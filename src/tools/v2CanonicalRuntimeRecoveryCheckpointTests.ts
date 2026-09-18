import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { CANONICAL_PIPELINE_SEQUENCE } from "../v2/architecture/canonicalPipelineRegistry";
import { V2_CANONICAL_RUNTIME_CURSOR_SCHEMA } from "../v2/runtime/canonicalRuntimeStepper";
import { V2_CANONICAL_RUNTIME_CHECKPOINT_SCHEMA,
  validateCanonicalRuntimeCheckpoint } from "../v2/persistence/canonicalRuntimeCursorStore";
import { V2_NAMLA_LOOP_GATE_STATE_SCHEMA } from "../v2/loop/namlaLoopGate";
import { ProtocolEngine } from "../v2/protocol/protocolEngine";
import { captureCanonicalFrozenPlanContract,
  type CanonicalFrozenPlanContractIdentity } from "../v2/protocol/canonicalFrozenPlanContract";
import { debitCanonicalRuntimeLoopBudget } from "../v2/runtime/canonicalRuntimeLoopBudget";
import type { CanonicalRuntimeCursor } from "../v2/runtime/canonicalRuntimeStepper";
import {
  V2_CANONICAL_RUNTIME_RECOVERY_CHECKPOINT_SCHEMA,
  restoreCanonicalRuntimeRecoveryCheckpoint as restore,
  validateCanonicalRuntimeRecoveryTransition as transition,
  type CanonicalRuntimeRecoveryCheckpoint,
} from "../v2/persistence/canonicalRuntimeRecoveryCheckpoint";

const MISSION = "recovery-checkpoint-test";
// Control-flow/data fixtures only. No factory execution, approval or durable
// operation receipt is implied by constructing a cursor at a canonical node.
function fixture(nodeId: CanonicalRuntimeCursor["nodeId"] = "EER", checkpointVersion = 40):
  CanonicalRuntimeRecoveryCheckpoint {
  const index = CANONICAL_PIPELINE_SEQUENCE.findIndex((node) => node.id === nodeId);
  assert.ok(index >= 0);
  const pro = CANONICAL_PIPELINE_SEQUENCE.findIndex((node) => node.id === "PRO");
  return {
    schemaVersion: V2_CANONICAL_RUNTIME_RECOVERY_CHECKPOINT_SCHEMA,
    missionId: MISSION, checkpointVersion, savedAt: 1000,
    cursor: { schemaVersion: V2_CANONICAL_RUNTIME_CURSOR_SCHEMA, missionId: MISSION,
      nodeIndex: index, nodeId, nodeKind: CANONICAL_PIPELINE_SEQUENCE[index].kind,
      stepVersion: index + 1, contractPhase: index < pro ? "PRE_FREEZE" : "CONTRACT_BOUND" },
    loopBudget: { maxTicks: 100, remainingTicks: 90, maxProviderCalls: 10,
      remainingProviderCalls: 8, maxFixAttempts: 3, remainingFixAttempts: 3 },
    gateStates: CANONICAL_PIPELINE_SEQUENCE.flatMap((node) => node.kind === "GATE" ? [{
      schemaVersion: V2_NAMLA_LOOP_GATE_STATE_SCHEMA, missionId: MISSION,
      stageId: node.id, workPackageId: null, maxLivelockThreshold: 3, livelockCounter: 0,
    }] : []),
    failureCount: 0, frozenContract: null,
  };
}
function revised(current: CanonicalRuntimeRecoveryCheckpoint): CanonicalRuntimeRecoveryCheckpoint {
  return { ...current, checkpointVersion: current.checkpointVersion + 1, savedAt: current.savedAt + 1 };
}
function counter(current: CanonicalRuntimeRecoveryCheckpoint, count: number, total = count):
  CanonicalRuntimeRecoveryCheckpoint {
  return { ...current, failureCount: total, gateStates: current.gateStates.map((state) =>
    state.stageId === "LOOP_AFTER_EER" ? { ...state, livelockCounter: count } : state) };
}
function freezeFixture(missionId = MISSION) {
  const result = new ProtocolEngine().freezePlanContract({
    draftId: "draft", objective: "Build the checkpoint codec",
    tasks: [{ id: "task", name: "Codec", description: "Implement codec",
      targetFiles: ["src/index.ts"], dependencies: [], capabilityRequirements: ["WRITE"] }],
    acceptanceCriteria: [{ id: "criterion", description: "Tests pass",
      verificationMethod: "TEST", required: true }],
    riskClassification: "LOW",
    estimatedBudgets: { maxVirtualTicks: 100, maxProviderCalls: 10, maxFixAttempts: 3 },
  }, {
    missionId, authoritativeInputs: ["Build the checkpoint codec"],
    policyVersions: ["policy-v1"], budgets: { virtualTicks: 100, providerCalls: 10, maxFixAttempts: 3 },
    evidenceRefs: [], missionStateRef: "PLANNING", contractPhase: "PRE_FREEZE",
  });
  assert.ok(result.success && result.frozenContract);
  const captured = captureCanonicalFrozenPlanContract(missionId, result.frozenContract);
  assert.ok(captured.ok);
  // Pin established from this independently created fixture before any tampering.
  const pin: CanonicalFrozenPlanContractIdentity = {
    missionId, contractId: captured.binding.contractId,
    contractVersion: captured.binding.contractVersion, contractHash: captured.binding.contractHash,
  };
  return { binding: captured.binding, contract: captured.contract, pin };
}
function failure(result: { readonly ok: boolean; readonly reasonCode: string }, reason: string): void {
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, reason);
}

