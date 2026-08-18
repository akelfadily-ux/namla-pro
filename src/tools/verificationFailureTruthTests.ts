/**
 * verificationFailureTruthTests — S-13. Proof that the REAL verification driver
 * reports what was actually established, and that human authorization cannot be
 * omitted by accident.
 *
 * THE DEFECT. `RealBackedVerificationDriver.run()` ended with:
 *
 *     failureCategory: result.status === "passed" ? null : "type-error"
 *
 * so EVERY failure became a TypeScript type error. A missing sandbox, a refused
 * authorization, a blocked start, a timeout, incomplete cleanup — all reported
 * as though the compiler had found a fault in code that was never compiled.
 * That is not a lossy summary; it is a false statement, and it sends whoever
 * reads it to the wrong place. The lower layer had the truth the whole time:
 * `runVerificationCommand` already returns the sandbox's own safe reason.
 *
 * WHAT REPLACES IT. Two categories that claim only what is known —
 * `verification-unavailable` when nothing ran, `verification-command-failed`
 * when it ran and did not pass — plus the precise `safeReasonCode` carried
 * through from the sandbox's closed vocabulary. A sandbox receipt reports an
 * exit CATEGORY, never a compiler diagnostic, so no cause is invented here.
 *
 * NOTHING REAL EXECUTES. Every sandbox below is an injected stub.
 *
 * Run: node --test dist/tools/verificationFailureTruthTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { RealBackedVerificationDriver } from "../cognitive/liveRealDrivers";
import { runVerificationCommand, type VerificationCommandId } from "../cognitive/nodeProviderProcessDriver";
import { buildSandboxReceipt, FakeSandboxBackend, SandboxPolicy, type SandboxExecutionReceipt, type SandboxExitCategory, type SandboxReasonCode } from "../cognitive/sandboxPolicy";
import { buildVerificationSandboxPolicy, type VerificationSandboxExecutor } from "../cognitive/verificationSandbox";
import type { SandboxAuthorization, SandboxExecutionPermit, SandboxExecutionRequest } from "../cognitive/sandboxPolicy";
import { FakeVerificationDriver } from "../digital/digitalVerification";

const WORKSPACE = "C:\\fake\\workspace";

function receipt(over: Partial<Omit<SandboxExecutionReceipt, "safeFingerprint">> = {}): SandboxExecutionReceipt {
  return buildSandboxReceipt({
    backendId: "stub",
    capabilityState: "available-and-verified",
    executionStarted: true,
    executionCompleted: true,
    exitCategory: "completed",
    timeoutMs: 5000,
    cpuLimit: 1,
    memoryLimitMb: 512,
    pidLimit: 64,
    networkPolicy: "denied",
    mountPolicy: "workspace-only",
    cleanupComplete: true,
    blocked: false,
    safeReasonCode: "ok",
    ...over,
  });
}

/**
 * A fully injected executor: the test states exactly what authorization and
 * execution report, so every branch is reachable without a container.
 */
class StubExecutor implements VerificationSandboxExecutor {
  authorizeCalls = 0;
  executeCalls = 0;
  constructor(
    private readonly authorization: SandboxAuthorization,
    private readonly executionReceipt: SandboxExecutionReceipt = receipt()
  ) {}
  authorize(_request: SandboxExecutionRequest): SandboxAuthorization {
    this.authorizeCalls += 1;
    return this.authorization;
  }
  execute(_permit: SandboxExecutionPermit): SandboxExecutionReceipt {
    this.executeCalls += 1;
    return this.executionReceipt;
  }
}

function refusedAuthorization(reason: SandboxReasonCode): SandboxAuthorization {
  return { ok: false, permit: null, receipt: receipt({ executionStarted: false, executionCompleted: false, exitCategory: "blocked", blocked: true, safeReasonCode: reason }) };
}

/**
 * A fully constructed permit — no `as` anywhere. The stub executor never reads
 * it, but building the real shape means the fixture cannot drift out of the
 * contract without the compiler saying so.
 */
