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
import { PostgresCanonicalRuntimeRecoveryStore as Store } from "../v2/persistence/postgresCanonicalRuntimeRecoveryStore";
import { V2_POSTGRES_CANONICAL_RUNTIME_RECOVERY_TABLE as TABLE,
  V2_POSTGRES_CANONICAL_RUNTIME_RECOVERY_SCHEMA_SQL as DDL } from "../v2/persistence/postgresCanonicalRuntimeRecoverySchema";
import { migrateV2CanonicalRuntimeRecoverySchema as migrate,
  V2_POSTGRES_CANONICAL_RUNTIME_RECOVERY_MIGRATION_VERSION as VERSION,
  V2_POSTGRES_CANONICAL_RUNTIME_RECOVERY_MIGRATION_NAME as NAME } from "../v2/persistence/postgresCanonicalRuntimeRecoveryMigration";
import { DurableCanonicalRuntimeRecoverySession as Session } from "../v2/persistence/durableCanonicalRuntimeRecoverySession";
import type { PostgresCheckpointDatabase, PostgresCheckpointClient,
  PostgresCheckpointQueryResult } from "../v2/persistence/postgresMissionCheckpointStore";
import { V2_POSTGRES_MIGRATION_NAME } from "../v2/persistence/postgresMissionCheckpointMigration";
import { V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_NAME } from "../v2/persistence/postgresExecutionAuthorityMigration";
import { V2_POSTGRES_CANONICAL_RUNTIME_MIGRATION_NAME } from "../v2/persistence/postgresCanonicalRuntimeCursorMigration";