test("10E6 recovery v2 restores an explicit initial snapshot without filling defaults", () => {
  const input = fixture("EER", 1);
  const result = restore(input, null);
  assert.ok(result.ok, result.reasonCode);
  assert.deepEqual(result.checkpoint, input);
  assert.equal(result.contract, null);
});

test("10E6 recovery v2 rejects v1 cursor-only snapshots instead of upgrading them", () => {
  const data = fixture();
  const v1 = { schemaVersion: V2_CANONICAL_RUNTIME_CHECKPOINT_SCHEMA, missionId: data.missionId,
    cursor: data.cursor, checkpointVersion: data.checkpointVersion, savedAt: data.savedAt };
  assert.equal(validateCanonicalRuntimeCheckpoint(v1).ok, true);
  failure(restore(v1, null), "recovery-shape-invalid");
  failure(validateCanonicalRuntimeCheckpoint(data), "checkpoint-shape-invalid");
});

test("10E6 recovery v2 requires every field and rejects unknown schema versions", () => {
  const input = fixture();
  for (const key of Object.keys(input)) {
    const missing = Object.fromEntries(Object.entries(input).filter(([field]) => field !== key));
    failure(restore(missing, null), "recovery-shape-invalid");
  }
  failure(restore({ ...input, schemaVersion: "unknown" }, null), "recovery-schema-invalid");
  failure(restore({ ...input, extra: true }, null), "recovery-shape-invalid");
});

test("10E6 recovery v2 reuses strict cursor and checkpoint validation", () => {
  const input = fixture();
  for (const candidate of [
    { ...input, savedAt: 0 }, { ...input, checkpointVersion: 0 },
    { ...input, cursor: { ...input.cursor, missionId: "other" } },
    { ...input, cursor: { ...input.cursor, nodeId: "PLAN" } },
    { ...input, cursor: { ...input.cursor, extra: true } },
    { ...fixture("PRO"), checkpointVersion: 1 },
  ]) failure(restore(candidate, null), "recovery-cursor-checkpoint-invalid");
});

test("10E6 recovery v2 refuses invalid budgets rather than restoring full balances", () => {
  const input = fixture();
  for (const loopBudget of [null, {}, { ...input.loopBudget, remainingTicks: 101 },
    { ...input.loopBudget, remainingProviderCalls: "8" }]) {
    failure(restore({ ...input, loopBudget }, null), "recovery-budget-invalid");
  }
});

test("10E6 recovery v2 requires a complete dense ordered set of external gate states", () => {
  const input = fixture();
  const sparse = [...input.gateStates];
  delete sparse[0];
  for (const gateStates of [[], input.gateStates.slice(1), [...input.gateStates, input.gateStates[0]], sparse]) {
    failure(restore({ ...input, gateStates }, null), "recovery-gate-states-invalid");
  }
  failure(restore({ ...input, gateStates: [...input.gateStates].reverse() }, null),
    "recovery-gate-binding-invalid");
  failure(restore({ ...input, gateStates: input.gateStates.map(() => input.gateStates[0]) }, null),
    "recovery-gate-binding-invalid");
});

