import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { Pool } from "pg";

import {
  MissionCheckpoint,
  V2_MISSION_CHECKPOINT_SCHEMA,
} from "../v2/persistence/missionCheckpointStore";

import {
  PgCheckpointDatabase,
} from "../v2/persistence/pgCheckpointDatabase";

import {
  PostgresMissionCheckpointStore,
} from "../v2/persistence/postgresMissionCheckpointStore";

import {
  migrateV2MissionCheckpointSchema,
  V2_POSTGRES_MIGRATION_NAME,
  V2_POSTGRES_MIGRATION_VERSION,
} from "../v2/persistence/postgresMissionCheckpointMigration";

const rawDatabaseUrl =
  process.env.DATABASE_URL;

if (
  typeof rawDatabaseUrl !== "string" ||
  rawDatabaseUrl.trim().length === 0
) {
  throw new Error(
    "V2_REAL_POSTGRES_RELEASE_DATABASE_URL_REQUIRED",
  );
}

const DATABASE_URL: string =
  rawDatabaseUrl;

function createSchemaName(): string {
  return (
    "namla_v2_release_" +
    randomUUID()
      .replace(/-/g, "")
      .toLowerCase()
  );
}

function createPool(
  schema: string,
  max = 4,
): Pool {
  if (
    !/^[a-z0-9_]+$/.test(schema)
  ) {
    throw new Error(
      "INVALID_RELEASE_SCHEMA_NAME",
    );
  }

  return new Pool({
    connectionString: DATABASE_URL,
    ssl: false,
    connectionTimeoutMillis: 5_000,
    max,
    options:
      `-c search_path=${schema},public`,
  });
}

async function withIsolatedSchema(
  work: (
    schema: string,
  ) => Promise<void>,
): Promise<void> {
  const adminPool =
    new Pool({
      connectionString: DATABASE_URL,
      ssl: false,
      connectionTimeoutMillis: 5_000,
      max: 1,
    });

  const schema =
    createSchemaName();

  let schemaCreated = false;

  try {
    await adminPool.query(
      `CREATE SCHEMA ${schema}`,
    );

    schemaCreated = true;

    await work(schema);
  } finally {
    try {
      if (schemaCreated) {
        await adminPool.query(
          `DROP SCHEMA IF EXISTS ${schema} CASCADE`,
        );
      }
    } finally {
      await adminPool.end();
    }
  }
}

function checkpoint(
  missionId: string,
  stateVersion: number,
  savedAt: number,
): MissionCheckpoint {
  return {
    schemaVersion:
      V2_MISSION_CHECKPOINT_SCHEMA,

    missionId,

    state: {
      missionId,
      currentState: "INTERPRETING",
      stateVersion,
      currentStage: "EER",
      activeWorkPackages: [],
      executions: [],
      failureCount: 0,
      livelockCounter: 0,
    },

    loopBudget: {
      maxTicks: 100,
      remainingTicks: 100,
      maxFixAttempts: 3,
      remainingFixAttempts: 3,
      maxProviderCalls: 20,
      remainingProviderCalls: 20,
    },

    evidenceRecords: [],
    integratedCandidates: [],
    savedAt,
  };
}

function postgresErrorCode(
  error: unknown,
): string | null {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error)
  ) {
    return null;
  }

  const code =
    (
      error as {
        readonly code?: unknown;
      }
    ).code;

  return typeof code === "string"
    ? code
    : null;
}

test(
  "real PostgreSQL release gate reaches an actual PostgreSQL 16+ server",
  {
    timeout: 30_000,
  },
  async () => {
    const pool =
      new Pool({
        connectionString: DATABASE_URL,
        ssl: false,
        connectionTimeoutMillis: 5_000,
        max: 1,
      });

    try {
      const result =
        await pool.query<{
          readonly db: string;
          readonly usr: string;
          readonly version_num: string;
        }>(
          `
SELECT
  current_database() AS db,
  current_user AS usr,
  current_setting('server_version_num') AS version_num
          `.trim(),
        );

      assert.equal(
        result.rows.length,
        1,
      );

      assert.ok(
        result.rows[0].db.length > 0,
      );

      assert.ok(
        result.rows[0].usr.length > 0,
      );

      const versionNum =
        Number(
          result.rows[0].version_num,
        );

      assert.equal(
        Number.isSafeInteger(versionNum),
        true,
      );

      assert.ok(
        versionNum >= 160000,
        `PostgreSQL 16+ required, got ${versionNum}`,
      );
    } finally {
      await pool.end();
    }
  },
);