function grantedAuthorization(): SandboxAuthorization {
  const permit: SandboxExecutionPermit = {
    objectiveId: "typecheck",
    taskId: "typecheck",
    workspaceId: WORKSPACE,
    executableId: "npx",
    fixedArguments: ["tsc", "--noEmit"],
    policy: buildVerificationSandboxPolicy(WORKSPACE),
    backendId: "stub",
    capabilityState: "available-and-verified",
  };
  return { ok: true, permit, receipt: receipt() };
}

function driverWith(sandbox: VerificationSandboxExecutor | null, humanAuthorized = true): RealBackedVerificationDriver {
  return new RealBackedVerificationDriver(WORKSPACE, ["typecheck"], 5000, 1000, humanAuthorized, sandbox);
}

// ================================ NOTHING RAN => verification-unavailable ===

test("S13-1: an unavailable sandbox stays sandbox-runtime-unavailable, never type-error", () => {
  const driver = driverWith(null);
  const outcome = driver.run("typecheck", WORKSPACE, false);

  assert.equal(outcome.status, "failed");
  assert.notEqual(outcome.failureCategory, "type-error", "a missing sandbox is not a type error");
  assert.equal(outcome.failureCategory, "verification-unavailable");
  assert.equal(outcome.safeReasonCode, "sandbox-runtime-unavailable", "the precise reason survives");
  assert.equal(outcome.realProcessExecutions, 0, "nothing ran");
  assert.equal(driver.realVerificationExecutions, 0);
});

test("S13-2: a declined human authorization reports the canonical refusal, never type-error", () => {
  // The reason string is DISCOVERED from the sandbox, not invented here: this is
  // whatever `authorize` refuses with when authorization is missing.
  const stub = new StubExecutor(refusedAuthorization("sandbox-human-authorization-missing"));
  const driver = driverWith(stub, false);
  const outcome = driver.run("typecheck", WORKSPACE, false);

  assert.notEqual(outcome.failureCategory, "type-error");
  assert.equal(outcome.failureCategory, "verification-unavailable");
  assert.equal(outcome.safeReasonCode, "sandbox-human-authorization-missing");
  assert.equal(stub.executeCalls, 0, "an unauthorized command must never execute");
  assert.equal(outcome.realProcessExecutions, 0);
});

test("S13-3: any authorize refusal reason is preserved exactly", () => {
  const reasons: SandboxReasonCode[] = ["sandbox-capability-unverified", "sandbox-network-policy-refused", "sandbox-host-mount-refused", "sandbox-privileged-refused", "sandbox-unknown-executable"];
  for (const reason of reasons) {
    const stub = new StubExecutor(refusedAuthorization(reason));
    const outcome = driverWith(stub).run("typecheck", WORKSPACE, false);
    assert.equal(outcome.safeReasonCode, reason, `${reason} must survive verbatim`);
    assert.notEqual(outcome.failureCategory, "type-error");
    assert.equal(stub.executeCalls, 0, `${reason}: nothing may execute`);
  }
});

test("S13-4: blocked execution preserves the receipt reason", () => {
  const stub = new StubExecutor(grantedAuthorization(), receipt({ blocked: true, exitCategory: "blocked", executionCompleted: false, safeReasonCode: "sandbox-docker-socket-refused" }));
  const outcome = driverWith(stub).run("typecheck", WORKSPACE, false);

  assert.notEqual(outcome.failureCategory, "type-error");
  assert.equal(outcome.failureCategory, "verification-unavailable", "blocked means nothing was established about the code");
  assert.equal(outcome.safeReasonCode, "sandbox-docker-socket-refused");
  assert.equal(outcome.realProcessExecutions, 0);
});

