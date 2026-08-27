/**
 * verificationSandboxTests — proof that a verification command executes THROUGH
 * the sandbox permit and can never execute on the host (§35, Fable S-5).
 *
 * The defect these tests exist for: `runVerificationCommand` minted a permit
 * with `authorize(...)`, checked only that authorization succeeded, and then
 * ran the command with `spawnSync` on the HOST. The permit was never passed to
 * `execute()` — it authorized nothing. The host spawn was unreachable only
 * because the gate was hard-wired to a detection-only backend that can never
 * verify; supplying a verified backend, which is exactly what this milestone
 * does, would have made it live.
 *
 * Every sandbox here is a deterministic RECORDING FAKE. No Docker, no provider,
 * no network, no child process. The fakes record the permit object they were
 * handed, which is the load-bearing assertion: permit authority is object
 * IDENTITY in an issued-permit WeakSet, so a cloned or rebuilt permit is a
 * forged permit.
 *
 * Run: node --test dist/tools/verificationSandboxTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { resolve } from "path";

import { runVerificationCommand, type VerificationCommandId } from "../cognitive/nodeProviderProcessDriver";
import { buildVerificationSandboxPolicy, composeVerificationSandbox, workspaceAuthorizedByConfiguredRoots, type VerificationSandboxExecutor } from "../cognitive/verificationSandbox";
import {
  SandboxPolicy,
  FakeSandboxBackend,
  UnavailableSandboxBackend,
  DEFAULT_SANDBOX_POLICY,
  buildSandboxReceipt,
  isIssuedPermit,
  type SandboxAuthorization,
  type SandboxBackend,
  type SandboxCapabilityReport,
  type SandboxExecutionPermit,
  type SandboxExecutionReceipt,
  type SandboxExecutionRequest,
  type SandboxExitCategory,
  type SandboxIsolationClaims,
} from "../cognitive/sandboxPolicy";
import { claimsFromProbe } from "../cognitive/containerSandboxBackend";
import { RealBackedVerificationDriver } from "../cognitive/liveRealDrivers";
import { RealMcpExecutionDriver } from "../civilization/civLiveMcp";
import { VERIFICATION_ARGUMENT_TEMPLATES } from "../cognitive/trustedExecutableRegistry";

// ----------------------------------------------------------------- FIXTURES ---

const WORKSPACE = process.cwd();

/** The claim set a REAL verified container produces (S-2: no allowlist claim). */
function realisticClaims(): SandboxIsolationClaims {
  return claimsFromProbe({
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
  });
}

/**
 * A verified backend that RECORDS what it executed. It performs no isolation
 * and starts nothing — it exists to observe permit routing.
 */
class RecordingVerifiedBackend implements SandboxBackend {
  readonly backendId = "recording-verified-fake";
  readonly isReal = false;
  executeCalls: SandboxExecutionPermit[] = [];

  constructor(
    private readonly exitCategory: SandboxExitCategory = "completed",
    private readonly cleanupComplete = true,
  ) {}

  detectCapability(): SandboxCapabilityReport {
    return {
      backendId: this.backendId,
      capabilityState: "available-and-verified",
      available: true,
      verified: true,
      detectionMethod: "fake",
      detectionDetail: "deterministic recording test backend - performs NO real isolation",
      claims: realisticClaims(),
      safeReasonCode: "ok",
    };
  }

  execute(permit: SandboxExecutionPermit): SandboxExecutionReceipt {
    this.executeCalls.push(permit);
    const completed = this.exitCategory === "completed";
    return buildSandboxReceipt({
      backendId: this.backendId,
      capabilityState: "available-and-verified",
      executionStarted: true,
      executionCompleted: completed,
      exitCategory: this.exitCategory,
      timeoutMs: permit.policy.limits.timeoutMs,
      cpuLimit: permit.policy.limits.cpuLimit,
      memoryLimitMb: permit.policy.limits.memoryLimitMb,
      pidLimit: permit.policy.limits.pidLimit,
      networkPolicy: permit.policy.network.policy,
      mountPolicy: "bounded-workspace-only",
      cleanupComplete: this.cleanupComplete,
      blocked: false,
      safeReasonCode: this.cleanupComplete ? "ok" : "sandbox-cleanup-incomplete",
    });
  }
}

