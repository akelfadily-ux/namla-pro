/**
 * windowsEnvFilePolicyTests — the empty env-file argument must be a real path on
 * the platform it is handed to (SANDBOX-R0H).
 *
 * THE DEFECT. `--env-file /dev/null` was emitted unconditionally. `/dev/null` is
 * not a path on Windows, so Docker rejected the ENTIRE run with exit 125 and
 * "open /dev/null: The system cannot find the path specified" before any
 * container existed. Measured through `spawnSync` with `shell: false`, exactly
 * as production spawns: `/dev/null` exits 125, `NUL` exits 0, and `NUL` yields
 * an environment byte-identical to passing no env-file at all.
 *
 * A SHELL HIDES THIS. Run through Git Bash, MSYS rewrites `/dev/null` into a
 * Windows path and the same command appears to succeed. Any control for this
 * behaviour must therefore avoid a shell, or it proves nothing.
 *
 * WHAT THE FLAG DOES AND DOES NOT DO. It declares in the fixed argv that this
 * run injects no environment of its own. It does NOT neutralise the image's ENV
 * - the approved image still declares PATH, NODE_VERSION and YARN_VERSION - and
 * it is NOT what proves secrets are absent: that comes from the probe's
 * `secretsAbsent` finding, enforced by `classifyProbe`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { mkdtempSync, mkdirSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

import { emptyEnvFilePath, buildContainerRunArgs, FORBIDDEN_DOCKER_FLAGS, CONTAINER_WORKSPACE_MOUNT, CONTAINER_PROBE_MOUNT } from "../cognitive/containerSandboxBackend";
import { validateMountSource, type CanonicalMountSource } from "../cognitive/safeMountSource";
import { stageDefinitions } from "../cognitive/dockerStageBisection";

/**
 * A REAL canonical mount source, minted by the production validator exactly as
 * `containerSandboxTests` does. Forging the brand here would prove the argv
 * template while bypassing the boundary the template depends on.
 */
const FIXTURE_ROOT = realpathSync(mkdtempSync(resolve(tmpdir(), "namla-envfile-")));

function provenSource(name: string): CanonicalMountSource {
  const dir = join(FIXTURE_ROOT, name);
  mkdirSync(dir, { recursive: true });
  const r = validateMountSource(dir, [FIXTURE_ROOT], "workspace");
  if (!r.ok) throw new Error(`fixture "${name}" failed real validation: ${r.reasonCode}`);
  return r.canonicalPath;
}

const WORKSPACE_SOURCE = provenSource("ws");
const PROBE_SOURCE = provenSource("probe");

function argvFor(): readonly string[] {
  return buildContainerRunArgs({
    userIdentity: { uid: 10001, gid: 10001 },
    workspaceHostPath: WORKSPACE_SOURCE,
    sourceHostPath: null,
    probeHostPath: PROBE_SOURCE,
    cpuLimit: 1,
    memoryLimitMb: 512,
    pidLimit: 64,
    timeoutSeconds: 60,
    imageRef: "namla-sandbox:v1",
    networkMode: "none",
    containerName: "namla-test",
    command: ["node", `${CONTAINER_PROBE_MOUNT}/probe.js`],
  });
}

// ---------------------------------------------------------------------------
// 1 + 2. Platform-correct value.
// ---------------------------------------------------------------------------
test("1/2: the empty env-file is NUL on win32 and /dev/null on POSIX", () => {
  assert.equal(emptyEnvFilePath("win32"), "NUL");
  for (const platform of ["linux", "darwin", "freebsd", "openbsd"] as const) {
    assert.equal(emptyEnvFilePath(platform), "/dev/null", `${platform} must keep /dev/null`);
  }
});

// ---------------------------------------------------------------------------
// 3. No POSIX null path may reach a Windows invocation.
// ---------------------------------------------------------------------------
test("3: a Windows invocation carries no /dev/null anywhere in argv", (t) => {
  if (process.platform !== "win32") return t.skip("win32-only: this asserts the Windows argv");
  const argv = argvFor();
  const at = argv.indexOf("--env-file");
  assert.equal(at >= 0, true, "the empty env-file flag must still be present");
  assert.equal(argv[at + 1], "NUL", "and its value must be the Windows null device");
  assert.equal(argv.some((a) => a.includes("/dev/null")), false, "no argv entry may contain /dev/null on win32");
});

test("3b: the stage-bisection definitions use the same platform-derived value", () => {
  const stages = stageDefinitions({ workspaceHostPath: WORKSPACE_SOURCE, probeHostDir: PROBE_SOURCE, sourceHostPath: null });
  const envStage = stages.find((s) => s.flags.includes("--env-file"));
  assert.notEqual(envStage, undefined, "a stage must still exercise the env-file flag");
  const value = envStage!.flags[envStage!.flags.indexOf("--env-file") + 1];
  assert.equal(value, emptyEnvFilePath(), "the diagnostic path must not drift from the production value");
  if (process.platform === "win32") assert.equal(value, "NUL");
});

// ---------------------------------------------------------------------------
// 4. The value is platform-derived and nothing else.
// ---------------------------------------------------------------------------
test("4: no environment, CLI, mission or provider input can set the env-file path", () => {
  const before = emptyEnvFilePath();
  const injected = ["NAMLA_ENV_FILE", "DOCKER_ENV_FILE", "ENV_FILE", "NAMLA_SANDBOX_ENV_FILE"];
  const saved: Record<string, string | undefined> = {};
  for (const k of injected) {
    saved[k] = process.env[k];
    process.env[k] = "C:/attacker/env.list";
  }
  try {
    assert.equal(emptyEnvFilePath(), before, "no environment variable may change the env-file path");
    const argv = argvFor();
    assert.equal(argv.some((a) => a.includes("attacker")), false, "no injected value may reach argv");
    // Exactly one env-file option, so nothing can be appended alongside it.
    assert.equal(argv.filter((a) => a === "--env-file").length, 1, "exactly one --env-file option");
  } finally {
    for (const k of injected) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});

// ---------------------------------------------------------------------------
// 5 + 6. The argv template stays closed and deterministic.
// ---------------------------------------------------------------------------
test("5/6: the fixed argv carries no dangerous flag and is deterministic", () => {
  const a = argvFor();
  const b = argvFor();
  assert.deepEqual(a, b, "the same inputs must produce the same argv");
  for (const flag of FORBIDDEN_DOCKER_FLAGS) {
    assert.equal(a.includes(flag), false, `${flag} must never appear`);
  }
  assert.equal(a.some((x) => /docker\.sock/.test(x)), false, "no Docker socket mount");
  assert.equal(a[a.indexOf("--network") + 1], "none", "verification runs network-denied");
  // The safety flags the run depends on are all present.
  for (const flag of ["--rm", "--user", "--security-opt", "--cap-drop", "--read-only", "--ipc", "--pids-limit", "--memory", "--cpus"]) {
    assert.equal(a.includes(flag), true, `${flag} must be present`);
  }
  assert.equal(a[a.indexOf("--workdir") + 1], CONTAINER_WORKSPACE_MOUNT);
});
