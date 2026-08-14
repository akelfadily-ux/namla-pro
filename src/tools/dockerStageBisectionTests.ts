/**
 * dockerStageBisectionTests — deterministic proof of the bisection, with no
 * Docker present.
 *
 * A fake runner records every argv it is handed and returns a scripted result
 * per stage, so ordering, early-stop, and cleanup are all observable without
 * starting a container.
 *
 * Run: node --test dist/tools/dockerStageBisectionTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { runStageBisection, buildStageArgs, stageDefinitions, stageCommand, describeStageResult, type StageRunner, type StageInputs, type StageNumber } from "../cognitive/dockerStageBisection";
import { classifyContainerStartup } from "../cognitive/containerStartupDiagnostics";
import { approvedImageReference } from "../cognitive/containerSandboxBackend";
import { validateMountSource, type CanonicalMountSource } from "../cognitive/safeMountSource";
import { mkdtempSync, mkdirSync, rmSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { resolve, join } from "path";

/**
 * Stage inputs produced by the REAL production validator over REAL temporary
 * directories (§31). No cast, no forged brand: `bisectDockerStages` obtains
 * these the same way, so these tests exercise the same boundary production
 * does rather than stepping around it.
 */
const FIXTURE_ROOT = realpathSync(mkdtempSync(resolve(tmpdir(), "namla-stage-")));

function provenSource(name: string): CanonicalMountSource {
  const dir = join(FIXTURE_ROOT, name);
  mkdirSync(dir, { recursive: true });
  const r = validateMountSource(dir, [FIXTURE_ROOT], "workspace");
  if (!r.ok) throw new Error(`stage fixture "${name}" failed real validation: ${r.reasonCode}`);
  return r.canonicalPath;
}

const INPUTS: StageInputs = {
  workspaceHostPath: provenSource("workspace"),
  probeHostDir: provenSource("probe"),
  sourceHostPath: null,
};

process.on("exit", () => {
  try {
    rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup of a temp fixture */
  }
});

/**
 * Docker flags only: everything BEFORE the image reference. Filtering on a "--"
 * prefix alone also catches `--version` from the in-container COMMAND, which is
 * not a Docker flag and legitimately disappears at stage 8.
 */
function dockerFlags(args: readonly string[]): string[] {
  const imageIndex = args.indexOf(approvedImageReference());
  const upToImage = imageIndex >= 0 ? args.slice(0, imageIndex) : [...args];
  return upToImage.filter((a) => a.startsWith("--"));
}

/** Records calls and fails at a chosen stage. Starts nothing. */
class FakeRunner implements StageRunner {
  readonly runArgs: string[][] = [];
  readonly removed: string[] = [];
  constructor(
    private readonly failAtStage: number | null,
    private readonly failure: { status: number | null; signal: string | null; stdout: string; stderr: string; errorCode?: string } = { status: 125, signal: null, stdout: "", stderr: "" },
    private readonly removeSucceeds = true
  ) {}

  run(args: readonly string[]): { status: number | null; signal: string | null; stdout: string; stderr: string; errorCode?: string } {
    this.runArgs.push([...args]);
    if (this.failAtStage !== null && this.runArgs.length === this.failAtStage) return this.failure;
    return { status: 0, signal: null, stdout: "v20.0.0", stderr: "" };
  }

  remove(containerName: string): boolean {
    this.removed.push(containerName);
    return this.removeSucceeds;
  }
}

// ------------------------------------------------ EXIT-CODE CLASSIFICATION ---

test("exit 125 maps to docker-run-rejected, never container-nonzero-exit", () => {
  const d = classifyContainerStartup({ status: 125, signal: null, stdout: "", stderr: "" });
  assert.equal(d.stderrCategory, "docker-run-rejected", "125 means DOCKER refused the run");
  assert.notEqual(d.stderrCategory, "container-nonzero-exit", "125 must not be reported as a workload failure");
  assert.equal(d.runtimeExitCode, 125);
  assert.equal(d.stdoutPresent, false);
});

test("126 and 127 keep their own meanings; other codes stay generic", () => {
  assert.equal(classifyContainerStartup({ status: 126, signal: null, stdout: "", stderr: "" }).stderrCategory, "container-command-not-invokable");
  assert.equal(classifyContainerStartup({ status: 127, signal: null, stdout: "", stderr: "" }).stderrCategory, "container-command-not-found");
  for (const code of [1, 2, 3, 42, 137]) {
    assert.equal(classifyContainerStartup({ status: code, signal: null, stdout: "", stderr: "" }).stderrCategory, "container-nonzero-exit", `exit ${code} stays generic`);
  }
});