test("S13-5: executionStarted=false preserves the receipt reason", () => {
  const stub = new StubExecutor(grantedAuthorization(), receipt({ executionStarted: false, executionCompleted: false, exitCategory: "not-started", safeReasonCode: "sandbox-image-unavailable" }));
  const outcome = driverWith(stub).run("typecheck", WORKSPACE, false);

  assert.notEqual(outcome.failureCategory, "type-error");
  assert.equal(outcome.safeReasonCode, "sandbox-image-unavailable");
  assert.equal(outcome.realProcessExecutions, 0, "a command that never started did not run");
});

// ============================ IT RAN => verification-command-failed =========

test("S13-6: a sandbox timeout is reported as a timeout, never as a type error", () => {
  const stub = new StubExecutor(grantedAuthorization(), receipt({ exitCategory: "timed-out", executionCompleted: false }));
  const outcome = driverWith(stub).run("typecheck", WORKSPACE, false);

  assert.notEqual(outcome.failureCategory, "type-error");
  assert.equal(outcome.failureCategory, "verification-command-failed");
  assert.equal(outcome.safeReasonCode, "timed-out", "the truthful exit category survives");
  assert.equal(outcome.realProcessExecutions, 1, "it did run");
});

test("S13-7: a non-zero exit is reported as such, not as a fabricated type error", () => {
  // This is the case where fabricating `type-error` is most tempting — the
  // command was `typecheck`. But a sandbox receipt reports an exit CATEGORY, and
  // nothing here observed a compiler diagnostic, so nothing claims one.
  const stub = new StubExecutor(grantedAuthorization(), receipt({ exitCategory: "non-zero-exit", executionCompleted: true }));
  const outcome = driverWith(stub).run("typecheck", WORKSPACE, false);

  assert.equal(outcome.failureCategory, "verification-command-failed");
  assert.equal(outcome.safeReasonCode, "non-zero-exit");
  assert.notEqual(outcome.failureCategory, "type-error");
  assert.equal(outcome.realProcessExecutions, 1);
});

test("S13-8: completed execution with incomplete cleanup fails with the cleanup reason", () => {
  const stub = new StubExecutor(grantedAuthorization(), receipt({ exitCategory: "completed", executionCompleted: true, cleanupComplete: false, safeReasonCode: "sandbox-cleanup-policy-refused" }));
  const outcome = driverWith(stub).run("typecheck", WORKSPACE, false);

  assert.equal(outcome.status, "failed", "a sandbox that did not clean up did not verify");
  assert.equal(outcome.safeReasonCode, "sandbox-cleanup-policy-refused");
  assert.notEqual(outcome.failureCategory, "type-error");
});

test("S13-9: a fully verified execution passes with no failure category at all", () => {
  const stub = new StubExecutor(grantedAuthorization(), receipt());
  const driver = driverWith(stub);
  const outcome = driver.run("typecheck", WORKSPACE, false);

  assert.equal(outcome.status, "passed");
  assert.equal(outcome.failureCategory, null, "a pass names no failure");
  assert.equal(outcome.safeReasonCode, null, "and carries no reason");
  assert.equal(outcome.realProcessExecutions, 1);
  assert.equal(driver.realVerificationExecutions, 1);
});

test("S13-10: an unknown command keeps its existing safe behaviour", () => {
  const stub = new StubExecutor(grantedAuthorization());
  const outcome = driverWith(stub).run("definitely-not-allowed", WORKSPACE, false);

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.failureCategory, "invalid-path", "the allowlist refusal is unchanged");
  assert.equal(outcome.safeReasonCode, "unknown-command", "and it states a reason rather than omitting one");
  assert.equal(stub.authorizeCalls, 0, "a command off the allowlist never reaches the sandbox");
  assert.equal(outcome.realProcessExecutions, 0);

  // And the lower layer refuses an unresolvable command id on its own terms.
  const lower = runVerificationCommand({ commandId: "nope" as VerificationCommandId, workingDirectoryAbsolute: WORKSPACE, timeoutMs: 5000, maxOutputBytes: 1000, humanAuthorized: true, sandbox: stub });
  assert.equal(lower.ran, false);
  assert.equal(lower.failureCategory, "unknown-command");
});