// Scripted adapter: NOT PostgreSQL, not a row-lock, process-crash or fsync proof.
interface Step {
  readonly sql: RegExp;
  readonly rows?: readonly unknown[];
  readonly error?: Error;
  readonly wait?: Promise<void>;
  readonly inspect?: (params: readonly unknown[], sql: string) => void;
}
class Database implements PostgresCheckpointDatabase {
  readonly events: string[] = [];
  readonly calls: { sql: string; params: readonly unknown[]; transactional: boolean }[] = [];
  private index = 0;
  constructor(private readonly steps: readonly Step[]) {}
  private async execute<T>(sql: string, params: readonly unknown[] | undefined,
    transactional: boolean): Promise<PostgresCheckpointQueryResult<T>> {
    const step = this.steps[this.index++];
    assert.ok(step, `Unexpected SQL: ${sql}`);
    assert.match(sql, step.sql);
    this.calls.push({ sql, params: params ?? [], transactional });
    step.inspect?.(params ?? [], sql);
    if (step.wait) await step.wait;
    if (step.error) throw step.error;
    return { rows: (step.rows ?? []) as readonly T[], rowCount: (step.rows ?? []).length };
  }
  async query<T = unknown>(sql: string, params?: readonly unknown[]): Promise<PostgresCheckpointQueryResult<T>> {
    return this.execute<T>(sql, params, false);
  }
  async transaction<T>(work: (client: PostgresCheckpointClient) => Promise<T>): Promise<T> {
    this.events.push("BEGIN");
    const client: PostgresCheckpointClient = { query: <R = unknown>(sql: string, params?: readonly unknown[]) =>
      this.execute<R>(sql, params, true) };
    try { const result = await work(client); this.events.push("COMMIT"); return result; }
    catch (error) { this.events.push("ROLLBACK"); throw error; }
  }
  complete(): void { assert.equal(this.index, this.steps.length); }
}
const MISSION = "pg-recovery-v2";
function initial(missionId = MISSION): CanonicalRuntimeRecoveryCheckpoint {
  return { schemaVersion: V2_CANONICAL_RUNTIME_RECOVERY_CHECKPOINT_SCHEMA, missionId,
    checkpointVersion: 1, cursor: createCanonicalRuntimeCursor(missionId), savedAt: 1000,
    loopBudget: { maxTicks: 100, remainingTicks: 90, maxProviderCalls: 10,
      remainingProviderCalls: 8, maxFixAttempts: 3, remainingFixAttempts: 3 },
    gateStates: CANONICAL_PIPELINE_SEQUENCE.flatMap((node) => node.kind === "GATE" ? [{
      schemaVersion: V2_NAMLA_LOOP_GATE_STATE_SCHEMA, missionId, stageId: node.id,
      workPackageId: null, maxLivelockThreshold: 3, livelockCounter: 0,
    }] : []), failureCount: 0, frozenContract: null };
}
function cursorAt(nodeId: CanonicalRuntimeCursor["nodeId"]): CanonicalRuntimeCursor {
  const nodeIndex = CANONICAL_PIPELINE_SEQUENCE.findIndex((node) => node.id === nodeId);
  assert.ok(nodeIndex >= 0);
  const proIndex = CANONICAL_PIPELINE_SEQUENCE.findIndex((node) => node.id === "PRO");
  return { ...createCanonicalRuntimeCursor(MISSION), nodeIndex, nodeId,
    nodeKind: CANONICAL_PIPELINE_SEQUENCE[nodeIndex].kind, stepVersion: nodeIndex + 1,
    contractPhase: nodeIndex < proIndex ? "PRE_FREEZE" : "CONTRACT_BOUND" };
}
function at(nodeId: CanonicalRuntimeCursor["nodeId"]): CanonicalRuntimeRecoveryCheckpoint {
  const cursor = cursorAt(nodeId);
  return { ...initial(), cursor, checkpointVersion: cursor.stepVersion };
}
function revised(current = initial(), fields: Partial<CanonicalRuntimeRecoveryCheckpoint> = {}): CanonicalRuntimeRecoveryCheckpoint {
  return { ...current, checkpointVersion: current.checkpointVersion + 1, savedAt: current.savedAt + 1, ...fields };
}
function frozen(objective = "Persist the exact approved bytes") {
  // Valid data fixture only, not a PLAN_TEST approval or genuine execution.
  const raw = { contractId: `contract-${MISSION}`, version: "v1.0.0", objective,
    acceptanceCriteria: [{ id: "ac-1", description: "Round trip", verificationMethod: "TEST" as const, required: true }],
    constraints: [], tasks: [{ id: "t1", name: "Save", description: "Save", targetFiles: ["out.txt"],
      dependencies: [], capabilityRequirements: [] }], dependencies: [], allowedCapabilities: [], requiredTests: [],
    securityRequirements: [], expectedArtifacts: [], evidenceRequirements: [], riskClassification: "LOW" as const,
    completionConditions: [], frozenAt: 900 };
  const contractHash = createHash("sha256").update(JSON.stringify(raw)).digest("hex");
  const result = captureCanonicalFrozenPlanContract(MISSION, { ...raw, contractHash });
  assert.ok(result.ok);
  const pin: CanonicalFrozenPlanContractIdentity = { missionId: MISSION, contractId: raw.contractId,
    contractVersion: raw.version, contractHash };
  return { binding: result.binding, pin };
}
function row(checkpoint = initial()): Record<string, unknown> {
  return { mission_id: checkpoint.missionId, schema_version: checkpoint.schemaVersion,
    checkpoint_version: String(checkpoint.checkpointVersion), cursor_step_version: String(checkpoint.cursor.stepVersion),
    checkpoint, saved_at: String(checkpoint.savedAt) };
}
function read(rows: readonly unknown[]): Step { return { sql: /^SELECT .*FROM .* WHERE mission_id = \$1$/, rows }; }
function lock(current: CanonicalRuntimeRecoveryCheckpoint): Step { return { sql: /FOR UPDATE$/, rows: [row(current)] }; }
function update(next: CanonicalRuntimeRecoveryCheckpoint): Step { return { sql: /^UPDATE /, rows: [row(next)] }; }
function waitFor() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
const oldReceipts = [
  { version: "1", name: V2_POSTGRES_MIGRATION_NAME },
  { version: "2", name: V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_NAME },
  { version: "3", name: V2_POSTGRES_CANONICAL_RUNTIME_MIGRATION_NAME },
];
function migrationPrefix(rows: readonly unknown[] = oldReceipts): Step[] {
  return [{ sql: /^SELECT pg_advisory_xact_lock\(\$1, \$2\)$/ },
    { sql: /^CREATE TABLE IF NOT EXISTS namla_v2_schema_migrations/ },
    { sql: /WHERE version IN \(\$1, \$2, \$3, \$4\) ORDER BY version FOR UPDATE$/, rows }];
}
function insertion(rows: readonly unknown[] = [{ version: "4", name: NAME }]): Step[] {
  return [{ sql: /^CREATE TABLE namla_v2_canonical_runtime_recovery_checkpoints/ },
    { sql: /^INSERT INTO namla_v2_schema_migrations/, rows }];
}

