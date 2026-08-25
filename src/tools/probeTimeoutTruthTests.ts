/**
 * probeTimeoutTruthTests — S-14. Proof that the container isolation probe is
 * always BOUNDED, and that a probe which times out can never be mistaken for
 * proven isolation, silently discarded, or left running.
 *
 * THE DEFECT. `verifyIsolation()` spawned the probe with:
 *
 *     timeout: this.options.verifyTimeoutMs ?? 120000
 *
 * `verifyTimeoutMs` was an unvalidated public option, and `??` only catches
 * nullish values. Two edge cases were therefore reachable, both measured
 * against this Node runtime rather than assumed:
 *
 *   0                  `spawnSync` arms NO timer. The probe waits for the
 *                      container forever — the one step that proves isolation
 *                      became the one step with no bound.
 *   -1 / NaN /         `spawnSync` throws ERR_OUT_OF_RANGE. `verifyIsolation()`
 *   Infinity / 1.5     is contractually total, and `composeVerificationSandbox`
 *                      does not catch, so the throw escaped the composition
 *                      root as a crash instead of "isolation not proven".
 *
 * SECOND DEFECT. `forceRemove` ran on every path, but its result was consulted
 * only in the SUCCESS branch. A timeout lands in the no-findings branch, which
 * returned before looking — so "timed out, container removed" and "timed out,
 * container still running" produced identical reports.
 *
 * NOTHING REAL RUNS HERE. No container is started, no Docker is required, and
 * the only child process is a local `node -e` sleeper used to measure
 * `spawnSync`'s own timeout semantics.
 *
 * Run: node --test dist/tools/probeTimeoutTruthTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { spawnSync, execFileSync } from "child_process";
import {
  DockerContainerSandboxBackend,
  resolveProbeTimeoutMs,
  configuredTimeoutBudgetMs,
  DEFAULT_PROBE_TIMEOUT_MS,
  PROBE_HELPER_TIMEOUT_MS,
  PROBE_KILL_SIGNAL,
  classifyProbe,
  claimsFromProbe,
  containerAbsenceProven,
  type ProbeFindings,
} from "../cognitive/containerSandboxBackend";
import { classifyContainerStartup, describeStartupFailure } from "../cognitive/containerStartupDiagnostics";
import { validateSandboxPolicySpec, SandboxPolicy, FakeSandboxBackend, DEFAULT_SANDBOX_POLICY, NO_ISOLATION_CLAIMS, type VerificationSafeReason } from "../cognitive/sandboxPolicy";

const BACKEND_SRC = readFileSync("src/cognitive/containerSandboxBackend.ts", "utf8");

/**
 * Liveness only. `kill(pid, 0)` performs the permission/existence check and
 * sends nothing, on POSIX and on Windows alike. EPERM means the process exists
 * but belongs to someone else, which is still "alive" for this purpose.
 */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Kill a test-created descendant and PROVE it is gone before returning.
 *
 * Cross-platform: SIGKILL is uncatchable on POSIX, and libuv routes it to
 * `TerminateProcess` on Windows. The wait is a BOUNDED re-check loop that ends
 * in an assertion, not a fixed sleep followed by an assumption — reaping is
 * asynchronous, so the only honest way to report death is to keep asking until
 * the answer is no, with a hard cap on how long that may take.
 */
function killAndProveDead(pid: number, attempts = 200): void {
  try {
    process.kill(pid, "SIGKILL");
  } catch (e) {
    // ESRCH == already gone, which is the desired end state.
    if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e;
  }
  const deadline = Date.now() + 10000;
  for (let i = 0; i < attempts && Date.now() < deadline; i += 1) {
    if (!processAlive(pid)) return;
    // Busy re-check: no timer, no sleep, and it exits the instant it is dead.
    execFileSync(process.execPath, ["-e", ""], { windowsHide: true });
  }
  assert.equal(processAlive(pid), false, `pid ${pid} must be dead after SIGKILL`);
}

/** Findings in which every isolation property holds. */
function goodFindings(over: Partial<ProbeFindings> = {}): ProbeFindings {
  return {
    uidNonRoot: true,
    sensitiveHostMarkersAbsent: true, unexpectedApplicationMounts: [],
    dockerSocketAbsent: true,
    secretsAbsent: true,
    pidNamespaceIsolated: true,
    rootFilesystemReadOnly: true,
    writeOutsideWorkspaceFails: true,
    sourceMountReadOnly: true,
    workspaceWritable: true,
    memoryLimitBytes: 536870912,
    cpuLimitConfigured: true,
    pidLimit: 64,
    networkDenied: true,
    ...over,
  };
}

