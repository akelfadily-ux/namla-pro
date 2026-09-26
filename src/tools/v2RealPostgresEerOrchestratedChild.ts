import {
  Pool,
} from "pg";

import {
  PgCheckpointDatabase,
} from "../v2/persistence/pgCheckpointDatabase";

import {
  PostgresCanonicalRuntimeRecoveryStore,
} from "../v2/persistence/postgresCanonicalRuntimeRecoveryStore";

import {
  PostgresExecutionAuthorityStore,
} from "../v2/persistence/postgresExecutionAuthorityStore";

import {
  PostgresCanonicalFactoryEvidenceAuthority,
} from "../v2/persistence/postgresCanonicalFactoryEvidenceAuthority";

import {
  DurableCanonicalRuntimeOrchestrator,
} from "../v2/runtime/durableCanonicalRuntimeOrchestrator";

import {
  DurableCanonicalEerRuntime,
} from "../v2/runtime/durableCanonicalEerRuntime";

import {
  DurableCanonicalEerOrchestratedRuntime,
} from "../v2/runtime/durableCanonicalEerOrchestratedRuntime";

const databaseUrl =
  process.env.DATABASE_URL ?? "";

const schema =
  process.env.NAMLA_C9E2B_SCHEMA ?? "";

const missionId =
  process.env.NAMLA_C9E2B_MISSION_ID ?? "";

const objective =
  process.env.NAMLA_C9E2B_OBJECTIVE ?? "";

const action =
  process.env.NAMLA_C9E2B_ACTION ?? "";

if (
  !databaseUrl ||
  !schema ||
  !/^namla_c9e2b_[0-9a-f]{32}$/u.test(schema) ||
  !missionId ||
  !objective ||
  !(
    action === "seed-gap" ||
    action === "resume-gap" ||
    action === "resume-loop"
  )
) {
  process.exit(90);
}

let phase =
  "CONNECT";

let pool:
  Pool | null =
    null;

function context() {
  return {
    missionId,
    authoritativeInputs: [
      "objective",
    ],
    policyVersions: [
      "policy-v1",
    ],
    budgets: {
      virtualTicks: 20,
      providerCalls: 5,
      maxFixAttempts: 3,
    },
    evidenceRefs: [],
    missionStateRef:
      "mission-state-c9e2b",
    contractPhase:
      "PRE_FREEZE" as const,
  };
}

function send(
  value: unknown,
): void {
  if (!process.send) {
    throw new Error(
      "IPC_UNAVAILABLE",
    );
  }

  process.send(
    value,
  );
}

async function finish(
  value: unknown,
): Promise<void> {
  if (!pool) {
    throw new Error(
      "POOL_MISSING",
    );
  }

  await pool.end();
  pool = null;

  if (!process.send) {
    throw new Error(
      "IPC_UNAVAILABLE",
    );
  }

  await new Promise<void>(
    (
      resolve,
      reject,
    ) => {
      process.send?.(
        value,
        (error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        },
      );
    },
  );

  process.disconnect();
}

