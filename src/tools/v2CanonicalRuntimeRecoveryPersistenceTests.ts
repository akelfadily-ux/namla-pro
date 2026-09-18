import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { CANONICAL_PIPELINE_SEQUENCE } from "../v2/architecture/canonicalPipelineRegistry";
import { V2_NAMLA_LOOP_GATE_STATE_SCHEMA } from "../v2/loop/namlaLoopGate";
import { captureCanonicalFrozenPlanContract,
  type CanonicalFrozenPlanContractIdentity } from "../v2/protocol/canonicalFrozenPlanContract";
import { createCanonicalRuntimeCursor, type CanonicalRuntimeCursor } from "../v2/runtime/canonicalRuntimeStepper";
import { V2_CANONICAL_RUNTIME_RECOVERY_CHECKPOINT_SCHEMA,
  type CanonicalRuntimeRecoveryCheckpoint } from "../v2/persistence/canonicalRuntimeRecoveryCheckpoint";
import { InMemoryCanonicalRuntimeRecoveryStore as Store } from "../v2/persistence/inMemoryCanonicalRuntimeRecoveryStore";
import { DurableCanonicalRuntimeRecoverySession as Session,
  type DurableCanonicalRuntimeRecoverySessionResult } from "../v2/persistence/durableCanonicalRuntimeRecoverySession";
import type { CanonicalRuntimeRecoveryStore, CanonicalRuntimeRecoveryCasResult,
  CanonicalRuntimeRecoveryCreateResult } from "../v2/persistence/canonicalRuntimeRecoveryStore";