/** Records BOTH the request it authorized and the permit it was asked to execute. */
class RecordingExecutor implements VerificationSandboxExecutor {
  readonly requests: SandboxExecutionRequest[] = [];
  readonly executed: SandboxExecutionPermit[] = [];
  lastAuthorization: SandboxAuthorization | null = null;

  constructor(private readonly policy: SandboxPolicy) {}

  authorize(request: SandboxExecutionRequest): SandboxAuthorization {
    this.requests.push(request);
    this.lastAuthorization = this.policy.authorize(request);
    return this.lastAuthorization;
  }

  execute(permit: SandboxExecutionPermit): SandboxExecutionReceipt {
    this.executed.push(permit);
    return this.policy.execute(permit);
  }
}

function verifiedExecutor(exitCategory: SandboxExitCategory = "completed", cleanupComplete = true): { executor: RecordingExecutor; backend: RecordingVerifiedBackend } {
  const backend = new RecordingVerifiedBackend(exitCategory, cleanupComplete);
  return { executor: new RecordingExecutor(new SandboxPolicy(backend)), backend };
}

function run(commandId: VerificationCommandId, sandbox: VerificationSandboxExecutor | null, humanAuthorized = true) {
  return runVerificationCommand({ commandId, workingDirectoryAbsolute: WORKSPACE, timeoutMs: 5000, maxOutputBytes: 1000, humanAuthorized, sandbox });
}

// -------------------------------------------------------- PERMIT ROUTING ---

test("the EXACT issued permit reaches execute(), unchanged by identity", () => {
  const { executor, backend } = verifiedExecutor();
  const result = run("typecheck", executor);

  assert.equal(result.ran, true, "a verified sandbox executes the command");
  assert.equal(executor.executed.length, 1, "execute was called exactly once");
  assert.equal(backend.executeCalls.length, 1, "and reached the backend exactly once");

  const issued = executor.lastAuthorization;
  assert.notEqual(issued, null);
  assert.equal(issued?.ok, true, "authorization succeeded");
  if (!issued?.ok) return;

  // Object IDENTITY, not deep equality: the WeakSet is the authority.
  assert.equal(executor.executed[0], issued.permit, "the same object must be passed through");
  assert.equal(backend.executeCalls[0], issued.permit, "and the same object must reach the backend");
  assert.equal(isIssuedPermit(executor.executed[0]), true, "and it is still a recognised issued permit");
});

test("the permit is not cloned, spread, or reconstructed", () => {
  const { executor } = verifiedExecutor();
  run("typecheck", executor);
  const issued = executor.lastAuthorization;
  if (!issued?.ok) throw new Error("expected authorization to succeed");

  const delivered = executor.executed[0];
  // A structural copy would deep-equal but fail identity AND fail the WeakSet.
  const clone = { ...issued.permit };
  assert.notEqual(delivered, clone, "a spread copy is a different object");
  assert.equal(isIssuedPermit(clone as SandboxExecutionPermit), false, "and a copy carries no authority");
  assert.equal(Object.isFrozen(delivered), true, "the delivered permit is the frozen original");
});

test("a forged permit is refused by the gate itself", () => {
  const backend = new RecordingVerifiedBackend();
  const policy = new SandboxPolicy(backend);
  const forged = {
    objectiveId: "typecheck",
    taskId: "typecheck",
    workspaceId: WORKSPACE,
    executableId: "npx",
    fixedArguments: ["tsc", "--noEmit"],
    policy: DEFAULT_SANDBOX_POLICY,
    backendId: backend.backendId,
    capabilityState: "available-and-verified",
  } as unknown as SandboxExecutionPermit;

  const receipt = policy.execute(forged);
  assert.equal(receipt.blocked, true, "an unissued permit must be refused");
  assert.equal(receipt.safeReasonCode, "sandbox-capability-unverified");
  assert.equal(backend.executeCalls.length, 0, "the backend must never see it");
});

