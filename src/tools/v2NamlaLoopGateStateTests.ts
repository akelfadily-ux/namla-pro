import assert from "node:assert/strict";
import test from "node:test";
import {
  NamlaLoopGate,
  V2_NAMLA_LOOP_GATE_STATE_SCHEMA,
  type NamlaLoopGateState,
  type NamlaLoopGateStateResult,
} from "../v2/loop/namlaLoopGate";
import type { GateInput, StageRecoveryPolicy } from "../v2/types/namlaLoopTypes";

// Control-flow fixtures only; not authentic factory evidence or execution permits.
function input(): GateInput {
  return {
    missionId: "gate-state-mission", stageId: "LOOP_AFTER_EER",
    artifactIdentity: { artifactId: "fixture", missionId: "gate-state-mission",
      path: "fixture.txt", sha256: "0".repeat(64), sizeBytes: 0 },
    environmentIdentity: { platform: process.platform, nodeVersion: process.version,
      cwd: process.cwd(), envFingerprint: "0".repeat(64) },
    policyVersions: ["test-policy-v1"], requiredAttestations: [],
    requiredAssessments: [], evidenceRefs: ["missing-proof"], phase: "PRE_CONTRACT",
    budget: { maxTicks: 10, remainingTicks: 10, maxProviderCalls: 4,
      remainingProviderCalls: 4, maxFixAttempts: 2, remainingFixAttempts: 2 },
  };
}
function state(): NamlaLoopGateState {
  return {
    schemaVersion: V2_NAMLA_LOOP_GATE_STATE_SCHEMA,
    missionId: "gate-state-mission", stageId: "LOOP_AFTER_EER", workPackageId: null,
    maxLivelockThreshold: 3, livelockCounter: 0,
  };
}
const policy: StageRecoveryPolicy = {
  stageId: "pipeline", allowedActions: ["FIX", "REWORK_AB", "FAIL_CLOSED"],
  maxRetriesPerStage: 3,
};
function evaluate(snapshot: unknown, gate = new NamlaLoopGate(), request = input()) {
  return gate.evaluateGateWithState(request, [], policy, snapshot);
}
function evaluated(result: NamlaLoopGateStateResult) {
  assert.ok(result.ok, result.reasonCode);
  return result;
}
function refusal(result: NamlaLoopGateStateResult, reasonCode: string): void {
  assert.deepEqual(result, { ok: false, reasonCode });
}

test("10E6 explicit gate state returns missing-evidence failure and next counter", () => {
  const result = evaluated(evaluate(state()));
  assert.equal(result.verdict.status, "FAIL");
  assert.equal(result.verdict.nextAction, "FIX");
  assert.deepEqual(result.verdict.reasonCodes, ["MISSING_REQUIRED_EVIDENCE"]);
  assert.equal(result.nextState.livelockCounter, 1);
});

test("10E6 explicit gate state evaluation is deterministic and non-mutating", () => {
  const snapshot = state();
  const before = structuredClone(snapshot);
  const gate = new NamlaLoopGate();
  assert.deepEqual(evaluate(snapshot, gate), evaluate(snapshot, gate));
  assert.deepEqual(snapshot, before);
  assert.equal(Object.isFrozen(snapshot), false);
});

test("10E6 JSON state restored into fresh gate instances retains anti-livelock history", () => {
  let snapshot = state();
  for (let expected = 1; expected <= 3; expected += 1) {
    const result = evaluated(evaluate(JSON.parse(JSON.stringify(snapshot))));
    assert.equal(result.verdict.nextAction, "FIX");
    assert.equal(result.nextState.livelockCounter, expected);
    snapshot = result.nextState;
  }
  const blocked = evaluated(evaluate(JSON.parse(JSON.stringify(snapshot))));
  assert.equal(blocked.verdict.nextAction, "FAIL_CLOSED");
  assert.deepEqual(blocked.verdict.reasonCodes,
    ["ANTI_LIVELOCK_TRIGGERED", "MAX_RETRY_EXCEEDED"]);
  assert.equal(blocked.nextState.livelockCounter, 3);
});

test("10E6 explicit gate state does not read the legacy instance Map", () => {
  const gate = new NamlaLoopGate();
  for (let i = 0; i < 3; i += 1) gate.evaluateGate(input(), [], policy);
  assert.equal(gate.evaluateGate(input(), [], policy).nextAction, "FAIL_CLOSED");
  assert.equal(evaluated(evaluate(state(), gate)).verdict.nextAction, "FIX");
});

test("10E6 explicit gate state does not write the legacy instance Map", () => {
  const gate = new NamlaLoopGate();
  let snapshot = state();
  for (let i = 0; i < 3; i += 1) snapshot = evaluated(evaluate(snapshot, gate)).nextState;
  assert.equal(evaluated(evaluate(snapshot, gate)).verdict.nextAction, "FAIL_CLOSED");
  assert.equal(gate.evaluateGate(input(), [], policy).nextAction, "FIX");
});

test("10E6 legacy three-argument API retains failure threshold and PASS reset behavior", () => {
  const legacy = new NamlaLoopGate();
  let snapshot = state();
  const requests = [input(), { ...input(), evidenceRefs: [] },
    input(), input(), input(), input()];
  const expectedActions = ["FIX", "NEXT", "FIX", "FIX", "FIX", "FAIL_CLOSED"];
  requests.forEach((request, i) => {
    const explicit = evaluated(evaluate(snapshot, new NamlaLoopGate(), request));
    assert.deepEqual(legacy.evaluateGate(request, [], policy), explicit.verdict);
    assert.equal(explicit.verdict.nextAction, expectedActions[i]);
    snapshot = explicit.nextState;
  });
});