test("a recognised stderr still beats the exit-code mapping", () => {
  // A specific cause is more useful than "docker refused it".
  const d = classifyContainerStartup({ status: 125, signal: null, stdout: "", stderr: "docker: Error response from daemon: invalid mount config for type bind" });
  assert.equal(d.stderrCategory, "bind-mount-failed");
});

// ---------------------------------------------------------- STAGE ORDERING ---

test("stages are cumulative and run in order 1..8", () => {
  const defs = stageDefinitions(INPUTS);
  assert.deepEqual(defs.map((d) => d.stage), [1, 2, 3, 4, 5, 6, 7, 8]);

  const runner = new FakeRunner(null);
  const r = runStageBisection(runner, INPUTS);
  assert.equal(r.failedStage, null, "all stages succeed with the fake");
  assert.equal(runner.runArgs.length, 8, "every stage ran exactly once");

  // Each stage's argv must be a strict superset of the previous stage's flags.
  for (let i = 1; i < runner.runArgs.length; i += 1) {
    const prevFlags = dockerFlags(runner.runArgs[i - 1]);
    const currFlags = dockerFlags(runner.runArgs[i]);
    for (const f of prevFlags) assert.equal(currFlags.includes(f), true, `stage ${i + 1} must retain ${f} from stage ${i}`);
    assert.equal(currFlags.length >= prevFlags.length, true, "flags accumulate, never shrink");
  }
});

test("each stage introduces its declared flags", () => {
  const expected: Array<[StageNumber, string]> = [
    [2, "--user"],
    [2, "--cap-drop"],
    [3, "--ipc"],
    [4, "--read-only"],
    [4, "--tmpfs"],
    [5, "--cpus"],
    [5, "--memory-swap"],
    [5, "--pids-limit"],
    [6, "--hostname"],
    [6, "--env-file"],
    [6, "--network"],
    [7, "--workdir"],
  ];
  for (const [stage, flag] of expected) {
    const args = buildStageArgs(stage, INPUTS, "c");
    assert.equal(args.includes(flag), true, `stage ${stage} must include ${flag}`);
    const before = buildStageArgs((stage - 1) as StageNumber, INPUTS, "c");
    assert.equal(before.includes(flag), false, `${flag} must NOT appear before stage ${stage}`);
  }
});

test("stage 1 is the bare image and a harmless command; stage 8 runs the probe", () => {
  const s1 = buildStageArgs(1, INPUTS, "c");
  // Stage 1 is the true baseline: disposable and named (so cleanup can target
  // it), and NOTHING else. Every isolation flag is introduced later, which is
  // what makes the bisection able to attribute a rejection to one group.
  assert.deepEqual(dockerFlags(s1), ["--rm", "--name"], "stage 1 carries only --rm and --name");
  assert.deepEqual([...stageCommand(1)], ["node", "--version"], "stage 1 command is harmless");
  assert.equal(s1.includes(approvedImageReference()), true, "every stage uses the approved image");

  assert.deepEqual([...stageCommand(8)], ["node", "/namla-probe/containerIsolationProbe.js"], "only stage 8 runs the real probe");
  for (const s of [1, 2, 3, 4, 5, 6, 7] as StageNumber[]) {
    assert.deepEqual([...stageCommand(s)], ["node", "--version"], `stage ${s} must stay harmless`);
  }
});

test("no stage uses a shell or a forbidden flag", () => {
  for (const s of [1, 2, 3, 4, 5, 6, 7, 8] as StageNumber[]) {
    const args = buildStageArgs(s, INPUTS, "c");
    for (const bad of ["--privileged", "--network=host", "--pid=host", "-v", "--cap-add", "sh", "-c"]) {
      assert.equal(args.includes(bad), false, `stage ${s} must not contain ${bad}`);
    }
    assert.equal(args.join(" ").includes("docker.sock"), false, `stage ${s} must not mount the Docker socket`);
  }
});

// -------------------------------------------------------------- EARLY STOP ---

test("execution stops at the first failed stage and later stages do NOT run", () => {
  for (const failAt of [1, 3, 6, 8]) {
    const runner = new FakeRunner(failAt);
    const r = runStageBisection(runner, INPUTS);
    assert.equal(r.failedStage, failAt, `must report stage ${failAt}`);
    // The runner's own call count is the proof that nothing beyond the failure
    // was attempted - stronger than a self-reported counter in the result.
    assert.equal(runner.runArgs.length, failAt, `exactly ${failAt} stages ran; later stages must NOT run`);
    // The bracket is derivable: stage N failed, so N-1 was the last accepted.
    assert.equal(r.failedStage !== null && r.failedStage - 1 === failAt - 1, true, "failedStage brackets the offending flag");
  }
});