// ------------------------------------------------------ NO HOST EXECUTION ---

test("no injected sandbox means no execution at all", () => {
  const result = run("test", null);
  assert.equal(result.ran, false, "nothing may run without a sandbox");
  assert.equal(result.status, "failed");
  assert.equal(result.failureCategory, "sandbox-runtime-unavailable");
  assert.equal(result.exitCode, null);
  assert.equal(result.outputLineCount, 0);
});

test("an unavailable or unverified sandbox executes nothing", () => {
  for (const [label, sandbox] of [
    ["unavailable", new SandboxPolicy(new UnavailableSandboxBackend())],
    ["fake-test-backend", new SandboxPolicy(new FakeSandboxBackend("fake-test-backend"))],
    ["available-unverified", new SandboxPolicy(new FakeSandboxBackend("available-unverified"))],
  ] as Array<[string, SandboxPolicy]>) {
    const fake = new FakeSandboxBackend("available-unverified");
    void fake;
    const result = run("test", sandbox);
    assert.equal(result.ran, false, `${label} must not execute`);
    assert.equal(result.status, "failed", `${label} status`);
    assert.notEqual(result.failureCategory, null, `${label} must state a reason, never none`);
    assert.match(result.failureCategory ?? "", /^sandbox-/, `${label} must report a sandbox refusal`);
  }
});

test("missing human authorization refuses before any execution", () => {
  const { executor, backend } = verifiedExecutor();
  const result = run("test", executor, false);

  assert.equal(result.ran, false, "high-risk work needs a human");
  assert.equal(result.failureCategory, "sandbox-human-authorization-missing");
  assert.equal(executor.executed.length, 0, "execute was never called");
  assert.equal(backend.executeCalls.length, 0, "and the backend was never reached");
});

test("runVerificationCommand contains NO host spawn path", () => {
  // Source-level guard, scoped to the FUNCTION rather than the module:
  // nodeProviderProcessDriver legitimately spawns for provider execution and
  // for the `--version` availability probe, and banning spawnSync file-wide
  // would be both wrong and unmaintainable.
  const source = readFileSync("src/cognitive/nodeProviderProcessDriver.ts", "utf8");
  const start = source.indexOf("export function runVerificationCommand");
  assert.equal(start > 0, true, "the function must exist");
  // The function is the last export in the file; take everything from its start.
  const body = source.slice(start);

  for (const hostCall of ["spawnSync(", "spawn(", "exec(", "execFile(", "execSync("]) {
    assert.equal(body.includes(hostCall), false, `runVerificationCommand must not call ${hostCall}`);
  }
  // It must also not resolve a host executable to run itself.
  assert.equal(body.includes("resolveTrustedExecutable("), false, "it must not resolve a host executable");
  // And it must route through the permit.
  assert.equal(body.includes("sandbox.execute(authorization.permit)"), true, "it must execute the issued permit");
});

// ------------------------------------------------------- POLICY BINDING ---

test("the REAL workspace path is bound, never the container-side default", () => {
  const { executor } = verifiedExecutor();
  run("build", executor);

  assert.equal(executor.requests.length, 1);
  const policy = executor.requests[0].policy;
  assert.equal(policy.mounts.workspaceMountPath, WORKSPACE, "the real host workspace is bound in");
  assert.notEqual(policy.mounts.workspaceMountPath, "/workspace", "the container-side default must not be used as a host source");
  assert.equal(DEFAULT_SANDBOX_POLICY.mounts.workspaceMountPath, "/workspace", "and the default really is that container path");

  // No extra mounts sneak in.
  assert.deepEqual([...policy.mounts.hostMounts], []);
  assert.equal(policy.mounts.mountDockerSocket, false);
  assert.equal(policy.mounts.mountCredentials, false);
  assert.equal(policy.inheritEnvironmentSecrets, false);
});

