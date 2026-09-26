import test from "node:test";
import assert from "node:assert/strict";

import {
  randomUUID,
} from "node:crypto";

import {
  spawn,
  type ChildProcess,
} from "node:child_process";

import {
  resolve,
} from "node:path";

import {
  Pool,
} from "pg";

import {
  PgCheckpointDatabase,
} from "../v2/persistence/pgCheckpointDatabase";

import {
  migrateV2MissionCheckpointSchema,
} from "../v2/persistence/postgresMissionCheckpointMigration";

import {
  migrateV2ExecutionAuthoritySchema,
} from "../v2/persistence/postgresExecutionAuthorityMigration";

import {
  migrateV2CanonicalRuntimeCursorSchema,
} from "../v2/persistence/postgresCanonicalRuntimeCursorMigration";

import {
  migrateV2CanonicalRuntimeRecoverySchema,
} from "../v2/persistence/postgresCanonicalRuntimeRecoveryMigration";

import {
  V2_POSTGRES_CANONICAL_RUNTIME_RECOVERY_TABLE,
} from "../v2/persistence/postgresCanonicalRuntimeRecoverySchema";

import {
  V2_POSTGRES_OPERATION_CLAIM_TABLE,
  V2_POSTGRES_TASK_EXECUTION_LEASE_TABLE,
} from "../v2/persistence/postgresExecutionAuthoritySchema";

const DATABASE_URL =
  process.env.DATABASE_URL;

if (
  typeof DATABASE_URL !== "string" ||
  DATABASE_URL.trim().length === 0
) {
  throw new Error(
    "C9E2B_DATABASE_URL_REQUIRED",
  );
}

const OBJECTIVE =
  "Build and test a TypeScript service";

interface Receipt {
  readonly type:
    | "GAP_SEEDED"
    | "GAP_RESUMED"
    | "LOOP_REVERIFIED";

  readonly status?:
    string;

  readonly writerStatus?:
    string;

  readonly checkpoint: {
    readonly checkpointVersion:
      number;

    readonly cursor: {
      readonly stepVersion:
        number;

      readonly nodeId:
        string;

      readonly nodeKind:
        string;
    };
  };

  readonly completion:
    unknown;

  readonly output:
    unknown;
}

async function childRun(
  env:
    Record<string, string>,
  expectedType:
    Receipt["type"],
  killAfterReceipt:
    boolean,
): Promise<Receipt> {
  const child:
    ChildProcess =
      spawn(
        process.execPath,
        [
          resolve(
            __dirname,
            "v2RealPostgresEerOrchestratedChild.js",
          ),
        ],
        {
          env: {
            ...process.env,
            ...env,
          },
          stdio: [
            "ignore",
            "ignore",
            "ignore",
            "ipc",
          ],
        },
      );

  const closed =
    new Promise<{
      readonly code:
        number | null;

      readonly signal:
        NodeJS.Signals | null;
    }>(
      (resolveClose) => {
        child.once(
          "close",
          (
            code,
            signal,
          ) => {
            resolveClose({
              code,
              signal,
            });
          },
        );
      },
    );

  const receipt =
    await new Promise<Receipt>(
      (
        resolveReceipt,
        reject,
      ) => {
        const timer =
          setTimeout(
            () => {
              reject(
                new Error(
                  "C9E2B_CHILD_TIMEOUT",
                ),
              );
            },
            30_000,
          );

        child.once(
          "error",
          () => {
            clearTimeout(timer);

            reject(
              new Error(
                "C9E2B_CHILD_START_FAILED",
              ),
            );
          },
        );

        child.on(
          "message",
          (raw) => {
            if (
              !raw ||
              typeof raw !== "object"
            ) {
              return;
            }

            const candidate =
              raw as {
                readonly type?:
                  unknown;

                readonly phase?:
                  unknown;

                readonly code?:
                  unknown;
              };

            if (
              candidate.type ===
                "FAILED"
            ) {
              clearTimeout(timer);

              reject(
                new Error(
                  `C9E2B_CHILD_FAILED:${String(candidate.phase)}:${String(candidate.code)}`,
                ),
              );

              return;
            }

            if (
              candidate.type ===
                expectedType
            ) {
              clearTimeout(timer);

              resolveReceipt(
                raw as Receipt,
              );
            }
          },
        );
      },
    );

  if (killAfterReceipt) {
    assert.equal(
      child.kill(
        "SIGKILL",
      ),
      true,
    );
  }

  const exit =
    await Promise.race([
      closed,

      new Promise<never>(
        (
          _,
          reject,
        ) => {
          setTimeout(
            () => {
              reject(
                new Error(
                  "C9E2B_CHILD_EXIT_TIMEOUT",
                ),
              );
            },
            10_000,
          );
        },
      ),
    ]);

  if (killAfterReceipt) {
    assert.equal(
      exit.code !== 0 ||
        exit.signal !== null,
      true,
    );
  } else {
    assert.equal(
      exit.code,
      0,
    );
  }

  return receipt;
}

