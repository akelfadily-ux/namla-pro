/**
 * containerSandboxTests — deterministic proof of the container backend WITHOUT
 * a container runtime.
 *
 * Nothing here starts a container, pulls an image, installs a package, or
 * contacts a network. It proves the two things that are decidable offline:
 *
 *   1. The docker argv is a fixed template with every dangerous flag absent and
 *      every isolation flag present.
 *   2. Detection can never reach `available-and-verified`, and an unverified
 *      backend refuses execution — on every platform, including one with no
 *      runtime at all.
 *
 * Real isolation is proven only by the ubuntu CI job that runs the probe inside
 * a real container. This file deliberately does not claim otherwise.
 *
 * Run: node --test dist/tools/containerSandboxTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { enforcedNetworkModeFor, executionMountRoots, verificationWorkspaceRoots, probeMountRoots, buildContainerRunArgs, classifyProbe, claimsFromProbe, approvedImageReference, imageIsPinned, DockerContainerSandboxBackend, resolveTrustedWorkspaceIdentity, validateIdentity, IMAGE_DEFAULT_IDENTITY, FORBIDDEN_DOCKER_FLAGS, CONTAINER_WORKSPACE_MOUNT, CONTAINER_SOURCE_MOUNT, IMAGE_REPOSITORY, type ContainerRunSpec, type ProbeFindings } from "../cognitive/containerSandboxBackend";
import { SandboxPolicy, FakeSandboxBackend, buildSandboxReceipt, validateSandboxPolicySpec, networkPolicyEnforceable, requiredNetworkEnforcement, detectContainerRuntime, NO_ISOLATION_CLAIMS, ALL_ISOLATION_CLAIMS, DEFAULT_SANDBOX_POLICY, type SandboxExecutionRequest, type SandboxBackend, type SandboxCapabilityReport, type SandboxExecutionPermit, type SandboxExecutionReceipt, type SandboxIsolationClaims } from "../cognitive/sandboxPolicy";
import { evaluateNetworkCapability, classifyDestination, safeDestinationSummary, UnobservedNetworkProvider, StubNetworkObservationProvider, TOOL_NETWORK_DECLARATIONS, type NetworkPolicy } from "../cognitive/networkPolicy";
import { validateMountSource, validateMountSourceSet, revalidateMountSource, isMountSpecHostile, type CanonicalMountSource } from "../cognitive/safeMountSource";
import { runIsolationProbe } from "./containerIsolationProbe";
import { mkdtempSync, mkdirSync, rmSync, statSync, symlinkSync, writeFileSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { resolve, join } from "path";

/**
 * Mount-source fixtures for the argv-template tests, produced by the REAL
 * production validator over REAL temporary directories.
 *
 * There is deliberately no cast and no branding constructor anywhere in this
 * file: `CanonicalMountSource` is minted solely by `validateMountSource`, and a
 * test helper that forged one would prove the argv template while quietly
 * bypassing the very boundary the template depends on. If validation ever
 * regressed, these fixtures would throw at load and every argv test would fail
 * with them — which is the intended coupling.
 */
const FIXTURE_ROOT = realpathSync(mkdtempSync(resolve(tmpdir(), "namla-argv-")));

function provenSource(name: string): CanonicalMountSource {
  const dir = join(FIXTURE_ROOT, name);
  mkdirSync(dir, { recursive: true });
  const r = validateMountSource(dir, [FIXTURE_ROOT], "workspace");
  if (!r.ok) throw new Error(`argv fixture "${name}" failed real validation: ${r.reasonCode}`);
  return r.canonicalPath;
}

const WORKSPACE_SOURCE = provenSource("workspace");
const READONLY_SOURCE = provenSource("readonly-src");
const PROBE_SOURCE = provenSource("probe");

process.on("exit", () => {
  try {
    rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup of a temp fixture */
  }
});

/** A syntactically valid immutable identity for argv-shape tests. */
const TEST_IMAGE_ID = `sha256:${"a".repeat(64)}`;

function spec(overrides: Partial<ContainerRunSpec> = {}): ContainerRunSpec {
  return {
    workspaceHostPath: WORKSPACE_SOURCE,
    sourceHostPath: null,
    probeHostPath: null,
    // S-15: runs are addressed by immutable identity, never by the tag.
    imageRef: TEST_IMAGE_ID,
    cpuLimit: 1,
    memoryLimitMb: 512,
    pidLimit: 64,
    timeoutSeconds: 60,
    networkMode: "none",
    containerName: "namla-test-1",
    userIdentity: { uid: 1001, gid: 1001 },
    command: ["node", "--version"],
    ...overrides,
  };
}

/** A probe result where every isolation property holds. */
function goodFindings(): ProbeFindings {
  return { uidNonRoot: true, sensitiveHostMarkersAbsent: true, unexpectedApplicationMounts: [], dockerSocketAbsent: true, secretsAbsent: true, pidNamespaceIsolated: true, rootFilesystemReadOnly: true, writeOutsideWorkspaceFails: true, sourceMountReadOnly: true, workspaceWritable: true, memoryLimitBytes: 536870912, cpuLimitConfigured: true, pidLimit: 64, networkDenied: true };
}

// ------------------------------------------------------- ARGUMENT TEMPLATE ---

test("the argv contains every required isolation flag", () => {
  const args = buildContainerRunArgs(spec());
  const joined = args.join(" ");
  // NOTE: `--pid` is absent by design. Docker accepts only `host` and
  // `container:<id>`; the private namespace is the default when omitted.
  for (const required of ["--rm", "--user", "--security-opt", "no-new-privileges", "--cap-drop", "ALL", "--ipc", "private", "--read-only", "--tmpfs", "--cpus", "--memory", "--memory-swap", "--pids-limit", "--network", "none", "--workdir"]) {
    assert.equal(joined.includes(required), true, `argv must contain ${required}`);
  }
  assert.equal(args[0], "run", "the first argument must be `run`");
  // The identity is DERIVED from workspace ownership, so the literal
  // 10001:10001 is no longer asserted here - only that a non-root numeric
  // identity is present. See the ownership tests below.
  const userIndex = args.indexOf("--user");
  assert.match(args[userIndex + 1], /^[1-9][0-9]*:[1-9][0-9]*$/, "--user must be a non-root numeric uid:gid");
});

test("the argv contains NO dangerous flag", () => {
  const args = buildContainerRunArgs(spec({ sourceHostPath: READONLY_SOURCE, probeHostPath: PROBE_SOURCE }));
  for (const forbidden of FORBIDDEN_DOCKER_FLAGS) {
    assert.equal(args.includes(forbidden), false, `argv must never contain ${forbidden}`);
  }
  // No host namespace in any form.
  const joined = args.join(" ");
  for (const bad of ["host", "unconfined"]) {
    const hostNs = joined.includes(`--pid ${bad}`) || joined.includes(`--network ${bad}`) || joined.includes(`--ipc ${bad}`);
    assert.equal(hostNs, false, `argv must not select ${bad} namespaces`);
  }
  assert.equal(joined.includes("docker.sock"), false, "the Docker socket must never be mounted");
});

test("the ONLY network the argv can express is `none`", () => {
  // This test replaces one that asserted `--network bridge` was emitted
  // whenever the policy was not `denied`. That assertion ENCODED the defect:
  // bridge is unrestricted egress, and it was standing in for provider-only,
  // loopback-only and allowlisted. The union now has one member, so the
  // widening is not expressible rather than merely unused.
  const args = buildContainerRunArgs(spec({ networkMode: "none" }));
  const joined = args.join(" ");
  assert.equal(joined.includes("--network none"), true, "denied must give no interface at all");
  assert.equal(joined.includes("bridge"), false, "bridge must never appear in the argv");
  assert.equal(joined.includes("--network host"), false, "the host network must never be selected");

  const netIndex = args.indexOf("--network");
  assert.equal(netIndex >= 0, true, "--network must always be present");
  assert.equal(args[netIndex + 1], "none", "the only enforceable mode is none");

  // Exactly one --network flag: no later flag can override an earlier one.
  assert.equal(args.filter((a) => a === "--network").length, 1, "exactly one --network flag");
});

test("exactly one writable mount; source and probe mounts are read-only", () => {
  const args = buildContainerRunArgs(spec({ sourceHostPath: READONLY_SOURCE, probeHostPath: PROBE_SOURCE }));
  const mounts = args.filter((a) => a.startsWith("type=bind"));
  assert.equal(mounts.length, 3, "workspace + source + probe");
  const writable = mounts.filter((m) => m.includes("readonly=false"));
  assert.equal(writable.length, 1, "exactly ONE writable mount is permitted");
  assert.equal(writable[0].includes(`target=${CONTAINER_WORKSPACE_MOUNT}`), true, "the writable mount is the workspace");
  for (const m of mounts.filter((x) => x !== writable[0])) assert.equal(m.includes("readonly=true"), true, "every other mount must be read-only");
  assert.equal(mounts.some((m) => m.includes(`target=${CONTAINER_SOURCE_MOUNT}`) && m.includes("readonly=true")), true, "the source mount is read-only");
});

