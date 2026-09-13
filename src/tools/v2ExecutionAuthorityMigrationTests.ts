import test from "node:test";
import assert from "node:assert/strict";

import {
  PostgresCheckpointClient,
  PostgresCheckpointDatabase,
  PostgresCheckpointQueryResult,
} from "../v2/persistence/postgresMissionCheckpointStore";

import {
  V2_POSTGRES_MIGRATION_NAME,
  V2_POSTGRES_MIGRATION_VERSION,
} from "../v2/persistence/postgresMissionCheckpointMigration";

import {
  V2_POSTGRES_EXECUTION_AUTHORITY_SCHEMA_SQL,
} from "../v2/persistence/postgresExecutionAuthoritySchema";

import {
  V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_LOCK_KEY,
  V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_LOCK_NAMESPACE,
  V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_NAME,
  V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_VERSION,
  migrateV2ExecutionAuthoritySchema,
} from "../v2/persistence/postgresExecutionAuthorityMigration";

interface Step {
  readonly contains: string;
  readonly rows: readonly unknown[];
}

class ScriptedMigrationDatabase
  implements PostgresCheckpointDatabase
{
  public transactionCount = 0;
  public readonly calls: string[] = [];
  private index = 0;

  public constructor(
    private readonly steps:
      readonly Step[],
  ) {}

  public async query<T = unknown>(
    sql: string,
  ): Promise<PostgresCheckpointQueryResult<T>> {
    throw new Error(
      `Unexpected direct query: ${sql}`,
    );
  }

  public async transaction<T>(
    work: (
      client: PostgresCheckpointClient,
    ) => Promise<T>,
  ): Promise<T> {
    this.transactionCount += 1;

    const client:
      PostgresCheckpointClient = {
        query:
          async <R = unknown>(
            sql: string,
          ): Promise<
            PostgresCheckpointQueryResult<R>
          > => {
            const step =
              this.steps[this.index];

            assert.ok(
              step,
              `Unexpected SQL: ${sql}`,
            );

            assert.ok(
              sql.includes(step.contains),
              `Expected SQL containing ${step.contains}`,
            );

            this.index += 1;
            this.calls.push(sql);

            return {
              rows:
                step.rows as readonly R[],
              rowCount:
                step.rows.length,
            };
          },
      };

    return work(client);
  }

  public assertComplete(): void {
    assert.equal(
      this.index,
      this.steps.length,
    );
  }
}

function v1Receipt() {
  return {
    version:
      String(V2_POSTGRES_MIGRATION_VERSION),
    name:
      V2_POSTGRES_MIGRATION_NAME,
  };
}

function v2Receipt() {
  return {
    version:
      String(
        V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_VERSION,
      ),
    name:
      V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_NAME,
  };
}

test(
  "R1B-PG1 migration shares canonical V2 migration lock",
  () => {
    assert.equal(
      V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_LOCK_NAMESPACE,
      731902,
    );
    assert.equal(
      V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_LOCK_KEY,
      1,
    );
  },
);

test(
  "R1B-PG1 applies after checkpoint migration receipt",
  async () => {
    const db =
      new ScriptedMigrationDatabase([
        {
          contains:
            "pg_advisory_xact_lock",
          rows: [],
        },
        {
          contains:
            "CREATE TABLE IF NOT EXISTS namla_v2_schema_migrations",
          rows: [],
        },
        {
          contains:
            "WHERE version IN",
          rows: [v1Receipt()],
        },
        {
          contains:
            "CREATE TABLE namla_v2_task_execution_leases",
          rows: [],
        },
        {
          contains:
            "INSERT INTO namla_v2_schema_migrations",
          rows: [v2Receipt()],
        },
      ]);

    const result =
      await migrateV2ExecutionAuthoritySchema(
        db,
      );

    assert.equal(result, "APPLIED");
    assert.equal(db.transactionCount, 1);
    db.assertComplete();
  },
);

test(
  "R1B-PG1 is idempotent with exact receipts",
  async () => {
    const db =
      new ScriptedMigrationDatabase([
        {
          contains:
            "pg_advisory_xact_lock",
          rows: [],
        },
        {
          contains:
            "CREATE TABLE IF NOT EXISTS namla_v2_schema_migrations",
          rows: [],
        },
        {
          contains:
            "WHERE version IN",
          rows: [v1Receipt(), v2Receipt()],
        },
      ]);

    const result =
      await migrateV2ExecutionAuthoritySchema(
        db,
      );

    assert.equal(
      result,
      "ALREADY_APPLIED",
    );

    db.assertComplete();
  },
);

test(
  "R1B-PG1 fails closed when prerequisite is absent",
  async () => {
    const db =
      new ScriptedMigrationDatabase([
        {
          contains:
            "pg_advisory_xact_lock",
          rows: [],
        },
        {
          contains:
            "CREATE TABLE IF NOT EXISTS namla_v2_schema_migrations",
          rows: [],
        },
        {
          contains:
            "WHERE version IN",
          rows: [],
        },
      ]);

    await assert.rejects(
      migrateV2ExecutionAuthoritySchema(db),
      /POSTGRES_EXECUTION_AUTHORITY_REQUIRES_CHECKPOINT_MIGRATION/,
    );

    db.assertComplete();
  },
);