test(
  "two first-time migrators serialize on a fresh real PostgreSQL schema",
  {
    timeout: 30_000,
  },
  async () => {
    await withIsolatedSchema(
      async (schema) => {
        const poolA =
          createPool(schema, 1);

        const poolB =
          createPool(schema, 1);

        const auditPool =
          createPool(schema, 1);

        try {
          const dbA =
            new PgCheckpointDatabase(
              poolA,
            );

          const dbB =
            new PgCheckpointDatabase(
              poolB,
            );

          let releaseStart:
            () => void =
              () => {
                throw new Error(
                  "V2_RELEASE_START_GATE_NOT_INITIALIZED",
                );
              };

          const startGate =
            new Promise<void>(
              (resolve) => {
                releaseStart = resolve;
              },
            );

          const runA =
            (async () => {
              await startGate;

              return migrateV2MissionCheckpointSchema(
                dbA,
              );
            })();

          const runB =
            (async () => {
              await startGate;

              return migrateV2MissionCheckpointSchema(
                dbB,
              );
            })();

          releaseStart();

          const results =
            await Promise.all([
              runA,
              runB,
            ]);

          assert.deepEqual(
            [...results].sort(),
            [
              "ALREADY_APPLIED",
              "APPLIED",
            ],
          );

          const ledger =
            await auditPool.query<{
              readonly version: string;
              readonly name: string;
            }>(
              `
SELECT version, name
FROM namla_v2_schema_migrations
ORDER BY version
              `.trim(),
            );

          assert.equal(
            ledger.rows.length,
            1,
          );

          assert.equal(
            Number(
              ledger.rows[0].version,
            ),
            V2_POSTGRES_MIGRATION_VERSION,
          );

          assert.equal(
            ledger.rows[0].name,
            V2_POSTGRES_MIGRATION_NAME,
          );

          const tables =
            await auditPool.query<{
              readonly migration_table:
                string | null;
              readonly checkpoint_table:
                string | null;
            }>(
              `
SELECT
  to_regclass($1) AS migration_table,
  to_regclass($2) AS checkpoint_table
              `.trim(),
              [
                `${schema}.namla_v2_schema_migrations`,
                `${schema}.namla_v2_mission_checkpoints`,
              ],
            );

          assert.notEqual(
            tables.rows[0]
              .migration_table,
            null,
          );

          assert.notEqual(
            tables.rows[0]
              .checkpoint_table,
            null,
          );
        } finally {
          await Promise.allSettled([
            poolA.end(),
            poolB.end(),
            auditPool.end(),
          ]);
        }
      },
    );
  },
);

test(
  "real PostgreSQL create/load and concurrent CAS preserve one writer",
  {
    timeout: 30_000,
  },
  async () => {
    await withIsolatedSchema(
      async (schema) => {
        const pool =
          createPool(schema, 8);

        try {
          const db =
            new PgCheckpointDatabase(
              pool,
            );

          await migrateV2MissionCheckpointSchema(
            db,
          );

          const store =
            new PostgresMissionCheckpointStore(
              db,
            );

          const missionId =
            "release-cas-" +
            randomUUID();

          const created =
            await store.create(
              checkpoint(
                missionId,
                1,
                1001,
              ),
            );

          assert.equal(
            created,
            "CREATED",
          );

          const duplicate =
            await store.create(
              checkpoint(
                missionId,
                1,
                1001,
              ),
            );

          assert.equal(
            duplicate,
            "ALREADY_EXISTS",
          );

          const loadedV1 =
            await store.load(
              missionId,
            );

          assert.equal(
            loadedV1?.state
              .stateVersion,
            1,
          );

          const race =
            await Promise.all([
              store.compareAndSet(
                missionId,
                1,
                checkpoint(
                  missionId,
                  2,
                  2001,
                ),
              ),

              store.compareAndSet(
                missionId,
                1,
                checkpoint(
                  missionId,
                  2,
                  2002,
                ),
              ),
            ]);

          const updated =
            race.filter(
              (result) =>
                result.status ===
                "UPDATED",
            );

          const conflicted =
            race.filter(
              (result) =>
                result.status ===
                "VERSION_CONFLICT",
            );

          assert.equal(
            updated.length,
            1,
          );

          assert.equal(
            conflicted.length,
            1,
          );

          if (
            updated[0].status ===
            "UPDATED"
          ) {
            assert.equal(
              updated[0]
                .stateVersion,
              2,
            );
          }

          if (
            conflicted[0].status ===
            "VERSION_CONFLICT"
          ) {
            assert.equal(
              conflicted[0]
                .currentStateVersion,
              2,
            );
          }

          const loadedV2 =
            await store.load(
              missionId,
            );

          assert.equal(
            loadedV2?.state
              .stateVersion,
            2,
          );

          const advanceV3 =
            await store.compareAndSet(
              missionId,
              2,
              checkpoint(
                missionId,
                3,
                3001,
              ),
            );

          assert.deepEqual(
            advanceV3,
            {
              status: "UPDATED",
              stateVersion: 3,
            },
          );

          const loadedV3 =
            await store.load(
              missionId,
            );

          assert.equal(
            loadedV3?.state
              .stateVersion,
            3,
          );

          const raw =
            await pool.query<{
              readonly state_version:
                string;
              readonly saved_at:
                string;
              readonly json_state_version:
                string;
            }>(
              `
SELECT
  state_version,
  saved_at,
  checkpoint #>>
    '{state,stateVersion}'
    AS json_state_version
FROM namla_v2_mission_checkpoints
WHERE mission_id = $1
              `.trim(),
              [missionId],
            );

          assert.equal(
            raw.rows.length,
            1,
          );

          assert.equal(
            raw.rows[0]
              .state_version,
            "3",
          );

          assert.equal(
            raw.rows[0]
              .saved_at,
            "3001",
          );

          assert.equal(
            raw.rows[0]
              .json_state_version,
            "3",
          );
        } finally {
          await pool.end();
        }
      },
    );
  },
);

