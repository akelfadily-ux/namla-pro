import test from "node:test";
import assert from "node:assert/strict";

import {
  PostgresCheckpointClient,
  PostgresCheckpointDatabase,
  PostgresCheckpointQueryResult,
} from "../v2/persistence/postgresMissionCheckpointStore";

import {
  migrateV2MissionCheckpointSchema,
  V2_POSTGRES_MIGRATION_NAME,
  V2_POSTGRES_MIGRATION_VERSION,
} from "../v2/persistence/postgresMissionCheckpointMigration";

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
              sql.includes(
                step.contains,
              ),
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

test(
  "migration creates ledger, schema, and receipt atomically",
  async () => {
    const db =
      new ScriptedMigrationDatabase([
        {
          contains:
            "CREATE TABLE IF NOT EXISTS namla_v2_schema_migrations",
          rows: [],
        },
        {
          contains:
            "FROM namla_v2_schema_migrations",
          rows: [],
        },
        {
          contains:
            "CREATE TABLE IF NOT EXISTS namla_v2_mission_checkpoints",
          rows: [],
        },
        {
          contains:
            "INSERT INTO namla_v2_schema_migrations",
          rows: [
            {
              version:
                String(
                  V2_POSTGRES_MIGRATION_VERSION,
                ),
              name:
                V2_POSTGRES_MIGRATION_NAME,
            },
          ],
        },
      ]);

    const result =
      await migrateV2MissionCheckpointSchema(
        db,
      );

    assert.equal(
      result,
      "APPLIED",
    );

    assert.equal(
      db.transactionCount,
      1,
    );

    db.assertComplete();
  },
);

test(
  "migration is idempotent when exact version is already recorded",
  async () => {
    const db =
      new ScriptedMigrationDatabase([
        {
          contains:
            "CREATE TABLE IF NOT EXISTS namla_v2_schema_migrations",
          rows: [],
        },
        {
          contains:
            "FROM namla_v2_schema_migrations",
          rows: [
            {
              version:
                String(
                  V2_POSTGRES_MIGRATION_VERSION,
                ),
              name:
                V2_POSTGRES_MIGRATION_NAME,
            },
          ],
        },
      ]);

    const result =
      await migrateV2MissionCheckpointSchema(
        db,
      );

    assert.equal(
      result,
      "ALREADY_APPLIED",
    );

    assert.equal(
      db.calls.length,
      2,
    );

    db.assertComplete();
  },
);

test(
  "migration fails closed on version-name conflict",
  async () => {
    const db =
      new ScriptedMigrationDatabase([
        {
          contains:
            "CREATE TABLE IF NOT EXISTS namla_v2_schema_migrations",
          rows: [],
        },
        {
          contains:
            "FROM namla_v2_schema_migrations",
          rows: [
            {
              version:
                String(
                  V2_POSTGRES_MIGRATION_VERSION,
                ),
              name:
                "unexpected-migration",
            },
          ],
        },
      ]);

    await assert.rejects(
      migrateV2MissionCheckpointSchema(
        db,
      ),
      /POSTGRES_MIGRATION_NAME_CONFLICT/,
    );

    db.assertComplete();
  },
);

test(
  "migration rejects corrupt recorded version",
  async () => {
    const db =
      new ScriptedMigrationDatabase([
        {
          contains:
            "CREATE TABLE IF NOT EXISTS namla_v2_schema_migrations",
          rows: [],
        },
        {
          contains:
            "FROM namla_v2_schema_migrations",
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
      migrateV2MissionCheckpointSchema(
        db,
      ),
      /POSTGRES_INVALID_MIGRATION_VERSION/,
    );

    db.assertComplete();
  },
);

test(
  "migration rejects an invalid insert receipt",
  async () => {
    const db =
      new ScriptedMigrationDatabase([
        {
          contains:
            "CREATE TABLE IF NOT EXISTS namla_v2_schema_migrations",
          rows: [],
        },
        {
          contains:
            "FROM namla_v2_schema_migrations",
          rows: [],
        },
        {
          contains:
            "CREATE TABLE IF NOT EXISTS namla_v2_mission_checkpoints",
          rows: [],
        },
        {
          contains:
            "INSERT INTO namla_v2_schema_migrations",
          rows: [
            {
              version:
                String(
                  V2_POSTGRES_MIGRATION_VERSION,
                ),
              name:
                "wrong-name",
            },
          ],
        },
      ]);

    await assert.rejects(
      migrateV2MissionCheckpointSchema(
        db,
      ),
      /POSTGRES_MIGRATION_RECEIPT_MISMATCH/,
    );

    db.assertComplete();
  },
);