test("10E6 recovery PostgreSQL DDL is v2-only and never alters v1 storage", () => {
  assert.equal(TABLE, "namla_v2_canonical_runtime_recovery_checkpoints");
  assert.match(DDL, new RegExp(`^CREATE TABLE ${TABLE} \\(`));
  assert.ok(DDL.includes(V2_CANONICAL_RUNTIME_RECOVERY_CHECKPOINT_SCHEMA));
  assert.doesNotMatch(DDL, /IF NOT EXISTS|ALTER TABLE|INSERT INTO|DROP TABLE/);
});
test("10E6 recovery PostgreSQL DDL makes all five JSON constraint bodies IS TRUE", () => {
  for (const name of ["json_shape", "row_binding", "budget", "gates", "contract_phase"]) {
    const segment = DDL.split(`CONSTRAINT recovery_v2_${name} CHECK ((`)[1];
    assert.ok(segment); assert.match(segment.split(/,\s*CONSTRAINT/)[0], /\) IS TRUE\)/);
  }
  assert.equal((DDL.match(/\) IS TRUE\)/g) ?? []).length, 5);
});
test("10E6 recovery PostgreSQL DDL pins complete ordered gate states and safe numeric fields", () => {
  const gates = CANONICAL_PIPELINE_SEQUENCE.filter((node) => node.kind === "GATE");
  for (const gate of gates) assert.ok(DDL.includes(`'${gate.id}'`));
  assert.ok(DDL.includes(`jsonb_array_length(checkpoint -> 'gateStates') = ${gates.length}`));
  assert.match(DDL, /9007199254740991/); assert.match(DDL, /trunc\(/);
  assert.match(DDL, /\?& ARRAY/); assert.match(DDL, /'frozenContract'/);
});
test("10E6 recovery PostgreSQL create checks the complete insert receipt within its transaction", async () => {
  const value = initial(); const db = new Database([{ sql: /^INSERT INTO /, rows: [row(value)] }]);
  assert.equal(await new Store(db).create(value), "CREATED");
  assert.deepEqual(db.events, ["BEGIN", "COMMIT"]); assert.ok(db.calls[0].transactional);
  assert.deepEqual(db.calls[0].params.slice(0, 4), [MISSION, value.schemaVersion, 1, 1]);
  assert.deepEqual(JSON.parse(db.calls[0].params[4] as string), value);
  assert.equal(db.calls[0].params[5], value.savedAt); db.complete();
});
test("10E6 recovery PostgreSQL duplicate creation is insert-only", async () => {
  const db = new Database([{ sql: /ON CONFLICT \(mission_id\) DO NOTHING/, rows: [] }]);
  assert.equal(await new Store(db).create(initial()), "ALREADY_EXISTS"); db.complete();
});
test("10E6 recovery PostgreSQL create refuses invalid or noninitial snapshots before SQL", async () => {
  const db = new Database([]); const store = new Store(db);
  for (const value of [null, { ...initial(), schemaVersion: "namla-v2-canonical-runtime-checkpoint-v1" },
    revised(), { ...initial(), failureCount: 1 }]) {
    await assert.rejects(store.create(value as CanonicalRuntimeRecoveryCheckpoint), /INVALID_RECOVERY_CHECKPOINT|RECOVERY_INITIAL_CHECKPOINT_REQUIRED/);
  }
  assert.deepEqual(db.events, []); db.complete();
});
test("10E6 recovery PostgreSQL invalid insert receipt prevents callback success", async () => {
  const wrong = { ...initial(), loopBudget: { ...initial().loopBudget, remainingTicks: 89 } };
  for (const rows of [[row(wrong)], [row(), row()]]) {
    const db = new Database([{ sql: /^INSERT INTO /, rows }]);
    await assert.rejects(new Store(db).create(initial()), /PG_RECOVERY_WRITE_RECEIPT/);
    assert.deepEqual(db.events, ["BEGIN", "ROLLBACK"]); db.complete();
  }
});
test("10E6 recovery PostgreSQL create snapshots input before awaited storage", async () => {
  const wait = waitFor(); const input = structuredClone(initial());
  const db = new Database([{ sql: /^INSERT INTO /, rows: [row()], wait: wait.promise }]);
  const pending = new Store(db).create(input);
  (input.loopBudget as { remainingTicks: number }).remainingTicks = 0;
  (input.gateStates[0] as { maxLivelockThreshold: number }).maxLivelockThreshold = 999;
  wait.resolve(); assert.equal(await pending, "CREATED");
  assert.deepEqual(JSON.parse(db.calls[0].params[4] as string), initial()); db.complete();
});
test("10E6 recovery PostgreSQL load validates and detaches all nested recovery data", async () => {
  const value = initial(); const db = new Database([read([row(value)])]);
  const loaded = await new Store(db).load(MISSION, null);
  assert.deepEqual(loaded, value); assert.notEqual(loaded, value);
  assert.notEqual(loaded?.loopBudget, value.loopBudget); assert.notEqual(loaded?.gateStates, value.gateStates);
  assert.equal(db.calls[0].transactional, false); db.complete();
});
test("10E6 recovery PostgreSQL absent load returns null without reconstruction", async () => {
  const db = new Database([read([])]); assert.equal(await new Store(db).load(MISSION, null), null); db.complete();
});
test("10E6 recovery PostgreSQL load accepts valid JSON text from an adapter", async () => {
  const db = new Database([read([{ ...row(), checkpoint: JSON.stringify(initial()) }])]);
  assert.deepEqual(await new Store(db).load(MISSION, null), initial()); db.complete();
});
test("10E6 recovery PostgreSQL load rejects malformed JSON and corrupt recovery snapshots", async () => {
  for (const checkpoint of ["{broken", null, {}, { ...initial(), failureCount: -1 }]) {
    const db = new Database([read([{ ...row(), checkpoint }])]);
    await assert.rejects(new Store(db).load(MISSION, null), /CORRUPT_JSON|INVALID_RECOVERY_CHECKPOINT/); db.complete();
  }
});
test("10E6 recovery PostgreSQL load rejects row identity schema and scalar mismatch", async () => {
  for (const fields of [{ mission_id: "other" }, { schema_version: "v1" }, { checkpoint_version: "2" }, { saved_at: "2" }]) {
    const db = new Database([read([{ ...row(), ...fields }])]);
    await assert.rejects(new Store(db).load(MISSION, null), /PG_RECOVERY_ROW_/); db.complete();
  }
});
test("10E6 recovery PostgreSQL rejects non-safe physical integers without coercion", async () => {
  for (const value of [null, undefined, "1.5", "1e3", " 1", true, 0, -1, NaN, Infinity, "9007199254740992"]) {
    const db = new Database([read([{ ...row(), checkpoint_version: value }])]);
    await assert.rejects(new Store(db).load(MISSION, null), /PG_RECOVERY_INVALID_INTEGER/); db.complete();
  }
});
test("10E6 recovery PostgreSQL rejects missing duplicate and accessor row surfaces", async () => {
  let calls = 0; const accessor = row();
  Object.defineProperty(accessor, "checkpoint", { enumerable: true, get() { calls++; return initial(); } });
  for (const rows of [[{}], [accessor], [row(), row()]]) {
    const db = new Database([read(rows)]);
    await assert.rejects(new Store(db).load(MISSION, null), /PG_RECOVERY_INVALID_ROW|PG_RECOVERY_LOAD_CARDINALITY/); db.complete();
  }
  assert.equal(calls, 0);
});
test("10E6 recovery PostgreSQL load requires explicit pin and valid mission before SQL", async () => {
  const db = new Database([]); const store = new Store(db);
  await assert.rejects(store.load(" ", null), /RECOVERY_MISSION_ID_INVALID/);
  await assert.rejects(store.load(MISSION, undefined as unknown as null), /RECOVERY_EXPECTED_CONTRACT_PIN_INVALID/);
  const pin = frozen().pin;
  await assert.rejects(store.load(MISSION, { ...pin, missionId: "other" }), /PIN_MISSION_MISMATCH/); db.complete();
});
test("10E6 recovery PostgreSQL bound load restores original raw bytes using the supplied pin", async () => {
  const { binding, pin } = frozen(); const value = { ...at("PRO"), frozenContract: binding };
  const db = new Database([read([row(value)])]); const loaded = await new Store(db).load(MISSION, pin);
  assert.deepEqual(loaded, value); assert.equal(loaded?.frozenContract?.rawContractJson, binding.rawContractJson); db.complete();
});
test("10E6 recovery PostgreSQL cannot infer a contract pin from a bound row", async () => {
  const { binding } = frozen(); const db = new Database([read([row({ ...at("PRO"), frozenContract: binding })])]);
  await assert.rejects(new Store(db).load(MISSION, null), /recovery-contract-phase-invalid/); db.complete();
});
test("10E6 recovery PostgreSQL rejects replacement contract content under the old pin", async () => {
  const original = frozen(); const changed = frozen("Substituted contract");
  const db = new Database([read([row({ ...at("PRO"), frozenContract: changed.binding })])]);
  await assert.rejects(new Store(db).load(MISSION, original.pin), /recovery-contract-invalid/); db.complete();
});
test("10E6 recovery PostgreSQL captures the expected pin before awaited load", async () => {
  const { binding, pin } = frozen(); const mutablePin = { ...pin }; const wait = waitFor();
  const value = { ...at("PRO"), frozenContract: binding };
  const db = new Database([{ ...read([row(value)]), wait: wait.promise }]);
  const pending = new Store(db).load(MISSION, mutablePin); mutablePin.contractHash = "0".repeat(64);
  wait.resolve(); assert.deepEqual(await pending, value); db.complete();
});
test("10E6 recovery PostgreSQL CAS updates the complete snapshot after FOR UPDATE", async () => {
  const next = revised(initial(), { loopBudget: { ...initial().loopBudget, remainingTicks: 80 } });
  const db = new Database([lock(initial()), update(next)]);
  assert.deepEqual(await new Store(db).compareAndSet(MISSION, 1, next, null, null), { status: "UPDATED", checkpointVersion: 2 });
  assert.deepEqual(db.events, ["BEGIN", "COMMIT"]); assert.ok(db.calls.every((call) => call.transactional));
  assert.deepEqual(JSON.parse(db.calls[1].params[4] as string), next);
  assert.equal(db.calls[1].params[6], 1); assert.match(db.calls[1].sql, /checkpoint_version = \$7/); db.complete();
});
test("10E6 recovery PostgreSQL CAS persists an adjacent cursor without losing policy state", async () => {
  const next = revised(initial(), { cursor: cursorAt("LOOP_AFTER_EER") });
  const db = new Database([lock(initial()), update(next)]);
  assert.equal((await new Store(db).compareAndSet(MISSION, 1, next, null, null)).status, "UPDATED"); db.complete();
});
test("10E6 recovery PostgreSQL stale CAS returns only a version conflict without UPDATE", async () => {
  const current = revised(); const db = new Database([lock(current)]);
  assert.deepEqual(await new Store(db).compareAndSet(MISSION, 1, revised(), null, null),
    { status: "VERSION_CONFLICT", currentCheckpointVersion: 2 }); db.complete();
});
test("10E6 recovery PostgreSQL stale prefreeze pin does not become a new pin on conflict", async () => {
  const current = { ...at("PRO"), frozenContract: frozen().binding }; const db = new Database([lock(current)]);
  const result = await new Store(db).compareAndSet(MISSION, 1, revised(), null, null);
  assert.deepEqual(result, { status: "VERSION_CONFLICT", currentCheckpointVersion: current.checkpointVersion }); db.complete();
});
test("10E6 recovery PostgreSQL missing CAS returns NOT_FOUND without INSERT", async () => {
  const db = new Database([{ sql: /FOR UPDATE$/, rows: [] }]);
  assert.deepEqual(await new Store(db).compareAndSet(MISSION, 1, revised(), null, null), { status: "NOT_FOUND" }); db.complete();
});
test("10E6 recovery PostgreSQL CAS rejects invalid versions identities and pins before SQL", async () => {
  const db = new Database([]); const store = new Store(db);
  for (const version of [0, -1, 1.5, NaN, Infinity]) {
    await assert.rejects(store.compareAndSet(MISSION, version, revised(), null, null), /RECOVERY_EXPECTED_CHECKPOINT_VERSION_INVALID/);
  }
  await assert.rejects(store.compareAndSet(MISSION, 1, revised(initial(), { checkpointVersion: 3 }), null, null), /VERSION_NOT_NEXT/);
  await assert.rejects(store.compareAndSet(MISSION, 1, revised(initial("other")), null, null), /MISSION_ID_MISMATCH/);
  await assert.rejects(store.compareAndSet(MISSION, 1, revised(), undefined as unknown as null, null), /PIN_INVALID/);
  assert.deepEqual(db.events, []); db.complete();
});
test("10E6 recovery PostgreSQL CAS rejects locked corrupt state rather than overwriting it", async () => {
  const db = new Database([{ sql: /FOR UPDATE$/, rows: [{ ...row(), checkpoint: {} }] }]);
  await assert.rejects(new Store(db).compareAndSet(MISSION, 1, revised(), null, null), /INVALID_RECOVERY_CHECKPOINT/);
  assert.deepEqual(db.events, ["BEGIN", "ROLLBACK"]); db.complete();
});
test("10E6 recovery PostgreSQL CAS refuses budget refill ceiling changes and time regression", async () => {
  for (const next of [revised(initial(), { loopBudget: { ...initial().loopBudget, remainingTicks: 91 } }),
    revised(initial(), { loopBudget: { ...initial().loopBudget, maxTicks: 101 } }), revised(initial(), { savedAt: 999 })]) {
    const db = new Database([lock(initial())]);
    await assert.rejects(new Store(db).compareAndSet(MISSION, 1, next, null, null), /INVALID_RECOVERY_TRANSITION/);
    assert.deepEqual(db.events, ["BEGIN", "ROLLBACK"]); db.complete();
  }
});
test("10E6 recovery PostgreSQL CAS refuses a structurally valid nonadjacent cursor", async () => {
  const current = revised(); const next = revised(current, { cursor: cursorAt("PLAN") });
  const db = new Database([lock(current)]);
  await assert.rejects(new Store(db).compareAndSet(MISSION, 2, next, null, null), /recovery-cursor-transition-invalid/); db.complete();
});
test("10E6 recovery PostgreSQL CAS writes gate failure history and lifetime counter together", async () => {
  const current = at("LOOP_AFTER_EER");
  const next = revised(current, { failureCount: 1, gateStates: current.gateStates.map((state, index) =>
    index === 0 ? { ...state, livelockCounter: 1 } : state) });
  const db = new Database([lock(current), update(next)]);
  assert.equal((await new Store(db).compareAndSet(MISSION, current.checkpointVersion, next, null, null)).status, "UPDATED"); db.complete();
});
test("10E6 recovery PostgreSQL CAS refuses gate threshold mutation", async () => {
  const next = revised(initial(), { gateStates: initial().gateStates.map((state) => ({ ...state, maxLivelockThreshold: 9 })) });
  const db = new Database([lock(initial())]);
  await assert.rejects(new Store(db).compareAndSet(MISSION, 1, next, null, null), /recovery-gate-threshold-mutated/); db.complete();
});
test("10E6 recovery PostgreSQL CAS binds the supplied contract only at the canonical boundary", async () => {
  const { binding, pin } = frozen(); const current = at("LOOP_AFTER_PLAN_TEST");
  const next = revised(current, { cursor: cursorAt("PRO"), frozenContract: binding });
  const db = new Database([lock(current), update(next)]);
  assert.equal((await new Store(db).compareAndSet(MISSION, current.checkpointVersion, next, null, pin)).status, "UPDATED"); db.complete();
});
test("10E6 recovery PostgreSQL CAS rejects replacing a bound contract even with a second valid pin", async () => {
  const first = frozen(); const second = frozen("Replacement");
  const current = { ...at("PRO"), frozenContract: first.binding };
  const next = revised(current, { frozenContract: second.binding }); const db = new Database([lock(current)]);
  await assert.rejects(new Store(db).compareAndSet(MISSION, current.checkpointVersion, next, first.pin, second.pin), /recovery-contract-mutated/); db.complete();
});
test("10E6 recovery PostgreSQL CAS requires the correct independently supplied current pin", async () => {
  const { binding, pin } = frozen(); const current = { ...at("PRO"), frozenContract: binding };
  const db = new Database([lock(current)]);
  await assert.rejects(new Store(db).compareAndSet(MISSION, current.checkpointVersion, revised(current), null, pin), /recovery-contract-phase-invalid/); db.complete();
});
test("10E6 recovery PostgreSQL CAS checks the full write receipt not only version numbers", async () => {
  const next = revised(); const changed = revised(initial(), { loopBudget: { ...initial().loopBudget, remainingTicks: 89 } });
  const db = new Database([lock(initial()), update(changed)]);
  await assert.rejects(new Store(db).compareAndSet(MISSION, 1, next, null, null), /WRITE_RECEIPT_MISMATCH/);
  assert.deepEqual(db.events, ["BEGIN", "ROLLBACK"]); db.complete();
});
test("10E6 recovery PostgreSQL CAS rejects missing multiple and mismatched receipts", async () => {
  for (const rows of [[], [row(revised()), row(revised())], [{ ...row(revised()), checkpoint_version: "999" }]]) {
    const db = new Database([lock(initial()), { sql: /^UPDATE /, rows }]);
    await assert.rejects(new Store(db).compareAndSet(MISSION, 1, revised(), null, null), /PG_RECOVERY_/);
    assert.deepEqual(db.events, ["BEGIN", "ROLLBACK"]); db.complete();
  }
});
test("10E6 recovery PostgreSQL database exceptions are never mapped to absence or success", async () => {
  const error = new Error("offline");
  const loadDb = new Database([{ ...read([]), error }]); await assert.rejects(new Store(loadDb).load(MISSION, null), /offline/);
  const createDb = new Database([{ sql: /^INSERT INTO /, error }]); await assert.rejects(new Store(createDb).create(initial()), /offline/);
  const casDb = new Database([lock(initial()), { sql: /^UPDATE /, error }]);
  await assert.rejects(new Store(casDb).compareAndSet(MISSION, 1, revised(), null, null), /offline/);
  assert.deepEqual(casDb.events, ["BEGIN", "ROLLBACK"]); loadDb.complete(); createDb.complete(); casDb.complete();
});
test("10E6 recovery PostgreSQL CAS snapshots candidate and next pin before lock await", async () => {
  const { binding, pin } = frozen(); const mutablePin = { ...pin }; const wait = waitFor();
  const current = at("LOOP_AFTER_PLAN_TEST"); const next = revised(current, { cursor: cursorAt("PRO"), frozenContract: binding });
  const mutable = structuredClone(next); const db = new Database([{ ...lock(current), wait: wait.promise }, update(next)]);
  const pending = new Store(db).compareAndSet(MISSION, current.checkpointVersion, mutable, null, mutablePin);
  mutablePin.contractHash = "0".repeat(64); (mutable.loopBudget as { remainingTicks: number }).remainingTicks = 0;
  wait.resolve(); assert.equal((await pending).status, "UPDATED");
  assert.deepEqual(JSON.parse(db.calls[1].params[4] as string), next); db.complete();
});
test("10E6 recovery PostgreSQL checkpoint and pin accessors are refused without execution", async () => {
  let calls = 0; const value = initial(); const pin = { ...frozen().pin };
  Object.defineProperty(value, "cursor", { enumerable: true, get() { calls++; return createCanonicalRuntimeCursor(MISSION); } });
  Object.defineProperty(pin, "contractHash", { enumerable: true, get() { calls++; return "0".repeat(64); } });
  const db = new Database([]); const store = new Store(db);
  await assert.rejects(store.create(value), /INVALID_RECOVERY_CHECKPOINT/);
  await assert.rejects(store.load(MISSION, pin), /PIN_INVALID/); assert.equal(calls, 0); db.complete();
});
test("10E6 recovery migration 4 is a separate ledger step for payload v2", () => {
  assert.equal(VERSION, 4); assert.equal(NAME, "v2-canonical-runtime-recovery-checkpoint-v2");
});
test("10E6 recovery migration uses the family lock first and validates exact ordered prerequisites", async () => {
  const db = new Database([...migrationPrefix(), ...insertion()]); assert.equal(await migrate(db), "APPLIED");
  assert.deepEqual(db.calls[0].params, [731902, 1]); assert.deepEqual(db.calls[2].params, [1, 2, 3, 4]);
  assert.equal(db.calls[3].sql, DDL); assert.deepEqual(db.calls[4].params, [4, NAME]);
  assert.ok(db.calls.every((call) => call.transactional)); assert.deepEqual(db.events, ["BEGIN", "COMMIT"]); db.complete();
});
test("10E6 recovery migration exact existing receipts are idempotent without recreating the table", async () => {
  const db = new Database(migrationPrefix([...oldReceipts, { version: "4", name: NAME }]));
  assert.equal(await migrate(db), "ALREADY_APPLIED"); db.complete();
});
for (const missing of [1, 2, 3]) test(`10E6 recovery migration refuses missing prerequisite ${missing} even with v4 receipt`, async () => {
  const rows = [...oldReceipts.filter((row) => row.version !== String(missing)), { version: "4", name: NAME }];
  const db = new Database(migrationPrefix(rows));
  await assert.rejects(migrate(db), new RegExp(`PREREQUISITE_MISSING:${missing}`));
  assert.deepEqual(db.events, ["BEGIN", "ROLLBACK"]); db.complete();
});
for (const version of [1, 2, 3, 4]) test(`10E6 recovery migration refuses mismatched ledger name at version ${version}`, async () => {
  const rows = [...oldReceipts, { version: "4", name: NAME }].map((row) =>
    row.version === String(version) ? { ...row, name: "not-the-approved-name" } : row);
  const db = new Database(migrationPrefix(rows)); await assert.rejects(migrate(db), new RegExp(`NAME_CONFLICT:${version}`)); db.complete();
});
test("10E6 recovery migration rejects duplicate unexpected and malformed receipts", async () => {
  for (const [rows, expected] of [
    [[...oldReceipts, oldReceipts[0]], /DUPLICATE_VERSION/],
    [[...oldReceipts, { version: "5", name: "unexpected" }], /UNEXPECTED_VERSION/],
    [[{ version: "NaN", name: "bad" }], /RECEIPT_INVALID/],
    [[{ version: "1", name: null }], /RECEIPT_INVALID/],
  ] as const) {
    const db = new Database(migrationPrefix(rows)); await assert.rejects(migrate(db), expected); db.complete();
  }
});
test("10E6 recovery migration receipt getters are rejected without invocation", async () => {
  let calls = 0; const value = { version: "1", name: oldReceipts[0].name };
  Object.defineProperty(value, "name", { enumerable: true, get() { calls++; return oldReceipts[0].name; } });
  const db = new Database(migrationPrefix([value])); await assert.rejects(migrate(db), /RECEIPT_INVALID/);
  assert.equal(calls, 0); db.complete();
});
test("10E6 recovery migration rejects missing duplicate or mismatching insert receipts", async () => {
  for (const rows of [[], [{ version: "4", name: NAME }, { version: "4", name: NAME }],
    [{ version: "3", name: NAME }], [{ version: "4", name: "wrong" }]]) {
    const db = new Database([...migrationPrefix(), ...insertion(rows)]);
    await assert.rejects(migrate(db), /PG_RECOVERY_MIGRATION_INSERT_/);
    assert.deepEqual(db.events, ["BEGIN", "ROLLBACK"]); db.complete();
  }
});
test("10E6 recovery migration propagates unrecorded table conflict without writing a receipt", async () => {
  const db = new Database([...migrationPrefix(), { sql: /^CREATE TABLE namla_v2_canonical_runtime_recovery_checkpoints/,
    error: new Error("duplicate_table") }]);
  await assert.rejects(migrate(db), /duplicate_table/); assert.deepEqual(db.events, ["BEGIN", "ROLLBACK"]); db.complete();
});
test("10E6 recovery migration does not proceed after advisory lock failure", async () => {
  const db = new Database([{ sql: /pg_advisory_xact_lock/, error: new Error("lock_timeout") }]);
  await assert.rejects(migrate(db), /lock_timeout/); db.complete();
});

test("10E6 recovery PostgreSQL refuses non-lossless JSON before opening a transaction", async () => {
  const value = { ...initial(), failureCount: -0 }; const db = new Database([]);
  await assert.rejects(new Store(db).create(value), /PG_RECOVERY_CHECKPOINT_NOT_LOSSLESS/);
  assert.deepEqual(db.events, []); db.complete();
});
test("10E6 recovery session integrates create debit and fresh resume through the PostgreSQL adapter", async () => {
  const next = revised(initial(), { loopBudget: { ...initial().loopBudget, remainingTicks: 75 } });
  const db = new Database([{ sql: /^INSERT INTO /, rows: [row()] }, lock(initial()), update(next), read([row(next)])]);
  const store = new Store(db); const writer = new Session(store, MISSION);
  assert.equal((await writer.createInitial(initial())).ok, true);
  assert.equal((await writer.advance(next, null)).ok, true);
  const restarted = new Session(store, MISSION); const result = await restarted.resume(null);
  assert.ok(result.ok); assert.deepEqual(result.checkpoint, next); db.complete();
});
test("10E6 recovery session remains failed closed after PostgreSQL CAS conflict", async () => {
  const db = new Database([read([row()]), lock(revised())]);
  const session = new Session(new Store(db), MISSION);
  assert.equal((await session.resume(null)).ok, true);
  const result = await session.advance(revised(), null); assert.equal(result.ok, false);
  if (result.ok) assert.fail("Expected conflict");
  assert.equal(result.reasonCode, "checkpoint-version-conflict");
  assert.equal(session.isFailedClosed(), true);
  assert.equal((await session.resume(null)).ok, false); db.complete();
});
