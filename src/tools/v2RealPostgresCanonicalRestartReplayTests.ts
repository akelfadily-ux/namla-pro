/**
 * C9D2 mandatory real PostgreSQL process restart/replay qualification.
 *
 * This test runs only inside the existing real PostgreSQL release job. It uses
 * DATABASE_URL, creates one isolated schema, performs migrations 1-4, persists
 * recovery + factory/proof evidence in one child process, kills that child
 * abruptly, then verifies exact recovery/evidence from a second fresh process.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  spawn,
  type ChildProcess,
} from "node:child_process";
import { resolve } from "node:path";
import { Pool } from "pg";

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
  V2_CANONICAL_RUNTIME_RECOVERY_CHECKPOINT_SCHEMA,
  type CanonicalRuntimeRecoveryCheckpoint,
} from "../v2/persistence/canonicalRuntimeRecoveryCheckpoint";

import {
  createCanonicalRuntimeCursor,
} from "../v2/runtime/canonicalRuntimeStepper";

import {
  CANONICAL_PIPELINE_SEQUENCE,
} from "../v2/architecture/canonicalPipelineRegistry";

import {
  V2_NAMLA_LOOP_GATE_STATE_SCHEMA,
} from "../v2/loop/namlaLoopGate";

import {
  V2_CANONICAL_FACTORY_COMPLETION_SCHEMA,
  type CanonicalFactoryCompletion,
} from "../v2/runtime/durableCanonicalRuntimeOrchestrator";

import {
  V2_CANONICAL_POST_PROMAX_PROOF_SCHEMA,
  type CanonicalPostProMaxProof,
} from "../v2/assurance/postProMaxAssuranceFactories";

import {
  canonicalAssuranceProofOperationKey,
  canonicalDurableResultRef,
  canonicalFactoryCompletionOperationKey,
} from "../v2/persistence/postgresCanonicalFactoryEvidenceAuthority";

const rawDatabaseUrl =
  process.env.DATABASE_URL;

if (
  typeof rawDatabaseUrl !== "string" ||
  rawDatabaseUrl.trim().length === 0
) {
  throw new Error(
    "C9D2_REAL_POSTGRES_DATABASE_URL_REQUIRED",
  );
}

const DATABASE_URL: string =
  rawDatabaseUrl;

function initial(
  missionId: string,
): CanonicalRuntimeRecoveryCheckpoint {
  return {
    schemaVersion:
      V2_CANONICAL_RUNTIME_RECOVERY_CHECKPOINT_SCHEMA,
    missionId,
    checkpointVersion:
      1,
    cursor:
      createCanonicalRuntimeCursor(
        missionId,
      ),
    savedAt:
      1_000,
    loopBudget: {
      maxTicks:
        100,
      remainingTicks:
        100,
      maxProviderCalls:
        10,
      remainingProviderCalls:
        10,
      maxFixAttempts:
        3,
      remainingFixAttempts:
        3,
    },
    gateStates:
      CANONICAL_PIPELINE_SEQUENCE.flatMap(
        (node) =>
          node.kind === "GATE"
            ? [
                {
                  schemaVersion:
                    V2_NAMLA_LOOP_GATE_STATE_SCHEMA,
                  missionId,
                  stageId:
                    node.id,
                  workPackageId:
                    null,
                  maxLivelockThreshold:
                    3,
                  livelockCounter:
                    0,
                },
              ]
            : [],
      ),
    failureCount:
      0,
    frozenContract:
      null,
  };
}

function revised(
  current:
    CanonicalRuntimeRecoveryCheckpoint,
): CanonicalRuntimeRecoveryCheckpoint {
  return {
    ...current,
    checkpointVersion:
      current.checkpointVersion + 1,
    savedAt:
      current.savedAt + 1,
    loopBudget: {
      ...current.loopBudget,
      remainingTicks:
        current.loopBudget.remainingTicks - 1,
      remainingProviderCalls:
        current.loopBudget.remainingProviderCalls - 1,
    },
  };
}

function completion(
  missionId: string,
  checkpoint:
    CanonicalRuntimeRecoveryCheckpoint,
): CanonicalFactoryCompletion {
  const outputFingerprint =
    "a".repeat(64);

  const operationKey =
    canonicalFactoryCompletionOperationKey({
      missionId,
      factoryId:
        "EER",
      checkpointVersion:
        checkpoint.checkpointVersion,
      cursorStepVersion:
        checkpoint.cursor.stepVersion,
      outputFingerprint,
    });

  return {
    schemaVersion:
      V2_CANONICAL_FACTORY_COMPLETION_SCHEMA,
    missionId,
    factoryId:
      "EER",
    checkpointVersion:
      checkpoint.checkpointVersion,
    cursorStepVersion:
      checkpoint.cursor.stepVersion,
    operationKey,
    resultRef:
      canonicalDurableResultRef(
        operationKey,
      ),
    outputFingerprint,
  };
}

function proof(
  missionId: string,
): CanonicalPostProMaxProof {
  const outputFingerprint =
    "b".repeat(64);

  const input = {
    missionId,
    candidateId:
      "candidate-c9d2",
    contractId:
      `contract-${missionId}`,
    contractVersion:
      "v1.0.0",
    contractHash:
      "c".repeat(64),
    stageId:
      "PROMAX" as const,
    outputFingerprint,
  };

  const operationKey =
    canonicalAssuranceProofOperationKey(
      input,
    );

  return {
    schemaVersion:
      V2_CANONICAL_POST_PROMAX_PROOF_SCHEMA,
    ...input,
    resultRef:
      canonicalDurableResultRef(
        operationKey,
      ),
  };
}

const CHILD_SOURCE = String.raw`
'use strict';

const { Pool } = require('pg');
const path = require('node:path');

const base =
  process.env.NAMLA_C9D2_MODULE_BASE;

const {
  PgCheckpointDatabase,
} = require(path.join(base, 'persistence/pgCheckpointDatabase.js'));

const {
  PostgresCanonicalRuntimeRecoveryStore,
} = require(path.join(base, 'persistence/postgresCanonicalRuntimeRecoveryStore.js'));

const {
  DurableCanonicalRuntimeRecoverySession,
} = require(path.join(base, 'persistence/durableCanonicalRuntimeRecoverySession.js'));

const {
  PostgresExecutionAuthorityStore,
} = require(path.join(base, 'persistence/postgresExecutionAuthorityStore.js'));

const evidence =
  require(path.join(base, 'persistence/postgresCanonicalFactoryEvidenceAuthority.js'));

let pool = null;
let phase = 'CONFIG';

const timer =
  setTimeout(
    () => process.exit(91),
    45000,
  );

function fail(code) {
  if (process.send) {
    process.send(
      {
        type: 'FAILED',
        phase,
        code,
      },
      () => process.exit(92),
    );
    return;
  }

  process.exit(92);
}

async function persistFactory(
  store,
  completion,
) {
  const lease =
    await store.acquireTaskLease({
      missionId:
        completion.missionId,
      taskId:
        evidence.canonicalFactoryAuthorityTaskId(
          completion.factoryId,
        ),
      workerId:
        'c9d2-seed-worker',
      authorityScope:
        evidence.canonicalFactoryAuthorityScope(
          completion.factoryId,
        ),
      leaseDurationMs:
        60000,
    });

  if (!lease.ok) {
    throw new Error('FACTORY_LEASE');
  }

  const claim =
    await store.claimOperation({
      operationKey:
        completion.operationKey,
      operationType:
        evidence.CANONICAL_FACTORY_COMPLETION_OPERATION_TYPE,
      value:
        completion,
      authority:
        lease.authority,
      claimDurationMs:
        30000,
    });

  if (
    !claim.ok ||
    claim.status !== 'CLAIMED' ||
    !claim.record
  ) {
    throw new Error('FACTORY_CLAIM');
  }

  const completed =
    await store.completeOperation({
      operationKey:
        completion.operationKey,
      authority:
        lease.authority,
      claimToken:
        claim.record.claimToken,
      claimEpoch:
        claim.record.claimEpoch,
      value:
        completion,
    });

  if (!completed.ok) {
    throw new Error('FACTORY_COMPLETE');
  }
}

async function persistProof(
  store,
  proof,
) {
  const key =
    evidence.canonicalAssuranceProofOperationKey({
      missionId:
        proof.missionId,
      candidateId:
        proof.candidateId,
      contractId:
        proof.contractId,
      contractVersion:
        proof.contractVersion,
      contractHash:
        proof.contractHash,
      stageId:
        proof.stageId,
      outputFingerprint:
        proof.outputFingerprint,
    });

  const lease =
    await store.acquireTaskLease({
      missionId:
        proof.missionId,
      taskId:
        evidence.canonicalAssuranceAuthorityTaskId(
          proof.stageId,
        ),
      workerId:
        'c9d2-proof-worker',
      authorityScope:
        evidence.canonicalAssuranceAuthorityScope(
          proof.stageId,
        ),
      leaseDurationMs:
        60000,
    });

  if (!lease.ok) {
    throw new Error('PROOF_LEASE');
  }

  const claim =
    await store.claimOperation({
      operationKey:
        key,
      operationType:
        evidence.CANONICAL_ASSURANCE_PROOF_OPERATION_TYPE,
      value:
        proof,
      authority:
        lease.authority,
      claimDurationMs:
        30000,
    });

  if (
    !claim.ok ||
    claim.status !== 'CLAIMED' ||
    !claim.record
  ) {
    throw new Error('PROOF_CLAIM');
  }

  const completed =
    await store.completeOperation({
      operationKey:
        key,
      authority:
        lease.authority,
      claimToken:
        claim.record.claimToken,
      claimEpoch:
        claim.record.claimEpoch,
      value:
        proof,
    });

  if (!completed.ok) {
    throw new Error('PROOF_COMPLETE');
  }
}

process.once(
  'message',
  async (m) => {
    try {
      if (
        !m ||
        !/^namla_c9d2_[0-9a-f]{32}$/.test(m.schema) ||
        !['seed', 'verify'].includes(m.action)
      ) {
        throw new Error('MESSAGE');
      }

      phase = 'CONNECT';

      pool =
        new Pool({
          connectionString:
            process.env.DATABASE_URL,
          ssl:
            false,
          max:
            4,
          connectionTimeoutMillis:
            10000,
          options:
            '-c search_path=' +
            m.schema +
            ',public -c synchronous_commit=on',
        });

      const db =
        new PgCheckpointDatabase(
          pool,
        );

      const recovery =
        new DurableCanonicalRuntimeRecoverySession(
          new PostgresCanonicalRuntimeRecoveryStore(
            db,
          ),
          m.missionId,
        );

      if (m.action === 'seed') {
        phase = 'RECOVERY_SEED';

        const created =
          await recovery.createInitial(
            m.initial,
          );

        if (!created.ok) {
          throw new Error('RECOVERY_CREATE');
        }

        const advanced =
          await recovery.advance(
            m.next,
            null,
          );

        if (!advanced.ok) {
          throw new Error('RECOVERY_ADVANCE');
        }

        phase = 'EVIDENCE_SEED';

        const execution =
          new PostgresExecutionAuthorityStore(
            db,
          );

        await persistFactory(
          execution,
          m.completion,
        );

        await persistProof(
          execution,
          m.proof,
        );

        if (!process.send) {
          throw new Error('IPC');
        }

        process.send({
          type:
            'SEEDED',
          checkpoint:
            recovery.getSnapshot(),
        });

        setInterval(
          () => {},
          1000,
        );

        return;
      }

      phase = 'RECOVERY_VERIFY';

      const loaded =
        await recovery.resume(
          null,
        );

      if (!loaded.ok) {
        throw new Error('RECOVERY_RESUME');
      }

      phase = 'EVIDENCE_VERIFY';

      const authority =
        new evidence.PostgresCanonicalFactoryEvidenceAuthority(
          new PostgresExecutionAuthorityStore(
            db,
          ),
        );

      const factoryResult =
        await authority.verifyFactoryCompletion(
          m.completion,
        );

      const proofResult =
        await authority.verifyProof(
          m.proof,
        );

      await pool.end();
      pool = null;

      if (!process.send) {
        throw new Error('IPC');
      }

      process.send(
        {
          type:
            'VERIFIED',
          checkpoint:
            loaded.checkpoint,
          factoryVerified:
            factoryResult.ok === true &&
            factoryResult.status === 'VERIFIED',
          proofVerified:
            proofResult.ok === true &&
            proofResult.status === 'VERIFIED',
        },
        () => {
          clearTimeout(timer);
          process.disconnect();
        },
      );
    } catch (error) {
      const raw =
        error &&
        typeof error === 'object' &&
        'message' in error &&
        typeof error.message === 'string'
          ? error.message
          : 'UNKNOWN';

      const code =
        /^[A-Z0-9_]{2,48}$/.test(raw)
          ? raw
          : 'NO_CODE';

      fail(code);
    }
  },
);
`;

interface ChildReceipt {
  readonly type:
    "SEEDED" | "VERIFIED";
  readonly checkpoint:
    CanonicalRuntimeRecoveryCheckpoint;
  readonly factoryVerified?:
    boolean;
  readonly proofVerified?:
    boolean;
}

async function childRun(
  message:
    Record<string, unknown>,
  expectedType:
    ChildReceipt["type"],
  killAfterReceipt:
    boolean,
): Promise<ChildReceipt> {
  const child:
    ChildProcess =
      spawn(
        process.execPath,
        [
          "-e",
          CHILD_SOURCE,
        ],
        {
          cwd:
            process.cwd(),
          env: {
            ...process.env,
            NAMLA_C9D2_MODULE_BASE:
              resolve(
                __dirname,
                "../v2",
              ),
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
      (done) => {
        child.once(
          "close",
          (
            code,
            signal,
          ) => {
            done({
              code,
              signal,
            });
          },
        );
      },
    );

  let timer:
    ReturnType<typeof setTimeout> |
    undefined;

  try {
    const receipt =
      await new Promise<ChildReceipt>(
        (
          done,
          reject,
        ) => {
          timer =
            setTimeout(
              () =>
                reject(
                  new Error(
                    "C9D2_CHILD_RECEIPT_TIMEOUT",
                  ),
                ),
              30_000,
            );

          child.once(
            "error",
            () =>
              reject(
                new Error(
                  "C9D2_CHILD_START_FAILED",
                ),
              ),
          );

          child.once(
            "close",
            () =>
              reject(
                new Error(
                  "C9D2_CHILD_EXITED_BEFORE_RECEIPT",
                ),
              ),
          );

          child.once(
            "message",
            (raw) => {
              if (
                !raw ||
                typeof raw !== "object"
              ) {
                reject(
                  new Error(
                    "C9D2_CHILD_RECEIPT_INVALID",
                  ),
                );
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
                const phase =
                  typeof candidate.phase ===
                    "string"
                    ? candidate.phase
                    : "UNKNOWN";

                const code =
                  typeof candidate.code ===
                    "string"
                    ? candidate.code
                    : "NO_CODE";

                reject(
                  new Error(
                    `C9D2_CHILD_FAILED:${phase}:${code}`,
                  ),
                );
                return;
              }

              if (
                candidate.type !==
                  expectedType
              ) {
                reject(
                  new Error(
                    "C9D2_CHILD_RECEIPT_TYPE_MISMATCH",
                  ),
                );
                return;
              }

              done(
                raw as
                  ChildReceipt,
              );
            },
          );

          if (!child.send) {
            reject(
              new Error(
                "C9D2_CHILD_IPC_UNAVAILABLE",
              ),
            );
            return;
          }

          child.send(
            message,
            (error) => {
              if (error) {
                reject(
                  new Error(
                    "C9D2_CHILD_IPC_SEND_FAILED",
                  ),
                );
              }
            },
          );
        },
      );

    if (timer) {
      clearTimeout(timer);
    }

    if (killAfterReceipt) {
      assert.equal(
        child.kill("SIGKILL"),
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
              () =>
                reject(
                  new Error(
                    "C9D2_CHILD_EXIT_TIMEOUT",
                  ),
                ),
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
  } finally {
    if (timer) {
      clearTimeout(timer);
    }

    if (
      child.exitCode === null &&
      child.signalCode === null
    ) {
      child.kill(
        "SIGKILL",
      );
    }
  }
}

test(
  "C9D2 real PostgreSQL survives abrupt process loss and a fresh process replays recovery plus durable factory/proof authority",
  {
    timeout:
      120_000,
  },
  async () => {
    const schema =
      "namla_c9d2_" +
      randomUUID()
        .replace(/-/g, "")
        .toLowerCase();

    const admin =
      new Pool({
        connectionString:
          DATABASE_URL,
        ssl:
          false,
        connectionTimeoutMillis:
          5_000,
        max:
          1,
      });

    let created =
      false;

    try {
      await admin.query(
        `CREATE SCHEMA ${schema}`,
      );

      created =
        true;

      const scoped =
        new Pool({
          connectionString:
            DATABASE_URL,
          ssl:
            false,
          connectionTimeoutMillis:
            5_000,
          max:
            4,
          options:
            `-c search_path=${schema},public -c synchronous_commit=on`,
        });

      try {
        const version =
          await scoped.query<{
            readonly version_num:
              string;
          }>(
            "SELECT current_setting('server_version_num') AS version_num",
          );

        assert.equal(
          version.rows.length,
          1,
        );

        assert.ok(
          Number(
            version.rows[0]
              .version_num,
          ) >= 160000,
        );

        const db =
          new PgCheckpointDatabase(
            scoped,
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

        const missionId =
          `c9d2-${randomUUID()}`;

        const first =
          initial(
            missionId,
          );

        const next =
          revised(
            first,
          );

        const durableCompletion =
          completion(
            missionId,
            next,
          );

        const durableProof =
          proof(
            missionId,
          );

        const message = {
          schema,
          missionId,
          initial:
            first,
          next,
          completion:
            durableCompletion,
          proof:
            durableProof,
        };

        const seeded =
          await childRun(
            {
              ...message,
              action:
                "seed",
            },
            "SEEDED",
            true,
          );

        assert.deepEqual(
          seeded.checkpoint,
          next,
        );

        const durableRows =
          await scoped.query<{
            readonly recovery_version:
              string;
            readonly completed_operations:
              number;
          }>(
            `
SELECT
  (
    SELECT checkpoint_version::text
    FROM namla_v2_canonical_runtime_recovery
    WHERE mission_id = $1
  ) AS recovery_version,
  (
    SELECT COUNT(*)::int
    FROM namla_v2_operation_claims
    WHERE mission_id = $1
      AND status = 'COMPLETED'
  ) AS completed_operations
            `.trim(),
            [
              missionId,
            ],
          );

        assert.equal(
          durableRows.rows.length,
          1,
        );

        assert.equal(
          durableRows.rows[0]
            .recovery_version,
          "2",
        );

        assert.equal(
          durableRows.rows[0]
            .completed_operations,
          2,
        );

        const replayed =
          await childRun(
            {
              ...message,
              action:
                "verify",
            },
            "VERIFIED",
            false,
          );

        assert.deepEqual(
          replayed.checkpoint,
          next,
        );

        assert.equal(
          replayed.factoryVerified,
          true,
        );

        assert.equal(
          replayed.proofVerified,
          true,
        );

        console.log(
          "C9D2_REAL_PG_PROCESS_RESTART_REPLAY=PASS",
        );

        console.log(
          "C9D2_REAL_PG_RECOVERY_CHECKPOINT_VERSION=2",
        );

        console.log(
          "C9D2_REAL_PG_DURABLE_EVIDENCE_ROWS=2",
        );
      } finally {
        await scoped.end();
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