/** The exact shape `spawnSync` reports when it kills a child on timeout. */
function timedOutOutcome(over: Partial<Parameters<typeof classifyContainerStartup>[0]> = {}) {
  return classifyContainerStartup({ errorCode: "ETIMEDOUT", status: null, signal: "SIGTERM", stdout: "", stderr: "", ...over });
}

// ============================================== THE BOUND ITSELF ============

test("S14-1: a normal successful probe remains successful", () => {
  // The success predicate is untouched by S-14: all properties met => "ok",
  // and the claims are asserted from the findings.
  assert.equal(classifyProbe(goodFindings()), "ok");
  const claims = claimsFromProbe(goodFindings());
  assert.equal(claims.defaultDenyNetwork, true);
  assert.equal(claims.dedicatedUser, true);
  assert.notDeepEqual(claims, NO_ISOLATION_CLAIMS, "a fully verified probe asserts real claims");

  // An unstated timeout still resolves to the ordinary default.
  assert.deepEqual(resolveProbeTimeoutMs(undefined), { ok: true, timeoutMs: DEFAULT_PROBE_TIMEOUT_MS, reasonCode: "ok" });
  assert.deepEqual(resolveProbeTimeoutMs(45000), { ok: true, timeoutMs: 45000, reasonCode: "ok" }, "an explicit bound is honoured");
});

test("S14-2: a probe timeout returns a specific timed-out result", () => {
  const d = timedOutOutcome();
  assert.equal(d.stderrCategory, "container-timeout-killed", "the timeout is named, not generalized");
  assert.equal(d.safeReasonCode, "sandbox-probe-failed");
  assert.equal(d.stdoutPresent, false);
  // A SIGKILL-shaped timeout classifies identically — the mechanism, not the
  // particular signal, is what makes it a timeout.
  assert.equal(timedOutOutcome({ errorCode: undefined, signal: "SIGKILL" }).stderrCategory, "container-timeout-killed");
});