test(
  "real PostgreSQL transaction rollback leaves no partial checkpoint",
  {
    timeout: 30_000,
  },
  async () => {
    await withIsolatedSchema(
      async (schema) => {
        const pool =
          createPool(schema, 2);

        try {
          const db =
            new PgCheckpointDatabase(
              pool,
            );

          await migrateV2MissionCheckpointSchema(
            db,
          );

          const missionId =
            "release-rollback-" +
            randomUUID();

          const cp =
            checkpoint(
              missionId,
              1,
              4001,
            );

          await assert.rejects(
            db.transaction(
              async (tx) => {
                await tx.query(
                  `
INSERT INTO namla_v2_mission_checkpoints (
  mission_id,
  schema_version,
  state_version,
  checkpoint,
  saved_at
)
VALUES ($1, $2, $3, $4::jsonb, $5)
                  `.trim(),
                  [
                    missionId,
                    cp.schemaVersion,
                    cp.state
                      .stateVersion,
                    JSON.stringify(cp),
                    cp.savedAt,
                  ],
                );

                throw new Error(
                  "INTENTIONAL_RELEASE_ROLLBACK",
                );
              },
            ),
            /INTENTIONAL_RELEASE_ROLLBACK/,
          );

          const remaining =
            await pool.query<{
              readonly count: number;
            }>(
              `
SELECT COUNT(*)::int AS count
FROM namla_v2_mission_checkpoints
WHERE mission_id = $1
              `.trim(),
              [missionId],
            );

          assert.equal(
            remaining.rows[0].count,
            0,
          );
        } finally {
          await pool.end();
        }
      },
    );
  },
);

test(
  "real PostgreSQL constraints reject metadata and JSON divergence",
  {
    timeout: 30_000,
  },
  async () => {
    await withIsolatedSchema(
      async (schema) => {
        const pool =
          createPool(schema, 2);

        try {
          const db =
            new PgCheckpointDatabase(
              pool,
            );

          await migrateV2MissionCheckpointSchema(
            db,
          );

          async function assertRejected(
            rowMissionId: string,
            cp: MissionCheckpoint,
            rowStateVersion: number,
            rowSavedAt: number,
          ): Promise<void> {
            let code:
              string | null = null;

            try {
              await pool.query(
                `
INSERT INTO namla_v2_mission_checkpoints (
  mission_id,
  schema_version,
  state_version,
  checkpoint,
  saved_at
)
VALUES ($1, $2, $3, $4::jsonb, $5)
                `.trim(),
                [
                  rowMissionId,
                  cp.schemaVersion,
                  rowStateVersion,
                  JSON.stringify(cp),
                  rowSavedAt,
                ],
              );
            } catch (error) {
              code =
                postgresErrorCode(
                  error,
                );
            }

            assert.equal(
              code,
              "23514",
            );

            const remaining =
              await pool.query<{
                readonly count:
                  number;
              }>(
                `
SELECT COUNT(*)::int AS count
FROM namla_v2_mission_checkpoints
WHERE mission_id = $1
                `.trim(),
                [rowMissionId],
              );

            assert.equal(
              remaining.rows[0]
                .count,
              0,
            );
          }

          const stateMissionId =
            "release-corrupt-state-" +
            randomUUID();

          await assertRejected(
            stateMissionId,
            checkpoint(
              stateMissionId,
              1,
              5001,
            ),
            2,
            5001,
          );

          const rowMissionId =
            "release-corrupt-mission-" +
            randomUUID();

          await assertRejected(
            rowMissionId,
            checkpoint(
              "different-" +
                randomUUID(),
              1,
              5002,
            ),
            1,
            5002,
          );

          const savedAtMissionId =
            "release-corrupt-saved-" +
            randomUUID();

          await assertRejected(
            savedAtMissionId,
            checkpoint(
              savedAtMissionId,
              1,
              5003,
            ),
            1,
            9999,
          );
        } finally {
          await pool.end();
        }
      },
    );
  },
);