// ================================== EXPLICIT HUMAN AUTHORIZATION ============

test("S13-11: humanAuthorized cannot be omitted at the trusted boundary", () => {
  // Structural, because the guarantee is structural: the constructor parameter
  // and the spec property both lost their optionality, so omission is a compile
  // error rather than a silent `false` that surfaces later as an unexplained
  // verification failure.
  const driverSrc = readFileSync("src/cognitive/liveRealDrivers.ts", "utf8");
  assert.match(driverSrc, /private readonly humanAuthorized: boolean,/, "the constructor parameter must be required");
  assert.equal(/humanAuthorized\s*=\s*false/.test(driverSrc), false, "no default may reintroduce silent omission");
  assert.equal(/sandbox: VerificationSandboxExecutor \| null = null/.test(driverSrc), false, "the sandbox position must be stated too");

  const specSrc = readFileSync("src/cognitive/nodeProviderProcessDriver.ts", "utf8");
  assert.match(specSrc, /readonly humanAuthorized: boolean;/, "the spec property must be required");
  assert.equal(/humanAuthorized\?: boolean/.test(specSrc), false, "the spec property must not be optional");

  // Still fail-closed at runtime: stating `false` refuses, and never runs.
  const stub = new StubExecutor(refusedAuthorization("sandbox-human-authorization-missing"));
  const outcome = driverWith(stub, false).run("typecheck", WORKSPACE, false);
  assert.equal(outcome.status, "failed");
  assert.equal(stub.executeCalls, 0);
});