test("the image reference is fixed and never mission-provided", () => {
  const ref = approvedImageReference();
  assert.equal(ref.startsWith(IMAGE_REPOSITORY), true, "the image must be the approved repository");
  // S-15: the argv carries the IMMUTABLE identity, not the mutable tag. The
  // approved reference still names which image is wanted, but a tag in the argv
  // would let the daemon re-resolve the name at run time — the exact window
  // that let verified image A be replaced by image B.
  const built = buildContainerRunArgs(spec());
  assert.equal(built.includes(TEST_IMAGE_ID), true, "the built argv uses the resolved immutable identity");
  assert.equal(built.includes(ref), false, "the mutable tag must never reach the argv");
  assert.equal(built.includes("--pull"), true, "and a pull is explicitly refused");
  assert.equal(built[built.indexOf("--pull") + 1], "never");
  // Pinning is reported honestly rather than assumed.
  assert.equal(typeof imageIsPinned(), "boolean");
  assert.equal(imageIsPinned() ? ref.includes("@") : ref.includes(":"), true, "pinned refs use a digest, unpinned use a tag");
});

test("the in-container command is a fixed argv array, never a shell string", () => {
  const args = buildContainerRunArgs(spec({ command: ["npm", "test"] }));
  const imageIndex = args.indexOf(TEST_IMAGE_ID);
  assert.equal(imageIndex > 0, true);
  const command = args.slice(imageIndex + 1);
  assert.deepEqual(command, ["npm", "test"], "the command follows the image as discrete argv entries");
  for (const c of command) assert.equal(c.includes("&&") || c.includes("|") || c.includes(";"), false, "no shell metacharacter may appear");
  assert.equal(args.includes("sh"), false);
  assert.equal(args.includes("-c"), false, "no `sh -c` construction");
});

// --------------------------------------------------------- PROBE CLASSIFIER ---

test("a fully isolated probe result verifies; every single unmet property does not", () => {
  assert.equal(classifyProbe(goodFindings()), "ok");
  // NOT deepEqual against ALL_ISOLATION_CLAIMS any more: that assertion baked
  // in the false `explicitNetworkAllowlist: true`, which a denial probe cannot
  // evidence. A fully passing probe claims everything it PROVED, and withholds
  // the one capability no mechanism exists for (§32).
  assert.deepEqual(claimsFromProbe(goodFindings()), { ...ALL_ISOLATION_CLAIMS, explicitNetworkAllowlist: false });

  const cases: Array<[Partial<ProbeFindings>, string]> = [
    [{ uidNonRoot: false }, "sandbox-user-not-isolated"],
    [{ dockerSocketAbsent: false }, "sandbox-docker-socket-detected"],
    [{ sensitiveHostMarkersAbsent: false }, "sandbox-host-mount-detected"],
    [{ secretsAbsent: false }, "sandbox-secret-inheritance-detected"],
    [{ rootFilesystemReadOnly: false }, "sandbox-root-filesystem-writable"],
    [{ writeOutsideWorkspaceFails: false }, "sandbox-root-filesystem-writable"],
    [{ sourceMountReadOnly: false }, "sandbox-host-mount-detected"],
    [{ networkDenied: false }, "sandbox-network-not-denied"],
    [{ memoryLimitBytes: null }, "sandbox-memory-limit-unverified"],
    [{ cpuLimitConfigured: false }, "sandbox-cpu-limit-unverified"],
    [{ pidLimit: null }, "sandbox-pid-limit-unverified"],
  ];
  for (const [patch, expected] of cases) {
    const f = { ...goodFindings(), ...patch };
    assert.equal(classifyProbe(f), expected, `${JSON.stringify(patch)} must yield ${expected}`);
    assert.deepEqual(claimsFromProbe(f), NO_ISOLATION_CLAIMS, "a failed probe claims NOTHING");
  }
});

test("an empty or partial probe result never verifies", () => {
  assert.notEqual(classifyProbe({}), "ok", "no findings must not verify");
  assert.deepEqual(claimsFromProbe({}), NO_ISOLATION_CLAIMS);
  assert.notEqual(classifyProbe({ uidNonRoot: true }), "ok", "a single property is not enough");
});

// ------------------------------------------------------------- FAIL CLOSED ---

test("DETECTION alone never reaches available-and-verified", () => {
  const cap = detectContainerRuntime();
  assert.notEqual(cap.capabilityState, "available-and-verified", "detection must never verify");
  assert.equal(cap.verified, false);
  assert.deepEqual(cap.claims, NO_ISOLATION_CLAIMS, "a detected binary claims no isolation");
});

test("an unverified container backend refuses to execute and never falls back to the host", () => {
  const backend = new DockerContainerSandboxBackend();
  assert.equal(backend.isReal, true);
  assert.equal(backend.runtimeExecutableId, "docker");

  // Never verified -> detection state only.
  const cap = backend.detectCapability();
  assert.notEqual(cap.capabilityState, "available-and-verified");

  const gate = new SandboxPolicy(backend);
  const request: SandboxExecutionRequest = { objectiveId: "o", taskId: "t", workspaceId: "w", executableId: "npm", fixedArguments: ["test"], policy: DEFAULT_SANDBOX_POLICY, riskLevel: "high-risk", humanAuthorized: true };
  const auth = gate.authorize(request);
  assert.equal(auth.ok, false, "an unverified backend must never authorize high-risk work");
  assert.equal(auth.permit, null);
  assert.equal(["sandbox-runtime-unavailable", "sandbox-capability-unverified"].includes(auth.receipt.safeReasonCode), true, `unexpected ${auth.receipt.safeReasonCode}`);
  assert.equal(auth.receipt.blocked, true);
  assert.equal(auth.receipt.cpuLimit, 0, "a blocked receipt claims no enforced limit");
});

test("a forged permit is refused by the container backend itself", () => {
  const backend = new DockerContainerSandboxBackend();
  const forged = Object.freeze({ objectiveId: "x", taskId: "x", workspaceId: "x", executableId: "npm" as const, fixedArguments: [], policy: DEFAULT_SANDBOX_POLICY, backendId: "docker", capabilityState: "available-and-verified" as const });
  const receipt = backend.execute(forged);
  assert.equal(receipt.blocked, true, "a hand-built permit must never execute");
  assert.equal(receipt.executionStarted, false);
  assert.equal(receipt.safeReasonCode, "sandbox-capability-unverified");
});

// ------------------------------------------------------------- PROBE LOCAL ---

test("the probe runs on this host and reports findings without leaking values", () => {
  // Running the probe OUTSIDE a container is expected to report failures - the
  // point is that it executes safely and emits only booleans and scalars.
  const r = runIsolationProbe();
  const json = JSON.stringify(r);
  assert.equal(typeof r.uid, "number");
  assert.equal(typeof r.sensitiveHostMarkersAbsent, "boolean");
  assert.equal(typeof r.visibleProcessCount, "number");
  // Env NAMES may appear; VALUES must not.
  for (const name of r.forbiddenEnvNames) {
    const value = process.env[name];
    if (value && value.length >= 6) assert.equal(json.includes(value), false, `the value of ${name} must never be emitted`);
  }
  for (const forbidden of ["sk-", "ghp_", "-----BEGIN"]) assert.equal(json.includes(forbidden), false, `probe output must not contain ${forbidden}`);
});

test("outside a container the probe does NOT report a verified state", () => {
  const r = runIsolationProbe();
  // On a developer host the root filesystem is writable and the host is
  // visible, so classification must refuse. This guards against a probe that
  // trivially returns success.
  const findings: ProbeFindings = { uidNonRoot: r.uidNonRoot, sensitiveHostMarkersAbsent: r.sensitiveHostMarkersAbsent, unexpectedApplicationMounts: r.unexpectedApplicationMounts, dockerSocketAbsent: r.dockerSocketAbsent, secretsAbsent: r.secretsAbsent, pidNamespaceIsolated: r.pidNamespaceIsolated, rootFilesystemReadOnly: r.rootFilesystemReadOnly, writeOutsideWorkspaceFails: r.writeOutsideWorkspaceFails, sourceMountReadOnly: r.sourceMountReadOnly, workspaceWritable: r.workspaceWritable, memoryLimitBytes: r.memoryLimitBytes, cpuLimitConfigured: r.cpuLimitConfigured, pidLimit: r.pidLimit, networkDenied: r.networkDenied };
  assert.notEqual(classifyProbe(findings), "ok", "an un-contained host must never classify as isolated");
});

test("no real action is taken by this suite", () => {
  // No container was created, no image pulled, no provider run.
  const backend = new DockerContainerSandboxBackend();
  assert.equal(backend.detectCapability().verified, false);
});

// ------------------------------------------------------- PID NAMESPACE ---