test("the builder binds exactly the path it is given", () => {
  const built = buildVerificationSandboxPolicy("/some/trusted/workspace");
  assert.equal(built.mounts.workspaceMountPath, "/some/trusted/workspace");
  assert.equal(built.network.policy, "denied");
  assert.deepEqual([...built.network.allowlist], []);
});

test("network policy is denied, and nothing wider is ever requested", () => {
  const { executor } = verifiedExecutor();
  run("test", executor);
  const request = executor.requests[0];
  assert.equal(request.policy.network.policy, "denied", "verification never needs the network");
  assert.deepEqual([...request.policy.network.allowlist], []);
  for (const wider of ["loopback-only", "provider-only", "allowlisted", "allowed"]) {
    assert.notEqual(request.policy.network.policy, wider, `${wider} must never be requested`);
  }
});

test("a workspace outside the configured authorized roots is refused", () => {
  // The requested workspace and the roots that authorize it are SEPARATE
  // authorities. A workspace that no configured root contains yields no
  // executor at all, so nothing downstream can execute.
  const outside = composeVerificationSandbox({
    workspaceHostPath: resolve(WORKSPACE, "some", "objective"),
    authorizedMountRoots: [resolve(WORKSPACE, "a-different-tree")],
    probeWorkspaceHostPath: resolve(WORKSPACE, "probe"),
  });
  assert.equal(outside, null, "a workspace outside every configured root is refused");

  const result = run("test", outside);
  assert.equal(result.ran, false, "so verification is unavailable");
  assert.equal(result.failureCategory, "sandbox-runtime-unavailable");
});

test("a workspace cannot be its own authorization root", () => {
  // Asserted on the PURE rule, not on composeVerificationSandbox: that function
  // also returns null when Docker is absent, so testing it here would pass on
  // this host for entirely the wrong reason and prove nothing.
  const objective = resolve(WORKSPACE, "objective");

  assert.equal(workspaceAuthorizedByConfiguredRoots(objective, [objective]), false, "a workspace must not authorize itself");
  assert.equal(workspaceAuthorizedByConfiguredRoots(objective, []), false, "no configured roots means no authorization");
  assert.equal(workspaceAuthorizedByConfiguredRoots(objective, ["relative/root"]), false, "a relative root authorizes nothing");
  assert.equal(workspaceAuthorizedByConfiguredRoots(objective, [resolve(WORKSPACE, "elsewhere")]), false, "an unrelated root authorizes nothing");
  assert.equal(workspaceAuthorizedByConfiguredRoots("", [WORKSPACE]), false, "an empty workspace is refused");

  // The legitimate shape: strictly inside a separately configured root.
  assert.equal(workspaceAuthorizedByConfiguredRoots(objective, [WORKSPACE]), true, "contained by a configured root is authorized");
  assert.equal(workspaceAuthorizedByConfiguredRoots(resolve(WORKSPACE, "a", "b", "c"), [WORKSPACE]), true, "nesting is fine");

  // And the composer refuses the collapsed case for this reason, before it ever
  // asks a backend anything.
  assert.equal(
    composeVerificationSandbox({ workspaceHostPath: objective, authorizedMountRoots: [objective], probeWorkspaceHostPath: resolve(WORKSPACE, "probe") }),
    null,
    "self-authorization produces no executor",
  );
});

test("isolation that cannot be proven yields no executor", () => {
  // Even a properly contained workspace under a real configured root produces
  // nothing when there is no scratch directory to prove isolation against.
  const executor = composeVerificationSandbox({
    workspaceHostPath: resolve(WORKSPACE, "objective"),
    authorizedMountRoots: [WORKSPACE],
    probeWorkspaceHostPath: null,
  });
  assert.equal(executor, null, "unprovable isolation yields no executor");
  assert.equal(run("test", executor).failureCategory, "sandbox-runtime-unavailable");
});

// --------------------------------------------------------- ARGV BINDING ---