async function main():
  Promise<void> {
  pool =
    new Pool({
      connectionString:
        databaseUrl,
      ssl:
        false,
      max:
        4,
      connectionTimeoutMillis:
        10_000,
      options:
        `-c search_path=${schema},public -c synchronous_commit=on`,
    });

  const db =
    new PgCheckpointDatabase(
      pool,
    );

  const recovery =
    new PostgresCanonicalRuntimeRecoveryStore(
      db,
    );

  const execution =
    new PostgresExecutionAuthorityStore(
      db,
    );

  const input = {
    objective,
    context:
      context(),
    workerId:
      "c9e2b-worker",
  };

  if (
    action ===
      "seed-gap"
  ) {
    phase =
      "START";

    const authority =
      new PostgresCanonicalFactoryEvidenceAuthority(
        execution,
      );

    const control =
      new DurableCanonicalRuntimeOrchestrator({
        missionId,
        store:
          recovery,
        factoryCompletionAuthority:
          authority,
      });

    const started =
      await control.start(
        input.context.budgets,
      );

    if (
      !started.ok ||
      started.checkpoint
        .checkpointVersion !== 1 ||
      started.checkpoint
        .cursor.stepVersion !== 1 ||
      started.checkpoint
        .cursor.nodeId !== "EER"
    ) {
      throw new Error(
        "START_STATE",
      );
    }

    phase =
      "WRITE_EER";

    const writer =
      new DurableCanonicalEerRuntime(
        execution,
      );

    const written =
      await writer.execute({
        objective:
          input.objective,
        context:
          input.context,
        checkpointVersion:
          started.checkpoint
            .checkpointVersion,
        cursorStepVersion:
          started.checkpoint
            .cursor.stepVersion,
        workerId:
          input.workerId,
      });

    if (
      !written.ok ||
      written.status !==
        "COMPLETED"
    ) {
      throw new Error(
        "WRITE_EER",
      );
    }

    send({
      type:
        "GAP_SEEDED",
      checkpoint:
        started.checkpoint,
      completion:
        written.completion,
      output:
        written.output,
    });

    setInterval(
      () => {},
      1000,
    );

    return;
  }

  phase =
    action === "resume-gap"
      ? "RESUME_GAP"
      : "RESUME_LOOP";

  const runtime =
    new DurableCanonicalEerOrchestratedRuntime({
      missionId,
      recoveryStore:
        recovery,
      executionStore:
        execution,
    });

  const resumed =
    await runtime.resumeAndRunEer(
      input,
    );

  if (!resumed.ok) {
    throw new Error(
      "ORCHESTRATED_RESUME",
    );
  }

  if (
    action ===
      "resume-gap"
  ) {
    if (
      resumed.status !==
        "RESUMED_AND_ADVANCED" ||
      resumed.writerStatus !==
        "REPLAY_COMPLETED" ||
      resumed.checkpoint
        .checkpointVersion !== 2 ||
      resumed.checkpoint
        .cursor.stepVersion !== 2 ||
      resumed.checkpoint
        .cursor.nodeId !==
          "LOOP_AFTER_EER"
    ) {
      throw new Error(
        "RESUME_GAP_STATE",
      );
    }

    await finish({
      type:
        "GAP_RESUMED",
      status:
        resumed.status,
      writerStatus:
        resumed.writerStatus,
      checkpoint:
        resumed.checkpoint,
      completion:
        resumed.completion,
      output:
        resumed.output,
    });

    return;
  }

  if (
    resumed.status !==
      "ALREADY_AT_LOOP_AFTER_EER" ||
    resumed.writerStatus !==
      "NOT_EXECUTED" ||
    resumed.checkpoint
      .checkpointVersion !== 2 ||
    resumed.checkpoint
      .cursor.stepVersion !== 2 ||
    resumed.checkpoint
      .cursor.nodeId !==
        "LOOP_AFTER_EER"
  ) {
    throw new Error(
      "RESUME_LOOP_STATE",
    );
  }

  await finish({
    type:
      "LOOP_REVERIFIED",
    status:
      resumed.status,
    writerStatus:
      resumed.writerStatus,
    checkpoint:
      resumed.checkpoint,
    completion:
      resumed.completion,
    output:
      resumed.output,
  });
}

void main().catch(
  async (error) => {
    const raw =
      error instanceof Error
        ? error.message
        : "UNKNOWN";

    try {
      send({
        type:
          "FAILED",
        phase,
        code:
          /^[A-Z0-9_]{2,48}$/u.test(
            raw,
          )
            ? raw
            : "NO_CODE",
      });
    } catch {
      // fail closed below
    }

    try {
      await pool?.end();
    } catch {
      // process exits non-zero below
    }

    process.exit(92);
  },
);
