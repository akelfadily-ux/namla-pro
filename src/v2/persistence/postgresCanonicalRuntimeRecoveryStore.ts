import { isDeepStrictEqual } from "node:util";
import type { CanonicalFrozenPlanContractIdentity } from "../protocol/canonicalFrozenPlanContract";
import {
  V2_CANONICAL_RUNTIME_RECOVERY_CHECKPOINT_SCHEMA,
  validateCanonicalRuntimeRecoveryTransition,
  type CanonicalRuntimeRecoveryCheckpoint,
} from "./canonicalRuntimeRecoveryCheckpoint";
import {
  isCanonicalRuntimeRecoveryMissionId, isInitialCanonicalRuntimeRecoveryCheckpoint,
  readCanonicalRuntimeRecoveryCandidate, snapshotCanonicalRuntimeRecoveryPin,
  type CanonicalRuntimeRecoveryCasResult, type CanonicalRuntimeRecoveryCreateResult,
  type CanonicalRuntimeRecoveryStore,
} from "./canonicalRuntimeRecoveryStore";
import type { PostgresCheckpointDatabase } from "./postgresMissionCheckpointStore";
import { V2_POSTGRES_CANONICAL_RUNTIME_RECOVERY_TABLE as TABLE } from "./postgresCanonicalRuntimeRecoverySchema";

const COLUMNS = "mission_id, schema_version, checkpoint_version, cursor_step_version, checkpoint, saved_at";
const ROW_FIELDS = ["mission_id", "schema_version", "checkpoint_version", "cursor_step_version", "checkpoint", "saved_at"] as const;

function assertMission(value: unknown): asserts value is string {
  if (!isCanonicalRuntimeRecoveryMissionId(value)) throw new Error("RECOVERY_MISSION_ID_INVALID");
}
function snapshotPin(value: unknown, missionId: string): CanonicalFrozenPlanContractIdentity | null {
  const captured = snapshotCanonicalRuntimeRecoveryPin(value);
  if (!captured.ok) throw new Error("RECOVERY_EXPECTED_CONTRACT_PIN_INVALID");
  if (captured.pin !== null && captured.pin.missionId !== missionId) {
    throw new Error("RECOVERY_EXPECTED_CONTRACT_PIN_MISSION_MISMATCH");
  }
  return captured.pin;
}
function candidate(value: unknown, pin: CanonicalFrozenPlanContractIdentity | null) {
  const checked = readCanonicalRuntimeRecoveryCandidate(value, pin);
  if (!checked.ok) throw new Error(`INVALID_RECOVERY_CHECKPOINT:${checked.reasonCode}`);
  return checked.checkpoint;
}
function integer(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value :
    typeof value === "string" && /^[1-9][0-9]*$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`PG_RECOVERY_INVALID_INTEGER:${field}`);
  }
  return parsed;
}
function rowFields(value: unknown): Record<typeof ROW_FIELDS[number], unknown> {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error();
    if (Reflect.ownKeys(value).length !== ROW_FIELDS.length) throw new Error();
    const captured = {} as Record<typeof ROW_FIELDS[number], unknown>;
    for (const field of ROW_FIELDS) {
      const descriptor = Object.getOwnPropertyDescriptor(value, field);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new Error();
      captured[field] = descriptor.value;
    }
    return captured;
  } catch { throw new Error("PG_RECOVERY_INVALID_ROW"); }
}
function metadata(value: unknown, missionId: string) {
  const row = rowFields(value);
  if (row.mission_id !== missionId) throw new Error("PG_RECOVERY_ROW_MISSION_MISMATCH");
  if (row.schema_version !== V2_CANONICAL_RUNTIME_RECOVERY_CHECKPOINT_SCHEMA) {
    throw new Error("PG_RECOVERY_ROW_SCHEMA_MISMATCH");
  }
  const checkpointVersion = integer(row.checkpoint_version, "checkpoint_version");
  const cursorStepVersion = integer(row.cursor_step_version, "cursor_step_version");
  const savedAt = integer(row.saved_at, "saved_at");
  if (checkpointVersion < cursorStepVersion) throw new Error("PG_RECOVERY_ROW_VERSION_BEFORE_CURSOR");
  return { checkpointVersion, cursorStepVersion, savedAt, raw: row.checkpoint };
}
function decode(
  data: ReturnType<typeof metadata>, missionId: string,
  expectedContract: CanonicalFrozenPlanContractIdentity | null,
): CanonicalRuntimeRecoveryCheckpoint {
  let value: unknown = data.raw;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { throw new Error("PG_RECOVERY_CORRUPT_JSON"); }
  }
  const restored = candidate(value, expectedContract);
  if (restored.missionId !== missionId) throw new Error("PG_RECOVERY_JSON_MISSION_MISMATCH");
  if (restored.checkpointVersion !== data.checkpointVersion ||
    restored.cursor.stepVersion !== data.cursorStepVersion || restored.savedAt !== data.savedAt) {
    throw new Error("PG_RECOVERY_ROW_JSON_MISMATCH");
  }
  return restored;
}
function writeValues(checkpoint: CanonicalRuntimeRecoveryCheckpoint): readonly unknown[] {
  const encoded = JSON.stringify(checkpoint);
  // Do not silently persist a different JS data value (for example -0 as 0).
  // All objects here were already detached by the shared strict reader.
  if (!isDeepStrictEqual(JSON.parse(encoded), checkpoint)) {
    throw new Error("PG_RECOVERY_CHECKPOINT_NOT_LOSSLESS");
  }
  return [checkpoint.missionId, checkpoint.schemaVersion, checkpoint.checkpointVersion,
    checkpoint.cursor.stepVersion, encoded, checkpoint.savedAt];
}
function verifyReceipt(
  rows: readonly unknown[], checkpoint: CanonicalRuntimeRecoveryCheckpoint,
  pin: CanonicalFrozenPlanContractIdentity | null,
): void {
  if (rows.length !== 1) throw new Error("PG_RECOVERY_WRITE_RECEIPT_CARDINALITY");
  const written = decode(metadata(rows[0], checkpoint.missionId), checkpoint.missionId, pin);
  if (!isDeepStrictEqual(written, checkpoint)) throw new Error("PG_RECOVERY_WRITE_RECEIPT_MISMATCH");
}