test("executable and argv come ONLY from the fixed template", () => {
  for (const commandId of ["typecheck", "test", "build", "lint"] as VerificationCommandId[]) {
    const entry = VERIFICATION_ARGUMENT_TEMPLATES[commandId];
    if (!entry) continue;
    const { executor } = verifiedExecutor();
    run(commandId, executor);
    const request = executor.requests[0];
    assert.equal(request.executableId, entry.id, `${commandId} executable must be the template id`);
    assert.deepEqual([...request.fixedArguments], [...entry.args], `${commandId} argv must be the template args`);
  }
});

test("no caller-supplied text can influence the executable or argv", () => {
  const { executor } = verifiedExecutor();
  // The spec carries only a command id, a workspace and numeric bounds — there
  // is no field through which a shell string, flag, or path could arrive.
  const result = runVerificationCommand({
    commandId: "typecheck",
    workingDirectoryAbsolute: WORKSPACE,
    timeoutMs: 5000,
    maxOutputBytes: 1000,
    humanAuthorized: true,
    sandbox: executor,
  });
  assert.equal(result.ran, true);
  const request = executor.requests[0];
  const joined = request.fixedArguments.join(" ");
  for (const injected of ["&&", ";", "|", "$(", "`", "--inspect", "rm "]) {
    assert.equal(joined.includes(injected), false, `argv must not contain ${injected}`);
  }
  assert.equal(request.executableId, "npx");
});

test("an unknown command id is refused before anything is authorized", () => {
  const { executor, backend } = verifiedExecutor();
  const result = runVerificationCommand({
    commandId: "definitely-not-a-command" as VerificationCommandId,
    workingDirectoryAbsolute: WORKSPACE,
    timeoutMs: 5000,
    maxOutputBytes: 1000,
    humanAuthorized: true,
    sandbox: executor,
  });
  assert.equal(result.ran, false);
  assert.equal(result.failureCategory, "unknown-command");
  assert.equal(executor.requests.length, 0, "no authorization was attempted");
  assert.equal(backend.executeCalls.length, 0, "and nothing executed");
});

// -------------------------------------------------------- RESULT MAPPING ---

test("outcomes map truthfully and invent no data", () => {
  // S-13: success is `null` and ONLY `null`. It was previously the string
  // "none", which meant one member of the reason vocabulary secretly meant "no
  // failure" — and a FAILED result could carry it too. `null` is not a reason,
  // so that pairing is now unrepresentable rather than merely unused.
  const cases: Array<[SandboxExitCategory, boolean, string | null, "passed" | "failed"]> = [
    ["completed", true, null, "passed"],
    ["timed-out", true, "timed-out", "failed"],
    ["non-zero-exit", true, "non-zero-exit", "failed"],
    ["backend-error", true, "backend-error", "failed"],
    ["completed", false, "sandbox-cleanup-incomplete", "failed"],
  ];
  for (const [exitCategory, cleanupComplete, expectedCategory, expectedStatus] of cases) {
    const { executor } = verifiedExecutor(exitCategory, cleanupComplete);
    const result = run("test", executor);
    assert.equal(result.ran, true, `${exitCategory} started`);
    assert.equal(result.failureCategory, expectedCategory, `${exitCategory} category`);
    assert.equal(result.status, expectedStatus, `${exitCategory} status`);
    // A failure always names a reason, and never a success-like one.
    if (expectedStatus === "failed") {
      assert.notEqual(result.failureCategory, null, `${exitCategory} must state a reason`);
      assert.equal(["ok", "completed", "none"].includes(String(result.failureCategory)), false, `${exitCategory} must not report success`);
    }

    // No fabricated numbers: a sandbox receipt exposes neither an exit code nor
    // stdout, so neither is invented to preserve the old field shape.
    assert.equal(result.exitCode, null, "no exit code may be invented");
    assert.equal(result.outputLineCount, 0, "no line count may be invented");
    assert.equal(result.outputObservable, false, "and the result says so honestly");
  }
});

test("no raw output, host path, or secret appears in a verification result", () => {
  const { executor } = verifiedExecutor();
  const result = run("test", executor);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(WORKSPACE), false, "no host path in the result");
  assert.equal(Object.keys(result).sort().join(","), "exitCode,failureCategory,outputLineCount,outputObservable,ran,status");
});

