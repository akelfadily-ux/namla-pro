import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

import {
  PgCheckpointDatabase,
} from "../v2/persistence/pgCheckpointDatabase";

import {
  migrateV2MissionCheckpointSchema,
} from "../v2/persistence/postgresMissionCheckpointMigration";

import {
  migrateV2ExecutionAuthoritySchema,
  V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_NAME,
  V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_VERSION,
} from "../v2/persistence/postgresExecutionAuthorityMigration";

import {
  PostgresExecutionAuthorityStore,
} from "../v2/persistence/postgresExecutionAuthorityStore";

const rawDatabaseUrl =
  process.env.DATABASE_URL;

if (
  typeof rawDatabaseUrl !== "string" ||
  rawDatabaseUrl.trim().length === 0
) {
  throw new Error(
    "R1B_PG3_DATABASE_URL_REQUIRED",
  );
}

const DATABASE_URL: string =
  rawDatabaseUrl;

function createSchemaName(): string {
  return (
    "namla_v2_execution_authority_" +
    randomUUID()
      .replace(/-/g, "")
      .toLowerCase()
  );
}

function createPool(
  schema: string,
  max = 8,
): Pool {
  if (!/^[a-z0-9_]+$/.test(schema)) {
    throw new Error(
      "R1B_PG3_INVALID_SCHEMA_NAME",
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

  let created = false;

  try {
    await adminPool.query(
      `CREATE SCHEMA ${schema}`,
    );

    created = true;

    await work(schema);
  } finally {
    try {
      if (created) {
        await adminPool.query(
          `DROP SCHEMA IF EXISTS ${schema} CASCADE`,
        );
      }
    } finally {
      await adminPool.end();
    }
  }
}

async function migrateAll(
  db: PgCheckpointDatabase,
): Promise<void> {
  await migrateV2MissionCheckpointSchema(
    db,
  );

  await migrateV2ExecutionAuthoritySchema(
    db,
  );
}

function operationValue() {
  return {
    path: "proof/output.json",
    payload: {
      stable: true,
      version: 1,
    },
  };
}

test(
  "R1B-PG3 two real execution-authority migrators serialize and leave one V2 receipt",
  {
    timeout: 30_000,
  },
  async () => {
    await withIsolatedSchema(
      async (schema) => {
        const setupPool =
          createPool(schema, 1);
        const poolA =
          createPool(schema, 1);
        const poolB =
          createPool(schema, 1);
        const auditPool =
          createPool(schema, 1);

        try {
          const setupDb =
            new PgCheckpointDatabase(
              setupPool,
            );

          await migrateV2MissionCheckpointSchema(
            setupDb,
          );

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
                  "R1B_PG3_START_GATE_NOT_INITIALIZED",
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

              return migrateV2ExecutionAuthoritySchema(
                dbA,
              );
            })();

          const runB =
            (async () => {
              await startGate;

              return migrateV2ExecutionAuthoritySchema(
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

          const receipt =
            await auditPool.query<{
              readonly version: string;
              readonly name: string;
            }>(
              `
SELECT version, name
FROM namla_v2_schema_migrations
WHERE version = $1
              `.trim(),
              [
                V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_VERSION,
              ],
            );

          assert.equal(
            receipt.rows.length,
            1,
          );

          assert.equal(
            Number(
              receipt.rows[0].version,
            ),
            V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_VERSION,
          );

          assert.equal(
            receipt.rows[0].name,
            V2_POSTGRES_EXECUTION_AUTHORITY_MIGRATION_NAME,
          );

          const tables =
            await auditPool.query<{
              readonly leases:
                string | null;
              readonly claims:
                string | null;
            }>(
              `
SELECT
  to_regclass($1) AS leases,
  to_regclass($2) AS claims
              `.trim(),
              [
                `${schema}.namla_v2_task_execution_leases`,
                `${schema}.namla_v2_operation_claims`,
              ],
            );

          assert.notEqual(
            tables.rows[0].leases,
            null,
          );

          assert.notEqual(
            tables.rows[0].claims,
            null,
          );
        } finally {
          await Promise.allSettled([
            setupPool.end(),
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
  "R1B-PG3 concurrent real task-lease acquisition preserves one authority",
  {
    timeout: 30_000,
  },
  async () => {
    await withIsolatedSchema(
      async (schema) => {
        const poolA =
          createPool(schema, 2);
        const poolB =
          createPool(schema, 2);
        const auditPool =
          createPool(schema, 1);

        try {
          const dbA =
            new PgCheckpointDatabase(
              poolA,
            );

          await migrateAll(dbA);

          const dbB =
            new PgCheckpointDatabase(
              poolB,
            );

          const storeA =
            new PostgresExecutionAuthorityStore(
              dbA,
            );

          const storeB =
            new PostgresExecutionAuthorityStore(
              dbB,
            );

          const missionId =
            `lease-race-${randomUUID()}`;

          const taskId =
            "task-1";

          const scope =
            "PRO/COLONY_A/task-1";

          const race =
            await Promise.all([
              storeA.acquireTaskLease({
                missionId,
                taskId,
                workerId:
                  "worker-a",
                authorityScope:
                  scope,
                leaseDurationMs:
                  60_000,
              }),

              storeB.acquireTaskLease({
                missionId,
                taskId,
                workerId:
                  "worker-b",
                authorityScope:
                  scope,
                leaseDurationMs:
                  60_000,
              }),
            ]);

          const acquired =
            race.filter(
              (result) =>
                result.ok &&
                result.status ===
                  "ACQUIRED",
            );

          const refused =
            race.filter(
              (result) =>
                !result.ok &&
                result.reasonCode ===
                  "held-by-other",
            );

          assert.equal(
            acquired.length,
            1,
          );

          assert.equal(
            refused.length,
            1,
          );

          if (!acquired[0].ok) {
            throw new Error(
              "R1B_PG3_ACQUIRED_RESULT_NARROWING_FAILED",
            );
          }

          assert.equal(
            acquired[0]
              .authority.leaseEpoch,
            1,
          );

          const durable =
            await auditPool.query<{
              readonly worker_id:
                string;
              readonly lease_epoch:
                string;
            }>(
              `
SELECT worker_id, lease_epoch
FROM namla_v2_task_execution_leases
WHERE mission_id = $1
  AND task_id = $2
              `.trim(),
              [
                missionId,
                taskId,
              ],
            );

          assert.equal(
            durable.rows.length,
            1,
          );

          assert.equal(
            Number(
              durable.rows[0]
                .lease_epoch,
            ),
            1,
          );

          assert.equal(
            durable.rows[0]
              .worker_id,
            acquired[0]
              .authority.workerId,
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
  "R1B-PG3 expired real task lease takeover increments epoch and fences stale renewal",
  {
    timeout: 30_000,
  },
  async () => {
    await withIsolatedSchema(
      async (schema) => {
        const pool =
          createPool(schema, 4);

        try {
          const db =
            new PgCheckpointDatabase(
              pool,
            );

          await migrateAll(db);

          const store =
            new PostgresExecutionAuthorityStore(
              db,
            );

          const missionId =
            `lease-takeover-${randomUUID()}`;

          const taskId =
            "task-1";

          const scope =
            "PRO/COLONY_A/task-1";

          const first =
            await store.acquireTaskLease({
              missionId,
              taskId,
              workerId:
                "worker-a",
              authorityScope:
                scope,
              leaseDurationMs:
                60_000,
            });

          assert.equal(
            first.ok,
            true,
          );

          if (!first.ok) {
            throw new Error(
              "R1B_PG3_FIRST_LEASE_NOT_ACQUIRED",
            );
          }

          await pool.query(
            `
UPDATE namla_v2_task_execution_leases
SET lease_expires_at =
  NOW() - INTERVAL '1 second'
WHERE mission_id = $1
  AND task_id = $2
            `.trim(),
            [
              missionId,
              taskId,
            ],
          );

          const second =
            await store.acquireTaskLease({
              missionId,
              taskId,
              workerId:
                "worker-b",
              authorityScope:
                scope,
              leaseDurationMs:
                60_000,
            });

          assert.equal(
            second.ok,
            true,
          );

          if (!second.ok) {
            throw new Error(
              "R1B_PG3_SECOND_LEASE_NOT_ACQUIRED",
            );
          }

          assert.equal(
            second.authority
              .leaseEpoch,
            first.authority
              .leaseEpoch + 1,
          );

          const staleRenew =
            await store.renewTaskLease(
              first.authority,
              60_000,
            );

          assert.deepEqual(
            staleRenew,
            {
              ok: false,
              status: "REFUSED",
              reasonCode:
                "authority-lost",
            },
          );
        } finally {
          await pool.end();
        }
      },
    );
  },
);

test(
  "R1B-PG3 concurrent real operation claim creates one durable claim",
  {
    timeout: 30_000,
  },
  async () => {
    await withIsolatedSchema(
      async (schema) => {
        const poolA =
          createPool(schema, 4);
        const poolB =
          createPool(schema, 4);
        const auditPool =
          createPool(schema, 1);

        try {
          const dbA =
            new PgCheckpointDatabase(
              poolA,
            );

          await migrateAll(dbA);

          const dbB =
            new PgCheckpointDatabase(
              poolB,
            );

          const storeA =
            new PostgresExecutionAuthorityStore(
              dbA,
            );

          const storeB =
            new PostgresExecutionAuthorityStore(
              dbB,
            );

          const missionId =
            `operation-race-${randomUUID()}`;

          const lease =
            await storeA.acquireTaskLease({
              missionId,
              taskId:
                "task-1",
              workerId:
                "worker-a",
              authorityScope:
                "PRO/COLONY_A/task-1",
              leaseDurationMs:
                60_000,
            });

          assert.equal(
            lease.ok,
            true,
          );

          if (!lease.ok) {
            throw new Error(
              "R1B_PG3_OPERATION_RACE_LEASE_FAILED",
            );
          }

          const input = {
            operationKey:
              "operation-1",
            operationType:
              "tool.filesystem.write",
            value:
              operationValue(),
            authority:
              lease.authority,
            claimDurationMs:
              30_000,
          } as const;

          const race =
            await Promise.all([
              storeA.claimOperation(
                input,
              ),
              storeB.claimOperation(
                input,
              ),
            ]);

          const claimed =
            race.filter(
              (result) =>
                result.ok &&
                result.status ===
                  "CLAIMED",
            );

          const already =
            race.filter(
              (result) =>
                result.ok &&
                result.status ===
                  "ALREADY_CLAIMED_BY_CALLER",
            );

          assert.equal(
            claimed.length,
            1,
          );

          assert.equal(
            already.length,
            1,
          );

          const row =
            await auditPool.query<{
              readonly count: number;
              readonly claim_epoch:
                string;
              readonly status:
                string;
            }>(
              `
SELECT
  COUNT(*)::int AS count,
  MAX(claim_epoch)::text AS claim_epoch,
  MAX(status)::text AS status
FROM namla_v2_operation_claims
WHERE mission_id = $1
  AND operation_key = $2
              `.trim(),
              [
                missionId,
                "operation-1",
              ],
            );

          assert.equal(
            row.rows[0].count,
            1,
          );

          assert.equal(
            row.rows[0]
              .claim_epoch,
            "1",
          );

          assert.equal(
            row.rows[0].status,
            "RUNNING",
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
  "R1B-PG3 real takeover fences stale writer and completed replay preserves durable result",
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

          await migrateAll(db);

          const storeA =
            new PostgresExecutionAuthorityStore(
              db,
            );

          const storeB =
            new PostgresExecutionAuthorityStore(
              db,
            );

          const missionId =
            `stale-writer-${randomUUID()}`;

          const taskId =
            "task-1";

          const scope =
            "PRO/COLONY_A/task-1";

          const leaseA =
            await storeA.acquireTaskLease({
              missionId,
              taskId,
              workerId:
                "worker-a",
              authorityScope:
                scope,
              leaseDurationMs:
                60_000,
            });

          assert.equal(
            leaseA.ok,
            true,
          );

          if (!leaseA.ok) {
            throw new Error(
              "R1B_PG3_STALE_WRITER_LEASE_A_FAILED",
            );
          }

          const claimA =
            await storeA.claimOperation({
              operationKey:
                "operation-1",
              operationType:
                "tool.filesystem.write",
              value:
                operationValue(),
              authority:
                leaseA.authority,
              claimDurationMs:
                30_000,
            });

          assert.equal(
            claimA.ok,
            true,
          );

          assert.equal(
            claimA.status,
            "CLAIMED",
          );

          if (
            !claimA.ok ||
            claimA.status !==
              "CLAIMED" ||
            !claimA.record
          ) {
            throw new Error(
              "R1B_PG3_STALE_WRITER_CLAIM_A_FAILED",
            );
          }

          await pool.query(
            `
UPDATE namla_v2_task_execution_leases
SET lease_expires_at =
  NOW() - INTERVAL '1 second'
WHERE mission_id = $1
  AND task_id = $2
            `.trim(),
            [
              missionId,
              taskId,
            ],
          );

          await pool.query(
            `
UPDATE namla_v2_operation_claims
SET claim_expires_at =
  NOW() - INTERVAL '1 second'
WHERE mission_id = $1
  AND operation_key = $2
            `.trim(),
            [
              missionId,
              "operation-1",
            ],
          );

          const leaseB =
            await storeB.acquireTaskLease({
              missionId,
              taskId,
              workerId:
                "worker-b",
              authorityScope:
                scope,
              leaseDurationMs:
                60_000,
            });

          assert.equal(
            leaseB.ok,
            true,
          );

          if (!leaseB.ok) {
            throw new Error(
              "R1B_PG3_STALE_WRITER_LEASE_B_FAILED",
            );
          }

          assert.equal(
            leaseB.authority
              .leaseEpoch,
            leaseA.authority
              .leaseEpoch + 1,
          );

          const claimB =
            await storeB.claimOperation({
              operationKey:
                "operation-1",
              operationType:
                "tool.filesystem.write",
              value:
                operationValue(),
              authority:
                leaseB.authority,
              claimDurationMs:
                30_000,
            });

          assert.equal(
            claimB.ok,
            true,
          );

          assert.equal(
            claimB.status,
            "CLAIMED",
          );

          if (
            !claimB.ok ||
            claimB.status !==
              "CLAIMED" ||
            !claimB.record
          ) {
            throw new Error(
              "R1B_PG3_STALE_WRITER_CLAIM_B_FAILED",
            );
          }

          assert.equal(
            claimB.record
              .claimEpoch,
            claimA.record
              .claimEpoch + 1,
          );

          const staleComplete =
            await storeA.completeOperation({
              operationKey:
                "operation-1",
              authority:
                leaseA.authority,
              claimToken:
                claimA.record.claimToken,
              claimEpoch:
                claimA.record.claimEpoch,
              value: {
                winner:
                  "stale-a",
              },
            });

          assert.equal(
            staleComplete.ok,
            false,
          );

          assert.equal(
            staleComplete.reasonCode,
            "task-authority-mismatch",
          );

          const durableValue = {
            winner:
              "worker-b",
            epoch:
              claimB.record.claimEpoch,
          };

          const completed =
            await storeB.completeOperation({
              operationKey:
                "operation-1",
              authority:
                leaseB.authority,
              claimToken:
                claimB.record.claimToken,
              claimEpoch:
                claimB.record.claimEpoch,
              value:
                durableValue,
            });

          assert.equal(
            completed.ok,
            true,
          );

          assert.equal(
            completed.status,
            "COMPLETED",
          );

          const replay =
            await storeB.claimOperation({
              operationKey:
                "operation-1",
              operationType:
                "tool.filesystem.write",
              value:
                operationValue(),
              authority:
                leaseB.authority,
              claimDurationMs:
                30_000,
            });

          assert.equal(
            replay.ok,
            true,
          );

          assert.equal(
            replay.status,
            "REPLAY_COMPLETED",
          );

          if (!replay.ok) {
            throw new Error(
              "R1B_PG3_REPLAY_FAILED",
            );
          }

          assert.deepEqual(
            replay.completedValue,
            durableValue,
          );

          const raw =
            await pool.query<{
              readonly status:
                string;
              readonly claim_epoch:
                string;
              readonly result:
                unknown;
            }>(
              `
SELECT
  status,
  claim_epoch,
  result
FROM namla_v2_operation_claims
WHERE mission_id = $1
  AND operation_key = $2
              `.trim(),
              [
                missionId,
                "operation-1",
              ],
            );

          assert.equal(
            raw.rows.length,
            1,
          );

          assert.equal(
            raw.rows[0].status,
            "COMPLETED",
          );

          assert.equal(
            Number(
              raw.rows[0]
                .claim_epoch,
            ),
            claimB.record
              .claimEpoch,
          );

          assert.deepEqual(
            raw.rows[0].result,
            durableValue,
          );
        } finally {
          await pool.end();
        }
      },
    );
  },
);