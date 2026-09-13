import {
  PostgresCheckpointDatabase,
} from "./postgresMissionCheckpointStore";

import {
  V2_POSTGRES_MIGRATION_NAME,
  V2_POSTGRES_MIGRATION_VERSION,
} from "./postgresMissionCheckpointMigration";

import {
  V2_POSTGRES_EXECUTION_AUTHORITY_SCHEMA_SQL,
} from "./postgresExecutionAuthoritySchema";

export const V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_VERSION =
  2 as const;

export const V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_NAME =
  "v2-execution-authority-v1" as const;

export const V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_LOCK_NAMESPACE =
  731902 as const;

export const V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_LOCK_KEY =
  1 as const;

export type V2PostgresExecutionAuthorityMigrationResult =
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
      "POSTGRES_EXECUTION_AUTHORITY_INVALID_MIGRATION_VERSION",
    );
  }

  return parsed;
}

function mapMigrationRows(
  rows: readonly MigrationRow[],
): Map<number, string> {
  const mapped = new Map<number, string>();

  for (const row of rows) {
    const version =
      parseMigrationVersion(row.version);

    if (
      version !== V2_POSTGRES_MIGRATION_VERSION &&
      version !==
        V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_VERSION
    ) {
      throw new Error(
        "POSTGRES_EXECUTION_AUTHORITY_UNEXPECTED_MIGRATION_VERSION",
      );
    }

    if (typeof row.name !== "string") {
      throw new Error(
        "POSTGRES_EXECUTION_AUTHORITY_INVALID_MIGRATION_NAME",
      );
    }

    if (mapped.has(version)) {
      throw new Error(
        "POSTGRES_EXECUTION_AUTHORITY_MIGRATION_CARDINALITY_VIOLATION",
      );
    }

    mapped.set(version, row.name);
  }

  return mapped;
}

export async function migrateV2ExecutionAuthoritySchema(
  database: PostgresCheckpointDatabase,
): Promise<V2PostgresExecutionAuthorityMigrationResult> {
  return database.transaction(
    async (client) => {
      await client.query(
        `
SELECT pg_advisory_xact_lock($1, $2)
        `.trim(),
        [
          V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_LOCK_NAMESPACE,
          V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_LOCK_KEY,
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
WHERE version IN ($1, $2)
ORDER BY version
FOR UPDATE
          `.trim(),
          [
            V2_POSTGRES_MIGRATION_VERSION,
            V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_VERSION,
          ],
        );

      const rows =
        mapMigrationRows(existing.rows);

      const prerequisiteName =
        rows.get(
          V2_POSTGRES_MIGRATION_VERSION,
        );

      if (prerequisiteName === undefined) {
        throw new Error(
          "POSTGRES_EXECUTION_AUTHORITY_REQUIRES_CHECKPOINT_MIGRATION",
        );
      }

      if (
        prerequisiteName !==
        V2_POSTGRES_MIGRATION_NAME
      ) {
        throw new Error(
          "POSTGRES_EXECUTION_AUTHORITY_PREREQUISITE_NAME_CONFLICT",
        );
      }

      const currentName =
        rows.get(
          V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_VERSION,
        );

      if (currentName !== undefined) {
        if (
          currentName !==
          V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_NAME
        ) {
          throw new Error(
            "POSTGRES_EXECUTION_AUTHORITY_MIGRATION_NAME_CONFLICT",
          );
        }

        return "ALREADY_APPLIED";
      }

      await client.query(
        V2_POSTGRES_EXECUTION_AUTHORITY_SCHEMA_SQL,
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
            V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_VERSION,
            V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_NAME,
          ],
        );

      if (inserted.rows.length !== 1) {
        throw new Error(
          "POSTGRES_EXECUTION_AUTHORITY_MIGRATION_INSERT_FAILED",
        );
      }

      const insertedVersion =
        parseMigrationVersion(
          inserted.rows[0].version,
        );

      if (
        insertedVersion !==
          V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_VERSION ||
        inserted.rows[0].name !==
          V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_NAME
      ) {
        throw new Error(
          "POSTGRES_EXECUTION_AUTHORITY_MIGRATION_RECEIPT_MISMATCH",
        );
      }

      return "APPLIED";
    },
  );
}