test("S14-3: a timeout can never produce available-and-verified", () => {
  const d = timedOutOutcome();
  assert.notEqual(d.safeReasonCode, "ok", "a timeout proves nothing");
  assert.deepEqual(claimsFromProbe({}), NO_ISOLATION_CLAIMS, "no findings => no claims");

  // Structural: the no-findings branch — where every timeout lands — returns
  // `unverified(...)`, and `available-and-verified` is produced in exactly one
  // place, after findings have been classified "ok".
  // Scoped to verifyIsolation(): it is the ONLY place that can mint a verified
  // capability REPORT. (execute() also stamps the state onto an execution
  // receipt, but it runs only after verification already succeeded, so it
  // reports the established fact rather than establishing it.)
  const vStart = BACKEND_SRC.indexOf("  verifyIsolation(): SandboxCapabilityReport {");
  const vEnd = BACKEND_SRC.indexOf("  private verifySequence", vStart);
  assert.ok(vStart !== -1 && vEnd > vStart, "verifyIsolation must be locatable");
  const verifyBody = BACKEND_SRC.slice(vStart, vEnd);
  const verifiedLiterals = verifyBody.split("\n").filter((l) => l.includes('capabilityState: "available-and-verified"'));
  assert.equal(verifiedLiterals.length, 1, "exactly one producer of the verified report");
  const before = verifyBody.slice(0, verifyBody.indexOf('capabilityState: "available-and-verified"'));
  assert.match(before.slice(-900), /classifyProbe\(findings\)/, "it is gated on classified findings");
  assert.match(before.slice(-900), /if \(!removed\) return unverified\("sandbox-cleanup-incomplete"/, "and on proven cleanup");
});

test("S14-4: a timeout never carries success/ok/completed semantics", () => {
  const d = timedOutOutcome();
  for (const successLike of ["ok", "completed", "none", "verified"]) {
    assert.notEqual(d.safeReasonCode, successLike, `reason must not be ${successLike}`);
    assert.notEqual(d.stderrCategory, successLike, `category must not be ${successLike}`);
  }
});

test("S14-5: a bounded probe settles within a bounded wall-clock envelope", () => {
  // Measures spawnSync's ACTUAL timeout behaviour with a local node sleeper —
  // no container, no Docker. A 300ms bound must stop a 5s child well inside the
  // envelope, which is the property the whole milestone rests on.
  const started = Date.now();
  const out = spawnSync(process.execPath, ["-e", "setTimeout(()=>{},5000)"], { timeout: 300, shell: false, windowsHide: true, encoding: "utf8" });
  const elapsed = Date.now() - started;

  assert.ok(elapsed < 3000, `must settle far below the child's own 5s (took ${elapsed}ms)`);
  const code = (out.error as NodeJS.ErrnoException | undefined)?.code ?? null;
  assert.equal(code === "ETIMEDOUT" || out.signal !== null, true, "and it settles AS a timeout");

  // The same outcome shape classifies as a timeout.
  const d = classifyContainerStartup({ errorCode: code ?? undefined, status: typeof out.status === "number" ? out.status : null, signal: (out.signal as string | null) ?? null, stdout: "", stderr: "" });
  assert.equal(d.stderrCategory, "container-timeout-killed");
});

test("S14-5b: an unboundable timeout is refused BEFORE any container is started", () => {
  // The defect values. Each must produce a truthful refusal rather than an
  // indefinite wait (0) or a thrown RangeError (the rest). This runs on a host
  // with no Docker precisely because the check precedes runtime resolution.
  // Each value carries the reason that is TRUE of it: zero means no bound was
  // set; the rest are set and unusable. Calling NaN "missing" would misdescribe
  // a field that is plainly present.
  const cases: Array<[number, "sandbox-limits-missing" | "sandbox-limits-invalid"]> = [
    [0, "sandbox-limits-missing"],
    [-1, "sandbox-limits-invalid"],
    [1.5, "sandbox-limits-invalid"],
    [NaN, "sandbox-limits-invalid"],
    [Infinity, "sandbox-limits-invalid"],
    [-Infinity, "sandbox-limits-invalid"],
  ];
  for (const [bad, expected] of cases) {
    const resolution = resolveProbeTimeoutMs(bad);
    assert.equal(resolution.ok, false, `${bad} is not a provable bound`);
    assert.equal(resolution.timeoutMs, null);
    assert.equal(resolution.reasonCode, expected, `${bad} must be reported as ${expected}`);

    const backend = new DockerContainerSandboxBackend({ probeWorkspaceHostPath: "/tmp/nonexistent-probe", verifyTimeoutMs: bad });
    const started = Date.now();
    const report = backend.verifyIsolation();
    const elapsed = Date.now() - started;

    assert.equal(report.verified, false, `${bad} must not verify`);
    assert.notEqual(report.capabilityState, "available-and-verified", `${bad} must not reach verified`);
    assert.equal(report.safeReasonCode, expected, `${bad} must name its actual fault`);
    assert.ok(elapsed < 5000, `${bad} must fail fast, took ${elapsed}ms`);
    assert.deepEqual(report.claims, NO_ISOLATION_CLAIMS, `${bad} claims nothing`);
  }
});

// ============================ REAL WALL-CLOCK SETTLEMENT (ADVERSARIAL) ======

test("S14-5c: a child that RESISTS graceful termination is still killed at the bound", () => {
  // The invariant a configured `timeout` does NOT prove on its own. `spawnSync`
  // sends `killSignal` at the timeout and then keeps waiting for the child to
  // exit; Node escalates to SIGKILL only if the kill CALL errors, not if the
  // signal is delivered and ignored. A child that traps SIGTERM can therefore
  // hold the caller past its own timeout — so the backend kills with SIGKILL,
  // which cannot be caught, blocked, or ignored.
  assert.equal(PROBE_KILL_SIGNAL, "SIGKILL", "the probe must not rely on a catchable signal");

  const resistant = "process.on('SIGTERM',()=>{});process.on('SIGINT',()=>{});process.on('SIGHUP',()=>{});setTimeout(()=>{},10000);";
  const started = Date.now();
  const out = spawnSync(process.execPath, ["-e", resistant], { timeout: 500, killSignal: PROBE_KILL_SIGNAL, shell: false, windowsHide: true, encoding: "utf8" });
  const elapsed = Date.now() - started;

  assert.ok(elapsed < 4000, `a signal-resistant child must still settle at the bound (took ${elapsed}ms of a possible 10000)`);
  const code = (out.error as NodeJS.ErrnoException | undefined)?.code ?? null;
  assert.equal(code === "ETIMEDOUT" || out.signal !== null, true, "and it settles as a timeout");
});

test("S14-5d: a descendant holding the stdio pipe open cannot extend the bound, and is not leaked", () => {
  // `spawnSync` waits for stdio EOF as well as process exit, so a detached
  // grandchild that inherits stdout keeps the pipe open after its parent is
  // gone. Measured: without a bound the caller waits for the grandchild; with
  // one it settles at the bound.
  //
  // This test creates a REAL survivor on purpose, so it must also dispose of
  // it. A test that proves a cleanup invariant while leaking a process would
  // contradict the very thing it asserts — and would contaminate every test
  // that runs after it. The grandchild therefore publishes its own PID to a
  // marker file, and the finally block kills it and PROVES it is gone.
  const pidFile = join(mkdtempSync(join(tmpdir(), "namla-s14-")), "grandchild.pid");
  const holder = `
    const {spawn}=require('child_process');
    const g=spawn(process.execPath,['-e','setTimeout(()=>{},8000)'],{detached:true,stdio:['ignore','inherit','inherit']});
    require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(g.pid));
    g.unref();
    process.exit(0);
  `;

  let grandchildPid: number | null = null;
  try {
    const started = Date.now();
    spawnSync(process.execPath, ["-e", holder], { timeout: 700, killSignal: PROBE_KILL_SIGNAL, shell: false, windowsHide: true, encoding: "utf8" });
    const elapsed = Date.now() - started;

    // Regression evidence with slack, not a real-time theorem: the descendant
    // would hold the pipe for 8000ms, so settling in under 4000ms shows the
    // bound governed the wait rather than the descendant's lifetime.
    assert.ok(elapsed < 4000, `a stdio-holding descendant must not extend the bound (took ${elapsed}ms of a possible 8000)`);

    // The PID is read from the marker the grandchild itself wrote — known
    // deterministically, never guessed or scanned for.
    assert.equal(existsSync(pidFile), true, "the grandchild must have published its pid");
    grandchildPid = Number.parseInt(readFileSync(pidFile, "utf8").trim(), 10);
    assert.equal(Number.isInteger(grandchildPid) && grandchildPid > 0, true, `pid must be real, got ${grandchildPid}`);
    assert.equal(processAlive(grandchildPid), true, "the survivor exists — that is the hazard under test");
  } finally {
    if (grandchildPid !== null) killAndProveDead(grandchildPid);
    rmSync(dirname(pidFile), { recursive: true, force: true });
  }

  // Proven dead AFTER the finally ran, so the suite leaves nothing behind.
  assert.equal(processAlive(grandchildPid as number), false, "no adversarial descendant may survive this test");
});

test("S14-5e: the configured timeout budget is stated, finite, and complete", () => {
  // What this asserts: every spawn inside verifyIsolation() sets a finite
  // timeout, and their sum is a stated number rather than an unwritten
  // assumption — probe + image inspect + rm + re-inspect.
  //
  // What it deliberately does NOT assert: a maximum elapsed real time. Signal
  // delivery and process reaping belong to the kernel, so an uninterruptible
  // child or a stalled filesystem can add time this module neither owns nor
  // measures. The guarantee is that no step waits on a child's cooperation.
  assert.equal(PROBE_HELPER_TIMEOUT_MS > 0 && Number.isInteger(PROBE_HELPER_TIMEOUT_MS), true);
  assert.equal(configuredTimeoutBudgetMs(DEFAULT_PROBE_TIMEOUT_MS), DEFAULT_PROBE_TIMEOUT_MS + PROBE_HELPER_TIMEOUT_MS * 3);
  assert.ok(Number.isFinite(configuredTimeoutBudgetMs(DEFAULT_PROBE_TIMEOUT_MS)), "the configured budget is finite");
  // The name itself must not overstate the claim.
  assert.equal(/wall.?clock/i.test(BACKEND_SRC.slice(BACKEND_SRC.indexOf("export function configuredTimeoutBudgetMs") - 700, BACKEND_SRC.indexOf("export function configuredTimeoutBudgetMs"))), true, "the doc must address the wall-clock limitation explicitly");

  // And every spawn in the backend states BOTH a bound and the uncatchable
  // signal — a bound alone would not settle against a resistant child.
  const spawns = BACKEND_SRC.split("\n").filter((l) => l.includes("spawnSync(") && l.includes("timeout:"));
  assert.ok(spawns.length >= 4, `all bounded spawns enumerated, found ${spawns.length}`);
  for (const line of spawns) {
    assert.match(line, /killSignal: PROBE_KILL_SIGNAL/, `every bounded spawn must kill uncatchably: ${line.trim().slice(0, 80)}`);
  }
});

// ================================================ CLEANUP AFTER TIMEOUT =====

test("S14-6: a timed-out probe whose container survived reports the cleanup failure", () => {
  // Structural, because reaching it at runtime needs a real container that
  // ignores `docker rm -f`. The guarantee is that the no-findings branch — the
  // timeout branch — consults `removed` BEFORE reporting, which it previously
  // did not.
  const branchIdx = BACKEND_SRC.indexOf("if (!findings) {");
  assert.notEqual(branchIdx, -1, "the no-findings branch must exist");
  const branch = BACKEND_SRC.slice(branchIdx, branchIdx + 1600);
  assert.match(branch, /if \(!removed\) return unverified\("sandbox-cleanup-incomplete"/, "a surviving container must be reported");
  // ...and the `removed` value is computed before that branch, unconditionally.
  assert.match(BACKEND_SRC.slice(0, branchIdx).slice(-1200), /const removed = this\.forceRemove\(runtime, containerName\);/, "cleanup is attempted on every path");
});

test("S14-7: cleanup failure after a timeout is still a failure, and keeps the timeout", () => {
  // The reported detail carries the cleanup fact AND the timeout category, so
  // neither is discarded in favour of the other.
  const d = timedOutOutcome();
  const detail = `container not removed after failed probe: ${describeStartupFailure(d)}`;
  assert.match(detail, /container not removed/, "the surviving container is stated");
  assert.match(detail, /container-timeout-killed/, "and the timeout is not lost");
  assert.equal(BACKEND_SRC.includes('unverified("sandbox-cleanup-incomplete", `container not removed after failed probe: ${describeStartupFailure(this.lastStartupDiagnostics)}`)'), true);

  // And the ORDINARY timeout branch reports the classified diagnostics too —
  // both the reason code and the detail come from the classifier, never a
  // generic string that would collapse a timeout into "probe failed".
  assert.match(
    BACKEND_SRC,
    /return unverified\(this\.lastStartupDiagnostics\.safeReasonCode, describeStartupFailure\(this\.lastStartupDiagnostics\)\);/,
    "the timeout branch must report the classified detail"
  );
  // The detail genuinely distinguishes a timeout from other probe failures.
  const rejected = classifyContainerStartup({ status: 125, signal: null, stdout: "", stderr: "unknown flag" });
  assert.notEqual(describeStartupFailure(d), describeStartupFailure(rejected), "a timeout and a rejected run must not describe identically");
});

test("S14-8: cleanup is proven by a successful enumeration, not assumed from the remove call", () => {
  // `forceRemove` returns the result of a follow-up ENUMERATION, so "removed"
  // means the container was actually absent from a successful listing rather
  // than that a removal command was issued.
  const idx = BACKEND_SRC.indexOf("private forceRemove(");
  assert.notEqual(idx, -1);
  const fn = BACKEND_SRC.slice(idx, idx + 700);
  assert.match(fn, /\["rm", "-f", name\]/, "removal is attempted");
  assert.match(fn, /containerEnumerationArgs\(\)/, "and independently re-checked by enumeration");
  // S-16: the verdict comes from the shared fail-closed predicate. This
  // assertion previously PINNED the bare `status !== 0` form, which is why the
  // defect survived S-14. Two successive corrections followed: `status` is null
  // whenever the query could not run, AND a completed non-zero status means only
  // that the query failed. The behavioural cases live in containerCleanupProofTests.
  assert.equal(/status\s*!==\s*0/.test(fn), false, "cleanup must not be decided by a bare status check");
  assert.match(fn, /return containerAbsenceProven\(name, query\);/, "an affirmative enumeration decides the answer");
  // A completed non-zero exit establishes nothing: Docker returns 1 both for
  // an object that is not there and for a daemon it could not reach. Only a
  // SUCCESSFUL enumeration omitting the target settles it.
  const N = "namla-verify-1-0";
  assert.equal(containerAbsenceProven(N, { status: 1, error: undefined, signal: null, stdout: "" }), false, "a completed exit 1 proves nothing");
  assert.equal(containerAbsenceProven(N, { status: 0, error: undefined, signal: null, stdout: JSON.stringify(N) }), false, "an enumerated target is still present");
  assert.equal(containerAbsenceProven(N, { status: 0, error: undefined, signal: null, stdout: "" }), true, "a successful empty enumeration proves absence");
  assert.equal(containerAbsenceProven(N, { status: null, error: undefined, signal: "SIGKILL", stdout: "" }), false, "a killed query proves nothing");
  // Every cleanup spawn is itself bounded.
  const bounded = fn.match(/timeout: PROBE_HELPER_TIMEOUT_MS/g) ?? [];
  assert.equal(bounded.length, 2, "both cleanup spawns carry the named bound");
  // ...and both kill uncatchably, so the CLEANUP path cannot itself hang and
  // strand the caller after the probe has already timed out.
  const uncatchable = fn.match(/killSignal: PROBE_KILL_SIGNAL/g) ?? [];
  assert.equal(uncatchable.length, 2, "both cleanup spawns kill uncatchably");
  assert.ok(PROBE_HELPER_TIMEOUT_MS > 0, "the cleanup bound is positive");
});

// ==================================================== OUTPUT HANDLING =======

test("S14-9: the probe output parser cannot hang after a timeout", () => {
  // `spawnSync` returns a SETTLED buffer, so parsing is a pure string operation
  // on an already-complete value — there is no stream, reader, or promise that
  // could still be open when the bound expires.
  assert.match(BACKEND_SRC, /const out = spawnSync\(runtime, args, \{[^}]*timeout: probeTimeoutMs/, "the probe is spawned synchronously with the proven bound");
  const idx = BACKEND_SRC.indexOf("const out = spawnSync(runtime, args");
  const after = BACKEND_SRC.slice(idx, idx + 1400);
  assert.match(after, /JSON\.parse\(\(out\.stdout as string\)\.trim\(\)\)/, "parsing reads the settled buffer");
  for (const asyncApi of ["await ", "new Promise", "Promise.race", ".on(", "createInterface", "readline"]) {
    assert.equal(after.includes(asyncApi), false, `no ${asyncApi} may appear on the probe result path`);
  }
});

test("S14-10: malformed or partial output combined with a timeout stays a failure", () => {
  const partial = classifyContainerStartup({ errorCode: "ETIMEDOUT", status: null, signal: "SIGTERM", stdout: '{"uidNonRoot":tr', stderr: "", jsonParseFailed: true });
  assert.equal(partial.safeReasonCode, "sandbox-probe-failed");
  assert.notEqual(partial.safeReasonCode, "ok");
  // A timeout outranks the parse failure: the reason the JSON is truncated is
  // that the container was killed mid-write.
  assert.equal(partial.stderrCategory, "container-timeout-killed");

  // Malformed output WITHOUT a timeout is named for what it is.
  const malformed = classifyContainerStartup({ status: 0, signal: null, stdout: "{oops", stderr: "", jsonParseFailed: true });
  assert.equal(malformed.stderrCategory, "malformed-json-output");
  assert.notEqual(malformed.safeReasonCode, "ok");

  // Partial findings never satisfy the isolation classifier.
  assert.notEqual(classifyProbe({ uidNonRoot: true }), "ok", "a fragment proves nothing");
});

test("S14-11: no raw stdout, stderr, path or secret reaches the safe result", () => {
  const leaky = "sk-live-DEADBEEF /home/akel/.ssh/id_rsa C:\\Users\\akel\\secret AWS_SECRET_ACCESS_KEY=abc";
  const d = classifyContainerStartup({ errorCode: "ETIMEDOUT", status: 137, signal: "SIGKILL", stdout: leaky, stderr: leaky, jsonParseFailed: true });
  const serialized = JSON.stringify(d) + describeStartupFailure(d);
  for (const forbidden of ["sk-live", "DEADBEEF", "id_rsa", "/home/", "C:\\", "AWS_SECRET", "abc123"]) {
    assert.equal(serialized.includes(forbidden), false, `must not leak ${forbidden}: ${serialized}`);
  }
  // Only the six safe scalar fields exist.
  assert.deepEqual(Object.keys(d).sort(), ["runtimeExitCode", "runtimeSignal", "safeFailureFingerprint", "safeReasonCode", "stderrCategory", "stdoutPresent"]);

  // The unboundable-timeout refusal is equally safe.
  const backend = new DockerContainerSandboxBackend({ probeWorkspaceHostPath: leaky, verifyTimeoutMs: 0 });
  const report = backend.verifyIsolation();
  for (const forbidden of ["sk-live", "id_rsa", "/home/", "AWS_SECRET"]) {
    assert.equal(JSON.stringify(report).includes(forbidden), false, `refusal must not leak ${forbidden}`);
  }
});

// =========================================== DETECTION vs VERIFICATION ======

test("S14-12: detection is never mistaken for verification", () => {
  const backend = new DockerContainerSandboxBackend({ probeWorkspaceHostPath: "/tmp/nonexistent-probe", verifyTimeoutMs: 0 });
  // Detection may say a CLI exists; it may never say isolation is proven.
  const detected = backend.detectCapability();
  assert.notEqual(detected.capabilityState, "available-and-verified", "detection alone never verifies");
  assert.equal(detected.verified, false);
  assert.deepEqual(detected.claims, NO_ISOLATION_CLAIMS, "detection asserts no isolation claims");

  // And a refused verification does not upgrade the detected state either.
  const report = backend.verifyIsolation();
  assert.equal(report.verified, false);
  assert.notEqual(report.capabilityState, "available-and-verified");
});

test("S14-13: existing successful container semantics are unchanged", () => {
  // The default policy still validates, and the ordinary default bound is the
  // same value production used before S-14 — this milestone removes an
  // unbounded path, it does not retune a working one.
  assert.equal(validateSandboxPolicySpec(DEFAULT_SANDBOX_POLICY), "ok");
  assert.equal(DEFAULT_PROBE_TIMEOUT_MS, 120000, "the production default is unchanged");
  assert.equal(resolveProbeTimeoutMs(undefined).timeoutMs, 120000);
  assert.equal(classifyProbe(goodFindings()), "ok", "a good probe still verifies");

  // A limit set that is merely wrong is still refused, as before.
  const zeroTimeout = { ...DEFAULT_SANDBOX_POLICY, limits: { ...DEFAULT_SANDBOX_POLICY.limits, timeoutMs: 0 } };
  assert.equal(validateSandboxPolicySpec(zeroTimeout), "sandbox-limits-missing");
});

test("S14-14: the timeout mechanism is structurally present and cannot be omitted", () => {
  // The probe spawn must use the PROVEN bound, never the raw option, and the
  // raw option must not reach spawnSync anywhere.
  assert.equal(BACKEND_SRC.includes("timeout: probeTimeoutMs"), true, "the probe spawn uses the proven bound");
  assert.equal(/timeout: this\.options\.verifyTimeoutMs/.test(BACKEND_SRC), false, "the raw option must never reach spawnSync");
  assert.equal(/verifyTimeoutMs \?\? \d+/.test(BACKEND_SRC), false, "nullish-coalescing alone cannot bound this");
  assert.match(BACKEND_SRC, /const probeTimeout = resolveProbeTimeoutMs\(this\.options\.verifyTimeoutMs\);/, "the bound is resolved once");
  assert.match(BACKEND_SRC, /if \(!probeTimeout\.ok\) return unverified\(probeTimeout\.reasonCode,/, "and an unprovable bound fails closed with its own reason");

  // Every spawn in this backend carries a bound AND an uncatchable kill —
  // neither alone settles the caller against a child that resists SIGTERM.
  const spawns = BACKEND_SRC.split("\n").filter((l) => l.includes("spawnSync("));
  assert.ok(spawns.length >= 5, `the backend spawns are enumerated, found ${spawns.length}`);
  for (const line of spawns) {
    assert.match(line, /timeout: /, `every spawn must be bounded: ${line.trim().slice(0, 90)}`);
    assert.match(line, /killSignal: PROBE_KILL_SIGNAL/, `every spawn must kill uncatchably: ${line.trim().slice(0, 90)}`);
  }
});

test("S14-15: an invalid execution timeout is refused by the gate, not by a crash", () => {
  // Adjacent to the probe, same failure: `limits.timeoutMs` is handed to
  // spawnSync by execute(). `<= 0` alone let NaN through, because every
  // comparison with NaN is false, and 1.5 throws ERR_OUT_OF_RANGE just as NaN
  // does. Each is refused with the reason that is TRUE of it — zero means no
  // limit was set, the rest are set and unusable.
  const cases: Array<[number, string]> = [
    [0, "sandbox-limits-missing"],
    [NaN, "sandbox-limits-invalid"],
    [Infinity, "sandbox-limits-invalid"],
    [-Infinity, "sandbox-limits-invalid"],
    [1.5, "sandbox-limits-invalid"],
    [-1, "sandbox-limits-invalid"],
  ];
  for (const [bad, expected] of cases) {
    const policy = { ...DEFAULT_SANDBOX_POLICY, limits: { ...DEFAULT_SANDBOX_POLICY.limits, timeoutMs: bad } };
    assert.equal(validateSandboxPolicySpec(policy), expected, `timeoutMs=${bad} must be refused as ${expected}`);
  }
  // A fractional CPU share stays legitimate — only the spawn timeout needs to
  // be an integer.
  const fractionalCpu = { ...DEFAULT_SANDBOX_POLICY, limits: { ...DEFAULT_SANDBOX_POLICY.limits, cpuLimit: 0.5 } };
  assert.equal(validateSandboxPolicySpec(fractionalCpu), "ok", "0.5 CPU is a valid limit");
});

test("S14-16: execute() is bounded the same way, and only its TIMEOUT path changed", () => {
  // The execute() spawn is the same defect class: a permit timeout handed to
  // spawnSync, previously with the catchable default signal. `killSignal` is
  // consulted ONLY when the timeout fires, so a normally-exiting container is
  // completely unaffected — there is no graceful-shutdown contract here to
  // break, because the container is disposable by policy (`--rm`,
  // disposableFilesystem, cleanupAfterExit all required) and the probe writes
  // its findings in one synchronous `process.stdout.write`.
  const execIdx = BACKEND_SRC.indexOf("  execute(permit: SandboxExecutionPermit): SandboxExecutionReceipt {");
  assert.notEqual(execIdx, -1, "execute must be locatable");
  const body = BACKEND_SRC.slice(execIdx);
  const spawnLine = body.split("\n").find((l) => l.includes("spawnSync(") && l.includes("timeout:"));
  assert.ok(spawnLine, "execute spawns with a bound");
  assert.match(spawnLine as string, /timeout: permit\.policy\.limits\.timeoutMs/, "the bound is still the permit's own limit, unchanged");
  assert.match(spawnLine as string, /killSignal: PROBE_KILL_SIGNAL/, "and the kill is uncatchable");

  // Cleanup still runs on the execution path, and the receipt still reports it.
  assert.match(body, /const cleanupComplete = this\.forceRemove\(/, "execute still forces cleanup");
  assert.match(body, /safeReasonCode: cleanupComplete \? "ok" : "sandbox-cleanup-incomplete"/, "and still reports cleanup truthfully");

  // A permit whose timeout is unusable is refused by the gate BEFORE any spawn,
  // so execute() never reaches spawnSync with a value that would throw.
  for (const bad of [NaN, Infinity, 1.5, 0, -1]) {
    const policy = { ...DEFAULT_SANDBOX_POLICY, limits: { ...DEFAULT_SANDBOX_POLICY.limits, timeoutMs: bad } };
    assert.notEqual(validateSandboxPolicySpec(policy), "ok", `timeoutMs=${bad} must never reach a spawn`);
  }
});

test("S14-17: sandbox-limits-invalid propagates through every consumer as a refusal", () => {
  // The new reason is not merely declared — it must survive the gate and reach
  // a receipt without being remapped, dropped, or turned into success.
  const invalidPolicy = { ...DEFAULT_SANDBOX_POLICY, limits: { ...DEFAULT_SANDBOX_POLICY.limits, timeoutMs: NaN } };
  assert.equal(validateSandboxPolicySpec(invalidPolicy), "sandbox-limits-invalid", "the validator names it");

  // Through the authorize() gate: refused, blocked, and carrying the exact code.
  const gate = new SandboxPolicy(new FakeSandboxBackend("available-and-verified"));
  const auth = gate.authorize({ objectiveId: "o", taskId: "t", workspaceId: "w", executableId: "npm", fixedArguments: ["test"], policy: invalidPolicy, riskLevel: "high-risk", humanAuthorized: true });
  assert.equal(auth.ok, false, "an unusable limit cannot authorize");
  assert.equal(auth.permit, null, "and mints no permit");
  assert.equal(auth.receipt.safeReasonCode, "sandbox-limits-invalid", "the reason is not remapped to missing");
  assert.equal(auth.receipt.blocked, true);
  assert.equal(["ok", "completed", "none"].includes(auth.receipt.safeReasonCode), false, "and is never success-like");

  // Through the verification path: it is a member of the canonical safe-reason
  // union, so it can be reported without a cast.
  const asSafeReason: VerificationSafeReason = "sandbox-limits-invalid";
  assert.equal(asSafeReason, "sandbox-limits-invalid");

  // And it is genuinely DISTINCT from missing — the whole point of adding it.
  const zeroPolicy = { ...DEFAULT_SANDBOX_POLICY, limits: { ...DEFAULT_SANDBOX_POLICY.limits, timeoutMs: 0 } };
  assert.equal(validateSandboxPolicySpec(zeroPolicy), "sandbox-limits-missing");
  assert.notEqual(validateSandboxPolicySpec(zeroPolicy), validateSandboxPolicySpec(invalidPolicy), "absent and invalid must not collapse");
});

test("this suite started no container and required no Docker", () => {
  // The only child process above is a local node sleeper in S14-5.
  const src = readFileSync("src/tools/probeTimeoutTruthTests.ts", "utf8");
  // Executable invocations only. Excluded, with reason: comment lines, and
  // lines that merely SEARCH the backend source (`BACKEND_SRC.indexOf(...)`),
  // where the text "spawnSync(" is a search key rather than a call.
  const spawns = src
    .split("\n")
    .filter((l) => /(^|[^.\w])spawnSync\(/.test(l))
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.includes("import"))
    // Lines that SEARCH source text (.includes / .indexOf / .find) mention
    // "spawnSync(" as a needle, not as a call.
    .filter((l) => !/\.(includes|indexOf|find)\(/.test(l));
  // Three: the bound measurement, the signal-resistant child, and the
  // stdio-holding descendant. Every one is a local node process.
  assert.equal(spawns.length, 3, `expected 3 spawn invocations in this suite, found ${spawns.length}`);
  for (const line of spawns) {
    assert.match(line, /process\.execPath/, `must be a local node process, never a container runtime: ${line.trim().slice(0, 70)}`);
  }
  // Nothing in this suite names a container runtime binary as a spawn target.
  for (const line of spawns) {
    for (const runtime of ["docker", "podman"]) assert.equal(line.includes(`"${runtime}"`), false, `must not spawn ${runtime}`);
  }
  // Needles are ASSEMBLED rather than written out, so this check does not match
  // its own source text.
  for (const runtime of ["docker", "podman"]) {
    for (const verb of ["run", "build", "create", "start"]) {
      const forbidden = `${runtime} ${verb}`;
      assert.equal(src.includes(forbidden), false, `must not invoke ${forbidden}`);
    }
  }
});