test("10E6 missing or malformed gate state is never initialized implicitly", () => {
  for (const value of [undefined, null, false, 0, "{}", [], {}]) {
    refusal(evaluate(value), "gate-state-invalid");
  }
});

test("10E6 gate state requires the exact schema and field set", () => {
  const original = state();
  for (const field of Object.keys(original)) {
    const missing = Object.fromEntries(Object.entries(original).filter(([key]) => key !== field));
    refusal(evaluate(missing), "gate-state-invalid");
  }
  refusal(evaluate({ ...original, extra: true }), "gate-state-invalid");
  refusal(evaluate({ ...original, schemaVersion: "unknown" }), "gate-state-invalid");
});

test("10E6 gate state validates counters and thresholds without coercion", () => {
  for (const field of ["livelockCounter", "maxLivelockThreshold"]) {
    for (const value of [-1, 0.5, "1", null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      refusal(evaluate({ ...state(), [field]: value }), "gate-state-invalid");
    }
  }
});

test("10E6 gate state rejects mission and stage binding substitution", () => {
  for (const field of ["missionId", "stageId"]) {
    refusal(evaluate({ ...state(), [field]: "other" }), "gate-state-binding-mismatch");
    refusal(evaluate({ ...state(), [field]: " " }), "gate-state-invalid");
  }
});

test("10E6 gate state distinguishes global scope from an explicitly named work package", () => {
  refusal(evaluate({ ...state(), workPackageId: "global" }), "gate-state-binding-mismatch");
  const request = { ...input(), workPackageId: "wp-1" };
  refusal(evaluate(state(), new NamlaLoopGate(), request), "gate-state-binding-mismatch");
  assert.equal(evaluated(evaluate({ ...state(), workPackageId: "wp-1" },
    new NamlaLoopGate(), request)).nextState.workPackageId, "wp-1");
});

test("10E6 gate state refuses silent changes to the configured threshold", () => {
  refusal(evaluate(state(), new NamlaLoopGate({ maxLivelockThreshold: 4 })),
    "gate-state-threshold-mismatch");
  const result = evaluated(evaluate({ ...state(), maxLivelockThreshold: 0 },
    new NamlaLoopGate({ maxLivelockThreshold: 0 })));
  assert.equal(result.verdict.nextAction, "FAIL_CLOSED");
});

test("10E6 gate state rejects accessors without invoking getters", () => {
  let reads = 0;
  for (const field of Object.keys(state())) {
    const snapshot = { ...state() };
    Object.defineProperty(snapshot, field, {
      enumerable: true, get() { reads += 1; throw new Error("GETTER_MUST_NOT_RUN"); },
    });
    refusal(evaluate(snapshot), "gate-state-invalid");
  }
  assert.equal(reads, 0);
});

test("10E6 gate state handles null prototypes and refuses malformed property surfaces", () => {
  assert.ok(evaluate(Object.assign(Object.create(null), state())).ok);
  const hidden = { ...state() };
  Object.defineProperty(hidden, "livelockCounter", { enumerable: false });
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  for (const value of [hidden, revoked.proxy, { ...state(), [Symbol("extra")]: 1 },
    Object.assign(Object.create({ extra: 1 }), state())]) {
    refusal(evaluate(value), "gate-state-invalid");
  }
});

test("10E6 gate state returns detached frozen proposals without freezing caller input", () => {
  const snapshot = { ...state() };
  const result = evaluated(evaluate(snapshot));
  snapshot.livelockCounter = 99;
  assert.equal(result.nextState.livelockCounter, 1);
  assert.notEqual(result.nextState, snapshot);
  for (const value of [result, result.nextState, result.verdict,
    result.verdict.reasonCodes, result.verdict.missingEvidence]) {
    assert.equal(Object.isFrozen(value), true);
  }
  assert.equal(Object.isFrozen(snapshot), false);
});

test("10E6 explicit gate entry rejects invalid budgets using the shared budget validator", () => {
  const request = input();
  for (const remainingTicks of [-1, NaN, 11]) {
    refusal(evaluate(state(), new NamlaLoopGate(), {
      ...request, budget: { ...request.budget, remainingTicks },
    }), "gate-budget-invalid");
  }
});

test("10E6 exhausted gate ticks preserve the existing HUMAN_REQUIRED verdict and counter", () => {
  const request = input();
  const result = evaluated(evaluate({ ...state(), livelockCounter: 2 }, new NamlaLoopGate(), {
    ...request, budget: { ...request.budget, remainingTicks: 0 },
  }));
  assert.equal(result.verdict.status, "HUMAN_REQUIRED");
  assert.deepEqual(result.verdict.reasonCodes, ["BUDGET_EXHAUSTED"]);
  assert.equal(result.nextState.livelockCounter, 2);
});

test("10E6 successful gate evaluation resets only the consecutive evidence-failure counter", () => {
  const result = evaluated(evaluate({ ...state(), livelockCounter: 2 }, new NamlaLoopGate(),
    { ...input(), evidenceRefs: [] }));
  assert.equal(result.verdict.status, "PASS");
  assert.equal(result.nextState.livelockCounter, 0);
});

test("10E6 explicit state preserves recovery-policy refusal without inventing retries", () => {
  const result = evaluated(new NamlaLoopGate().evaluateGateWithState(input(), [],
    { ...policy, allowedActions: [] }, state()));
  assert.equal(result.verdict.status, "FAIL");
  assert.equal(result.verdict.nextAction, "FAIL_CLOSED");
  assert.equal(result.nextState.livelockCounter, 1);
});

test("10E6 malformed gate evaluation fails without producing replacement state", () => {
  const snapshot = state();
  const request = { ...input(), evidenceRefs: null } as unknown as GateInput;
  refusal(evaluate(snapshot, new NamlaLoopGate(), request), "gate-evaluation-failed");
  assert.deepEqual(snapshot, state());
});