test("10E6 recovery v2 reuses the gate state schema validator", () => {
  const input = fixture();
  for (const change of [{ schemaVersion: "bad" }, { livelockCounter: -1 },
    { maxLivelockThreshold: "3" }, { extra: true }]) {
    failure(restore({ ...input, gateStates: [{ ...input.gateStates[0], ...change },
      ...input.gateStates.slice(1)] }, null), "recovery-gate-states-invalid");
  }
});

test("10E6 recovery v2 rejects cross-mission and work-package gate substitution", () => {
  const input = fixture();
  for (const change of [{ missionId: "other" }, { workPackageId: "global" }]) {
    failure(restore({ ...input, gateStates: [{ ...input.gateStates[0], ...change },
      ...input.gateStates.slice(1)] }, null), "recovery-gate-binding-invalid");
  }
});

test("10E6 recovery v2 refuses failure history for a gate not yet reached", () => {
  failure(restore(counter(fixture(), 1), null), "recovery-future-gate-history");
});

test("10E6 recovery v2 checks lifetime failures against consecutive gate failures", () => {
  const input = fixture("LOOP_AFTER_EER");
  failure(restore(counter(input, 2, 1), null), "recovery-failure-count-invalid");
  for (const failureCount of [-1, 0.5, "1", Number.MAX_SAFE_INTEGER + 1]) {
    failure(restore({ ...input, failureCount }, null), "recovery-failure-count-invalid");
  }
  assert.equal(restore(counter(input, 2, 5), null).ok, true);
});

test("10E6 recovery v2 requires explicit null binding and pin before the freeze boundary", () => {
  const frozen = freezeFixture();
  failure(restore({ ...fixture(), frozenContract: frozen.binding }, null), "recovery-contract-phase-invalid");
  failure(restore(fixture(), frozen.pin), "recovery-contract-phase-invalid");
  failure(restore(fixture(), undefined as unknown as null), "recovery-contract-phase-invalid");
});

test("10E6 recovery v2 requires a real binding and independent pin after the freeze boundary", () => {
  const frozen = freezeFixture();
  failure(restore(fixture("PRO"), frozen.pin), "recovery-contract-phase-invalid");
  failure(restore({ ...fixture("PRO"), frozenContract: frozen.binding }, null), "recovery-contract-phase-invalid");
  failure(restore({ ...fixture("PRO"), frozenContract: frozen.binding }, {} as CanonicalFrozenPlanContractIdentity),
    "recovery-contract-invalid");
});

test("10E6 recovery v2 restores the original pinned contract without issuing another freeze", () => {
  const frozen = freezeFixture();
  const result = restore({ ...fixture("PRO"), frozenContract: frozen.binding }, frozen.pin);
  assert.ok(result.ok, result.reasonCode);
  assert.deepEqual(result.contract, frozen.contract);
  assert.equal(result.checkpoint.frozenContract?.rawContractJson, frozen.binding.rawContractJson);
  assert.ok(Object.isFrozen(result.contract?.tasks[0]));
});

test("10E6 recovery v2 refuses replacement raw contract bytes under the old pin", () => {
  const frozen = freezeFixture();
  const raw = JSON.parse(frozen.binding.rawContractJson);
  raw.objective = "Substituted objective";
  const rawContractJson = JSON.stringify(raw);
  const changed = { ...frozen.binding, rawContractJson,
    contractHash: createHash("sha256").update(rawContractJson).digest("hex") };
  failure(restore({ ...fixture("PRO"), frozenContract: changed }, frozen.pin), "recovery-contract-invalid");
});

test("10E6 recovery v2 checks the pinned contract mission against its own mission", () => {
  const other = freezeFixture("other-mission");
  failure(restore({ ...fixture("PRO"), frozenContract: other.binding }, other.pin),
    "recovery-contract-mission-mismatch");
});

test("10E6 recovery v2 returns a deeply frozen detached control snapshot", () => {
  const input = fixture();
  const result = restore(input, null);
  assert.ok(result.ok);
  assert.ok(Object.isFrozen(result.checkpoint));
  assert.ok(Object.isFrozen(result.checkpoint.cursor));
  assert.ok(Object.isFrozen(result.checkpoint.loopBudget));
  assert.ok(Object.isFrozen(result.checkpoint.gateStates));
  assert.ok(Object.isFrozen(result.checkpoint.gateStates[0]));
  assert.notEqual(result.checkpoint.cursor, input.cursor);
  assert.notEqual(result.checkpoint.gateStates[0], input.gateStates[0]);
  assert.equal(Object.isFrozen(input), false);
  assert.equal(Object.isFrozen(input.gateStates), false);
});

