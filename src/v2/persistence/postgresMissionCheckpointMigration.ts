import {
  PostgresCheckpointDatabase,
} from "./postgresMissionCheckpointStore";

import {
  V2_POSTGRES_MISSION_CHECKPOINT_SCHEMA_SQL,
} from "./postgresMissionCheckpointSchema";

export const V2_POSTGRES_MIGRATION_VERSION = 1 as const;

export const V2_POSTGRES_MIGRATION_NAME =
  "v2-mission-checkpoint-v1" as const;

/*
 * Transaction-scoped advisory lock dedicated to the V2 persistence
 * migration family.
 *
 * SELECT ... FOR UPDATE cannot serialize the very first migration when
 * the migration receipt row does not exist yet. Two first-time migrators
 * could both observe "no row" and race to create/insert.
 *
 * pg_advisory_xact_lock serializes that bootstrap window and is released
 * automatically by PostgreSQL on COMMIT or ROLLBACK.
 */
const V2_POSTGRES_MIGRATION_LOCK_NAMESPACE =
  731902 as const;

const V2_POSTGRES_MIGRATION_LOCK_KEY =
  1 as const;

export type V2PostgresMigrationResult =
  | "APPLIED"
  | "ALREADY_APPLIED";

interface MigrationRow {
  readonly version: unknown;
  readonly name: unknown;
}

function parseMigrationVersion(
  value: unknown,
): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" &&
          /^[0-9]+$/.test(value)
        ? Number(value)
        : Number.NaN;

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1
  ) {
    throw new Error(
      "POSTGRES_INVALID_MIGRATION_VERSION",
    );
  }

  return parsed;
}

export async function migrateV2MissionCheckpointSchema(
  database: PostgresCheckpointDatabase,
): Promise<V2PostgresMigrationResult> {
  return database.transaction(
    async (client) => {
      /*
       * Must be the first database operation inside this transaction.
       * This serializes two independent processes attempting the initial
       * migration against the same PostgreSQL database.
       */
      await client.query(
        `
SELECT pg_advisory_xact_lock($1, $2)
        `.trim(),
        [
          V2_POSTGRES_MIGRATION_LOCK_NAMESPACE,
          V2_POSTGRES_MIGRATION_LOCK_KEY,
        ],
      );

      await client.query(`
CREATE TABLE IF NOT EXISTS namla_v2_schema_migrations (
  version BIGINT PRIMARY KEY
    CHECK (version >= 1),

  name TEXT NOT NULL
    CHECK (length(btrim(name)) > 0),

  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
      `.trim());

      const existing =
        await client.query<MigrationRow>(
          `
SELECT version, name
FROM namla_v2_schema_migrations
WHERE version = $1
FOR UPDATE
          `.trim(),
          [
            V2_POSTGRES_MIGRATION_VERSION,
          ],
        );

      if (existing.rows.length > 1) {
        throw new Error(
          "POSTGRES_MIGRATION_CARDINALITY_VIOLATION",
        );
      }

      if (existing.rows.length === 1) {
        const version =
          parseMigrationVersion(
            existing.rows[0].version,
          );

        if (
          version !==
          V2_POSTGRES_MIGRATION_VERSION
        ) {
          throw new Error(
            "POSTGRES_MIGRATION_VERSION_MISMATCH",
          );
        }

        if (
          existing.rows[0].name !==
          V2_POSTGRES_MIGRATION_NAME
        ) {
          throw new Error(
            "POSTGRES_MIGRATION_NAME_CONFLICT",
          );
        }

        return "ALREADY_APPLIED";
      }

      await client.query(
        V2_POSTGRES_MISSION_CHECKPOINT_SCHEMA_SQL,
      );

      const inserted =
        await client.query<MigrationRow>(
          `
INSERT INTO namla_v2_schema_migrations (
  version,
  name
)
VALUES ($1, $2)
RETURNING version, name
          `.trim(),
          [
            V2_POSTGRES_MIGRATION_VERSION,
            V2_POSTGRES_MIGRATION_NAME,
          ],
        );

      if (inserted.rows.length !== 1) {
        throw new Error(
          "POSTGRES_MIGRATION_INSERT_FAILED",
        );
      }

      const insertedVersion =
        parseMigrationVersion(
          inserted.rows[0].version,
        );

      if (
        insertedVersion !==
          V2_POSTGRES_MIGRATION_VERSION ||
        inserted.rows[0].name !==
          V2_POSTGRES_MIGRATION_NAME
      ) {
        throw new Error(
          "POSTGRES_MIGRATION_RECEIPT_MISMATCH",
        );
      }

      return "APPLIED";
    },
  );
}