test("a stage-6 failure brackets the offending flag to the env/network group", () => {
  // The shape the real run points at: everything up to resource limits is fine.
  const runner = new FakeRunner(6, { status: 125, signal: null, stdout: "", stderr: "" });
  const r = runStageBisection(runner, INPUTS);
  assert.equal(r.failedStage, 6);
  assert.equal(stageDefinitions(INPUTS)[5].label, "hostname-env-network", "stage 6 is the env/network group");
  assert.equal(r.stderrCategory, "docker-run-rejected");
  assert.equal(r.runtimeExitCode, 125);
});

// ---------------------------------------------------------------- CLEANUP ---

test("cleanup runs after EVERY stage, including the failing one", () => {
  const runner = new FakeRunner(4);
  runStageBisection(runner, INPUTS);
  assert.equal(runner.removed.length, 4, "one cleanup per attempted stage");
  assert.equal(runner.removed.length, runner.runArgs.length, "cleanup count matches run count");
});

test("cleanup runs on the all-success path too", () => {
  const runner = new FakeRunner(null);
  const r = runStageBisection(runner, INPUTS);
  assert.equal(runner.removed.length, 8);
  assert.equal(r.cleanupComplete, true);
});

test("a failed removal is reported, never silently ignored", () => {
  const runner = new FakeRunner(2, { status: 125, signal: null, stdout: "", stderr: "" }, false);
  const r = runStageBisection(runner, INPUTS);
  assert.equal(r.cleanupComplete, false, "an unremovable container must be reported");
});

// -------------------------------------------------------------- REDACTION ---

test("raw stderr containing secrets and host paths never reaches the result", () => {
  const secret = "sk-proj-AbCdEf0123456789AbCdEf0123456789";
  const B = String.fromCharCode(92);
  const hostileStderr = [`docker: Error response from daemon: permission denied at /home/runner/work/namla-pro/secret-dir`, `C:${B}Users${B}akelf${B}Desktop${B}namla-pro`, `container 3f2a1b9c8d7e6f5a4b3c2d1e0f9a8b7c failed`, `token ${secret}`].join(" ");

  const runner = new FakeRunner(3, { status: 125, signal: null, stdout: `leaked ${secret}`, stderr: hostileStderr });
  const r = runStageBisection(runner, INPUTS);

  const json = JSON.stringify(r);
  for (const forbidden of [secret, "/home/runner", "akelf", "namla-pro", "3f2a1b9c8d7e", "permission denied at", "leaked", "sk-", "ghp_"]) {
    assert.equal(json.includes(forbidden), false, `the result must not contain ${forbidden}`);
  }
  // stdout presence is a boolean; the content never appears.
  assert.equal(r.stdoutPresent, true);
  assert.equal(describeStageResult(r).includes("/home/runner"), false, "the one-liner is safe too");
});

test("the result carries ONLY the safe fields", () => {
  const r = runStageBisection(new FakeRunner(5), INPUTS);
  // EXACTLY the seven permitted fields - a closed set, so an eighth cannot be
  // added without this failing.
  const allowed = ["failedStage", "runtimeExitCode", "runtimeSignal", "stdoutPresent", "stderrCategory", "safeFailureFingerprint", "cleanupComplete"];
  assert.deepEqual(Object.keys(r).sort(), [...allowed].sort(), "only the seven safe fields may be emitted");
  assert.equal(Object.keys(r).length, 7);
});

test("container names in the result are stage numbers, never host-derived", () => {
  const runner = new FakeRunner(null);
  runStageBisection(runner, INPUTS, "namla-bisect");
  for (const name of runner.removed) {
    assert.match(name, /^namla-bisect-[1-8]$/, "container names are fixed and stage-numbered");
  }
});

test("no real action is taken by this suite", () => {
  const runner = new FakeRunner(null);
  const r = runStageBisection(runner, INPUTS);
  assert.equal(r.failedStage, null, "the fake ran every stage; no Docker was involved");
  assert.equal(runner.runArgs.length, 8);
});

test("stage 3 adds ONLY the valid IPC namespace flag", () => {
  const defs = stageDefinitions(INPUTS);
  const stage3 = defs.find((d) => d.stage === 3);
  assert.notEqual(stage3, undefined);
  assert.deepEqual([...(stage3?.flags ?? [])], ["--ipc", "private"], "stage 3 introduces the IPC flag and nothing else");

  // `--pid private` is not a supported Docker value; it made the daemon reject
  // the run with exit 125 at exactly this stage.
  for (const s of [1, 2, 3, 4, 5, 6, 7, 8] as StageNumber[]) {
    const args = buildStageArgs(s, INPUTS, "c");
    assert.equal(args.includes("--pid"), false, `stage ${s} must contain no --pid flag`);
    const joined = args.join(" ");
    assert.equal(joined.includes("--pid host"), false, `stage ${s} must never select the host PID namespace`);
    assert.equal(args.includes("--pid=host"), false, `stage ${s} must not use the equals form either`);
  }
});