test("10E6 recovery v2 rejects accessor input without invoking getters", () => {
  let reads = 0;
  for (const level of ["root", "cursor", "budget", "gate", "array"] as const) {
    const input = structuredClone(fixture());
    const [target, property] = level === "root" ? [input, "loopBudget"] :
      level === "cursor" ? [input.cursor, "nodeIndex"] :
      level === "budget" ? [input.loopBudget, "remainingTicks"] :
      level === "gate" ? [input.gateStates[0], "livelockCounter"] : [input.gateStates, "0"];
    Object.defineProperty(target, property, { enumerable: true, get() { reads += 1; return 0; } });
    assert.equal(restore(input, null).ok, false);
  }
  assert.equal(reads, 0);
});

test("10E6 recovery v2 refuses symbols hidden fields custom prototypes and revoked proxies", () => {
  const symbol = { ...fixture(), [Symbol("hidden")]: true };
  const hidden = Object.defineProperty({ ...fixture() }, "extra", { value: true });
  const exotic = Object.assign(Object.create({}), fixture());
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  for (const input of [symbol, hidden, exotic, revoked.proxy]) assert.equal(restore(input, null).ok, false);
  const array = [...fixture().gateStates];
  Object.defineProperty(array, "extra", { value: 1 });
  assert.equal(restore({ ...fixture(), gateStates: array }, null).ok, false);
});

test("10E6 recovery v2 accepts plain null-prototype records", () => {
  const input = fixture();
  assert.equal(restore(Object.assign(Object.create(null), {
    ...input, cursor: Object.assign(Object.create(null), input.cursor),
    loopBudget: Object.assign(Object.create(null), input.loopBudget),
  }), null).ok, true);
});

test("10E6 recovery v2 JSON round-trip preserves budget and gate history", () => {
  const original = counter(fixture("LOOP_AFTER_EER"), 2, 4);
  const charged = debitCanonicalRuntimeLoopBudget(original.loopBudget,
    { virtualTicks: 1, providerCalls: 1, fixAttempts: 1 });
  assert.ok(charged.ok);
  const expected = { ...original, loopBudget: charged.budget };
  const result = restore(JSON.parse(JSON.stringify(expected)), null);
  assert.ok(result.ok);
  assert.deepEqual(result.checkpoint, expected);
});

test("10E6 recovery v2 JSON round-trip preserves pinned contract bytes despite outer key order", () => {
  const frozen = freezeFixture();
  const input = { ...fixture("PRO"), frozenContract: frozen.binding };
  const reordered = Object.fromEntries(Object.entries(input).reverse());
  const result = restore(JSON.parse(JSON.stringify(reordered)), frozen.pin);
  assert.ok(result.ok);
  assert.equal(result.checkpoint.frozenContract?.rawContractJson, frozen.binding.rawContractJson);
});

test("10E6 recovery transition permits a same-node budget debit", () => {
  const before = fixture();
  const charged = debitCanonicalRuntimeLoopBudget(before.loopBudget,
    { virtualTicks: 1, providerCalls: 0, fixAttempts: 0 });
  assert.ok(charged.ok);
  assert.equal(transition(before, { ...revised(before), loopBudget: charged.budget }, null, null).ok, true);
});

test("10E6 recovery transition requires exact next CAS revision and nonregressing time", () => {
  const before = fixture();
  failure(transition(before, { ...revised(before), checkpointVersion: 42 }, null, null), "recovery-version-not-next");
  failure(transition(before, { ...revised(before), savedAt: 999 }, null, null), "recovery-saved-at-regression");
});

test("10E6 recovery transition rejects mission substitution", () => {
  const before = fixture();
  const next = { ...revised(before), missionId: "other", cursor: { ...before.cursor, missionId: "other" },
    gateStates: before.gateStates.map((state) => ({ ...state, missionId: "other" })) };
  failure(transition(before, next, null, null), "recovery-mission-mismatch");
});

test("10E6 recovery transition permits adjacency but rejects cursor skip and regression", () => {
  const before = fixture();
  assert.equal(transition(before, { ...revised(before), cursor: fixture("LOOP_AFTER_EER").cursor }, null, null).ok, true);
  failure(transition(before, { ...revised(before), cursor: fixture("PLAN").cursor }, null, null),
    "recovery-cursor-transition-invalid");
  const atGate = fixture("LOOP_AFTER_EER");
  failure(transition(atGate, { ...revised(atGate), cursor: before.cursor }, null, null),
    "recovery-cursor-transition-invalid");
});