test(
  "R1B-PG1 fails closed on prerequisite name conflict",
  async () => {
    const db =
      new ScriptedMigrationDatabase([
        {
          contains:
            "pg_advisory_xact_lock",
          rows: [],
        },
        {
          contains:
            "CREATE TABLE IF NOT EXISTS namla_v2_schema_migrations",
          rows: [],
        },
        {
          contains:
            "WHERE version IN",
          rows: [
            {
              version:
                String(
                  V2_POSTGRES_MIGRATION_VERSION,
                ),
              name:
                "wrong-v1-name",
            },
          ],
        },
      ]);

    await assert.rejects(
      migrateV2ExecutionAuthoritySchema(db),
      /POSTGRES_EXECUTION_AUTHORITY_PREREQUISITE_NAME_CONFLICT/,
    );

    db.assertComplete();
  },
);

test(
  "R1B-PG1 fails closed on V2 name conflict",
  async () => {
    const db =
      new ScriptedMigrationDatabase([
        {
          contains:
            "pg_advisory_xact_lock",
          rows: [],
        },
        {
          contains:
            "CREATE TABLE IF NOT EXISTS namla_v2_schema_migrations",
          rows: [],
        },
        {
          contains:
            "WHERE version IN",
          rows: [
            v1Receipt(),
            {
              version:
                String(
                  V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_VERSION,
                ),
              name:
                "wrong-v2-name",
            },
          ],
        },
      ]);

    await assert.rejects(
      migrateV2ExecutionAuthoritySchema(db),
      /POSTGRES_EXECUTION_AUTHORITY_MIGRATION_NAME_CONFLICT/,
    );

    db.assertComplete();
  },
);

test(
  "R1B-PG1 rejects corrupt migration versions",
  async () => {
    const db =
      new ScriptedMigrationDatabase([
        {
          contains:
            "pg_advisory_xact_lock",
          rows: [],
        },
        {
          contains:
            "CREATE TABLE IF NOT EXISTS namla_v2_schema_migrations",
          rows: [],
        },
        {
          contains:
            "WHERE version IN",
          rows: [
            {
              version: "invalid",
              name:
                V2_POSTGRES_MIGRATION_NAME,
            },
          ],
        },
      ]);

    await assert.rejects(
      migrateV2ExecutionAuthoritySchema(db),
      /POSTGRES_EXECUTION_AUTHORITY_INVALID_MIGRATION_VERSION/,
    );

    db.assertComplete();
  },
);

test(
  "R1B-PG1 rejects invalid insert receipt",
  async () => {
    const db =
      new ScriptedMigrationDatabase([
        {
          contains:
            "pg_advisory_xact_lock",
          rows: [],
        },
        {
          contains:
            "CREATE TABLE IF NOT EXISTS namla_v2_schema_migrations",
          rows: [],
        },
        {
          contains:
            "WHERE version IN",
          rows: [v1Receipt()],
        },
        {
          contains:
            "CREATE TABLE namla_v2_task_execution_leases",
          rows: [],
        },
        {
          contains:
            "INSERT INTO namla_v2_schema_migrations",
          rows: [
            {
              version:
                String(
                  V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_VERSION,
                ),
              name:
                "wrong-receipt",
            },
          ],
        },
      ]);

    await assert.rejects(
      migrateV2ExecutionAuthoritySchema(db),
      /POSTGRES_EXECUTION_AUTHORITY_MIGRATION_RECEIPT_MISMATCH/,
    );

    db.assertComplete();
  },
);

test(
  "R1B-PG1 schema defines hardened NAMLA-native tables",
  () => {
    assert.match(
      V2_POSTGRES_EXECUTION_AUTHORITY_SCHEMA_SQL,
      /CREATE TABLE namla_v2_task_execution_leases/,
    );

    assert.match(
      V2_POSTGRES_EXECUTION_AUTHORITY_SCHEMA_SQL,
      /CREATE TABLE namla_v2_operation_claims/,
    );

    assert.match(
      V2_POSTGRES_EXECUTION_AUTHORITY_SCHEMA_SQL,
      /PRIMARY KEY \(mission_id, task_id\)/,
    );

    assert.match(
      V2_POSTGRES_EXECUTION_AUTHORITY_SCHEMA_SQL,
      /PRIMARY KEY \(mission_id, operation_key\)/,
    );

    assert.match(
      V2_POSTGRES_EXECUTION_AUTHORITY_SCHEMA_SQL,
      /claim_task_lease_epoch BIGINT NOT NULL/,
    );

    assert.match(
      V2_POSTGRES_EXECUTION_AUTHORITY_SCHEMA_SQL,
      /claim_epoch BIGINT NOT NULL/,
    );

    assert.match(
      V2_POSTGRES_EXECUTION_AUTHORITY_SCHEMA_SQL,
      /\^\[0-9a-f\]\{64\}\$/,
    );

    assert.doesNotMatch(
      V2_POSTGRES_EXECUTION_AUTHORITY_SCHEMA_SQL,
      /CREATE TABLE IF NOT EXISTS namla_v2_(?:task_execution_leases|operation_claims)/,
    );
  },
);