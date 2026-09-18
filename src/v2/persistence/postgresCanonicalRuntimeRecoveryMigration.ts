import type { PostgresCheckpointDatabase } from "./postgresMissionCheckpointStore";
import { V2_POSTGRES_MIGRATION_NAME, V2_POSTGRES_MIGRATION_VERSION } from "./postgresMissionCheckpointMigration";
import {
  V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_LOCK_KEY,
  V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_LOCK_NAMESPACE,
  V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_NAME,
  V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_VERSION,
} from "./postgresExecutionAuthorityMigration";
import { V2_POSTGRES_CANONICAL_RUNTIME_MIGRATION_NAME,
  V2_POSTGRES_CANONICAL_RUNTIME_MIGRATION_VERSION } from "./postgresCanonicalRuntimeCursorMigration";
import { V2_POSTGRES_CANONICAL_RUNTIME_RECOVERY_SCHEMA_SQL } from "./postgresCanonicalRuntimeRecoverySchema";

// Ledger version and payload schema version are different version domains.
export const V2_POSTGRES_CANONICAL_RUNTIME_RECOVERY_MIGRATION_VERSION = 4 as const;
export const V2_POSTGRES_CANONICAL_RUNTIME_RECOVERY_MIGRATION_NAME =
  "v2-canonical-runtime-recovery-checkpoint-v2" as const;
export type V2PostgresCanonicalRuntimeRecoveryMigrationResult = "APPLIED" | "ALREADY_APPLIED";
const expectedReceipts = new Map<number, string>([
  [V2_POSTGRES_MIGRATION_VERSION, V2_POSTGRES_MIGRATION_NAME],
  [V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_VERSION, V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_NAME],
  [V2_POSTGRES_CANONICAL_RUNTIME_MIGRATION_VERSION, V2_POSTGRES_CANONICAL_RUNTIME_MIGRATION_NAME],
  [V2_POSTGRES_CANONICAL_RUNTIME_RECOVERY_MIGRATION_VERSION, V2_POSTGRES_CANONICAL_RUNTIME_RECOVERY_MIGRATION_NAME],
]);
function receipt(value: unknown): { version: number; name: string } {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error();
    if (Reflect.ownKeys(value).length !== 2) throw new Error();
    const version = Object.getOwnPropertyDescriptor(value, "version");
    const name = Object.getOwnPropertyDescriptor(value, "name");
    if (!version || !("value" in version) || !version.enumerable ||
      !name || !("value" in name) || !name.enumerable || typeof name.value !== "string") throw new Error();
    const raw: unknown = version.value;
    const parsed = typeof raw === "number" ? raw :
      typeof raw === "string" && /^[1-9][0-9]*$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(parsed) || parsed < 1 || name.value.trim().length === 0) throw new Error();
    return { version: parsed, name: name.value };
  } catch { throw new Error("PG_RECOVERY_MIGRATION_RECEIPT_INVALID"); }
}
/**
 * Explicit opt-in migration; importing this module does not connect or migrate.
 * Same transaction-scoped V2 advisory lock and ledger as migrations 1, 2 and 3.
 * Does not upgrade/copy cursor-only records or run prerequisite migrations.
 * ALREADY_APPLIED verifies ledger identities, not absence of later schema drift.
 */
export async function migrateV2CanonicalRuntimeRecoverySchema(
  database: PostgresCheckpointDatabase,
): Promise<V2PostgresCanonicalRuntimeRecoveryMigrationResult> {
  return database.transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [
      V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_LOCK_NAMESPACE,
      V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_LOCK_KEY,
    ]);
    await client.query(`CREATE TABLE IF NOT EXISTS namla_v2_schema_migrations (
      version BIGINT PRIMARY KEY CHECK (version >= 1),
      name TEXT NOT NULL CHECK (length(btrim(name)) > 0),
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    const existing = await client.query<unknown>(`
SELECT version, name FROM namla_v2_schema_migrations
WHERE version IN ($1, $2, $3, $4) ORDER BY version FOR UPDATE`.trim(), [...expectedReceipts.keys()]);
    const recorded = new Map<number, string>();
    for (const raw of existing.rows) {
      const row = receipt(raw);
      if (!expectedReceipts.has(row.version)) throw new Error("PG_RECOVERY_MIGRATION_UNEXPECTED_VERSION");
      if (recorded.has(row.version)) throw new Error("PG_RECOVERY_MIGRATION_DUPLICATE_VERSION");
      if (expectedReceipts.get(row.version) !== row.name) {
        throw new Error(`PG_RECOVERY_MIGRATION_NAME_CONFLICT:${row.version}`);
      }
      recorded.set(row.version, row.name);
    }
    for (const version of expectedReceipts.keys()) {
      if (version !== V2_POSTGRES_CANONICAL_RUNTIME_RECOVERY_MIGRATION_VERSION && !recorded.has(version)) {
        throw new Error(`PG_RECOVERY_MIGRATION_PREREQUISITE_MISSING:${version}`);
      }
    }
    if (recorded.has(V2_POSTGRES_CANONICAL_RUNTIME_RECOVERY_MIGRATION_VERSION)) return "ALREADY_APPLIED";
    await client.query(V2_POSTGRES_CANONICAL_RUNTIME_RECOVERY_SCHEMA_SQL);
    const inserted = await client.query<unknown>(`
INSERT INTO namla_v2_schema_migrations (version, name)
VALUES ($1, $2) RETURNING version, name`.trim(), [
      V2_POSTGRES_CANONICAL_RUNTIME_RECOVERY_MIGRATION_VERSION,
      V2_POSTGRES_CANONICAL_RUNTIME_RECOVERY_MIGRATION_NAME,
    ]);
    if (inserted.rows.length !== 1) throw new Error("PG_RECOVERY_MIGRATION_INSERT_CARDINALITY");
    const written = receipt(inserted.rows[0]);
    if (written.version !== V2_POSTGRES_CANONICAL_RUNTIME_RECOVERY_MIGRATION_VERSION ||
      written.name !== V2_POSTGRES_CANONICAL_RUNTIME_RECOVERY_MIGRATION_NAME) {
      throw new Error("PG_RECOVERY_MIGRATION_INSERT_MISMATCH");
    }
    return "APPLIED";
  });
}