const MISSION = "recovery-cas-test";
// Data/transition fixtures only: not evidence of factory execution or gate PASS.
function initial(missionId = MISSION): CanonicalRuntimeRecoveryCheckpoint {
  return { schemaVersion: V2_CANONICAL_RUNTIME_RECOVERY_CHECKPOINT_SCHEMA,
    missionId, checkpointVersion: 1, cursor: createCanonicalRuntimeCursor(missionId), savedAt: 1000,
    loopBudget: { maxTicks: 100, remainingTicks: 90, maxProviderCalls: 10,
      remainingProviderCalls: 8, maxFixAttempts: 3, remainingFixAttempts: 3 },
    gateStates: CANONICAL_PIPELINE_SEQUENCE.flatMap((node) => node.kind === "GATE" ? [{
      schemaVersion: V2_NAMLA_LOOP_GATE_STATE_SCHEMA, missionId,
      stageId: node.id, workPackageId: null, maxLivelockThreshold: 3, livelockCounter: 0,
    }] : []), failureCount: 0, frozenContract: null };
}
function cursorAt(nodeId: CanonicalRuntimeCursor["nodeId"], missionId = MISSION): CanonicalRuntimeCursor {
  const nodeIndex = CANONICAL_PIPELINE_SEQUENCE.findIndex((node) => node.id === nodeId);
  assert.ok(nodeIndex >= 0);
  const proIndex = CANONICAL_PIPELINE_SEQUENCE.findIndex((node) => node.id === "PRO");
  return { ...createCanonicalRuntimeCursor(missionId), nodeIndex, nodeId,
    nodeKind: CANONICAL_PIPELINE_SEQUENCE[nodeIndex].kind, stepVersion: nodeIndex + 1,
    contractPhase: nodeIndex < proIndex ? "PRE_FREEZE" : "CONTRACT_BOUND" };
}
function revised(current: CanonicalRuntimeRecoveryCheckpoint,
  fields: Partial<CanonicalRuntimeRecoveryCheckpoint> = {}): CanonicalRuntimeRecoveryCheckpoint {
  return { ...current, checkpointVersion: current.checkpointVersion + 1,
    savedAt: current.savedAt + 1, ...fields };
}
function frozen(missionId = MISSION, objective = "Exercise persisted contract binding") {
  // Synthetic contract with valid bytes; not an authority approval fixture.
  const raw = { contractId: `contract-${missionId}`, version: "v1.0.0", objective,
    acceptanceCriteria: [{ id: "ac-1", description: "Contract round-trips", verificationMethod: "TEST" as const,
      required: true }], constraints: [],
    tasks: [{ id: "task-1", name: "Round trip", description: "Check persistence",
      targetFiles: ["src/index.ts"], dependencies: [], capabilityRequirements: [] }],
    dependencies: [], allowedCapabilities: [], requiredTests: [], securityRequirements: [],
    expectedArtifacts: [], evidenceRequirements: [], riskClassification: "LOW" as const,
    completionConditions: [], frozenAt: 900 };
  const contractHash = createHash("sha256").update(JSON.stringify(raw)).digest("hex");
  const captured = captureCanonicalFrozenPlanContract(missionId, { ...raw, contractHash });
  assert.ok(captured.ok, captured.reasonCode);
  const pin: CanonicalFrozenPlanContractIdentity = { missionId, contractId: raw.contractId,
    contractVersion: raw.version, contractHash };
  return { binding: captured.binding, pin };
}
function failure(result: DurableCanonicalRuntimeRecoverySessionResult, reason: string, detail?: string) {
  assert.equal(result.ok, false);
  if (result.ok) assert.fail("Expected session refusal");
  assert.equal(result.reasonCode, reason);
  if (detail !== undefined) assert.equal(result.detailReasonCode, detail);
  return result;
}
function success(result: DurableCanonicalRuntimeRecoverySessionResult) {
  assert.ok(result.ok, result.reasonCode);
  return result;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, refuse) => { resolve = accept; reject = refuse; });
  return { promise, resolve, reject };
}
function fakeStore(overrides: Partial<CanonicalRuntimeRecoveryStore> = {}): CanonicalRuntimeRecoveryStore {
  return { create: async () => "CREATED", load: async () => initial(),
    compareAndSet: async (_mission, _version, next) => ({ status: "UPDATED",
      checkpointVersion: next.checkpointVersion }), ...overrides };
}
async function toBoundary(store: Store) {
  let current = initial();
  assert.equal(await store.create(current), "CREATED");
  const boundary = CANONICAL_PIPELINE_SEQUENCE.findIndex((node) => node.id === "LOOP_AFTER_PLAN_TEST");
  for (let index = 1; index <= boundary; index += 1) {
    const next = revised(current, { cursor: cursorAt(CANONICAL_PIPELINE_SEQUENCE[index].id) });
    assert.equal((await store.compareAndSet(MISSION, current.checkpointVersion, next, null, null)).status, "UPDATED");
    current = next;
  }
  return current;
}

