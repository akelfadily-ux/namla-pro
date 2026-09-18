import assert from "node:assert/strict";
import test from "node:test";

import {
  type PostgresCheckpointClient,
  type PostgresCheckpointDatabase,
  type PostgresCheckpointQueryResult,
} from "../v2/persistence/postgresMissionCheckpointStore";

import {
  V2_POSTGRES_MIGRATION_NAME,
  V2_POSTGRES_MIGRATION_VERSION,
} from "../v2/persistence/postgresMissionCheckpointMigration";

import {
  V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_LOCK_KEY,
  V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_LOCK_NAMESPACE,
  V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_NAME,
  V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_VERSION,
} from "../v2/persistence/postgresExecutionAuthorityMigration";

import {
  V2_POSTGRES_CANONICAL_RUNTIME_MIGRATION_NAME,
  V2_POSTGRES_CANONICAL_RUNTIME_MIGRATION_VERSION,
  migrateV2CanonicalRuntimeCursorSchema,
} from "../v2/persistence/postgresCanonicalRuntimeCursorMigration";

interface Step {
  readonly contains: string;
  readonly rows: readonly unknown[];
}

class ScriptedMigrationDatabase
  implements PostgresCheckpointDatabase
{
  public transactionCount = 0;
  public readonly calls: string[] = [];
  public readonly params: (readonly unknown[] | undefined)[] = [];

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
            params?: readonly unknown[],
          ): Promise<PostgresCheckpointQueryResult<R>> => {
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

            this.calls.push(
              sql,
            );

            this.params.push(
              params,
            );

            return {
              rows:
                step.rows as readonly R[],
              rowCount:
                step.rows.length,
            };
          },
      };

    return work(
      client,
    );
  }

  public assertComplete(): void {
    assert.equal(
      this.index,
      this.steps.length,
      "Not all scripted migration steps were consumed",
    );
  }
}

function v1Receipt() {
  return {
    version:
      String(
        V2_POSTGRES_MIGRATION_VERSION,
      ),

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

function v3Receipt() {
  return {
    version:
      String(
        V2_POSTGRES_CANONICAL_RUNTIME_MIGRATION_VERSION,
      ),

    name:
      V2_POSTGRES_CANONICAL_RUNTIME_MIGRATION_NAME,
  };
}

test(
  "10E6 canonical runtime persistence owns migration version 3",
  () => {
    assert.equal(
      V2_POSTGRES_CANONICAL_RUNTIME_MIGRATION_VERSION,
      3,
    );

    assert.equal(
      V2_POSTGRES_CANONICAL_RUNTIME_MIGRATION_NAME,
      "v2-canonical-runtime-checkpoint-v1",
    );

    assert.equal(
      V2_POSTGRES_MIGRATION_VERSION,
      1,
    );

    assert.equal(
      V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_VERSION,
      2,
    );
  },
);

test(
  "10E6 migration shares the canonical V2 advisory lock",
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
  "10E6 migration applies only after exact V1 and V2 receipts",
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
            v2Receipt(),
          ],
        },
        {
          contains:
            "CREATE TABLE namla_v2_canonical_runtime_checkpoints",
          rows: [],
        },
        {
          contains:
            "INSERT INTO namla_v2_schema_migrations",
          rows: [
            v3Receipt(),
          ],
        },
      ]);

    const result =
      await migrateV2CanonicalRuntimeCursorSchema(
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

    assert.match(
      db.calls[0],
      /pg_advisory_xact_lock/,
    );

    assert.deepEqual(
      db.params[0],
      [
        V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_LOCK_NAMESPACE,
        V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_LOCK_KEY,
      ],
    );

    db.assertComplete();
  },
);

test(
  "10E6 migration is idempotent when V1 V2 and V3 receipts are exact",
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
            v2Receipt(),
            v3Receipt(),
          ],
        },
      ]);

    const result =
      await migrateV2CanonicalRuntimeCursorSchema(
        db,
      );

    assert.equal(
      result,
      "ALREADY_APPLIED",
    );

    assert.equal(
      db.calls.length,
      3,
    );

    db.assertComplete();
  },
);

test(
  "10E6 migration fails closed when checkpoint migration prerequisite is absent",
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
            v2Receipt(),
          ],
        },
      ]);

    await assert.rejects(
      migrateV2CanonicalRuntimeCursorSchema(
        db,
      ),
      /POSTGRES_CANONICAL_RUNTIME_REQUIRES_CHECKPOINT_MIGRATION/,
    );

    db.assertComplete();
  },
);