test("S13-12: every production construction DERIVES its authorization from a real confirmation", () => {
  // Both live CLIs used to pass a literal `true`, guarded only by an earlier
  // `if (!confirmation.ok) abort`. That is a CONTROL-flow dependency: the
  // literal asserts authorization on its own, and would keep asserting it if
  // the gate were moved, weakened, or removed. The value now comes from
  // `isValidHumanConfirmation`, which is WeakSet identity over tokens
  // `acquireHumanConfirmation` really minted — a DATA dependency that a forged
  // or absent confirmation resolves to `false`.
  for (const file of ["src/cli/digitalLiveObjectiveCli.ts", "src/cli/civilizationLiveCli.ts"]) {
    const src = readFileSync(file, "utf8");
    const ctor = /new RealBackedVerificationDriver\(([^;]*?)\);/s.exec(src);
    assert.notEqual(ctor, null, `${file} must construct the driver`);
    const args = (ctor as RegExpExecArray)[1].split(",").map((a) => a.trim());
    assert.equal(args.length, 6, `${file}: every position must be stated`);
    assert.equal(/undefined/.test(args.join(",")), false, `${file}: no position may be left undefined`);

    // Position 5 is `humanAuthorized`. It must not be a bare literal.
    assert.equal(/^(true|false)$/.test(args[4]), false, `${file}: a hard-coded ${args[4]} is not authority`);
    assert.equal(args[4], "humanAuthorizedVerification", `${file}: authorization must be a derived value, got ${args[4]}`);

    // ...and that value must be computed from the real token, not assigned one.
    assert.match(src, /const humanAuthorizedVerification = isValidHumanConfirmation\(confirmation\.confirmation\);/, `${file}: it must be derived from the confirmation token`);
    assert.match(src, /acquireHumanConfirmation\(/, `${file}: authorization must come from a typed confirmation`);
    assert.match(src, /if \(!confirmation\.ok\)/, `${file}: a refused confirmation must abort`);

    // No production site anywhere in the file may still hard-code it.
    assert.equal(/humanAuthorized: true/.test(src), false, `${file}: no literal humanAuthorized: true may remain`);
  }
});

// ============================================= UNCHANGED / NON-LEAKING =====

test("S13-13: the deterministic fake driver still reports code-level verdicts", () => {
  // S-13 is about the REAL path lying. The fake models code outcomes and may
  // legitimately say `type-error`.
  const fake = new FakeVerificationDriver();
  const failed = fake.run("typecheck", "ws", true);
  assert.equal(failed.status, "failed");
  assert.equal(failed.failureCategory, "type-error", "the fake's semantics are unchanged");
  assert.equal(failed.realProcessExecutions, 0);

  const passed = fake.run("typecheck", "ws", false);
  assert.equal(passed.status, "passed");
  assert.equal(passed.failureCategory, null);
  assert.equal(fake.run("nope", "ws", false).failureCategory, "invalid-path");
});

test("S13-14: no failure path leaks output, commands, paths or secrets", () => {
  const leaky = "sk-live-DEADBEEF secret token /etc/passwd C:\\Users\\someone\\.ssh\\id_rsa";
  const cases: RealBackedVerificationDriver[] = [
    driverWith(null),
    driverWith(new StubExecutor(refusedAuthorization("sandbox-human-authorization-missing")), false),
    driverWith(new StubExecutor(grantedAuthorization(), receipt({ blocked: true, exitCategory: "blocked", safeReasonCode: "sandbox-privileged-refused" }))),
    driverWith(new StubExecutor(grantedAuthorization(), receipt({ exitCategory: "non-zero-exit" }))),
  ];
  for (const driver of cases) {
    const outcome = driver.run("typecheck", `${WORKSPACE}\\${leaky}`, false);
    const serialized = JSON.stringify(outcome);
    for (const forbidden of ["sk-live", "DEADBEEF", "id_rsa", "/etc/passwd", "npx", "tsc", "--noEmit"]) {
      assert.equal(serialized.includes(forbidden), false, `outcome must not carry ${forbidden}: ${serialized}`);
    }
    // Only the bounded, safe shape is present.
    assert.equal(typeof outcome.outputLineCount, "number");
    assert.equal(outcome.realNetworkCalls, 0);
  }
});

// ==================================== THE REASON CANNOT BE OMITTED / FAKED ===

test("S13-15: safeReasonCode is required, so no outcome can silently omit it", () => {
  // Structural, because optionality is a structural property. `safeReasonCode?:`
  // would make "this driver has no sandbox reason" and "someone forgot to set
  // it" the same value — `undefined` — at every call site, which is the exact
  // ambiguity this field was added to remove.
  const src = readFileSync("src/digital/digitalVerification.ts", "utf8");
  assert.match(src, /readonly safeReasonCode: VerificationSafeReason \| null;/, "the field must be required");
  assert.equal(/safeReasonCode\?:/.test(src), false, "it must not be optional");

  // And every producer states it. Both drivers are exercised, pass and fail.
  const outcomes = [
    driverWith(null).run("typecheck", WORKSPACE, false),
    driverWith(new StubExecutor(grantedAuthorization())).run("typecheck", WORKSPACE, false),
    driverWith(new StubExecutor(grantedAuthorization())).run("not-allowed", WORKSPACE, false),
    new FakeVerificationDriver().run("typecheck", "ws", true),
    new FakeVerificationDriver().run("typecheck", "ws", false),
    new FakeVerificationDriver().run("nope", "ws", false),
  ];
  for (const outcome of outcomes) {
    assert.equal("safeReasonCode" in outcome, true, `${outcome.commandId}: the key must be present`);
    assert.notEqual(outcome.safeReasonCode, undefined, `${outcome.commandId}: never undefined`);
  }
});

test("S13-16: a failed outcome can never carry a success-like reason", () => {
  // "ok" is a real SandboxReasonCode and `authorize` genuinely returns it with
  // `ok: false` for a low-risk request, so this was constructible, not merely
  // representable. "completed" and "none" mean the opposite of a failure.
  const SUCCESS_LIKE = ["ok", "completed", "none"];

  const src = readFileSync("src/cognitive/sandboxPolicy.ts", "utf8");
  assert.match(src, /Exclude<SandboxReasonCode, "ok">/, "the union must exclude ok");
  assert.match(src, /Exclude<SandboxExitCategory, "completed">/, "the union must exclude completed");
  assert.equal(/VerificationSafeReason =[^;]*"none"/.test(src), false, "none must not be a reason at all");

  // Runtime: the refusal that really does carry "ok" must not surface as one.
  const refusedWithOk = new StubExecutor(refusedAuthorization("ok"));
  const fromRefusal = driverWith(refusedWithOk).run("typecheck", WORKSPACE, false);
  assert.equal(fromRefusal.status, "failed");
  assert.equal(SUCCESS_LIKE.includes(String(fromRefusal.safeReasonCode)), false, `a refusal reported ${fromRefusal.safeReasonCode}`);
  assert.equal(fromRefusal.safeReasonCode, "blocked", "the structural fact the receipt does assert");

  // And the contradictory receipt that used to yield a failure reasoned "none":
  // completed + clean cleanup, yet execution never completed.
  const contradictory = new StubExecutor(grantedAuthorization(), receipt({ exitCategory: "completed", executionCompleted: false, cleanupComplete: true, safeReasonCode: "ok" }));
  const fromExecution = contradictory ? driverWith(contradictory).run("typecheck", WORKSPACE, false) : null;
  assert.notEqual(fromExecution, null);
  assert.equal(fromExecution?.status, "failed");
  assert.equal(SUCCESS_LIKE.includes(String(fromExecution?.safeReasonCode)), false, `an execution reported ${fromExecution?.safeReasonCode}`);
  assert.equal(fromExecution?.safeReasonCode, "backend-error", "a receipt that contradicts itself is a backend fault");

  // Exhaustive sweep: no exit category and no refusal reason may pass through
  // as something success-like.
  const categories: SandboxExitCategory[] = ["not-started", "completed", "non-zero-exit", "timed-out", "blocked", "backend-error"];
  for (const exitCategory of categories) {
    const stub = new StubExecutor(grantedAuthorization(), receipt({ exitCategory, executionCompleted: false, cleanupComplete: false, safeReasonCode: "ok" }));
    const outcome = driverWith(stub).run("typecheck", WORKSPACE, false);
    if (outcome.status === "passed") continue;
    assert.equal(SUCCESS_LIKE.includes(String(outcome.safeReasonCode)), false, `${exitCategory} leaked ${outcome.safeReasonCode}`);
  }
});

test("S13-17: the REAL gate never hands the driver a success-like reason", () => {
  // S13-16 covers an injected executor that misbehaves. This one uses the real
  // `SandboxPolicy` — the actual producer that used to emit `blocked: true`
  // with `safeReasonCode: "ok"` — so the fix is proven at the source and not
  // merely masked by the mapping at the consumer boundary.
  for (const state of ["available-and-verified", "available-unverified", "unavailable", "fake-test-backend"] as const) {
    const gate = new SandboxPolicy(new FakeSandboxBackend(state));
    for (const humanAuthorized of [true, false]) {
      const outcome = driverWith(gate, humanAuthorized).run("typecheck", WORKSPACE, false);
      if (outcome.status === "passed") {
        assert.equal(outcome.safeReasonCode, null, `${state}: a pass carries no reason`);
        continue;
      }
      assert.notEqual(outcome.safeReasonCode, null, `${state}: a failure must state a reason`);
      assert.equal(["ok", "completed", "none"].includes(String(outcome.safeReasonCode)), false, `${state}/human=${humanAuthorized} leaked ${outcome.safeReasonCode}`);
      // Verification is HIGH-RISK, so the low-risk-only reason is never right.
      assert.notEqual(outcome.safeReasonCode, "sandbox-not-required-for-risk-level", `${state}: verification always needs a sandbox`);
      assert.notEqual(outcome.failureCategory, "type-error", `${state}: still never a fabricated type error`);
    }
  }
});

test("this suite executed no real verification command", () => {
  const driver = driverWith(null);
  driver.run("typecheck", WORKSPACE, false);
  assert.equal(driver.realVerificationExecutions, 0, "a null sandbox can never execute anything");
});