async function state(
  pool: Pool,
  missionId: string,
) {
  const result =
    await pool.query<{
      readonly recovery_version:
        string | null;

      readonly node_id:
        string | null;

      readonly node_kind:
        string | null;

      readonly cursor_version:
        string | null;

      readonly completed_operations:
        number;

      readonly lease_epoch:
        string | null;
    }>(
      `
SELECT
  (
    SELECT checkpoint_version::text
    FROM ${V2_POSTGRES_CANONICAL_RUNTIME_RECOVERY_TABLE}
    WHERE mission_id = $1
  ) AS recovery_version,

  (
    SELECT checkpoint #>> '{cursor,nodeId}'
    FROM ${V2_POSTGRES_CANONICAL_RUNTIME_RECOVERY_TABLE}
    WHERE mission_id = $1
  ) AS node_id,

  (
    SELECT checkpoint #>> '{cursor,nodeKind}'
    FROM ${V2_POSTGRES_CANONICAL_RUNTIME_RECOVERY_TABLE}
    WHERE mission_id = $1
  ) AS node_kind,

  (
    SELECT cursor_step_version::text
    FROM ${V2_POSTGRES_CANONICAL_RUNTIME_RECOVERY_TABLE}
    WHERE mission_id = $1
  ) AS cursor_version,

  (
    SELECT COUNT(*)::int
    FROM ${V2_POSTGRES_OPERATION_CLAIM_TABLE}
    WHERE mission_id = $1
      AND status = 'COMPLETED'
  ) AS completed_operations,

  (
    SELECT lease_epoch::text
    FROM ${V2_POSTGRES_TASK_EXECUTION_LEASE_TABLE}
    WHERE mission_id = $1
      AND task_id = 'canonical-factory:EER'
  ) AS lease_epoch
      `.trim(),
      [
        missionId,
      ],
    );

  assert.equal(
    result.rows.length,
    1,
  );

  return result.rows[0];
}

