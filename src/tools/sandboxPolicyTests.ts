/**
 * sandboxPolicyTests — proof that unverified isolation never authorizes
 * high-risk execution, and that refusal never degrades into host execution.
 *
 * Fake backends only. No container is created, no image pulled, no package
 * installed, no network touched, and no provider run.
 *
 * Run: node --test dist/tools/sandboxPolicyTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  SandboxPolicy,
  FakeSandboxBackend,
  UnavailableSandboxBackend,
  SandboxUnavailableError,
  detectContainerRuntime,
  validateSandboxPolicySpec,
  projectSandbox,
  describeSandbox,
  describeMountPolicy,
  isIssuedPermit,
  buildSandboxReceipt,
  DEFAULT_SANDBOX_POLICY,
  NO_ISOLATION_CLAIMS,
  ALL_ISOLATION_CLAIMS,
  type SandboxAuthorization,
  type SandboxExecutionRequest,
  type SandboxPolicySpec,
  type SandboxExecutionPermit,
} from "../cognitive/sandboxPolicy";
import { readFileSync } from "fs";
import { runVerificationCommand } from "../cognitive/nodeProviderProcessDriver";
import { TWIN_COMMAND_CENTER_SANDBOX } from "../twin/twinCommandCenter";

function request(overrides: Partial<SandboxExecutionRequest> = {}): SandboxExecutionRequest {
  return {
    objectiveId: "obj-1",
    taskId: "task-1",
    workspaceId: "workspaces/namola-twin/m1/codex-crucible",
    executableId: "npm",
    fixedArguments: ["test"],
    policy: DEFAULT_SANDBOX_POLICY,
    riskLevel: "high-risk",
    humanAuthorized: true,
    ...overrides,
  };
}

function policyWith(patch: Partial<SandboxPolicySpec>): SandboxPolicySpec {
  return { ...DEFAULT_SANDBOX_POLICY, ...patch };
}

// ------------------------------------------------------ CAPABILITY LADDER ---

test("a verified backend authorizes bounded execution and issues a real permit", () => {
  const backend = new FakeSandboxBackend("available-and-verified");
  const gate = new SandboxPolicy(backend);
  const auth = gate.authorize(request());

  assert.equal(auth.ok, true, "a verified backend must authorize");
  if (!auth.ok) return;
  assert.equal(isIssuedPermit(auth.permit), true, "the permit must be one this gate issued");
  assert.equal(Object.isFrozen(auth.permit), true, "the permit must be frozen");
  assert.equal(auth.receipt.blocked, false);
  assert.equal(auth.receipt.exitCategory, "not-started");
  assert.equal(auth.receipt.cpuLimit, DEFAULT_SANDBOX_POLICY.limits.cpuLimit);
  assert.equal(auth.receipt.networkPolicy, "denied", "default-deny network is preserved");

  const receipt = gate.execute(auth.permit);
  assert.equal(receipt.executionStarted, true);
  assert.equal(receipt.executionCompleted, true);
  assert.equal(receipt.cleanupComplete, true, "a cleanup receipt must be produced");
  assert.equal(backend.executeCallCount, 1);
});

test("an UNAVAILABLE backend blocks before the backend is ever invoked", () => {
  const backend = new FakeSandboxBackend("unavailable");
  const gate = new SandboxPolicy(backend);
  const auth = gate.authorize(request());

  assert.equal(auth.ok, false, "unavailable must fail closed");
  assert.equal(auth.permit, null, "no permit may be handed back");
  assert.equal(auth.receipt.safeReasonCode, "sandbox-runtime-unavailable");
  assert.equal(auth.receipt.blocked, true);
  assert.equal(auth.receipt.executionStarted, false);
  // THE decisive assertion: nothing executed.
  assert.equal(backend.executeCallCount, 0, "the backend must never be invoked when blocked");
});

test("available-unverified is NOT sufficient for high-risk execution", () => {
  const backend = new FakeSandboxBackend("available-unverified");
  const gate = new SandboxPolicy(backend);
  const auth = gate.authorize(request());

  assert.equal(auth.ok, false, "a detected-but-unverified runtime must not authorize");
  assert.equal(auth.receipt.safeReasonCode, "sandbox-capability-unverified");
  assert.equal(backend.executeCallCount, 0);

  // And it must not be projected as protection.
  const p = projectSandbox(backend.detectCapability());
  assert.equal(p.sandboxVerified, false);
  assert.equal(p.sandboxExecutionBlocked, true, "unverified must never read as protected");
});

test("the fake backend is labelled fake-test-backend and cannot authorize high-risk work", () => {
  const backend = new FakeSandboxBackend();
  assert.equal(backend.backendId, "fake-test-backend");
  assert.equal(backend.isReal, false, "the fake backend must never claim to be real");

  const cap = backend.detectCapability();
  assert.equal(cap.capabilityState, "fake-test-backend");
  assert.equal(cap.verified, false);
  assert.deepEqual(cap.claims, NO_ISOLATION_CLAIMS, "a fake backend claims NO isolation");

  const auth = new SandboxPolicy(backend).authorize(request());
  assert.equal(auth.ok, false);
  assert.equal(auth.receipt.safeReasonCode, "sandbox-fake-backend-not-permitted");
  assert.equal(backend.executeCallCount, 0);
});

test("an unverified or unavailable capability never projects protected=true", () => {
  for (const state of ["unavailable", "available-unverified", "fake-test-backend"] as const) {
    const p = projectSandbox(new FakeSandboxBackend(state).detectCapability());
    assert.equal(p.sandboxVerified, false, `${state} must not be verified`);
    assert.equal(p.sandboxExecutionBlocked, true, `${state} must block execution`);
    assert.equal(p.sandboxLimits, "none-enforced", `${state} must not claim enforced limits`);
    assert.equal(p.sandboxMountPolicy, "none", `${state} must not claim a mount policy`);
    assert.equal(describeSandbox(p).startsWith("NOT SANDBOXED"), true, `${state} must not read as sandboxed`);
  }
  const verified = projectSandbox(new FakeSandboxBackend("available-and-verified").detectCapability());
  assert.equal(verified.sandboxVerified, true);
  assert.equal(describeSandbox(verified).startsWith("sandboxed"), true);
});

// ------------------------------------------------------- NO HOST FALLBACK ---

test("NO HOST FALLBACK: the real verification path refuses before spawning", () => {
  // runVerificationCommand runs `npm test`, which executes whatever the
  // generated package.json declares. Without a VERIFIED sandbox it must refuse
  // rather than run on the host.
  //
  // The refusal CODE depends on the host, and hard-coding one was a real
  // platform assumption that failed on the first CI run: GitHub's ubuntu
  // runners ship Docker, so capability is `available-unverified` and the
  // correct code is `sandbox-capability-unverified`, not
  // `sandbox-runtime-unavailable`. Both are fail-closed. What must NEVER vary
  // is that nothing ran, so that is asserted unconditionally and the code is
  // asserted to MATCH the host's actual capability rather than a fixed guess.
  const cap = detectContainerRuntime();
  // §35: the executor is now INJECTED rather than hard-wired inside the
  // function. An explicit unverified backend preserves this test's original
  // meaning — refusal comes from the gate, not from a missing dependency.
  const result = runVerificationCommand({
    commandId: "test",
    workingDirectoryAbsolute: process.cwd(),
    timeoutMs: 5000,
    maxOutputBytes: 1000,
    humanAuthorized: true,
    sandbox: new SandboxPolicy(new UnavailableSandboxBackend()),
  });

  assert.equal(result.ran, false, "no process may be started without a verified sandbox");
  assert.equal(result.status, "failed");
  assert.equal(result.exitCode, null);
  assert.equal(result.outputLineCount, 0);

  const expected = cap.capabilityState === "unavailable" ? "sandbox-runtime-unavailable" : "sandbox-capability-unverified";
  assert.equal(result.failureCategory, expected, `capability is ${cap.capabilityState}, so the refusal code must be ${expected}`);
  // Detection must never be enough to authorize execution.
  assert.equal(cap.verified, false, "detection alone must never report verified");
});

test("a DETECTED runtime yields available-unverified and still refuses execution", () => {
  // Regression for the CI failure above, covering BOTH host states explicitly
  // so neither can silently become the only tested one.
  const detected = new FakeSandboxBackend("available-unverified");
  const detectedGate = new SandboxPolicy(detected);
  const detectedCap = detected.detectCapability();
  assert.equal(detectedCap.capabilityState, "available-unverified");
  assert.equal(detectedCap.available, true, "a detected runtime IS available");
  assert.equal(detectedCap.verified, false, "but it is NOT verified");
  assert.deepEqual(detectedCap.claims, NO_ISOLATION_CLAIMS, "a detected runtime claims no isolation");
  const detectedAuth = detectedGate.authorize(request());
  assert.equal(detectedAuth.ok, false, "detection must never authorize execution");
  assert.equal(detectedAuth.receipt.safeReasonCode, "sandbox-capability-unverified");
  assert.equal(detected.executeCallCount, 0, "nothing may execute");

  const absent = new FakeSandboxBackend("unavailable");
  const absentGate = new SandboxPolicy(absent);
  const absentAuth = absentGate.authorize(request());
  assert.equal(absentAuth.ok, false);
  assert.equal(absentAuth.receipt.safeReasonCode, "sandbox-runtime-unavailable");
  assert.equal(absent.executeCallCount, 0);

  // Both states are fail-closed, and neither projects as sandboxed.
  for (const cap of [detectedCap, absent.detectCapability()]) {
    assert.equal(projectSandbox(cap).sandboxVerified, false);
    assert.equal(projectSandbox(cap).sandboxExecutionBlocked, true);
  }
});

test("the unavailable backend is structurally incapable of executing", () => {
  const backend = new UnavailableSandboxBackend();
  assert.equal(backend.isReal, false);
  const receipt = backend.execute();
  assert.equal(receipt.executionStarted, false);
  assert.equal(receipt.blocked, true);
  assert.equal(receipt.safeReasonCode, "sandbox-runtime-unavailable");
});

test("a forged permit object is refused by the gate", () => {
  const gate = new SandboxPolicy(new FakeSandboxBackend("available-and-verified"));
  const forged = Object.freeze({ objectiveId: "x", taskId: "x", workspaceId: "x", executableId: "npm", fixedArguments: [], policy: DEFAULT_SANDBOX_POLICY, backendId: "fake-test-backend", capabilityState: "available-and-verified" }) as SandboxExecutionPermit;
  assert.equal(isIssuedPermit(forged), false, "a hand-built permit is not issued");
  const receipt = gate.execute(forged);
  assert.equal(receipt.blocked, true, "a forged permit must not execute");
  assert.equal(receipt.executionStarted, false);
});

// ------------------------------------------------- POLICY VIOLATION GATES ---

test("host mounts, docker socket, and credential mounts are refused", () => {
  const cases: Array<[string, SandboxPolicySpec, string]> = [
    ["host mount", policyWith({ mounts: { ...DEFAULT_SANDBOX_POLICY.mounts, hostMounts: ["/"] } }), "sandbox-host-mount-refused"],
    ["home mount", policyWith({ mounts: { ...DEFAULT_SANDBOX_POLICY.mounts, hostMounts: ["/home/user"] } }), "sandbox-host-mount-refused"],
    ["docker socket", policyWith({ mounts: { ...DEFAULT_SANDBOX_POLICY.mounts, mountDockerSocket: true } }), "sandbox-docker-socket-refused"],
    ["credential mount", policyWith({ mounts: { ...DEFAULT_SANDBOX_POLICY.mounts, mountCredentials: true } }), "sandbox-credential-mount-refused"],
  ];
  for (const [label, policy, expected] of cases) {
    assert.equal(validateSandboxPolicySpec(policy), expected, `${label} must be refused`);
    const backend = new FakeSandboxBackend("available-and-verified");
    const auth = new SandboxPolicy(backend).authorize(request({ policy }));
    assert.equal(auth.ok, false, `${label} must not authorize even on a VERIFIED backend`);
    assert.equal(auth.receipt.safeReasonCode, expected);
    assert.equal(backend.executeCallCount, 0, `${label} must not execute`);
  }
});

test("privileged mode and host namespaces are refused", () => {
  const cases: Array<[string, SandboxPolicySpec, string]> = [
    ["privileged", policyWith({ namespaces: { ...DEFAULT_SANDBOX_POLICY.namespaces, privileged: true } }), "sandbox-privileged-refused"],
    ["host pid ns", policyWith({ namespaces: { ...DEFAULT_SANDBOX_POLICY.namespaces, hostPidNamespace: true } }), "sandbox-host-namespace-refused"],
    ["host net ns", policyWith({ namespaces: { ...DEFAULT_SANDBOX_POLICY.namespaces, hostNetworkNamespace: true } }), "sandbox-host-namespace-refused"],
  ];
  for (const [label, policy, expected] of cases) {
    assert.equal(validateSandboxPolicySpec(policy), expected, `${label} must be refused`);
    const backend = new FakeSandboxBackend("available-and-verified");
    assert.equal(new SandboxPolicy(backend).authorize(request({ policy })).ok, false, `${label} must not authorize`);
    assert.equal(backend.executeCallCount, 0);
  }
});

test("root / shared-user execution and environment-secret inheritance are refused", () => {
  assert.equal(validateSandboxPolicySpec(policyWith({ user: { dedicatedUser: false, runAsRoot: false } })), "sandbox-user-policy-refused");
  assert.equal(validateSandboxPolicySpec(policyWith({ user: { dedicatedUser: true, runAsRoot: true } })), "sandbox-user-policy-refused");
  // Inheriting environment secrets is treated as a credential mount by another name.
  assert.equal(validateSandboxPolicySpec(policyWith({ inheritEnvironmentSecrets: true })), "sandbox-credential-mount-refused");

  const backend = new FakeSandboxBackend("available-and-verified");
  assert.equal(new SandboxPolicy(backend).authorize(request({ policy: policyWith({ inheritEnvironmentSecrets: true }) })).ok, false);
  assert.equal(backend.executeCallCount, 0);
});

test("network is default-deny and an unrestricted policy is refused", () => {
  assert.equal(DEFAULT_SANDBOX_POLICY.network.policy, "denied", "the default must be deny");
  assert.deepEqual([...DEFAULT_SANDBOX_POLICY.network.allowlist], [], "the default allowlist must be empty");

  assert.equal(validateSandboxPolicySpec(policyWith({ network: { policy: "allowed", allowlist: [] } })), "sandbox-network-policy-refused");
  // A "denied" policy carrying an allowlist is incoherent - refuse it.
  assert.equal(validateSandboxPolicySpec(policyWith({ network: { policy: "denied", allowlist: ["unknown-external"] } })), "sandbox-network-policy-refused");
  // An explicit, bounded allowlist under a restrictive policy is acceptable.
  assert.equal(validateSandboxPolicySpec(policyWith({ network: { policy: "loopback-only", allowlist: ["loopback"] } })), "ok");
});

test("missing limits and a non-disposable filesystem are refused", () => {
  for (const patch of [{ cpuLimit: 0 }, { memoryLimitMb: 0 }, { pidLimit: 0 }, { processLimit: 0 }, { timeoutMs: 0 }]) {
    assert.equal(validateSandboxPolicySpec(policyWith({ limits: { ...DEFAULT_SANDBOX_POLICY.limits, ...patch } })), "sandbox-limits-missing", `${JSON.stringify(patch)} must be refused`);
  }
  assert.equal(validateSandboxPolicySpec(policyWith({ cleanup: { disposableFilesystem: false, cleanupAfterExit: true } })), "sandbox-cleanup-policy-refused");
  assert.equal(validateSandboxPolicySpec(policyWith({ cleanup: { disposableFilesystem: true, cleanupAfterExit: false } })), "sandbox-cleanup-policy-refused");
});

test("human authorization is required for high-risk execution", () => {
  const backend = new FakeSandboxBackend("available-and-verified");
  const auth = new SandboxPolicy(backend).authorize(request({ humanAuthorized: false }));
  assert.equal(auth.ok, false);
  assert.equal(auth.receipt.safeReasonCode, "sandbox-human-authorization-missing");
  assert.equal(backend.executeCallCount, 0);
});

test("low-risk deterministic work is not broken but never receives a sandbox permit", () => {
  const backend = new FakeSandboxBackend("unavailable");
  const auth = new SandboxPolicy(backend).authorize(request({ riskLevel: "low-risk-deterministic" }));
  assert.equal(auth.ok, false, "low-risk work gets no permit - it needs none");
  // S-13: this asserted "ok", which made the receipt claim `blocked: true` and
  // "nothing is wrong" simultaneously. The intent — that this is NOT a sandbox
  // failure — is preserved by a reason that says so explicitly, instead of by a
  // success-like code that a reader cannot distinguish from a pass.
  assert.equal(auth.receipt.safeReasonCode, "sandbox-not-required-for-risk-level");
  assert.equal(auth.receipt.blocked, true, "it is still a refusal");
  assert.equal(/^sandbox-(runtime|capability|image|network|user|host|docker|privileged|credential|cleanup|limits|human|fake|unknown|root|secret|cpu|memory|pid|workspace|probe|mount)/.test(auth.receipt.safeReasonCode), false, "and it is not reported as a sandbox failure");
  assert.equal(backend.executeCallCount, 0);
});

test("S-13: no authorize refusal ever reports a success-like reason", () => {
  // Sweeps every refusal branch in the gate. A receipt that says `blocked: true`
  // must say WHY, and "ok"/"completed" are not reasons a refusal can have.
  const refusals: Array<[string, SandboxAuthorization]> = [
    ["low-risk", new SandboxPolicy(new FakeSandboxBackend("available-and-verified")).authorize(request({ riskLevel: "low-risk-deterministic" }))],
    ["unavailable", new SandboxPolicy(new FakeSandboxBackend("unavailable")).authorize(request({}))],
    ["fake-backend", new SandboxPolicy(new FakeSandboxBackend("fake-test-backend")).authorize(request({}))],
    ["unverified", new SandboxPolicy(new FakeSandboxBackend("available-unverified")).authorize(request({}))],
    ["no-human", new SandboxPolicy(new FakeSandboxBackend("available-and-verified")).authorize(request({ humanAuthorized: false }))],
    ["bad-policy", new SandboxPolicy(new FakeSandboxBackend("available-and-verified")).authorize(request({ policy: { ...DEFAULT_SANDBOX_POLICY, namespaces: { privileged: true, hostPidNamespace: false, hostNetworkNamespace: false } } }))],
  ];
  for (const [label, auth] of refusals) {
    assert.equal(auth.ok, false, `${label} must be refused`);
    assert.equal(auth.receipt.blocked, true, `${label} must be blocked`);
    assert.equal(["ok", "completed", "none"].includes(auth.receipt.safeReasonCode), false, `${label} reported ${auth.receipt.safeReasonCode}`);
  }
});

test("S-13: sandbox-not-required-for-risk-level is reachable ONLY from the low-risk path", () => {
  // F/G. The code names one specific decision — "this request needs no sandbox".
  // A HIGH-RISK request must never receive it, whatever else goes wrong, or the
  // reason would be telling a caller that dangerous work was safe to skip.
  const LOW_RISK_ONLY = "sandbox-not-required-for-risk-level";

  const states = ["available-and-verified", "available-unverified", "unavailable", "fake-test-backend"] as const;
  for (const state of states) {
    const gate = new SandboxPolicy(new FakeSandboxBackend(state));
    for (const humanAuthorized of [true, false]) {
      const auth = gate.authorize(request({ riskLevel: "high-risk", humanAuthorized }));
      assert.notEqual(auth.receipt.safeReasonCode, LOW_RISK_ONLY, `high-risk/${state}/human=${humanAuthorized} must never claim no sandbox was needed`);
    }
    // ...and the low-risk path DOES produce it, whatever the backend state is:
    // the decision is about the request, not about what is installed.
    const low = gate.authorize(request({ riskLevel: "low-risk-deterministic" }));
    assert.equal(low.receipt.safeReasonCode, LOW_RISK_ONLY, `low-risk/${state}`);
  }

  // Only one producer exists in the whole source tree, and it is that branch.
  const src = readFileSync("src/cognitive/sandboxPolicy.ts", "utf8");
  const producers = src.split("\n").filter((l) => l.includes(`blockedReceipt("${LOW_RISK_ONLY}")`));
  assert.equal(producers.length, 1, "exactly one producer");
  const idx = src.indexOf(`blockedReceipt("${LOW_RISK_ONLY}")`);
  const preceding = src.slice(0, idx);
  assert.match(preceding.slice(-400), /request\.riskLevel === "low-risk-deterministic"/, "it must sit under the low-risk guard");
});

// ------------------------------------------------------------- RECEIPTS ---

test("a sandbox receipt carries only safe metadata", () => {
  const gate = new SandboxPolicy(new FakeSandboxBackend("available-and-verified"));
  const auth = gate.authorize(request());
  assert.equal(auth.ok, true);
  if (!auth.ok) return;
  const receipt = gate.execute(auth.permit);

  const allowed = ["backendId", "capabilityState", "executionStarted", "executionCompleted", "exitCategory", "timeoutMs", "cpuLimit", "memoryLimitMb", "pidLimit", "networkPolicy", "mountPolicy", "cleanupComplete", "blocked", "safeReasonCode", "safeFingerprint"];
  assert.deepEqual(Object.keys(receipt).sort(), [...allowed].sort(), "receipt must carry exactly the safe fields");

  const json = JSON.stringify(receipt);
  for (const forbidden of ["sk-", "ghp_", "Authorization", "Cookie", "C:\\", "/home/", "npm test", "prompt", "PATH"]) {
    assert.equal(json.includes(forbidden), false, `receipt must not contain ${forbidden}`);
  }
  assert.match(receipt.safeFingerprint, /^sb-[0-9a-f]{8}$/);
});

test("a blocked receipt claims no limits it did not apply", () => {
  const auth = new SandboxPolicy(new FakeSandboxBackend("unavailable")).authorize(request());
  assert.equal(auth.ok, false);
  // Reporting the REQUESTED limits here would imply something enforced them.
  assert.equal(auth.receipt.cpuLimit, 0);
  assert.equal(auth.receipt.memoryLimitMb, 0);
  assert.equal(auth.receipt.pidLimit, 0);
  assert.equal(auth.receipt.mountPolicy, "none");
  assert.equal(auth.receipt.networkPolicy, "denied");
});

test("mount policy is described as a class, never as host paths", () => {
  assert.equal(describeMountPolicy(DEFAULT_SANDBOX_POLICY.mounts), "bounded-workspace-only");
  assert.equal(describeMountPolicy({ ...DEFAULT_SANDBOX_POLICY.mounts, readOnlySourceMount: "/src" }), "bounded-workspace-plus-readonly-source");
  assert.equal(describeMountPolicy({ ...DEFAULT_SANDBOX_POLICY.mounts, hostMounts: ["/etc/shadow"] }), "host-mounts-present");
  assert.equal(describeMountPolicy({ ...DEFAULT_SANDBOX_POLICY.mounts, hostMounts: ["/etc/shadow"] }).includes("/etc"), false, "no host path may appear");
});

test("identical safe receipts fingerprint identically; different ones differ", () => {
  const base = { backendId: "b", capabilityState: "available-and-verified" as const, executionStarted: true, executionCompleted: true, exitCategory: "completed" as const, timeoutMs: 1000, cpuLimit: 1, memoryLimitMb: 512, pidLimit: 64, networkPolicy: "denied" as const, mountPolicy: "bounded-workspace-only", cleanupComplete: true, blocked: false, safeReasonCode: "ok" as const };
  assert.equal(buildSandboxReceipt(base).safeFingerprint, buildSandboxReceipt(base).safeFingerprint);
  assert.notEqual(buildSandboxReceipt(base).safeFingerprint, buildSandboxReceipt({ ...base, memoryLimitMb: 1024 }).safeFingerprint);
});

// -------------------------------------------------- DETECTION + ERROR TYPE ---

test("container runtime detection is honest about this host", () => {
  // No container is created, no image pulled, no network touched.
  const cap = detectContainerRuntime();
  assert.equal(["unavailable", "available-unverified"].includes(cap.capabilityState), true, "detection can never yield 'verified'");
  assert.equal(cap.verified, false, "detection alone NEVER verifies isolation");
  assert.deepEqual(cap.claims, NO_ISOLATION_CLAIMS, "a detected binary proves no isolation property");
  if (cap.capabilityState === "unavailable") {
    assert.equal(cap.safeReasonCode, "sandbox-runtime-unavailable");
    assert.equal(cap.backendId, "none");
  } else {
    assert.equal(cap.safeReasonCode, "sandbox-capability-unverified");
  }
  // The detail is a bounded token, never a host path.
  assert.equal(cap.detectionDetail.includes("\\"), false);
  assert.equal(cap.detectionDetail.includes("/"), false);
});

test("SandboxUnavailableError carries a reason code and no host detail", () => {
  const e = new SandboxUnavailableError();
  assert.equal(e.safeReasonCode, "sandbox-runtime-unavailable");
  assert.equal(e.message, "sandbox-runtime-unavailable", "the message IS the reason code");
  assert.equal(e.name, "SandboxUnavailableError");
  const unverified = new SandboxUnavailableError("sandbox-capability-unverified");
  assert.equal(unverified.safeReasonCode, "sandbox-capability-unverified");
});

test("ALL_ISOLATION_CLAIMS and NO_ISOLATION_CLAIMS cover the same claim set", () => {
  assert.deepEqual(Object.keys(ALL_ISOLATION_CLAIMS).sort(), Object.keys(NO_ISOLATION_CLAIMS).sort());
  assert.equal(Object.values(NO_ISOLATION_CLAIMS).every((v) => v === false), true, "the honest default claims nothing");
  assert.equal(Object.values(ALL_ISOLATION_CLAIMS).every((v) => v === true), true);
  assert.equal(Object.keys(NO_ISOLATION_CLAIMS).length, 19, "all 19 required isolation claims are modelled");
});

test("the command centre never displays sandboxed without a verified backend", () => {
  const cc = TWIN_COMMAND_CENTER_SANDBOX;
  assert.equal(typeof cc.sandboxCapabilityState, "string");
  if (!cc.sandboxVerified) {
    assert.equal(cc.sandboxExecutionBlocked, true, "unverified must block");
    assert.equal(cc.sandboxLimits, "none-enforced", "no limit may be claimed");
    assert.equal(cc.sandboxMountPolicy, "none", "no mount policy may be claimed");
    assert.equal(cc.sandboxNetworkPolicy, "denied", "the safe default, not a claim of enforcement");
    assert.equal(describeSandbox(cc).startsWith("NOT SANDBOXED"), true);
  }
  // The projection carries no host path.
  const json = JSON.stringify(cc);
  assert.equal(json.includes("C:\\"), false);
  assert.equal(json.includes("/home/"), false);
});

test("no real action is taken by this suite", () => {
  const backend = new FakeSandboxBackend("unavailable");
  const gate = new SandboxPolicy(backend);
  for (let i = 0; i < 5; i += 1) assert.equal(gate.authorize(request()).ok, false);
  assert.equal(backend.executeCallCount, 0, "zero executions across the whole suite");
  assert.equal(backend.isReal, false);
});