test("production argv contains NO --pid flag in any form", () => {
  const args = buildContainerRunArgs(spec({ sourceHostPath: READONLY_SOURCE, probeHostPath: PROBE_SOURCE }));
  // `--pid private` is not a supported Docker value and made the daemon reject
  // the entire run with exit 125 before the container command executed.
  assert.equal(args.includes("--pid"), false, "--pid must not appear at all");
  const joined = args.join(" ");
  assert.equal(joined.includes("--pid private"), false, "the invalid pair must be gone");
  assert.equal(joined.includes("--pid host"), false, "the host PID namespace must never be selected");
  assert.equal(args.includes("--pid=host"), false, "nor its equals form");
  assert.equal(/--pid[= ]container:/.test(joined), false, "nor a shared container PID namespace");

  // The valid IPC flag is retained.
  assert.equal(joined.includes("--ipc private"), true, "--ipc private IS supported and stays");
});

test("removing --pid did not reintroduce any host namespace", () => {
  const args = buildContainerRunArgs(spec({ sourceHostPath: READONLY_SOURCE, probeHostPath: PROBE_SOURCE }));
  for (const forbidden of FORBIDDEN_DOCKER_FLAGS) {
    assert.equal(args.includes(forbidden), false, `${forbidden} must remain absent`);
  }
  const joined = args.join(" ");
  for (const bad of ["--network host", "--ipc host", "--userns host", "--privileged"]) {
    assert.equal(joined.includes(bad), false, `${bad} must remain absent`);
  }
});

test("the PID-isolation claim stays FALSE until a real probe observes it", () => {
  // Omitting --pid gives the private default, but omission is not evidence.
  // Only the probe's own observation may raise the claim.
  const unobserved = { ...goodFindings(), pidNamespaceIsolated: undefined };
  assert.notEqual(classifyProbe(unobserved), "ok", "an unobserved PID namespace must not verify");
  assert.deepEqual(claimsFromProbe(unobserved), NO_ISOLATION_CLAIMS, "no claim may be made without observation");
  assert.equal(claimsFromProbe(unobserved).noHostPidNamespace, false, "noHostPidNamespace must be false without proof");

  // And only a positive observation permits the claim.
  assert.equal(claimsFromProbe(goodFindings()).noHostPidNamespace, true, "an observed private namespace permits the claim");
});

test("a probe reporting pidNamespaceIsolated=false is refused", () => {
  const shared = { ...goodFindings(), pidNamespaceIsolated: false };
  assert.notEqual(classifyProbe(shared), "ok", "a shared PID namespace must never verify");
  assert.deepEqual(claimsFromProbe(shared), NO_ISOLATION_CLAIMS, "a failed probe claims nothing");

  // It must not authorize execution either.
  const backend = new DockerContainerSandboxBackend();
  const gate = new SandboxPolicy(backend);
  const auth = gate.authorize({ objectiveId: "o", taskId: "t", workspaceId: "w", executableId: "npm", fixedArguments: ["test"], policy: DEFAULT_SANDBOX_POLICY, riskLevel: "high-risk", humanAuthorized: true });
  assert.equal(auth.ok, false, "an unverified backend never authorizes high-risk work");
});

// ------------------------------------------------- NON-ROOT BIND OWNERSHIP ---

test("the identity is derived from real workspace metadata, never supplied", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "namla-own-"));
  try {
    const r = resolveTrustedWorkspaceIdentity(dir, process.platform);
    if (process.platform === "win32") {
      // statSync reports uid 0 for every file here, so ownership cannot be
      // proven and the resolver must refuse rather than guess.
      assert.equal(r.ok, false, "an unprovable identity must be refused");
      assert.equal(r.reasonCode, "sandbox-user-not-isolated");
    } else {
      assert.equal(r.ok, true, "a real POSIX directory yields its owner");
      if (r.ok) {
        assert.equal(r.identity.uid, statSync(dir).uid, "uid comes from the directory owner");
        assert.equal(r.identity.gid, statSync(dir).gid, "gid comes from the directory owner");
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Windows fails CLOSED because ownership cannot be proven", () => {
  const r = resolveTrustedWorkspaceIdentity("C:/anything", "win32");
  assert.equal(r.ok, false, "uid 0 for every file is indistinguishable from root");
  assert.equal(r.identity, null);
  assert.equal(r.reasonCode, "sandbox-user-not-isolated");
});

test("UID 0 and GID 0 are refused in either position", () => {
  assert.equal(validateIdentity(0, 1000).ok, false, "uid 0 must be refused");
  assert.equal(validateIdentity(1000, 0).ok, false, "gid 0 must be refused");
  assert.equal(validateIdentity(0, 0).ok, false);
  assert.equal(validateIdentity(1000, 1000).ok, true, "a real non-root identity is accepted");
});

test("invalid, missing, negative and fractional identities are refused", () => {
  const bad: Array<[unknown, unknown]> = [
    [-1, 1000],
    [1000, -1],
    [1.5, 1000],
    [1000, 2.7],
    [Number.NaN, 1000],
    [1000, Number.POSITIVE_INFINITY],
    [undefined, 1000],
    [null, 1000],
    ["1000", 1000],
  ];
  for (const [uid, gid] of bad) {
    assert.equal(validateIdentity(uid as number, gid as number).ok, false, `${String(uid)}:${String(gid)} must be refused`);
  }
  assert.equal(resolveTrustedWorkspaceIdentity("", "linux").ok, false, "an empty path is refused");
  assert.equal(resolveTrustedWorkspaceIdentity("/definitely/not/a/real/path", "linux").ok, false, "a missing path is refused");
});

test("production argv uses the trusted numeric non-root identity", () => {
  const args = buildContainerRunArgs(spec({ userIdentity: { uid: 1001, gid: 1002 } }));
  const i = args.indexOf("--user");
  assert.equal(i >= 0, true, "--user must be present");
  assert.equal(args[i + 1], "1001:1002", "the derived numeric identity is used verbatim");
  assert.equal(args[i + 1].includes("root"), false, "never a name, never root");
  assert.notEqual(args[i + 1], "0:0", "never root");
});

test("the image default stays non-root", () => {
  assert.equal(IMAGE_DEFAULT_IDENTITY.uid > 0, true);
  assert.equal(IMAGE_DEFAULT_IDENTITY.gid > 0, true);
  assert.deepEqual(IMAGE_DEFAULT_IDENTITY, { uid: 10001, gid: 10001 });
});

test("no chmod or world-writable fallback exists in the argv path", () => {
  const args = buildContainerRunArgs(spec({ sourceHostPath: READONLY_SOURCE, probeHostPath: PROBE_SOURCE }));
  // Substring-search the FLAGS only. Mount specs now carry real host paths
  // whose text is not ours to constrain — a random temp suffix could contain
  // "777" and would make this assertion flaky while proving nothing. Mount
  // safety is proven by the validator and by the mount assertions below, not
  // by searching a path for scary substrings.
  const flagArgs = args.filter((a) => !a.startsWith("type=bind"));
  const joined = flagArgs.join(" ");
  for (const bad of ["chmod", "0777", "777", "a+w", "o+w", "--userns", "--privileged"]) {
    assert.equal(joined.includes(bad), false, `argv must not contain ${bad}`);
  }
  const mounts = args.filter((a) => a.startsWith("type=bind"));
  assert.equal(mounts.filter((m) => m.includes("readonly=false")).length, 1, "still exactly one writable mount");
  // Every mount spec is exactly four fields: nothing the path contributed was
  // parsed as an extra option.
  for (const m of mounts) assert.equal(m.split(",").length, 4, "mount specs must remain type/source/target/readonly");
});

test("workspaceWritable=false maps to sandbox-workspace-not-writable", () => {
  const f = { ...goodFindings(), workspaceWritable: false };
  assert.equal(classifyProbe(f), "sandbox-workspace-not-writable", "the ownership mismatch gets its own code");
  assert.notEqual(classifyProbe(f), "sandbox-probe-failed", "no longer hidden behind a generic failure");
  assert.deepEqual(claimsFromProbe(f), NO_ISOLATION_CLAIMS, "a failed probe claims nothing");
});

test("the probe still refuses uidNonRoot=false", () => {
  const f = { ...goodFindings(), uidNonRoot: false };
  assert.equal(classifyProbe(f), "sandbox-user-not-isolated", "a root container is never accepted");
  assert.deepEqual(claimsFromProbe(f), NO_ISOLATION_CLAIMS);
});

test("claims stay ALL false until every probe property passes", () => {
  const keys: Array<keyof ProbeFindings> = ["uidNonRoot", "sensitiveHostMarkersAbsent", "dockerSocketAbsent", "secretsAbsent", "pidNamespaceIsolated", "rootFilesystemReadOnly", "writeOutsideWorkspaceFails", "sourceMountReadOnly", "workspaceWritable", "cpuLimitConfigured", "networkDenied"];
  for (const k of keys) {
    const f = { ...goodFindings(), [k]: false } as ProbeFindings;
    assert.deepEqual(claimsFromProbe(f), NO_ISOLATION_CLAIMS, `${String(k)}=false must yield NO claims`);
    assert.equal(Object.values(claimsFromProbe(f)).every((v) => v === false), true, "every claim must be false");
  }
  // A fully passing probe claims everything it PROVED. `explicitNetworkAllowlist`
  // is deliberately excluded: the probe evidences default-deny, never an
  // allowlist mechanism, and there is no such mechanism to evidence (§32).
  const passing = claimsFromProbe(goodFindings());
  const proven = (Object.keys(passing) as Array<keyof SandboxIsolationClaims>).filter((k) => k !== "explicitNetworkAllowlist");
  assert.equal(
    proven.every((k) => passing[k] === true),
    true,
    "a fully passing probe claims every property it proved",
  );
  assert.equal(passing.explicitNetworkAllowlist, false, "and withholds the one it cannot prove");
});

// ------------------------------------------------- §31 MOUNT SOURCE VALIDATION ---
// These tests use the REAL validator against REAL directories. No path is
// branded by hand here — a value only becomes a CanonicalMountSource by being
// proven, which is exactly the property under test.

/** A real temp directory tree. Caller must clean up. */
function mountFixture(tag: string): { root: string; inside: string } {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), `namla-mnt-${tag}-`)));
  const inside = join(root, "workspace");
  mkdirSync(inside, { recursive: true });
  return { root, inside };
}