test(
  "10E6 migration fails closed on checkpoint prerequisite name conflict",
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

            v2Receipt(),
          ],
        },
      ]);

    await assert.rejects(
      migrateV2CanonicalRuntimeCursorSchema(
        db,
      ),
      /POSTGRES_CANONICAL_RUNTIME_CHECKPOINT_PREREQUISITE_NAME_CONFLICT/,
    );

    db.assertComplete();
  },
);

test(
  "10E6 migration fails closed when execution-authority prerequisite is absent",
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
          ],
        },
      ]);

    await assert.rejects(
      migrateV2CanonicalRuntimeCursorSchema(
        db,
      ),
      /POSTGRES_CANONICAL_RUNTIME_REQUIRES_EXECUTION_AUTHORITY_MIGRATION/,
    );

    db.assertComplete();
  },
);

test(
  "10E6 migration fails closed on execution-authority prerequisite name conflict",
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
      migrateV2CanonicalRuntimeCursorSchema(
        db,
      ),
      /POSTGRES_CANONICAL_RUNTIME_EXECUTION_AUTHORITY_PREREQUISITE_NAME_CONFLICT/,
    );

    db.assertComplete();
  },
);

test(
  "10E6 migration fails closed when version 3 is occupied by another migration",
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
            v2Receipt(),

            {
              version:
                String(
                  V2_POSTGRES_CANONICAL_RUNTIME_MIGRATION_VERSION,
                ),

              name:
                "wrong-v3-name",
            },
          ],
        },
      ]);

    await assert.rejects(
      migrateV2CanonicalRuntimeCursorSchema(
        db,
      ),
      /POSTGRES_CANONICAL_RUNTIME_MIGRATION_NAME_CONFLICT/,
    );

    db.assertComplete();
  },
);

test(
  "10E6 migration rejects corrupt recorded versions",
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
                "invalid",

              name:
                V2_POSTGRES_MIGRATION_NAME,
            },
          ],
        },
      ]);

    await assert.rejects(
      migrateV2CanonicalRuntimeCursorSchema(
        db,
      ),
      /POSTGRES_CANONICAL_RUNTIME_INVALID_MIGRATION_VERSION/,
    );

    db.assertComplete();
  },
);

test(
  "10E6 migration rejects duplicate migration rows",
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
            v1Receipt(),
            v2Receipt(),
          ],
        },
      ]);

    await assert.rejects(
      migrateV2CanonicalRuntimeCursorSchema(
        db,
      ),
      /POSTGRES_CANONICAL_RUNTIME_MIGRATION_CARDINALITY_VIOLATION/,
    );

    db.assertComplete();
  },
);

test(
  "10E6 migration rejects unexpected migration versions returned by storage",
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
            v2Receipt(),

            {
              version:
                "4",

              name:
                "unexpected-v4",
            },
          ],
        },
      ]);

    await assert.rejects(
      migrateV2CanonicalRuntimeCursorSchema(
        db,
      ),
      /POSTGRES_CANONICAL_RUNTIME_UNEXPECTED_MIGRATION_VERSION/,
    );

    db.assertComplete();
  },
);

test(
  "10E6 migration rejects invalid insert receipt",
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
            v2Receipt(),
          ],
        },
        {
          contains:
            "CREATE TABLE namla_v2_canonical_runtime_checkpoints",
          rows: [],
        },
        {
          contains:
            "INSERT INTO namla_v2_schema_migrations",
          rows: [
            {
              version:
                String(
                  V2_POSTGRES_CANONICAL_RUNTIME_MIGRATION_VERSION,
                ),

              name:
                "wrong-receipt",
            },
          ],
        },
      ]);

    await assert.rejects(
      migrateV2CanonicalRuntimeCursorSchema(
        db,
      ),
      /POSTGRES_CANONICAL_RUNTIME_MIGRATION_RECEIPT_MISMATCH/,
    );

    db.assertComplete();
  },
);

test(
  "10E6 migration requires exactly one insert receipt",
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
            v2Receipt(),
          ],
        },
        {
          contains:
            "CREATE TABLE namla_v2_canonical_runtime_checkpoints",
          rows: [],
        },
        {
          contains:
            "INSERT INTO namla_v2_schema_migrations",
          rows: [],
        },
      ]);

    await assert.rejects(
      migrateV2CanonicalRuntimeCursorSchema(
        db,
      ),
      /POSTGRES_CANONICAL_RUNTIME_MIGRATION_INSERT_FAILED/,
    );

    db.assertComplete();
  },
);