test("10E6 recovery transition rejects ceiling changes and balance replenishment", () => {
  const before = fixture();
  for (const loopBudget of [{ ...before.loopBudget, maxTicks: 101 },
    { ...before.loopBudget, remainingTicks: 91 }]) {
    failure(transition(before, { ...revised(before), loopBudget }, null, null), "recovery-budget-transition-invalid");
  }
});

test("10E6 recovery transition records one same-gate evidence failure and lifetime increment", () => {
  const before = fixture("LOOP_AFTER_EER");
  assert.equal(transition(before, counter(revised(before), 1), null, null).ok, true);
  failure(transition(before, counter(revised(before), 2), null, null), "recovery-gate-counter-transition-invalid");
  // Lifetime count is already high enough for shape validation, but must still increase.
  const lifetime = { ...before, failureCount: 10 };
  failure(transition(lifetime, counter(revised(lifetime), 1, 10), null, null), "recovery-gate-counter-transition-invalid");
});

test("10E6 recovery transition rejects gate threshold changes and inactive history edits", () => {
  const before = counter(fixture("PLAN"), 1);
  const changedThreshold = { ...revised(before), gateStates: before.gateStates.map((state, index) =>
    index === 0 ? { ...state, maxLivelockThreshold: 9 } : state) };
  failure(transition(before, changedThreshold, null, null), "recovery-gate-threshold-mutated");
  failure(transition(before, counter(revised(before), 2), null, null), "recovery-gate-counter-transition-invalid");
});

test("10E6 recovery transition resets consecutive failures only when leaving their gate", () => {
  const before = counter(fixture("LOOP_AFTER_EER"), 2, 5);
  failure(transition(before, counter(revised(before), 0, 5), null, null), "recovery-gate-counter-transition-invalid");
  const next = { ...counter(revised(before), 0, 5), cursor: fixture("PLAN").cursor };
  assert.equal(transition(before, next, null, null).ok, true);
  failure(transition(before, { ...revised(before), cursor: fixture("PLAN").cursor }, null, null),
    "recovery-gate-counter-transition-invalid");
});

test("10E6 recovery transition refuses lifetime counter regression", () => {
  const before = { ...fixture(), failureCount: 5 };
  failure(transition(before, { ...revised(before), failureCount: 4 }, null, null), "recovery-failure-count-regression");
});

test("10E6 recovery transition binds the actual contract only on the exact crossing into PRO", () => {
  const before = fixture("LOOP_AFTER_PLAN_TEST");
  const frozen = freezeFixture();
  const next = { ...revised(before), cursor: fixture("PRO").cursor, frozenContract: frozen.binding };
  assert.equal(transition(before, next, null, frozen.pin).ok, true);
  failure(transition(before, { ...next, frozenContract: null }, null, frozen.pin), "recovery-contract-phase-invalid");
  failure(transition(fixture("PLAN_TEST"), next, null, frozen.pin), "recovery-cursor-transition-invalid");
});

test("10E6 recovery transition refuses replacing a frozen contract even with another valid pin", () => {
  const original = freezeFixture();
  const raw = JSON.parse(original.binding.rawContractJson);
  raw.objective = "Changed but structurally valid objective";
  const rawContractJson = JSON.stringify(raw);
  const contractHash = createHash("sha256").update(rawContractJson).digest("hex");
  const changed = { ...original.binding, rawContractJson, contractHash };
  const before = { ...fixture("PRO"), frozenContract: original.binding };
  failure(transition(before, { ...revised(before), frozenContract: changed }, original.pin,
    { ...original.pin, contractHash }), "recovery-contract-mutated");
});

test("10E6 recovery transition refuses malformed candidates without returning substitute state", () => {
  const before = fixture();
  assert.equal(transition(null, revised(before), null, null).ok, false);
  const result = transition(before, { ...revised(before), loopBudget: null }, null, null);
  failure(result, "recovery-budget-invalid");
  assert.equal("checkpoint" in result, false);
  assert.deepEqual(before, fixture());
});

test("10E6 recovery transition does not increment a gate already at its livelock ceiling", () => {
  const before = counter(fixture("LOOP_AFTER_EER"), 3, 5);
  failure(transition(before, counter(revised(before), 4, 6), null, null), "recovery-gate-counter-transition-invalid");
  assert.equal(transition(before, revised(before), null, null).ok, true);
});