test("a canonical directory inside an authorized root is accepted", () => {
  const { root, inside } = mountFixture("ok");
  try {
    const r = validateMountSource(inside, [root], "workspace");
    assert.equal(r.ok, true, "a real directory inside the authorized root must be accepted");
    if (!r.ok) return;
    assert.equal(r.reasonCode, "ok");
    assert.equal(r.canonicalPath, realpathSync(inside), "the CANONICAL path is returned, not the input string");
    assert.equal(r.role, "workspace");
    // The root itself is also a legitimate mount source.
    assert.equal(validateMountSource(root, [root], "workspace").ok, true, "the root may be mounted");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a missing mount source is refused", () => {
  const { root } = mountFixture("missing");
  try {
    const r = validateMountSource(join(root, "does-not-exist"), [root], "workspace");
    assert.equal(r.ok, false, "a non-existent source must never be mounted");
    assert.equal(r.reasonCode, "sandbox-mount-source-missing");
    assert.equal(r.canonicalPath, null, "no path may be handed back on refusal");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("relative paths and `..` traversal are refused, never normalized", () => {
  const { root, inside } = mountFixture("rel");
  try {
    for (const bad of ["relative/path", "./workspace", "../escape", "workspace"]) {
      const r = validateMountSource(bad, [root], "workspace");
      assert.equal(r.ok, false, `${bad} must be refused`);
      assert.equal(r.reasonCode, "sandbox-mount-source-invalid");
    }
    // An ABSOLUTE path containing `..` is refused OUTRIGHT rather than being
    // collapsed into an accepted path — even though it would resolve back
    // inside the authorized root. Silently normalizing is the failure mode.
    // NOT path.join: it collapses `..` before the validator would ever see it,
    // which would make this assertion vacuous.
    const traversal = `${inside}/../workspace`;
    assert.equal(traversal.includes(".."), true, "the fixture really does contain ..");
    const r = validateMountSource(traversal, [root], "workspace");
    assert.equal(r.ok, false, "a `..` segment must be refused, not collapsed");
    assert.equal(r.reasonCode, "sandbox-mount-source-invalid");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("empty, non-string, and NUL-bearing sources are refused", () => {
  const { root } = mountFixture("shape");
  try {
    for (const bad of ["", "\0", undefined, null, 42, {}, []]) {
      const r = validateMountSource(bad, [root], "workspace");
      assert.equal(r.ok, false, `${String(bad)} must be refused`);
      assert.equal(r.reasonCode, "sandbox-mount-source-invalid");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a source that would inject extra --mount options is refused", () => {
  // `--mount` takes a COMMA-SEPARATED list of key=value pairs, so a comma or
  // equals sign in the source is not data — it is parsed as further mount
  // options appended to ours. shell:false does not help: the injection happens
  // inside a single argv element.
  const { root } = mountFixture("inject");
  try {
    const injections = [`${root},readonly=false`, `${root},target=/host`, `${root}=x`, `${root},type=bind`];
    for (const bad of injections) {
      assert.equal(isMountSpecHostile(bad), true, `${bad} must be recognised as mount-spec hostile`);
      const r = validateMountSource(bad, [root], "workspace");
      assert.equal(r.ok, false, "a mount-spec injection must be refused");
      assert.equal(r.reasonCode, "sandbox-mount-source-invalid");
    }
    // Ordinary hyphens and spaces must still be accepted — refusing them would
    // break real hosts (`C:\Program Files`, `namla-sandbox-verify-abc`).
    assert.equal(isMountSpecHostile("/tmp/namla-sandbox-verify-abc123"), false, "hyphens are legal");
    assert.equal(isMountSpecHostile("C:\\Program Files\\app"), false, "spaces are legal");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a source escaping the authorized root is refused", () => {
  const a = mountFixture("root-a");
  const b = mountFixture("root-b");
  try {
    // A perfectly canonical, existing directory is still not mountable when it
    // is not inside a root the trusted process nominated.
    const r = validateMountSource(b.inside, [a.root], "workspace");
    assert.equal(r.ok, false, "an unauthorized root must be refused");
    assert.equal(r.reasonCode, "sandbox-mount-source-outside-root");

    // An EMPTY root list authorizes nothing — fail closed, not fail open.
    const none = validateMountSource(a.inside, [], "workspace");
    assert.equal(none.ok, false, "no authorized roots means no mount is authorized");
    assert.equal(none.reasonCode, "sandbox-mount-source-outside-root");

    // A root that cannot itself be proven authorizes nothing either.
    const bogus = validateMountSource(a.inside, [join(a.root, "not-a-real-root")], "workspace");
    assert.equal(bogus.ok, false, "an unprovable root authorizes nothing");
    assert.equal(bogus.reasonCode, "sandbox-mount-source-outside-root");
  } finally {
    rmSync(a.root, { recursive: true, force: true });
    rmSync(b.root, { recursive: true, force: true });
  }
});

test("a file, not a directory, is refused", () => {
  const { root } = mountFixture("filetype");
  try {
    const file = join(root, "a-file.txt");
    writeFileSync(file, "x", "utf8");
    const r = validateMountSource(file, [root], "workspace");
    assert.equal(r.ok, false, "a bind-mount source must be a directory");
    assert.equal(r.reasonCode, "sandbox-mount-source-not-directory");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a SYMLINKED / junctioned mount source is refused", (t) => {
  const inside = mountFixture("link-in");
  const outside = mountFixture("link-out");
  try {
    const link = join(inside.root, "escape");
    try {
      // "junction" is the Windows form; libuv reports both as symbolic links.
      symlinkSync(outside.inside, link, process.platform === "win32" ? "junction" : "dir");
    } catch {
      t.skip("platform does not permit directory link creation");
      return;
    }

    // The link is INSIDE the authorized root and looks perfectly legitimate.
    const r = validateMountSource(link, [inside.root], "workspace");
    assert.equal(r.ok, false, "a linked source must never be mounted");
    assert.equal(r.reasonCode, "sandbox-mount-source-symlink", "the reason must name the link, not something vague");

    // And a link whose canonical target escapes is refused on containment too,
    // proving the two defences are independent rather than one check twice.
    const viaParent = join(link, "nested");
    mkdirSync(viaParent, { recursive: true });
    const nested = validateMountSource(viaParent, [inside.root], "workspace");
    assert.equal(nested.ok, false, "a link in a PARENT component must also be refused");
    assert.equal(nested.reasonCode, "sandbox-mount-source-outside-root", "canonical containment catches the parent link");
  } finally {
    rmSync(inside.root, { recursive: true, force: true });
    rmSync(outside.root, { recursive: true, force: true });
  }
});

test("read-only source and probe mounts are validated with their own roots", () => {
  const ws = mountFixture("set-ws");
  const build = mountFixture("set-build");
  try {
    const ok = validateMountSourceSet({
      workspace: ws.inside,
      readOnlySource: ws.root,
      probe: build.inside,
      workspaceRoots: [ws.root],
      probeRoots: [build.root],
    });
    assert.equal(ok.ok, true, "all three mounts prove out against their own roots");
    if (!ok.ok) return;
    assert.equal(ok.sources.workspace, realpathSync(ws.inside));
    assert.equal(ok.sources.readOnlySource, realpathSync(ws.root));
    assert.equal(ok.sources.probe, realpathSync(build.inside));

    // A probe path is NOT authorized by the workspace root: build artefacts and
    // workspace data have separate authorization.
    const crossed = validateMountSourceSet({ workspace: ws.inside, probe: build.inside, workspaceRoots: [ws.root], probeRoots: [ws.root] });
    assert.equal(crossed.ok, false, "a probe outside the build root must be refused");
    assert.equal(crossed.reasonCode, "sandbox-mount-source-outside-root");

    // A bad READ-ONLY source fails the whole set — one bad mount blocks the run.
    const badSource = validateMountSourceSet({ workspace: ws.inside, readOnlySource: build.inside, workspaceRoots: [ws.root], probeRoots: [build.root] });
    assert.equal(badSource.ok, false, "an unauthorized read-only source blocks the set");
    assert.equal(badSource.sources, null, "no partial source set may escape");

    // An ABSENT optional mount is not a failure.
    const minimal = validateMountSourceSet({ workspace: ws.inside, readOnlySource: null, probe: null, workspaceRoots: [ws.root], probeRoots: [build.root] });
    assert.equal(minimal.ok, true, "null optional mounts are legitimate");
    if (minimal.ok) {
      assert.equal(minimal.sources.readOnlySource, null);
      assert.equal(minimal.sources.probe, null);
    }
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
    rmSync(build.root, { recursive: true, force: true });
  }
});

test("re-validation refuses a source that changed after it was approved", () => {
  const { root, inside } = mountFixture("toctou");
  try {
    const first = validateMountSource(inside, [root], "workspace");
    assert.equal(first.ok, true);
    if (!first.ok) return;

    // Still the same object: re-validation passes.
    const again = revalidateMountSource(first.canonicalPath, [root], "workspace");
    assert.equal(again.ok, true, "an unchanged source re-validates");

    // The object is destroyed between approval and use.
    rmSync(inside, { recursive: true, force: true });
    const gone = revalidateMountSource(first.canonicalPath, [root], "workspace");
    assert.equal(gone.ok, false, "a source that vanished must not be mounted");
    assert.equal(gone.reasonCode, "sandbox-mount-source-missing");

    // Replaced by a FILE of the same name — same path, different object.
    writeFileSync(inside, "swapped", "utf8");
    const swapped = revalidateMountSource(first.canonicalPath, [root], "workspace");
    assert.equal(swapped.ok, false, "a swapped object must not be mounted");
    assert.equal(swapped.reasonCode, "sandbox-mount-source-not-directory");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the VALIDATED CANONICAL path is what reaches the Docker argv", () => {
  const { root, inside } = mountFixture("argv");
  try {
    const v = validateMountSource(inside, [root], "workspace");
    assert.equal(v.ok, true);
    if (!v.ok) return;

    const args = buildContainerRunArgs(spec({ workspaceHostPath: v.canonicalPath }));
    const mount = args.find((a) => a.startsWith("type=bind") && a.includes(CONTAINER_WORKSPACE_MOUNT));
    assert.notEqual(mount, undefined, "the workspace mount must be present");
    assert.equal(mount?.includes(`source=${v.canonicalPath}`), true, "argv carries the canonical path verbatim");
    // The mount spec must remain exactly four fields — proof that nothing the
    // path contributed was parsed as an extra option.
    assert.equal(mount?.split(",").length, 4, "type, source, target, readonly — and nothing else");
    assert.equal(mount?.startsWith("type=bind,source="), true);
    assert.equal(mount?.endsWith(`target=${CONTAINER_WORKSPACE_MOUNT},readonly=false`), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a backend with NO authorized roots executes nothing and claims nothing", () => {
  // The decisive fail-closed test: an unverified backend must refuse, and the
  // refusal must not be accompanied by any isolation claim.
  const backend = new DockerContainerSandboxBackend({ authorizedMountRoots: [] });
  const cap = backend.detectCapability();
  assert.notEqual(cap.capabilityState, "available-and-verified", "detection alone never verifies");
  assert.deepEqual(cap.claims, NO_ISOLATION_CLAIMS, "an unverified backend claims nothing");

  const gate = new SandboxPolicy(backend);
  const auth = gate.authorize({ objectiveId: "o", taskId: "t", workspaceId: "w", executableId: "npm", fixedArguments: ["test"], policy: DEFAULT_SANDBOX_POLICY, riskLevel: "high-risk", humanAuthorized: true });
  assert.equal(auth.ok, false, "no permit is issued without a verified backend");
});

test("the default policy's container path is NOT a valid host mount source", () => {
  // DEFAULT_SANDBOX_POLICY.mounts.workspaceMountPath is "/workspace" — a path
  // INSIDE the container that was being passed to Docker as a HOST bind-mount
  // source. That is the mount confusion this milestone closes.
  const { root } = mountFixture("default");
  try {
    const r = validateMountSource(DEFAULT_SANDBOX_POLICY.mounts.workspaceMountPath, [root], "workspace");
    assert.equal(r.ok, false, "a container-side path must never be accepted as a host source");
    assert.equal(r.canonicalPath, null);
    assert.equal(["sandbox-mount-source-missing", "sandbox-mount-source-outside-root"].includes(r.reasonCode), true, `unexpected reason ${r.reasonCode}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("no refusal ever leaks a host path", () => {
  const a = mountFixture("leak-a");
  const b = mountFixture("leak-b");
  try {
    const refusals = [
      validateMountSource(b.inside, [a.root], "workspace"),
      validateMountSource(join(a.root, "missing"), [a.root], "workspace"),
      validateMountSource(`${a.root},readonly=false`, [a.root], "workspace"),
      validateMountSource("relative", [a.root], "workspace"),
    ];
    for (const r of refusals) {
      assert.equal(r.ok, false);
      const serialized = JSON.stringify(r);
      assert.equal(serialized.includes(a.root), false, "the authorized root must not appear in a refusal");
      assert.equal(serialized.includes(b.root), false, "the rejected path must not appear in a refusal");
      assert.equal(serialized.includes(tmpdir()), false, "no host directory may appear at all");
      assert.match(r.reasonCode, /^sandbox-mount-source-/, "only a fixed reason token is returned");
    }
  } finally {
    rmSync(a.root, { recursive: true, force: true });
    rmSync(b.root, { recursive: true, force: true });
  }
});

// ------------------------------------------- §31 AUTHORIZATION-ROOT MODEL ---
// A validator is useless if the caller picks BOTH the path and the root that
// authorizes it: `X inside X` is true for every X, so containment alone proves
// nothing. These tests pin down where roots may come from.

test("self-authorization proves containment but is NOT authorization", () => {
  const { root, inside } = mountFixture("self");
  try {
    // Containment genuinely holds when a path is offered as its own root — the
    // validator says yes, and that is exactly why the validator alone is not
    // the security boundary. The ROOT MODEL is.
    const selfAuthorized = validateMountSource(inside, [inside], "workspace");
    assert.equal(selfAuthorized.ok, true, "a path is trivially inside itself");

    // EXECUTION therefore never lets configuration default to the requested
    // path: with no configured roots the authorized set is EMPTY, not the
    // caller's own path.
    assert.deepEqual(executionMountRoots({}), [], "absent configuration authorizes nothing for execution");
    assert.deepEqual(executionMountRoots({ authorizedMountRoots: [] }), [], "an empty list stays empty");
    assert.deepEqual(executionMountRoots({ authorizedMountRoots: [root] }), [root], "only configured roots are used");

    // And the resulting empty set refuses the very path a caller supplied.
    const underExecutionRules = validateMountSource(inside, executionMountRoots({}), "workspace");
    assert.equal(underExecutionRules.ok, false, "execution must refuse a self-authorized mount");
    assert.equal(underExecutionRules.reasonCode, "sandbox-mount-source-outside-root");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verification trusts its OWN ephemeral workspace, and only that", () => {
  const { root, inside } = mountFixture("verify-roots");
  const build = mountFixture("verify-build");
  try {
    // The probe workspace is created by `verifyContainerSandbox` with mkdtemp
    // moments earlier and deleted straight after; it is not caller data, so it
    // may authorize itself. This is the ONE documented difference from
    // execution, and it is explicit rather than an accidental default.
    assert.deepEqual(verificationWorkspaceRoots({}, inside), [inside], "the trusted ephemeral workspace authorizes itself");
    // Explicit configuration still wins over that fallback.
    assert.deepEqual(verificationWorkspaceRoots({ authorizedMountRoots: [root] }, inside), [root], "configuration overrides the fallback");

    // The PROBE directory gets no such treatment: it is always constrained to
    // the trusted build root and can never authorize itself.
    assert.deepEqual(probeMountRoots({}), [process.cwd()], "probe mounts default to the build root");
    assert.deepEqual(probeMountRoots({ trustedBuildRoot: build.root }), [build.root], "an explicit build root is used");
    // The workspace tree is a DIFFERENT tree from the build root, so a probe
    // pointed at the workspace is refused — the two authorizations do not mix.
    const probeAtWorkspace = validateMountSource(inside, probeMountRoots({ trustedBuildRoot: build.root }), "probe");
    assert.equal(probeAtWorkspace.ok, false, "a probe outside the build root is refused");
    assert.equal(probeAtWorkspace.reasonCode, "sandbox-mount-source-outside-root");
    // A probe INSIDE the build root is accepted — proving the refusal above is
    // about the root, not about probes being refused unconditionally.
    assert.equal(validateMountSource(build.inside, probeMountRoots({ trustedBuildRoot: build.root }), "probe").ok, true, "a probe inside the build root is accepted");
    // A probe can never authorize itself the way the ephemeral workspace may.
    const probeSelf = validateMountSource(build.inside, probeMountRoots({ trustedBuildRoot: root }), "probe");
    assert.equal(probeSelf.ok, false, "a probe is never self-authorized");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(build.root, { recursive: true, force: true });
  }
});

test("nothing a permit carries can widen the authorized roots", () => {
  const attacker = mountFixture("attacker");
  try {
    // A permit is frozen policy data. Even a policy naming a perfectly real,
    // canonical directory cannot authorize it, because the root set is read
    // from BACKEND CONFIGURATION and the permit contributes nothing to it.
    const policy = {
      ...DEFAULT_SANDBOX_POLICY,
      mounts: { ...DEFAULT_SANDBOX_POLICY.mounts, workspaceMountPath: attacker.inside, readOnlySourceMount: attacker.root },
    };
    const roots = executionMountRoots({});
    assert.equal(roots.length, 0, "a permit contributed no root");

    const w = validateMountSource(policy.mounts.workspaceMountPath, roots, "workspace");
    assert.equal(w.ok, false, "a permit-named workspace is refused without a configured root");
    const s = validateMountSource(policy.mounts.readOnlySourceMount, roots, "readonly-source");
    assert.equal(s.ok, false, "a permit-named read-only source is refused too");

    // The whole set fails, and no partial source escapes.
    const set = validateMountSourceSet({ workspace: policy.mounts.workspaceMountPath, readOnlySource: policy.mounts.readOnlySourceMount, probe: null, workspaceRoots: roots, probeRoots: probeMountRoots({}) });
    assert.equal(set.ok, false, "the set fails closed");
    assert.equal(set.sources, null, "no canonical source is produced");
  } finally {
    rmSync(attacker.root, { recursive: true, force: true });
  }
});

test("a refused mount yields no execution, no claim, and no host path", () => {
  const { root, inside } = mountFixture("refused");
  try {
    const set = validateMountSourceSet({ workspace: inside, readOnlySource: null, probe: null, workspaceRoots: [], probeRoots: [process.cwd()] });
    assert.equal(set.ok, false, "validation must fail with no authorized roots");
    assert.equal(set.sources, null, "structurally, there is nothing to hand to Docker");

    // No isolation claim may accompany a mount refusal.
    const backend = new DockerContainerSandboxBackend({ authorizedMountRoots: [] });
    assert.deepEqual(backend.detectCapability().claims, NO_ISOLATION_CLAIMS, "a refusal claims nothing");
    assert.notEqual(backend.detectCapability().capabilityState, "available-and-verified");

    // And the refusal itself carries no host path.
    const serialized = JSON.stringify(set);
    assert.equal(serialized.includes(root), false, "no host path in the refusal");
    assert.equal(serialized.includes(inside), false, "no host path in the refusal");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --------------------------------------- §32 NETWORK POLICY TRUTHFULNESS ---
// The defect: every policy that was not `denied` became `--network bridge`,
// which is unrestricted egress. provider-only, loopback-only and allowlisted
// exist precisely to EXCLUDE destinations, so substituting bridge granted the
// whole set they were meant to withhold — and `provider-only` is the policy
// TOOL_NETWORK_DECLARATIONS assigns to both real providers.


/**
 * A deterministic backend reporting EXACTLY the claims it is handed, in the
 * verified state. It exists so the gate can be exercised against the claim set
 * a REAL container actually produces, instead of against ALL_ISOLATION_CLAIMS.
 * It performs no isolation and executes nothing meaningful.
 */
class ClaimScopedFakeBackend implements SandboxBackend {
  readonly backendId = "claim-scoped-fake";
  readonly isReal = false;
  executeCallCount = 0;

  constructor(private readonly claims: SandboxIsolationClaims) {}

  detectCapability(): SandboxCapabilityReport {
    return { backendId: this.backendId, capabilityState: "available-and-verified", available: true, verified: true, detectionMethod: "fake", detectionDetail: "deterministic claim-scoped test backend - performs NO real isolation", claims: this.claims, safeReasonCode: "ok" };
  }

  execute(permit: SandboxExecutionPermit): SandboxExecutionReceipt {
    this.executeCallCount += 1;
    return buildSandboxReceipt({ backendId: this.backendId, capabilityState: "available-and-verified", executionStarted: true, executionCompleted: true, exitCategory: "completed", timeoutMs: permit.policy.limits.timeoutMs, cpuLimit: permit.policy.limits.cpuLimit, memoryLimitMb: permit.policy.limits.memoryLimitMb, pidLimit: permit.policy.limits.pidLimit, networkPolicy: permit.policy.network.policy, mountPolicy: "bounded-workspace-only", cleanupComplete: true, blocked: false, safeReasonCode: "ok" });
  }
}

const NARROWER_THAN_OPEN: readonly NetworkPolicy[] = ["loopback-only", "provider-only", "allowlisted"];

/** A verified capability report whose claims are exactly what the probe proves. */
function verifiedClaims(): SandboxIsolationClaims {
  return claimsFromProbe(goodFindings());
}

test("denied is enforceable and resolves to --network none", () => {
  const r = enforcedNetworkModeFor("denied");
  assert.equal(r.ok, true, "denied must remain supported");
  if (!r.ok) return;
  assert.equal(r.mode, "none", "denied means no interface at all");
  assert.equal(r.reasonCode, "ok");
  assert.equal(buildContainerRunArgs(spec({ networkMode: r.mode })).join(" ").includes("--network none"), true);
});

test("no narrower-than-open policy silently becomes bridge", () => {
  for (const policy of NARROWER_THAN_OPEN) {
    const r = enforcedNetworkModeFor(policy);
    assert.equal(r.ok, false, `${policy} has no real enforcement mechanism and must be refused`);
    assert.equal(r.mode, null, `${policy} must yield NO docker network mode`);
    assert.equal(r.reasonCode, "sandbox-network-policy-unenforceable", `${policy} must name the exact cause`);
    // Not the generic "refused" code, which means something different.
    assert.notEqual(r.reasonCode, "sandbox-network-policy-refused", `${policy} is unenforceable, not forbidden`);
  }
});

test("`allowed` stays forbidden outright, not merely unenforceable", () => {
  const r = enforcedNetworkModeFor("allowed");
  assert.equal(r.ok, false, "unrestricted egress must never be granted");
  assert.equal(r.mode, null);
  assert.equal(r.reasonCode, "sandbox-network-policy-refused", "forbidden, not unenforceable");
});

test("bridge is not reachable from any declared policy", () => {
  // Exhaustive over the whole NetworkPolicy union: NOTHING produces bridge.
  const every: readonly NetworkPolicy[] = ["denied", "loopback-only", "provider-only", "allowlisted", "allowed"];
  for (const policy of every) {
    const r = enforcedNetworkModeFor(policy);
    if (!r.ok) continue;
    const joined = buildContainerRunArgs(spec({ networkMode: r.mode })).join(" ");
    assert.equal(joined.includes("bridge"), false, `${policy} must never produce bridge`);
    assert.equal(joined.includes("--network host"), false, `${policy} must never produce host networking`);
    assert.equal(joined.includes("--network none"), true, `${policy} resolved to a mode, which can only be none`);
  }
});

// ------------------------------------------- CAPABILITY CLAIM TRUTHFULNESS ---

test("a denial probe proves default-deny and NOT an allowlist", () => {
  const claims = verifiedClaims();
  assert.equal(claims.defaultDenyNetwork, true, "the outbound-connection attempt failed, so default-deny holds");
  assert.equal(claims.noHostNetworkNamespace, true, "a shared host netns would have let the connection succeed");

  // THE correction: this was true, asserted purely from a denial result.
  assert.equal(claims.explicitNetworkAllowlist, false, "no allowlist mechanism exists, so no allowlist may be claimed");
});

test("claims are no longer taken wholesale from ALL_ISOLATION_CLAIMS", () => {
  const claims = verifiedClaims();
  assert.notDeepEqual(claims, ALL_ISOLATION_CLAIMS, "a real probe must not assert every possible capability");
  // Precisely one claim differs, and it is the unevidenced one.
  const differing = (Object.keys(ALL_ISOLATION_CLAIMS) as Array<keyof SandboxIsolationClaims>).filter((k) => claims[k] !== ALL_ISOLATION_CLAIMS[k]);
  assert.deepEqual(differing, ["explicitNetworkAllowlist"], "exactly the unproven claim is withheld");
});

test("a failed probe still claims nothing at all", () => {
  const denied = { ...goodFindings(), networkDenied: false };
  assert.equal(classifyProbe(denied), "sandbox-network-not-denied", "a reachable network is named exactly");
  assert.deepEqual(claimsFromProbe(denied), NO_ISOLATION_CLAIMS, "a failed probe claims nothing");
  assert.equal(claimsFromProbe(denied).defaultDenyNetwork, false, "default-deny is not claimed when the probe reached out");
});

// ------------------------------------------------------------ POLICY GATE ---

test("the gate refuses a policy the verified backend cannot enforce", () => {
  const claims = verifiedClaims();
  assert.equal(networkPolicyEnforceable("denied", claims), "ok", "denied is enforceable under a verified probe");
  for (const policy of NARROWER_THAN_OPEN) {
    assert.equal(networkPolicyEnforceable(policy, claims), "sandbox-network-policy-unenforceable", `${policy} must be refused`);
  }
  assert.equal(networkPolicyEnforceable("allowed", claims), "sandbox-network-policy-refused");
  assert.deepEqual(requiredNetworkEnforcement("denied"), { kind: "claim", claim: "defaultDenyNetwork" });
  assert.deepEqual(requiredNetworkEnforcement("allowlisted"), { kind: "claim", claim: "explicitNetworkAllowlist" });
  assert.deepEqual(requiredNetworkEnforcement("allowed"), { kind: "forbidden" }, "no claim can authorize unrestricted egress");

  // loopback-only and provider-only are NOT allowlisting. Tying them to
  // `explicitNetworkAllowlist` would silently authorize them the day an
  // unrelated destination-allowlist proxy shipped, even though neither has
  // been proven. They require their own verified mechanism.
  for (const policy of ["loopback-only", "provider-only"] as NetworkPolicy[]) {
    assert.deepEqual(requiredNetworkEnforcement(policy), { kind: "no-mechanism" }, `${policy} has no claim that could authorize it`);
  }
});

test("an allowlist capability does NOT unlock loopback-only or provider-only", () => {
  // The forward-looking fail-closed property: even a backend that has genuinely
  // built and verified a destination allowlist must not thereby be treated as
  // enforcing loopback-only (127.0.0.1 and nothing else) or provider-only
  // (exactly one external service). Those are different mechanisms.
  const withAllowlist: SandboxIsolationClaims = { ...claimsFromProbe(goodFindings()), explicitNetworkAllowlist: true };

  assert.equal(networkPolicyEnforceable("allowlisted", withAllowlist), "ok", "the claim authorizes exactly the policy it proves");
  for (const policy of ["loopback-only", "provider-only"] as NetworkPolicy[]) {
    assert.equal(networkPolicyEnforceable(policy, withAllowlist), "sandbox-network-policy-unenforceable", `${policy} must stay blocked`);
  }
  assert.equal(networkPolicyEnforceable("allowed", withAllowlist), "sandbox-network-policy-refused", "unrestricted egress stays forbidden");
});

test("a VERIFIED baseline alone does not authorize unsupported networking", () => {
  // The whole point: `available-and-verified` means the baseline sandbox was
  // proven, NOT that every NetworkPolicy is enforceable. A fake backend in the
  // verified state passes every capability check and must still be refused.
  const backend = new FakeSandboxBackend("available-and-verified");
  const gate = new SandboxPolicy(backend);

  for (const policy of NARROWER_THAN_OPEN) {
    const request: SandboxExecutionRequest = {
      objectiveId: "o",
      taskId: "t",
      workspaceId: "w",
      executableId: "npm",
      fixedArguments: ["test"],
      policy: { ...DEFAULT_SANDBOX_POLICY, network: { policy, allowlist: [] } },
      riskLevel: "high-risk",
      humanAuthorized: true,
    };
    const auth = gate.authorize(request);
    // This synthetic fake claims EVERYTHING, including explicitNetworkAllowlist.
    // `allowlisted` is therefore authorized — which is how the gate proves it is
    // driven by CLAIMS rather than a hard-coded policy list. loopback-only and
    // provider-only remain blocked even so, because no claim maps to them.
    if (policy === "allowlisted") {
      assert.equal(auth.ok, true, "an all-claims fake authorizes exactly the policy its claim proves");
    } else {
      assert.equal(auth.ok, false, `${policy} has no mechanism, so even an all-claims backend cannot authorize it`);
      assert.equal(auth.receipt.safeReasonCode, "sandbox-network-policy-unenforceable");
    }
  }

  // Now the honest claim set a REAL verified container produces: refused.
  const realistic = new ClaimScopedFakeBackend(verifiedClaims());
  const realisticGate = new SandboxPolicy(realistic);
  for (const policy of NARROWER_THAN_OPEN) {
    const auth = realisticGate.authorize({
      objectiveId: "o",
      taskId: "t",
      workspaceId: "w",
      executableId: "npm",
      fixedArguments: ["test"],
      policy: { ...DEFAULT_SANDBOX_POLICY, network: { policy, allowlist: [] } },
      riskLevel: "high-risk",
      humanAuthorized: true,
    });
    assert.equal(auth.ok, false, `${policy} must be refused under REAL container claims`);
    assert.equal(auth.permit, null, "no permit may exist");
    assert.equal(auth.receipt.blocked, true);
    assert.equal(auth.receipt.safeReasonCode, "sandbox-network-policy-unenforceable");
    assert.equal(auth.receipt.executionStarted, false, "no process may be created");
    assert.equal(realistic.executeCallCount, 0, "the backend must never be invoked");
  }
});

test("denied still authorizes and still carries every other guarantee", () => {
  const realistic = new ClaimScopedFakeBackend(verifiedClaims());
  const gate = new SandboxPolicy(realistic);
  const auth = gate.authorize({
    objectiveId: "o",
    taskId: "t",
    workspaceId: "w",
    executableId: "npm",
    fixedArguments: ["test"],
    policy: DEFAULT_SANDBOX_POLICY,
    riskLevel: "high-risk",
    humanAuthorized: true,
  });
  assert.equal(auth.ok, true, "the supported policy must still work");
  assert.equal(auth.receipt.networkPolicy, "denied", "the receipt records what was actually enforced");

  // And the S-1 mount guarantees are untouched by this milestone.
  const args = buildContainerRunArgs(spec({ sourceHostPath: READONLY_SOURCE, probeHostPath: PROBE_SOURCE }));
  const mounts = args.filter((a) => a.startsWith("type=bind"));
  assert.equal(mounts.filter((m) => m.includes("readonly=false")).length, 1, "still exactly one writable mount");
  assert.equal(args.join(" ").includes("--network none"), true, "still network-denied");
});

test("no receipt claims a stronger network policy than was enforced", () => {
  const realistic = new ClaimScopedFakeBackend(verifiedClaims());
  const gate = new SandboxPolicy(realistic);
  for (const policy of [...NARROWER_THAN_OPEN, "allowed"] as NetworkPolicy[]) {
    const auth = gate.authorize({
      objectiveId: "o",
      taskId: "t",
      workspaceId: "w",
      executableId: "npm",
      fixedArguments: ["test"],
      policy: { ...DEFAULT_SANDBOX_POLICY, network: { policy, allowlist: [] } },
      riskLevel: "high-risk",
      humanAuthorized: true,
    });
    assert.equal(auth.ok, false, `${policy} must not be authorized`);
    // A blocked receipt reports the SAFE default, never the requested policy —
    // otherwise the audit record would read as though it had been enforced.
    assert.equal(auth.receipt.networkPolicy, "denied", "a blocked receipt never advertises the requested policy");
  }
});

test("network refusals leak no destination, host, or credential", () => {
  const realistic = new ClaimScopedFakeBackend(verifiedClaims());
  const gate = new SandboxPolicy(realistic);
  const auth = gate.authorize({
    objectiveId: "o",
    taskId: "t",
    workspaceId: "w",
    executableId: "npm",
    fixedArguments: ["test"],
    policy: { ...DEFAULT_SANDBOX_POLICY, network: { policy: "allowlisted", allowlist: ["provider-service", "package-registry"] } },
    riskLevel: "high-risk",
    humanAuthorized: true,
  });
  assert.equal(auth.ok, false);
  const serialized = JSON.stringify(auth.receipt);
  for (const forbidden of ["http", "://", "api.anthropic.com", "api.openai.com", "registry.npmjs.org", "provider-service", "package-registry", "token", "Bearer"]) {
    assert.equal(serialized.includes(forbidden), false, `a receipt must not contain ${forbidden}`);
  }
  assert.match(auth.receipt.safeReasonCode, /^sandbox-network-policy-/, "only a fixed reason token is reported");
});

// ------------------------------------------ OBSERVATION IS NOT ENFORCEMENT ---
// networkPolicy.ts records what a run was INTENDED to allow and what was
// actually SEEN. Neither is a control. The sandbox gate is what prevents
// traffic, and these two must never be confused: a clean observation is not
// permission, and classifying a destination after the fact is not blocking it.

test("a network receipt records observation and enforces nothing", () => {
  const decl = TOOL_NETWORK_DECLARATIONS["claude"];
  assert.equal(decl.requiredNetworkPolicy, "provider-only", "the real provider declares provider-only");

  // An UNOBSERVED host yields unknown with a NULL count — never 0, and never a
  // statement that nothing happened.
  const receipt = evaluateNetworkCapability({ declaration: decl, grantedPolicy: "provider-only", observationProvider: new UnobservedNetworkProvider(), sequence: 1 });
  assert.equal(receipt.observedNetworkCallCount, null, "unknown must stay null, never coerced to 0");
  assert.equal(receipt.networkObservation, "unknown");
  assert.equal(receipt.networkEvidenceAvailable, false, "nothing was watching");
  assert.equal(receipt.safeReasonCode, "network-observation-unavailable", "the unknown is visible in the reason code");

  // And that receipt confers NO enforcement authority: the sandbox gate still
  // refuses provider-only, because observation is not a mechanism.
  assert.equal(networkPolicyEnforceable(decl.requiredNetworkPolicy, claimsFromProbe(goodFindings())), "sandbox-network-policy-unenforceable", "an observation receipt cannot authorize a policy");
  assert.equal(enforcedNetworkModeFor(decl.requiredNetworkPolicy).ok, false, "and it produces no docker network mode");
});

test("destination classification is not destination blocking", () => {
  // classifyDestination tells us what a destination WAS. It runs after the
  // fact, on a string, with no ability to stop anything — so a receipt that
  // classifies traffic must never be read as having prevented it.
  assert.equal(classifyDestination("https://api.anthropic.com/v1/messages"), "provider-service");
  assert.equal(classifyDestination("http://127.0.0.1:8080/health"), "loopback");
  assert.equal(classifyDestination("https://evil.example.com/x"), "unknown-external");

  // Classifying an external destination does not make `allowlisted` enforceable.
  assert.equal(networkPolicyEnforceable("allowlisted", claimsFromProbe(goodFindings())), "sandbox-network-policy-unenforceable");

  // And the summary drops credentials structurally, keeping scheme+host+class.
  const summary = safeDestinationSummary("https://user:supersecrettoken@api.openai.com/v1/chat?key=abcd1234");
  assert.equal(summary.includes("supersecrettoken"), false, "userinfo must never survive");
  assert.equal(summary.includes("abcd1234"), false, "a query string must never survive");
  assert.equal(summary.includes("/v1/chat"), false, "the path must never survive");
  assert.equal(summary.includes("api.openai.com"), true, "the host class summary is retained");
});

test("observed traffic under a denied grant is reported as enforcement failure", () => {
  // The one place observation DOES bite: if something was watching and saw
  // traffic while the grant was `denied`, that is an enforcement failure and
  // must block — not be recorded and ignored.
  const seen = new StubNetworkObservationProvider({ observation: "observed-some", count: 3, destinationClasses: ["unknown-external"], status: "verified", evidenceSource: "sandbox-netns" });
  const receipt = evaluateNetworkCapability({ declaration: TOOL_NETWORK_DECLARATIONS["verification-command"], grantedPolicy: "denied", observationProvider: seen, sequence: 2 });
  assert.equal(receipt.blocked, true, "traffic under a denied grant must block");
  assert.equal(receipt.safeReasonCode, "unexpected-network-observed");
  assert.equal(receipt.observedNetworkCallCount, 3, "a real observation reports its real count");
});

// ------------------------------------- EXACT CAPABILITY SEMANTICS (§32) ---
// No capability may be inferred from a different capability. Each policy is
// authorized by the claim that proves THAT policy, or not at all.

test("denied is accepted ONLY when defaultDenyNetwork is actually verified", () => {
  // The positive case: the probe proved default-deny, so denied is enforceable.
  assert.equal(networkPolicyEnforceable("denied", claimsFromProbe(goodFindings())), "ok");

  // The negative case that matters: a backend that has NOT proven default-deny
  // cannot run `denied` either. `denied` is not a free pass just because it is
  // the most restrictive name in the union — it is a claim like any other.
  assert.equal(networkPolicyEnforceable("denied", NO_ISOLATION_CLAIMS), "sandbox-network-policy-unenforceable", "denied needs its claim proven too");

  const withoutDenyProof: SandboxIsolationClaims = { ...ALL_ISOLATION_CLAIMS, defaultDenyNetwork: false };
  assert.equal(networkPolicyEnforceable("denied", withoutDenyProof), "sandbox-network-policy-unenforceable", "every other claim being true does not substitute");
});

test("no capability is inferred from a neighbouring capability", () => {
  // Each row: the ONE claim turned on, and the policies it must NOT unlock.
  const onlyDeny: SandboxIsolationClaims = { ...NO_ISOLATION_CLAIMS, defaultDenyNetwork: true };
  const onlyAllowlist: SandboxIsolationClaims = { ...NO_ISOLATION_CLAIMS, explicitNetworkAllowlist: true };

  // defaultDenyNetwork proves denied and nothing wider.
  assert.equal(networkPolicyEnforceable("denied", onlyDeny), "ok");
  for (const wider of ["loopback-only", "provider-only", "allowlisted"] as NetworkPolicy[]) {
    assert.equal(networkPolicyEnforceable(wider, onlyDeny), "sandbox-network-policy-unenforceable", `default-deny must not imply ${wider}`);
  }

  // A generic destination allowlist proves `allowlisted` and nothing narrower.
  assert.equal(networkPolicyEnforceable("allowlisted", onlyAllowlist), "ok");
  for (const narrower of ["loopback-only", "provider-only"] as NetworkPolicy[]) {
    assert.equal(networkPolicyEnforceable(narrower, onlyAllowlist), "sandbox-network-policy-unenforceable", `a generic allowlist must not imply ${narrower}`);
  }
  // It also does not imply default-deny: those are different mechanisms.
  assert.equal(networkPolicyEnforceable("denied", onlyAllowlist), "sandbox-network-policy-unenforceable", "an allowlist does not prove default-deny");

  // And nothing whatsoever unlocks unrestricted egress.
  for (const claims of [onlyDeny, onlyAllowlist, ALL_ISOLATION_CLAIMS]) {
    assert.equal(networkPolicyEnforceable("allowed", claims), "sandbox-network-policy-refused", "allowed is forbidden under every claim set");
  }
});

test("spec validity is not authorization — the two layers are distinct", () => {
  // `loopback-only` is a STRUCTURALLY VALID policy: validateSandboxPolicySpec
  // accepts it, and should, because there is nothing forbidden about wanting
  // loopback-only networking. It is the ENFORCEABILITY layer that refuses it,
  // and conflating the two is what let it through to bridge in the first place.
  const loopbackSpec = { ...DEFAULT_SANDBOX_POLICY, network: { policy: "loopback-only" as NetworkPolicy, allowlist: ["loopback"] as const } };
  assert.equal(validateSandboxPolicySpec(loopbackSpec), "ok", "the policy spec itself is legitimate");
  assert.equal(networkPolicyEnforceable("loopback-only", claimsFromProbe(goodFindings())), "sandbox-network-policy-unenforceable", "but nothing here enforces it");

  // `allowed` is refused at the STRUCTURAL layer, so it never even reaches
  // enforceability — a different failure with a different meaning.
  assert.equal(validateSandboxPolicySpec({ ...DEFAULT_SANDBOX_POLICY, network: { policy: "allowed", allowlist: [] } }), "sandbox-network-policy-refused");
});

test("the real Docker verified claim set is exactly the truthful one", () => {
  // What a REAL successful container verification ends up asserting.
  const real = claimsFromProbe(goodFindings());
  assert.equal(real.defaultDenyNetwork, true, "the probe proved the container cannot reach out");
  assert.equal(real.noHostNetworkNamespace, true, "a shared host netns would have let it reach out");
  assert.equal(real.explicitNetworkAllowlist, false, "no allowlist mechanism exists, so none is claimed");

  // Under exactly those claims: denied works, everything else is refused.
  assert.equal(networkPolicyEnforceable("denied", real), "ok");
  for (const unsupported of ["loopback-only", "provider-only", "allowlisted"] as NetworkPolicy[]) {
    assert.equal(networkPolicyEnforceable(unsupported, real), "sandbox-network-policy-unenforceable", `${unsupported} refused under real claims`);
    assert.equal(enforcedNetworkModeFor(unsupported).ok, false, `${unsupported} yields no docker mode either`);
  }
  assert.equal(networkPolicyEnforceable("allowed", real), "sandbox-network-policy-refused");

  // The synthetic all-true fixture is untouched — fakes still need it.
  assert.equal(ALL_ISOLATION_CLAIMS.explicitNetworkAllowlist, true, "the test-only fixture keeps its all-true shape");
  assert.notEqual(real.explicitNetworkAllowlist, ALL_ISOLATION_CLAIMS.explicitNetworkAllowlist, "real and synthetic claims are separate");
});