// ---------------------------------------------------------- NO REAL WORK ---

test("this suite starts no container, provider, network call, or child process", () => {
  const self = readFileSync("src/tools/verificationSandboxTests.ts", "utf8");
  const moduleRefs = [...self.matchAll(/(?:from|require\()\s*"([^"]+)"/g)].map((m) => m[1]);
  for (const banned of ["child_process", "http", "https", "net", "tls"]) {
    assert.equal(moduleRefs.includes(banned), false, `this suite must not import ${banned}`);
  }
  // Every backend used here is a fake; none performs isolation.
  const backend = new RecordingVerifiedBackend();
  assert.equal(backend.isReal, false, "the recording backend is not real");
  assert.equal(new FakeSandboxBackend("available-and-verified").isReal, false);
});

// --------------------------------- CALLERS DO NOT INVENT AUTHORIZATION ---

test("RealBackedVerificationDriver never invents human authorization", () => {
  // Constructed WITHOUT the trusted confirmation and without a sandbox — the
  // defaults a caller gets if it forgets to thread them. Both must fail closed
  // rather than the leaf deciding it is authorized.
  // S-13 removed the constructor defaults, so this position must now be STATED
  // rather than inherited. The behaviour under test is unchanged: authorization
  // explicitly declined, no sandbox, both failing closed rather than the leaf
  // deciding it is authorized.
  const driver = new RealBackedVerificationDriver(WORKSPACE, ["typecheck"], 5000, 1000, false, null);
  const outcome = driver.run("typecheck", WORKSPACE, false);

  assert.equal(outcome.realProcessExecutions, 0, "nothing may run");
  assert.equal(driver.realVerificationExecutions, 0, "and nothing was counted as executed");
  assert.equal(outcome.status, "failed");

  // Even given a VERIFIED sandbox, an unauthorized driver still refuses: the
  // sandbox is not a substitute for the human.
  const { executor, backend } = verifiedExecutor();
  const unauthorized = new RealBackedVerificationDriver(WORKSPACE, ["typecheck"], 5000, 1000, false, executor);
  unauthorized.run("typecheck", WORKSPACE, false);
  assert.equal(backend.executeCalls.length, 0, "a verified sandbox does not authorize the run");
  assert.equal(unauthorized.realVerificationExecutions, 0);

  // With BOTH the human fact and a verified sandbox, it proceeds.
  const authorized = new RealBackedVerificationDriver(WORKSPACE, ["typecheck"], 5000, 1000, true, executor);
  authorized.run("typecheck", WORKSPACE, false);
  assert.equal(backend.executeCalls.length, 1, "both authorities present -> exactly one execution");
  assert.equal(authorized.realVerificationExecutions, 1);
});

test("RealMcpExecutionDriver never invents human authorization", () => {
  const { executor, backend } = verifiedExecutor();
  const config = {
    handle: { workspaceId: "ws", absolutePath: WORKSPACE },
    perFileByteCap: 1000,
    timeoutMs: 5000,
    maxOutputBytes: 1000,
    contentForTask: () => null,
    humanAuthorized: false,
    sandbox: executor,
  };

  const unauthorized = new RealMcpExecutionDriver(config);
  const res = unauthorized.execute({ toolId: "typecheck", antId: "a", districtId: "d", taskId: "t", tick: 1 } as never);
  assert.equal(res.ok, false, "an unauthorized verification tool must fail");
  assert.equal(backend.executeCalls.length, 0, "and must never reach the backend");
  assert.equal(unauthorized.realVerificationRuns, 0);

  // The config carries the fact; the driver only transports it.
  const authorized = new RealMcpExecutionDriver({ ...config, humanAuthorized: true });
  authorized.execute({ toolId: "typecheck", antId: "a", districtId: "d", taskId: "t", tick: 1 } as never);
  assert.equal(backend.executeCalls.length, 1, "with the human fact present it proceeds exactly once");
});