test("10E6 recovery store inserts the complete explicit initial v2 snapshot", async () => {
  const store = new Store(); const data = initial();
  assert.equal(await store.create(data), "CREATED");
  assert.deepEqual(await store.load(MISSION, null), data);
  assert.equal((await store.load(MISSION, null))?.loopBudget.remainingTicks, 90);
});
test("10E6 recovery store duplicate creation never overwrites budgets or thresholds", async () => {
  const store = new Store(); await store.create(initial());
  const duplicate = { ...initial(), savedAt: 2000, loopBudget: { ...initial().loopBudget, remainingTicks: 70 } };
  assert.equal(await store.create(duplicate), "ALREADY_EXISTS");
  assert.deepEqual(await store.load(MISSION, null), initial());
});
test("10E6 recovery store snapshots caller input before create returns its promise", async () => {
  const store = new Store(); const input = structuredClone(initial()); const expected = structuredClone(input);
  const pending = store.create(input);
  (input.loopBudget as { remainingTicks: number }).remainingTicks = 1;
  (input.gateStates[0] as { livelockCounter: number }).livelockCounter = 9;
  assert.equal(await pending, "CREATED");
  assert.deepEqual(await store.load(MISSION, null), expected);
});
test("10E6 recovery store load returns detached nested snapshots", async () => {
  const store = new Store(); await store.create(initial()); const data = await store.load(MISSION, null);
  assert.ok(data); (data.loopBudget as { remainingTicks: number }).remainingTicks = 0;
  assert.deepEqual(await store.load(MISSION, null), initial());
});
test("10E6 recovery store refuses noninitial revisions and invented initial failure history", async () => {
  const store = new Store();
  for (const data of [revised(initial()), { ...initial(), failureCount: 1 }]) {
    await assert.rejects(store.create(data), /RECOVERY_INITIAL_CHECKPOINT_REQUIRED/);
  }
  assert.equal(await store.load(MISSION, null), null);
});
test("10E6 recovery store rejects v1 envelopes instead of inventing recovery defaults", async () => {
  const data = initial();
  const v1 = { schemaVersion: "namla-v2-canonical-runtime-checkpoint-v1", missionId: MISSION,
    checkpointVersion: 1, cursor: data.cursor, savedAt: data.savedAt };
  await assert.rejects(new Store().create(v1 as unknown as CanonicalRuntimeRecoveryCheckpoint),
    /INVALID_RECOVERY_CHECKPOINT:recovery-shape-invalid/);
});
test("10E6 recovery store missing CAS returns NOT_FOUND without creating a record", async () => {
  const store = new Store();
  assert.deepEqual(await store.compareAndSet(MISSION, 1, revised(initial()), null, null), { status: "NOT_FOUND" });
  assert.equal(await store.load(MISSION, null), null);
});
test("10E6 recovery store same-node CAS commits the complete reduced budget", async () => {
  const store = new Store(); const data = initial(); await store.create(data);
  const next = revised(data, { loopBudget: { ...data.loopBudget, remainingTicks: 80, remainingProviderCalls: 5 } });
  assert.deepEqual(await store.compareAndSet(MISSION, 1, next, null, null), { status: "UPDATED", checkpointVersion: 2 });
  assert.deepEqual(await store.load(MISSION, null), next);
});
test("10E6 recovery store adjacent CAS preserves the rest of recovery state", async () => {
  const store = new Store(); await store.create(initial());
  const next = revised(initial(), { cursor: cursorAt("LOOP_AFTER_EER") });
  assert.equal((await store.compareAndSet(MISSION, 1, next, null, null)).status, "UPDATED");
  assert.deepEqual(await store.load(MISSION, null), next);
});
test("10E6 recovery store concurrent CAS attempts have one winner and one conflict", async () => {
  const store = new Store(); await store.create(initial());
  const a = revised(initial()); const b = revised(initial(), { cursor: cursorAt("LOOP_AFTER_EER") });
  const results = await Promise.all([store.compareAndSet(MISSION, 1, a, null, null),
    store.compareAndSet(MISSION, 1, b, null, null)]);
  assert.equal(results.filter((r) => r.status === "UPDATED").length, 1);
  assert.equal(results.filter((r) => r.status === "VERSION_CONFLICT").length, 1);
  assert.deepEqual(await store.load(MISSION, null), a);
});
test("10E6 recovery store failed transition never partially changes budget or gate history", async () => {
  const store = new Store(); const current = await toBoundary(store);
  const bad = revised(current, { loopBudget: { ...current.loopBudget, remainingTicks: 1 },
    gateStates: current.gateStates.map((s, index) => index === 0 ? { ...s, maxLivelockThreshold: 9 } : s) });
  await assert.rejects(store.compareAndSet(MISSION, current.checkpointVersion, bad, null, null),
    /recovery-gate-threshold-mutated/);
  assert.deepEqual(await store.load(MISSION, null), current);
});
test("10E6 recovery store prevents refill and savedAt regression under CAS", async () => {
  const store = new Store(); await store.create(initial());
  for (const bad of [revised(initial(), { loopBudget: { ...initial().loopBudget, remainingTicks: 91 } }),
    revised(initial(), { savedAt: 999 })]) {
    await assert.rejects(store.compareAndSet(MISSION, 1, bad, null, null), /INVALID_RECOVERY_TRANSITION/);
    assert.deepEqual(await store.load(MISSION, null), initial());
  }
});
test("10E6 recovery store rejects invalid expected versions and mission substitution before mutation", async () => {
  const store = new Store(); await store.create(initial());
  for (const version of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(store.compareAndSet(MISSION, version, revised(initial()), null, null),
      /RECOVERY_EXPECTED_CHECKPOINT_VERSION_INVALID/);
  }
  await assert.rejects(store.compareAndSet(MISSION, 1, revised(initial("other")), null, null), /RECOVERY_MISSION_ID_MISMATCH/);
  await assert.rejects(store.compareAndSet(MISSION, 1, revised(initial(), { checkpointVersion: 3 }), null, null),
    /RECOVERY_CHECKPOINT_VERSION_NOT_NEXT/);
  assert.deepEqual(await store.load(MISSION, null), initial());
});
test("10E6 recovery store CAS snapshots nested caller input before returning", async () => {
  const store = new Store(); await store.create(initial()); const next = structuredClone(revised(initial()));
  const expected = structuredClone(next); const pending = store.compareAndSet(MISSION, 1, next, null, null);
  (next.loopBudget as { remainingTicks: number }).remainingTicks = 0;
  assert.equal((await pending).status, "UPDATED"); assert.deepEqual(await store.load(MISSION, null), expected);
});
test("10E6 recovery store preserves gate failures through re-instantiated sessions", async () => {
  const store = new Store(); const writer = new Session(store, MISSION); await writer.createInitial(initial());
  const gate = revised(initial(), { cursor: cursorAt("LOOP_AFTER_EER") }); await writer.advance(gate, null);
  const failed = revised(gate, { failureCount: 1, loopBudget: { ...gate.loopBudget, remainingTicks: 89 },
    gateStates: gate.gateStates.map((s, index) => index === 0 ? { ...s, livelockCounter: 1 } : s) });
  success(await writer.advance(failed, null));
  const replacement = new Session(store, MISSION);
  assert.deepEqual(success(await replacement.resume(null)).checkpoint, failed);
});
test("10E6 recovery store binds a contract at the boundary using an external pin", async () => {
  const store = new Store(); const current = await toBoundary(store); const contract = frozen();
  const bound = revised(current, { cursor: cursorAt("PRO"), frozenContract: contract.binding });
  assert.equal((await store.compareAndSet(MISSION, current.checkpointVersion, bound, null, contract.pin)).status, "UPDATED");
  assert.deepEqual(await store.load(MISSION, contract.pin), bound);
  await assert.rejects(store.load(MISSION, { ...contract.pin, contractHash: "0".repeat(64) }), /INVALID_RECOVERY_CHECKPOINT/);
  await assert.rejects(store.load(MISSION, null), /INVALID_RECOVERY_CHECKPOINT/);
});
test("10E6 recovery store never replaces an existing contract with another valid binding", async () => {
  const store = new Store(); const current = await toBoundary(store); const a = frozen(); const b = frozen(MISSION, "Other contract");
  const bound = revised(current, { cursor: cursorAt("PRO"), frozenContract: a.binding });
  await store.compareAndSet(MISSION, current.checkpointVersion, bound, null, a.pin);
  await assert.rejects(store.compareAndSet(MISSION, bound.checkpointVersion,
    revised(bound, { frozenContract: b.binding }), a.pin, b.pin), /recovery-contract-mutated/);
  assert.deepEqual(await store.load(MISSION, a.pin), bound);
});
test("10E6 recovery store isolates separate missions", async () => {
  const store = new Store(); await store.create(initial()); await store.create(initial("other"));
  await store.compareAndSet(MISSION, 1, revised(initial()), null, null);
  assert.deepEqual(await store.load("other", null), initial("other"));
});
test("10E6 recovery store rejects checkpoint accessors without invoking them", async () => {
  let reads = 0; const data = { ...initial() }; Object.defineProperty(data, "missionId", {
    enumerable: true, get() { reads += 1; return MISSION; } });
  await assert.rejects(new Store().create(data), /INVALID_RECOVERY_CHECKPOINT/); assert.equal(reads, 0);
});
test("10E6 recovery session validates mission identity at construction", () => {
  for (const mission of [" ", "", null, undefined, 1]) {
    assert.throws(() => new Session(new Store(), mission as string), /RECOVERY_SESSION_MISSION_ID_INVALID/);
  }
});
test("10E6 recovery session create then resume preserves exact consumed balances", async () => {
  const store = new Store(); const writer = new Session(store, MISSION);
  assert.equal(success(await writer.createInitial(initial())).status, "CREATED");
  const replacement = new Session(store, MISSION); const resumed = success(await replacement.resume(null));
  assert.equal(resumed.status, "RESUMED"); assert.deepEqual(resumed.checkpoint, initial());
  assert.equal(replacement.isActive(), true);
});
test("10E6 recovery session missing resume never becomes a fresh mission", async () => {
  const store = new Store(); const session = new Session(store, MISSION);
  failure(await session.resume(null), "checkpoint-not-found");
  failure(await session.createInitial(initial()), "session-failed-closed");
  assert.equal(await store.load(MISSION, null), null);
});
test("10E6 recovery session cannot advance without explicit create or resume", async () => {
  const session = new Session(new Store(), MISSION);
  failure(await session.advance(revised(initial()), null), "session-not-active"); assert.equal(session.isFailedClosed(), true);
});
test("10E6 recovery session refuses active reinitialization and silent reload", async () => {
  for (const method of ["resume", "create"] as const) {
    const session = new Session(new Store(), MISSION); await session.createInitial(initial());
    failure(await (method === "resume" ? session.resume(null) : session.createInitial(initial())), "session-already-active");
    assert.equal(session.isActive(), false); assert.deepEqual(session.getSnapshot(), initial());
  }
});
test("10E6 recovery session rejects identity mismatch before making a store call", async () => {
  let calls = 0; const session = new Session(fakeStore({ create: async () => { calls += 1; return "CREATED"; } }), MISSION);
  failure(await session.createInitial(initial("other")), "mission-id-mismatch"); assert.equal(calls, 0);
});
test("10E6 recovery session validates candidate transitions before invoking CAS", async () => {
  let calls = 0; const store = fakeStore({ compareAndSet: async () => { calls += 1; return { status: "NOT_FOUND" }; } });
  const session = new Session(store, MISSION); await session.createInitial(initial());
  const bad = revised(initial(), { loopBudget: { ...initial().loopBudget, remainingTicks: 91 } });
  failure(await session.advance(bad, null), "invalid-transition", "recovery-budget-transition-invalid");
  assert.equal(calls, 0); assert.deepEqual(session.getSnapshot(), initial());
});
test("10E6 recovery session CAS conflict permanently locks the stale writer only", async () => {
  const store = new Store(); const a = new Session(store, MISSION); await a.createInitial(initial());
  const b = new Session(store, MISSION); await b.resume(null);
  const results = await Promise.all([a.advance(revised(initial()), null), b.advance(revised(initial()), null)]);
  assert.equal(results.filter((r) => r.ok).length, 1);
  failure(results[1], "checkpoint-version-conflict"); assert.equal(b.isFailedClosed(), true);
  failure(await b.resume(null), "session-failed-closed"); assert.deepEqual(b.getSnapshot(), initial());
  const replacement = new Session(store, MISSION);
  assert.deepEqual(success(await replacement.resume(null)).checkpoint, revised(initial()));
});
test("10E6 recovery session storage failures in create load and CAS lock the instance", async () => {
  for (const phase of ["create", "load", "compareAndSet"] as const) {
    const fail = async (): Promise<never> => { throw new Error("simulated storage offline"); };
    const store = fakeStore({ [phase]: fail }); const session = new Session(store, MISSION);
    if (phase === "compareAndSet") success(await session.createInitial(initial()));
    const result = phase === "create" ? await session.createInitial(initial()) :
      phase === "load" ? await session.resume(null) : await session.advance(revised(initial()), null);
    failure(result, "storage-operation-failed"); assert.equal(session.isFailedClosed(), true);
    failure(await session.resume(null), "session-failed-closed");
  }
});
test("10E6 recovery session store disappearance retains its last trusted snapshot", async () => {
  const session = new Session(fakeStore({ compareAndSet: async () => ({ status: "NOT_FOUND" }) }), MISSION);
  await session.createInitial(initial()); failure(await session.advance(revised(initial()), null), "checkpoint-disappeared");
  assert.deepEqual(session.getSnapshot(), initial());
});
test("10E6 recovery session rejects corrupted and undefined loaded state without defaults", async () => {
  for (const value of [undefined, {}, { ...initial(), gateStates: [] }]) {
    const session = new Session(fakeStore({ load: async () => value as CanonicalRuntimeRecoveryCheckpoint }), MISSION);
    failure(await session.resume(null), "invalid-checkpoint"); assert.equal(session.getSnapshot(), null);
  }
});
test("10E6 recovery session rejects invalid create receipts instead of reporting duplicates", async () => {
  const session = new Session(fakeStore({ create: async () => "other" as CanonicalRuntimeRecoveryCreateResult }), MISSION);
  failure(await session.createInitial(initial()), "store-receipt-invalid"); assert.equal(session.getSnapshot(), null);
});
test("10E6 recovery session rejects malformed unknown and mismatching CAS receipts", async () => {
  for (const receipt of [undefined, null, { status: "OTHER", checkpointVersion: 2 },
    { status: "UPDATED", checkpointVersion: 999 }, { status: "UPDATED", checkpointVersion: "2" },
    { status: "VERSION_CONFLICT", currentCheckpointVersion: 1 },
    { status: "VERSION_CONFLICT", currentCheckpointVersion: NaN }, { status: "NOT_FOUND", extra: true }]) {
    const session = new Session(fakeStore({ compareAndSet: async () => receipt as CanonicalRuntimeRecoveryCasResult }), MISSION);
    await session.createInitial(initial()); failure(await session.advance(revised(initial()), null), "store-receipt-invalid");
    assert.deepEqual(session.getSnapshot(), initial());
  }
});
test("10E6 recovery session refuses accessor receipts without invoking their getters", async () => {
  let reads = 0; const receipt = Object.defineProperty({}, "status", {
    enumerable: true, get() { reads += 1; return "UPDATED"; } });
  const session = new Session(fakeStore({ compareAndSet: async () => receipt as CanonicalRuntimeRecoveryCasResult }), MISSION);
  await session.createInitial(initial()); failure(await session.advance(revised(initial()), null), "store-receipt-invalid");
  assert.equal(reads, 0);
});
test("10E6 recovery session detaches returned results and snapshots from private state", async () => {
  const session = new Session(new Store(), MISSION); const result = success(await session.createInitial(initial()));
  (result.checkpoint.loopBudget as { remainingTicks: number }).remainingTicks = 0;
  const snapshot = session.getSnapshot(); assert.ok(snapshot);
  (snapshot.gateStates[0] as { maxLivelockThreshold: number }).maxLivelockThreshold = 999;
  assert.deepEqual(session.getSnapshot(), initial());
});
test("10E6 recovery session single-flight create rejects a concurrent call without resurrection", async () => {
  const wait = deferred<CanonicalRuntimeRecoveryCreateResult>(); let calls = 0;
  const session = new Session(fakeStore({ create: async () => { calls += 1; return wait.promise; } }), MISSION);
  const first = session.createInitial(initial());
  failure(await session.resume(null), "session-busy"); assert.equal(calls, 1);
  assert.equal(session.isFailedClosed(), false); wait.resolve("CREATED"); success(await first);
  assert.equal(session.isActive(), true);
});
test("10E6 recovery session single-flight CAS rejects a concurrent advance", async () => {
  const wait = deferred<CanonicalRuntimeRecoveryCasResult>(); let calls = 0;
  const session = new Session(fakeStore({ compareAndSet: async () => { calls += 1; return wait.promise; } }), MISSION);
  await session.createInitial(initial()); const first = session.advance(revised(initial()), null);
  failure(await session.advance(revised(initial()), null), "session-busy"); assert.equal(calls, 1);
  assert.deepEqual(session.getSnapshot(), initial()); wait.resolve({ status: "UPDATED", checkpointVersion: 2 });
  success(await first); assert.deepEqual(session.getSnapshot(), revised(initial()));
});
test("10E6 recovery session deferred input mutation cannot alter its eventual snapshot", async () => {
  const wait = deferred<CanonicalRuntimeRecoveryCasResult>();
  const session = new Session(fakeStore({ compareAndSet: async () => wait.promise }), MISSION);
  await session.createInitial(initial()); const next = structuredClone(revised(initial()));
  const first = session.advance(next, null); (next.loopBudget as { remainingTicks: number }).remainingTicks = 0;
  wait.resolve({ status: "UPDATED", checkpointVersion: 2 }); success(await first);
  assert.deepEqual(session.getSnapshot(), revised(initial()));
});
test("10E6 recovery session requires an explicit pin parameter even before freeze", async () => {
  let loads = 0; const session = new Session(fakeStore({ load: async () => { loads += 1; return initial(); } }), MISSION);
  failure(await session.resume(undefined as unknown as null), "expected-contract-pin-invalid"); assert.equal(loads, 0);
});
test("10E6 recovery session resumes a bound snapshot only with its separately supplied pin", async () => {
  const store = new Store(); const boundary = await toBoundary(store); const contract = frozen();
  const writer = new Session(store, MISSION); success(await writer.resume(null));
  const bound = revised(boundary, { cursor: cursorAt("PRO"), frozenContract: contract.binding });
  success(await writer.advance(bound, contract.pin));
  const replacement = new Session(store, MISSION); assert.deepEqual(success(await replacement.resume(contract.pin)).checkpoint, bound);
  const invalid = new Session(fakeStore({ load: async () => bound }), MISSION);
  failure(await invalid.resume(null), "invalid-checkpoint"); assert.equal(invalid.isFailedClosed(), true);
});
test("10E6 recovery session captures the external contract pin before asynchronous load", async () => {
  const contract = frozen(); const bound = { ...initial(), checkpointVersion: 7, cursor: cursorAt("PRO"), frozenContract: contract.binding };
  const wait = deferred<CanonicalRuntimeRecoveryCheckpoint | null>();
  const pin = { ...contract.pin }; const session = new Session(fakeStore({ load: async () => wait.promise }), MISSION);
  const pending = session.resume(pin); pin.contractHash = "0".repeat(64); wait.resolve(bound);
  assert.deepEqual(success(await pending).checkpoint, bound);
});
test("10E6 recovery session refuses pin accessors without invoking them or storage", async () => {
  let reads = 0; let loads = 0; const pin = { ...frozen().pin };
  Object.defineProperty(pin, "contractHash", { enumerable: true, get() { reads += 1; return "0".repeat(64); } });
  const session = new Session(fakeStore({ load: async () => { loads += 1; return initial(); } }), MISSION);
  failure(await session.resume(pin), "expected-contract-pin-invalid"); assert.equal(reads, 0); assert.equal(loads, 0);
});
test("10E6 recovery session deferred storage failure cannot reactivate a failed instance", async () => {
  const wait = deferred<CanonicalRuntimeRecoveryCasResult>();
  const session = new Session(fakeStore({ compareAndSet: async () => wait.promise }), MISSION);
  await session.createInitial(initial()); const pending = session.advance(revised(initial()), null);
  failure(await session.resume(null), "session-busy"); wait.reject(new Error("simulated uncertain commit"));
  failure(await pending, "storage-operation-failed"); failure(await session.resume(null), "session-failed-closed");
  assert.equal(session.isActive(), false); assert.deepEqual(session.getSnapshot(), initial());
});