test(
  "C9E2B real PostgreSQL recovers the EER crash gap and re-verifies LOOP_AFTER_EER",
  {
    timeout:
      120_000,
  },
  async () => {
    const schema =
      "namla_c9e2b_" +
      randomUUID()
        .replace(
          /-/gu,
          "",
        )
        .toLowerCase();

    const missionId =
      `c9e2b-${randomUUID()}`;

    const admin =
      new Pool({
        connectionString:
          DATABASE_URL,
        ssl:
          false,
        max:
          1,
        connectionTimeoutMillis:
          5_000,
      });

    let created =
      false;

    try {
      await admin.query(
        `CREATE SCHEMA ${schema}`,
      );

      created =
        true;

      const pool =
        new Pool({
          connectionString:
            DATABASE_URL,
          ssl:
            false,
          max:
            4,
          connectionTimeoutMillis:
            5_000,
          options:
            `-c search_path=${schema},public -c synchronous_commit=on`,
        });

      try {
        const db =
          new PgCheckpointDatabase(
            pool,
          );

        await migrateV2MissionCheckpointSchema(
          db,
        );

        await migrateV2ExecutionAuthoritySchema(
          db,
        );

        await migrateV2CanonicalRuntimeCursorSchema(
          db,
        );

        await migrateV2CanonicalRuntimeRecoverySchema(
          db,
        );

        const common = {
          NAMLA_C9E2B_SCHEMA:
            schema,

          NAMLA_C9E2B_MISSION_ID:
            missionId,

          NAMLA_C9E2B_OBJECTIVE:
            OBJECTIVE,
        };

        const seeded =
          await childRun(
            {
              ...common,
              NAMLA_C9E2B_ACTION:
                "seed-gap",
            },
            "GAP_SEEDED",
            true,
          );

        assert.equal(
          seeded.checkpoint
            .checkpointVersion,
          1,
        );

        assert.equal(
          seeded.checkpoint
            .cursor.nodeId,
          "EER",
        );

        const gap =
          await state(
            pool,
            missionId,
          );

        assert.deepEqual(
          {
            recovery:
              gap.recovery_version,
            node:
              gap.node_id,
            kind:
              gap.node_kind,
            cursor:
              gap.cursor_version,
            operations:
              gap.completed_operations,
            lease:
              gap.lease_epoch,
          },
          {
            recovery:
              "1",
            node:
              "EER",
            kind:
              "FACTORY",
            cursor:
              "1",
            operations:
              2,
            lease:
              "1",
          },
        );

        const resumed =
          await childRun(
            {
              ...common,
              NAMLA_C9E2B_ACTION:
                "resume-gap",
            },
            "GAP_RESUMED",
            false,
          );

        assert.equal(
          resumed.status,
          "RESUMED_AND_ADVANCED",
        );

        assert.equal(
          resumed.writerStatus,
          "REPLAY_COMPLETED",
        );

        assert.deepEqual(
          resumed.completion,
          seeded.completion,
        );

        assert.deepEqual(
          resumed.output,
          seeded.output,
        );

        const after =
          await state(
            pool,
            missionId,
          );

        assert.deepEqual(
          {
            recovery:
              after.recovery_version,
            node:
              after.node_id,
            kind:
              after.node_kind,
            cursor:
              after.cursor_version,
            operations:
              after.completed_operations,
            lease:
              after.lease_epoch,
          },
          {
            recovery:
              "2",
            node:
              "LOOP_AFTER_EER",
            kind:
              "GATE",
            cursor:
              "2",
            operations:
              2,
            lease:
              "1",
          },
        );

        const verified =
          await childRun(
            {
              ...common,
              NAMLA_C9E2B_ACTION:
                "resume-loop",
            },
            "LOOP_REVERIFIED",
            false,
          );

        assert.equal(
          verified.status,
          "ALREADY_AT_LOOP_AFTER_EER",
        );

        assert.equal(
          verified.writerStatus,
          "NOT_EXECUTED",
        );

        assert.deepEqual(
          verified.completion,
          seeded.completion,
        );

        assert.deepEqual(
          verified.output,
          seeded.output,
        );

        const final =
          await state(
            pool,
            missionId,
          );

        assert.equal(
          final.completed_operations,
          2,
        );

        assert.equal(
          final.lease_epoch,
          "1",
        );

        console.log(
          "C9E2B_REAL_PG_EER_CRASH_GAP_RESTART=PASS",
        );

        console.log(
          "C9E2B_REAL_PG_CURSOR=LOOP_AFTER_EER",
        );

        console.log(
          "C9E2B_REAL_PG_COMPLETED_OPERATIONS=2",
        );

        console.log(
          "C9E2B_REAL_PG_EER_LEASE_EPOCH=1",
        );
      } finally {
        await pool.end();
      }
    } finally {
      try {
        if (created) {
          await admin.query(
            `DROP SCHEMA IF EXISTS ${schema} CASCADE`,
          );
        }
      } finally {
        await admin.end();
      }
    }
  },
);