/**
 * One v2 JSON snapshot per row; all updates use the existing transaction adapter.
 * A transaction-scoped row lock protects version comparison, full transition
 * validation and whole-snapshot update. Full RETURNING receipts are checked
 * before the callback can commit. No execution lease or contract pin is invented.
 *
 * On a stale CAS, only checked physical revision metadata is returned, NOT a
 * validated recovery snapshot. The stale pin may predate the freeze boundary;
 * never derive a new pin from that row. Explicit resume needs the current pin.
 * SQL CHECKs are defense in depth, not a substitute for these validators.
 */
export class PostgresCanonicalRuntimeRecoveryStore implements CanonicalRuntimeRecoveryStore {
  public constructor(private readonly database: PostgresCheckpointDatabase) {}

  public async create(checkpoint: CanonicalRuntimeRecoveryCheckpoint): Promise<CanonicalRuntimeRecoveryCreateResult> {
    const next = candidate(checkpoint, null);
    if (!isInitialCanonicalRuntimeRecoveryCheckpoint(next)) throw new Error("RECOVERY_INITIAL_CHECKPOINT_REQUIRED");
    const values = writeValues(next);
    return this.database.transaction(async (client) => {
      const result = await client.query<unknown>(`
INSERT INTO ${TABLE} (${COLUMNS})
VALUES ($1, $2, $3, $4, $5::jsonb, $6)
ON CONFLICT (mission_id) DO NOTHING
RETURNING ${COLUMNS}`.trim(), values);
      if (result.rows.length === 0) return "ALREADY_EXISTS";
      verifyReceipt(result.rows, next, null);
      return "CREATED";
    });
  }

  public async load(
    missionId: string, expectedContract: CanonicalFrozenPlanContractIdentity | null,
  ): Promise<CanonicalRuntimeRecoveryCheckpoint | null> {
    assertMission(missionId);
    const pin = snapshotPin(expectedContract, missionId);
    const result = await this.database.query<unknown>(
      `SELECT ${COLUMNS} FROM ${TABLE} WHERE mission_id = $1`, [missionId]);
    if (result.rows.length === 0) return null;
    if (result.rows.length !== 1) throw new Error("PG_RECOVERY_LOAD_CARDINALITY");
    return structuredClone(decode(metadata(result.rows[0], missionId), missionId, pin));
  }

  public async compareAndSet(
    missionId: string, expectedCheckpointVersion: number,
    checkpoint: CanonicalRuntimeRecoveryCheckpoint,
    currentExpectedContract: CanonicalFrozenPlanContractIdentity | null,
    nextExpectedContract: CanonicalFrozenPlanContractIdentity | null,
  ): Promise<CanonicalRuntimeRecoveryCasResult> {
    assertMission(missionId);
    if (!Number.isSafeInteger(expectedCheckpointVersion) || expectedCheckpointVersion < 1) {
      throw new Error("RECOVERY_EXPECTED_CHECKPOINT_VERSION_INVALID");
    }
    // All caller-controlled data/pins are detached before the first async work.
    const beforePin = snapshotPin(currentExpectedContract, missionId);
    const afterPin = snapshotPin(nextExpectedContract, missionId);
    const next = candidate(checkpoint, afterPin);
    if (next.missionId !== missionId) throw new Error("RECOVERY_MISSION_ID_MISMATCH");
    if (next.checkpointVersion !== expectedCheckpointVersion + 1) {
      throw new Error("RECOVERY_CHECKPOINT_VERSION_NOT_NEXT");
    }
    const values = writeValues(next);
    return this.database.transaction(async (client) => {
      const locked = await client.query<unknown>(
        `SELECT ${COLUMNS} FROM ${TABLE} WHERE mission_id = $1 FOR UPDATE`, [missionId]);
      if (locked.rows.length === 0) return { status: "NOT_FOUND" as const };
      if (locked.rows.length !== 1) throw new Error("PG_RECOVERY_LOCK_CARDINALITY");
      const currentMetadata = metadata(locked.rows[0], missionId);
      if (currentMetadata.checkpointVersion !== expectedCheckpointVersion) {
        return { status: "VERSION_CONFLICT" as const, currentCheckpointVersion: currentMetadata.checkpointVersion };
      }
      const current = decode(currentMetadata, missionId, beforePin);
      const transition = validateCanonicalRuntimeRecoveryTransition(current, next, beforePin, afterPin);
      if (!transition.ok) throw new Error(`INVALID_RECOVERY_TRANSITION:${transition.reasonCode}`);
      const updated = await client.query<unknown>(`
UPDATE ${TABLE}
SET schema_version = $2, checkpoint_version = $3, cursor_step_version = $4,
    checkpoint = $5::jsonb, saved_at = $6, updated_at = NOW()
WHERE mission_id = $1 AND checkpoint_version = $7
RETURNING ${COLUMNS}`.trim(), [...values, expectedCheckpointVersion]);
      verifyReceipt(updated.rows, next, afterPin);
      return { status: "UPDATED" as const, checkpointVersion: next.checkpointVersion };
    });
  }
}
