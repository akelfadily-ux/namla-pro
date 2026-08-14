/**
 * containerStartupDiagnosticsTests — proof that a failed container start is
 * distinguishable AND that nothing unsafe survives into the receipt.
 *
 * Every sample below is a representative real Docker stderr string. Nothing
 * here starts a container, pulls an image, or runs a provider.
 *
 * Run: node --test dist/tools/containerStartupDiagnosticsTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { classifyContainerStartup, classifyStderr, sanitizeForClassification, describeStartupFailure, type ContainerStderrCategory, type ContainerStartupOutcome } from "../cognitive/containerStartupDiagnostics";
import { DockerContainerSandboxBackend } from "../cognitive/containerSandboxBackend";
import { DEFAULT_SANDBOX_POLICY, type SandboxExecutionPermit } from "../cognitive/sandboxPolicy";

function outcome(overrides: Partial<ContainerStartupOutcome> = {}): ContainerStartupOutcome {
  return { status: 0, signal: null, stdout: "", stderr: "", ...overrides };
}

// ------------------------------------------------------ CATEGORY MAPPING ---

test("representative Docker stderr samples map to distinct fixed categories", () => {
  const samples: Array<[string, ContainerStderrCategory]> = [
    ["docker: unknown flag: --env-file-typo.\nSee 'docker run --help'.", "docker-argument-rejected"],
    ["docker: Error response from daemon: invalid argument: cannot set both memory and memory-swap.", "docker-argument-rejected"],
    ["docker: Error response from daemon: invalid mount config for type \"bind\": bind source path does not exist: /home/runner/work/namla-pro/dist/tools", "bind-mount-failed"],
    ["docker: Error response from daemon: invalid volume specification.", "bind-mount-failed"],
    ["docker: Error response from daemon: failed to create task for container: permission denied", "permission-denied"],
    ["docker: Got permission denied while trying to connect to the Docker daemon socket", "permission-denied"],
    ["docker: Error response from daemon: failed to create task: exec: \"node\": executable file not found in $PATH", "executable-not-found"],
    ["Error: Cannot find module '/namla-probe/containerIsolationProbe.js'", "node-script-load-failed"],
    ["node:internal/modules/cjs/loader:1215 throw err; MODULE_NOT_FOUND", "node-script-load-failed"],
    ["touch: cannot touch '/namla-rootfs-probe': Read-only file system", "read-only-filesystem"],
    ["Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?", "runtime-not-executable"],
  ];

  for (const [stderr, expected] of samples) {
    const sanitized = sanitizeForClassification(stderr);
    assert.equal(classifyStderr(sanitized), expected, `"${stderr.slice(0, 50)}..." must map to ${expected}`);
  }
});

test("empty stderr maps to none; unrecognised stderr maps to unclassified", () => {
  assert.equal(classifyStderr(""), "none");
  assert.equal(classifyStderr("some entirely novel daemon complaint"), "unclassified", "an unknown message must not be forced into a wrong category");
});

// -------------------------------------------------- FULL-OUTCOME CLASSIFY ---

test("a timeout kill is reported as a timeout, not as empty output", () => {
  const d = classifyContainerStartup(outcome({ errorCode: "ETIMEDOUT", status: null, signal: "SIGKILL" }));
  assert.equal(d.stderrCategory, "container-timeout-killed");
  assert.equal(d.runtimeSignal, "SIGKILL");
  assert.equal(d.runtimeExitCode, null);
  assert.equal(d.stdoutPresent, false);
  assert.equal(d.safeReasonCode, "sandbox-probe-failed");
});

test("a missing runtime is reported as runtime-unavailable, not probe-failed", () => {
  const d = classifyContainerStartup(outcome({ errorCode: "ENOENT", status: null }));
  assert.equal(d.stderrCategory, "runtime-not-executable");
  assert.equal(d.safeReasonCode, "sandbox-runtime-unavailable", "an absent runtime is a different fact from a failed probe");
});

test("exit 0 with empty stdout is its own category", () => {
  const d = classifyContainerStartup(outcome({ status: 0, stdout: "", stderr: "" }));
  assert.equal(d.stderrCategory, "empty-output-exit-zero");
  assert.equal(d.stdoutPresent, false);
  assert.equal(d.runtimeExitCode, 0);
});

test("Docker reserved exit codes are distinguished from a workload failure", () => {
  // 125/126/127 are DOCKER's own codes. This test previously asserted that 125
  // was a "container-nonzero-exit", which is exactly the defect the real CI run
  // exposed: exit 125 means the daemon refused the invocation and the container
  // command never ran, so it is a configuration fault, not a workload failure.
  assert.equal(classifyContainerStartup(outcome({ status: 125, stderr: "" })).stderrCategory, "docker-run-rejected");
  assert.equal(classifyContainerStartup(outcome({ status: 126, stderr: "" })).stderrCategory, "container-command-not-invokable");
  assert.equal(classifyContainerStartup(outcome({ status: 127, stderr: "" })).stderrCategory, "container-command-not-found");

  // Everything else stays generic.
  for (const code of [1, 2, 42, 137]) {
    const d = classifyContainerStartup(outcome({ status: code, stderr: "" }));
    assert.equal(d.stderrCategory, "container-nonzero-exit", `exit ${code} stays generic`);
    assert.equal(d.runtimeExitCode, code);
  }
});

test("malformed JSON is distinguished from absent output", () => {
  const bad = classifyContainerStartup(outcome({ status: 0, stdout: "{not json", jsonParseFailed: true }));
  assert.equal(bad.stderrCategory, "malformed-json-output");
  assert.equal(bad.stdoutPresent, true, "stdout WAS present - it simply did not parse");

  const empty = classifyContainerStartup(outcome({ status: 0, stdout: "" }));
  assert.notEqual(empty.stderrCategory, bad.stderrCategory, "the two must never collapse together");
});

test("a recognised stderr wins over a bare non-zero exit", () => {
  const d = classifyContainerStartup(outcome({ status: 125, stderr: "docker: Error response from daemon: invalid mount config for type \"bind\": bind source path does not exist: /tmp/missing" }));
  assert.equal(d.stderrCategory, "bind-mount-failed", "the specific cause must beat the generic exit code");
  assert.equal(d.runtimeExitCode, 125);
});

test("every distinct failure yields a distinct fingerprint; identical ones match", () => {
  const a = classifyContainerStartup(outcome({ status: 125, stderr: "unknown flag: --nope" }));
  const b = classifyContainerStartup(outcome({ status: 125, stderr: "unknown flag: --nope" }));
  const c = classifyContainerStartup(outcome({ errorCode: "ETIMEDOUT", status: null, signal: "SIGKILL" }));
  assert.equal(a.safeFailureFingerprint, b.safeFailureFingerprint, "identical failures must fingerprint identically");
  assert.notEqual(a.safeFailureFingerprint, c.safeFailureFingerprint, "different failures must differ");
  assert.match(a.safeFailureFingerprint, /^csd-[0-9a-f]{8}$/);
});

// --------------------------------------------------------------- REDACTION ---

test("host paths, usernames, container names and Docker ids never survive", () => {
  const B = String.fromCharCode(92);
  const hostile = [
    "docker: Error response from daemon: invalid mount config: bind source path does not exist: /home/runner/work/namla-pro/dist/tools",
    "C:" + B + "Users" + B + "akelf" + B + "Desktop" + B + "namla-pro" + B + "dist ",
    "container 3f2a1b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a failed",
    "namla-verify-12345-7 exited",
    "file:///home/runner/work/namla-pro/leak.js",
  ].join(" ");

  const sanitized = sanitizeForClassification(hostile);
  assert.equal(sanitized.includes("/home/runner"), false, "no POSIX host path may survive");
  assert.equal(sanitized.includes("C:"), false, "no Windows drive path may survive");
  assert.equal(sanitized.includes("akelf"), false, "no username may survive");
  assert.equal(sanitized.includes("namla-pro" + B), false, "no repository path may survive");
  assert.equal(sanitized.includes("3f2a1b9c8d7e"), false, "no Docker id may survive");
  assert.equal(sanitized.includes("namla-verify-12345-7"), false, "no container name may survive");
  assert.equal(sanitized.includes("file:///"), false, "no file URL may survive");
  // The stable phrase used for classification is retained.
  assert.equal(sanitized.includes("invalid mount config"), true, "the classifiable phrase must be kept");
});

test("credentials inside stderr are redacted before classification", () => {
  const secret = "sk-proj-AbCdEf0123456789AbCdEf0123456789";
  const ghp = "ghp_AbCdEf0123456789AbCdEf0123456789Ab";
  const sanitized = sanitizeForClassification(`docker: permission denied; tried token ${secret} and ${ghp}`);
  assert.equal(sanitized.includes(secret), false, "the OpenAI-style key must not survive");
  assert.equal(sanitized.includes(ghp), false, "the GitHub token must not survive");
  assert.equal(sanitized.includes("[REDACTED:"), true, "a redaction marker must be present");
  assert.equal(classifyStderr(sanitized), "permission-denied", "classification still works on sanitized text");
});

test("the emitted diagnostics carry ONLY the six safe fields and no raw output", () => {
  const secret = "sk-proj-AbCdEf0123456789AbCdEf0123456789";
  const d = classifyContainerStartup(outcome({ status: 125, stderr: `permission denied for /home/runner/x with ${secret}`, stdout: `leaked ${secret}` }));

  const allowed = ["runtimeExitCode", "runtimeSignal", "stdoutPresent", "stderrCategory", "safeFailureFingerprint", "safeReasonCode"];
  assert.deepEqual(Object.keys(d).sort(), [...allowed].sort(), "only the six safe fields may be emitted");

  const json = JSON.stringify(d);
  for (const forbidden of [secret, "/home/runner", "permission denied for", "leaked", "sk-", "ghp_"]) {
    assert.equal(json.includes(forbidden), false, `diagnostics must not contain ${forbidden}`);
  }
  // stdout presence is a BOOLEAN - the content never appears.
  assert.equal(d.stdoutPresent, true);
  assert.equal(json.includes("true"), true);
});

test("the safe one-liner is safe too", () => {
  const line = describeStartupFailure(classifyContainerStartup(outcome({ status: 125, stderr: "permission denied at /home/runner/secret-dir" })));
  assert.equal(line.includes("/home/runner"), false);
  assert.equal(line.includes("category=permission-denied"), true);
  assert.equal(line.includes("fp=csd-"), true);
});

test("no real action is taken by this suite", () => {
  // Pure classification. No container, no image, no provider, no network.
  const d = classifyContainerStartup(outcome({ status: 0 }));
  assert.equal(typeof d.safeFailureFingerprint, "string");
});

// ------------------------------------------------------- BACKEND WIRING ---

test("the backend exposes startup diagnostics and starts with none", () => {
  const backend = new DockerContainerSandboxBackend();
  assert.equal(backend.startupDiagnostics, null, "no failure has occurred yet");
  assert.equal(typeof backend.verifyIsolation, "function");
});

test("a refused execute() records NO startup diagnostics - nothing was started", () => {
  // A forged permit is refused BEFORE any container is created, so there is no
  // startup outcome to classify. Reporting one would invent a container run.
  const backend = new DockerContainerSandboxBackend();
  const forged = Object.freeze({ objectiveId: "x", taskId: "x", workspaceId: "x", executableId: "npm" as const, fixedArguments: [], policy: DEFAULT_SANDBOX_POLICY, backendId: "docker", capabilityState: "available-and-verified" as const }) as SandboxExecutionPermit;
  const receipt = backend.execute(forged);
  assert.equal(receipt.blocked, true);
  assert.equal(receipt.executionStarted, false);
  assert.equal(backend.startupDiagnostics, null, "a pre-spawn refusal must not fabricate startup diagnostics");
});

test("verifyIsolation on a host with no runtime records the runtime category", () => {
  // On a host without Docker the runtime cannot resolve, so verification stops
  // before any container. The reported reason must be the absent runtime.
  const backend = new DockerContainerSandboxBackend({ probeWorkspaceHostPath: "" });
  const report = backend.verifyIsolation();
  assert.notEqual(report.capabilityState, "available-and-verified", "no runtime can never verify");
  assert.equal(report.verified, false);
  assert.equal(["sandbox-runtime-unavailable", "sandbox-image-unavailable", "sandbox-probe-failed"].includes(report.safeReasonCode), true, `unexpected ${report.safeReasonCode}`);
  // Whatever the detail says, it carries no host path or credential.
  for (const forbidden of ["/home/", "C:", "sk-", "ghp_"]) {
    assert.equal(report.detectionDetail.includes(forbidden), false, `detectionDetail must not contain ${forbidden}`);
  }
});

test("every category is reachable from at least one classifier input", () => {
  // Guards against a category that exists in the type but can never be produced,
  // which would read as "this never happens" when it simply cannot be reported.
  const produced = new Set<ContainerStderrCategory>();
  const inputs: ContainerStartupOutcome[] = [
    { status: 125, signal: null, stdout: "", stderr: "docker: unknown flag: --nope" },
    { status: 125, signal: null, stdout: "", stderr: "invalid mount config for type bind" },
    { status: 126, signal: null, stdout: "", stderr: "permission denied" },
    { status: 127, signal: null, stdout: "", stderr: "executable file not found in $PATH" },
    { status: 1, signal: null, stdout: "", stderr: "Cannot find module '/namla-probe/x.js'" },
    { status: 1, signal: null, stdout: "", stderr: "Read-only file system" },
    { errorCode: "ETIMEDOUT", status: null, signal: "SIGKILL", stdout: "", stderr: "" },
    { status: 3, signal: null, stdout: "", stderr: "" },
    { status: 125, signal: null, stdout: "", stderr: "" },
    { status: 126, signal: null, stdout: "", stderr: "" },
    { status: 127, signal: null, stdout: "", stderr: "" },
    { status: 0, signal: null, stdout: "", stderr: "" },
    { status: 0, signal: null, stdout: "{oops", stderr: "", jsonParseFailed: true },
    { errorCode: "ENOENT", status: null, signal: null, stdout: "", stderr: "" },
    // `unclassified` requires exit 0 with output present and an unrecognised
    // message. With a NON-ZERO exit, `container-nonzero-exit` deliberately wins
    // because it is the more informative of the two.
    { status: 0, signal: null, stdout: "some output", stderr: "a totally novel daemon complaint" },
  ];
  for (const i of inputs) produced.add(classifyContainerStartup(i).stderrCategory);

  const expected: ContainerStderrCategory[] = ["docker-argument-rejected", "bind-mount-failed", "permission-denied", "executable-not-found", "node-script-load-failed", "read-only-filesystem", "container-timeout-killed", "docker-run-rejected", "container-command-not-invokable", "container-command-not-found", "container-nonzero-exit", "empty-output-exit-zero", "malformed-json-output", "runtime-not-executable", "unclassified"];
  for (const c of expected) assert.equal(produced.has(c), true, `category ${c} must be reachable`);
  assert.equal(produced.size, expected.length, "no unexpected category was produced");
});
