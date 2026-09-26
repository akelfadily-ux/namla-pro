import { types } from "node:util";

import type {
  EerExecutionResult,
} from "../eer/eerEngine";

import type {
  CanonicalRuntimeRecoveryCheckpoint,
} from "../persistence/canonicalRuntimeRecoveryCheckpoint";

import type {
  CanonicalRuntimeRecoveryStore,
} from "../persistence/canonicalRuntimeRecoveryStore";

import {
  PostgresCanonicalFactoryEvidenceAuthority,
  canonicalDurableResultRef,
  canonicalFactoryCompletionOperationKey,
} from "../persistence/postgresCanonicalFactoryEvidenceAuthority";

import {
  V2_CANONICAL_FACTORY_COMPLETION_SCHEMA,
  DurableCanonicalRuntimeOrchestrator,
  type CanonicalFactoryCompletion,
} from "./durableCanonicalRuntimeOrchestrator";

import {
  DurableCanonicalEerRuntime,
  captureCanonicalEerPreFreezeContext,
  restoreCanonicalEerExecutionResult,
  type CanonicalEerExecutionStore,
} from "./durableCanonicalEerRuntime";

import {
  readCanonicalFactoryOutput,
} from "./canonicalFactoryDurableOutput";

import type {
  PreFreezeStageContext,
} from "../types/stageContext";

export interface DurableCanonicalEerOrchestratedRuntimeOptions {
  readonly missionId: string;
  readonly recoveryStore:
    CanonicalRuntimeRecoveryStore;
  readonly executionStore:
    CanonicalEerExecutionStore;
  readonly maxLivelockThreshold?: number;
  readonly clock?: () => number;
}

export interface DurableCanonicalEerOrchestratedInput {
  readonly objective: string;
  readonly context:
    PreFreezeStageContext;
  readonly workerId: string;
}

export type DurableCanonicalEerOrchestratedResult =
  | {
      readonly ok: true;
      readonly status:
        | "STARTED_AND_ADVANCED"
        | "RESUMED_AND_ADVANCED"
        | "ALREADY_AT_LOOP_AFTER_EER";
      readonly reasonCode: "ok";
      readonly checkpoint:
        CanonicalRuntimeRecoveryCheckpoint;
      readonly completion:
        CanonicalFactoryCompletion;
      readonly output:
        EerExecutionResult;
      readonly writerStatus:
        | "COMPLETED"
        | "REPLAY_COMPLETED"
        | "RECOVERED"
        | "NOT_EXECUTED";
    }
  | {
      readonly ok: false;
      readonly status: "REFUSED";
      readonly reasonCode:
        | "input-invalid"
        | "control-refused"
        | "unexpected-step"
        | "eer-writer-refused"
        | "completion-commit-refused"
        | "durable-replay-invalid";
      readonly detailReasonCode?: string;
      readonly checkpoint?:
        CanonicalRuntimeRecoveryCheckpoint;
    };

const COMPLETION_FIELDS = [
  "schemaVersion",
  "missionId",
  "factoryId",
  "checkpointVersion",
  "cursorStepVersion",
  "operationKey",
  "resultRef",
  "outputFingerprint",
] as const;

function exactRecord(
  value: unknown,
): Record<string, unknown> | null {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      types.isProxy(value)
    ) {
      return null;
    }

    const prototype =
      Object.getPrototypeOf(value);

    if (
      prototype !== Object.prototype &&
      prototype !== null
    ) {
      return null;
    }

    if (
      Reflect.ownKeys(value).length !==
        COMPLETION_FIELDS.length
    ) {
      return null;
    }

    const out:
      Record<string, unknown> =
        Object.create(null);

    for (
      const field
      of COMPLETION_FIELDS
    ) {
      const descriptor =
        Object.getOwnPropertyDescriptor(
          value,
          field,
        );

      if (
        !descriptor ||
        !("value" in descriptor) ||
        !descriptor.enumerable
      ) {
        return null;
      }

      out[field] =
        descriptor.value;
    }

    return out;
  } catch {
    return null;
  }
}

function capturedInput(
  raw:
    DurableCanonicalEerOrchestratedInput,
  missionId: string,
):
  | {
      readonly objective: string;
      readonly context:
        PreFreezeStageContext;
      readonly workerId: string;
    }
  | null {
  const context =
    captureCanonicalEerPreFreezeContext(
      raw.context,
    );

  if (
    !context ||
    context.missionId !==
      missionId ||
    typeof raw.objective !==
      "string" ||
    raw.objective.trim().length ===
      0 ||
    raw.objective.length >
      65_536 ||
    raw.objective.includes(
      "\u0000",
    ) ||
    typeof raw.workerId !==
      "string" ||
    raw.workerId.trim().length ===
      0 ||
    raw.workerId.length >
      512
  ) {
    return null;
  }

  return Object.freeze({
    objective:
      raw.objective,
    context,
    workerId:
      raw.workerId,
  });
}

function refused(
  reasonCode:
    Exclude<
      DurableCanonicalEerOrchestratedResult[
        "reasonCode"
      ],
      "ok"
    >,
  detailReasonCode?:
    string,
  checkpoint?:
    CanonicalRuntimeRecoveryCheckpoint,
): DurableCanonicalEerOrchestratedResult {
  return Object.freeze({
    ok: false as const,
    status:
      "REFUSED" as const,
    reasonCode,
    ...(detailReasonCode ===
    undefined
      ? {}
      : {
          detailReasonCode,
        }),
    ...(checkpoint === undefined
      ? {}
      : {
          checkpoint,
        }),
  });
}

export class DurableCanonicalEerOrchestratedRuntime {
  private readonly writer:
    DurableCanonicalEerRuntime;

  private readonly authority:
    PostgresCanonicalFactoryEvidenceAuthority;

  private readonly control:
    DurableCanonicalRuntimeOrchestrator;

  public constructor(
    options:
      DurableCanonicalEerOrchestratedRuntimeOptions,
  ) {
    this.writer =
      new DurableCanonicalEerRuntime(
        options.executionStore,
      );

    this.authority =
      new PostgresCanonicalFactoryEvidenceAuthority(
        options.executionStore,
      );

    this.control =
      new DurableCanonicalRuntimeOrchestrator({
        missionId:
          options.missionId,
        store:
          options.recoveryStore,
        factoryCompletionAuthority:
          this.authority,
        ...(options.maxLivelockThreshold ===
        undefined
          ? {}
          : {
              maxLivelockThreshold:
                options.maxLivelockThreshold,
            }),
        ...(options.clock === undefined
          ? {}
          : {
              clock:
                options.clock,
            }),
      });

    this.missionId =
      options.missionId;

    this.executionStore =
      options.executionStore;
  }

  private readonly missionId:
    string;

  private readonly executionStore:
    CanonicalEerExecutionStore;

  public async startAndRunEer(
    raw:
      DurableCanonicalEerOrchestratedInput,
  ): Promise<
    DurableCanonicalEerOrchestratedResult
  > {
    const input =
      capturedInput(
        raw,
        this.missionId,
      );

    if (!input) {
      return refused(
        "input-invalid",
      );
    }

    const started =
      await this.control.start(
        input.context.budgets,
      );

    if (!started.ok) {
      return refused(
        "control-refused",
        started.reasonCode,
        started.checkpoint,
      );
    }

    return this.runCurrentEer(
      input,
      "STARTED_AND_ADVANCED",
    );
  }

  public async resumeAndRunEer(
    raw:
      DurableCanonicalEerOrchestratedInput,
  ): Promise<
    DurableCanonicalEerOrchestratedResult
  > {
    const input =
      capturedInput(
        raw,
        this.missionId,
      );

    if (!input) {
      return refused(
        "input-invalid",
      );
    }

    const resumed =
      await this.control.resume(
        null,
      );

    if (!resumed.ok) {
      return refused(
        "control-refused",
        resumed.reasonCode,
        resumed.checkpoint,
      );
    }

    const inspection =
      this.control.inspectCurrentStep();

    if (!inspection.ok) {
      return refused(
        "control-refused",
        inspection.reasonCode,
      );
    }

    if (
      inspection.decision.kind ===
        "EVALUATE_NAMLA_LOOP" &&
      inspection.decision.gateInstanceId ===
        "LOOP_AFTER_EER" &&
      inspection.decision.afterFactory ===
        "EER"
    ) {
      return this.recoverAtLoop(
        input,
        inspection.checkpoint,
      );
    }

    return this.runCurrentEer(
      input,
      "RESUMED_AND_ADVANCED",
    );
  }

  private async runCurrentEer(
    input: {
      readonly objective:
        string;
      readonly context:
        PreFreezeStageContext;
      readonly workerId:
        string;
    },
    status:
      | "STARTED_AND_ADVANCED"
      | "RESUMED_AND_ADVANCED",
  ): Promise<
    DurableCanonicalEerOrchestratedResult
  > {
    const inspection =
      this.control.inspectCurrentStep();

    if (
      !inspection.ok ||
      inspection.decision.kind !==
        "RUN_FACTORY" ||
      inspection.decision.factoryId !==
        "EER" ||
      inspection.decision.requiredContextPhase !==
        "PRE_FREEZE"
    ) {
      return refused(
        "unexpected-step",
        inspection.ok
          ? inspection.decision.kind
          : inspection.reasonCode,
        inspection.ok
          ? inspection.checkpoint
          : undefined,
      );
    }

    const before =
      inspection.checkpoint;

    const writer =
      await this.writer.execute({
        objective:
          input.objective,
        context:
          input.context,
        checkpointVersion:
          before.checkpointVersion,
        cursorStepVersion:
          before.cursor.stepVersion,
        workerId:
          input.workerId,
      });

    if (!writer.ok) {
      return refused(
        "eer-writer-refused",
        writer.detailReasonCode ??
          writer.reasonCode,
        before,
      );
    }

    const committed =
      await this.control
        .commitFactoryCompletion(
          writer.completion,
        );

    if (!committed.ok) {
      return refused(
        "completion-commit-refused",
        committed.detailReasonCode ??
          committed.reasonCode,
        committed.checkpoint ??
          before,
      );
    }

    const after =
      this.control.inspectCurrentStep();

    if (
      !after.ok ||
      after.decision.kind !==
        "EVALUATE_NAMLA_LOOP" ||
      after.decision.gateInstanceId !==
        "LOOP_AFTER_EER" ||
      after.decision.afterFactory !==
        "EER"
    ) {
      return refused(
        "unexpected-step",
        after.ok
          ? after.decision.kind
          : after.reasonCode,
        committed.checkpoint,
      );
    }

    if (
      committed.checkpoint.cursor.nodeId !==
        "LOOP_AFTER_EER" ||
      committed.checkpoint.cursor.nodeKind !==
        "GATE" ||
      committed.checkpoint.checkpointVersion !==
        before.checkpointVersion + 1 ||
      committed.checkpoint.cursor.stepVersion !==
        before.cursor.stepVersion + 1
    ) {
      return refused(
        "unexpected-step",
        "EER_ADVANCEMENT_INVARIANT_FAILED",
        committed.checkpoint,
      );
    }

    return Object.freeze({
      ok: true as const,
      status,
      reasonCode:
        "ok" as const,
      checkpoint:
        committed.checkpoint,
      completion:
        writer.completion,
      output:
        writer.output,
      writerStatus:
        writer.status,
    });
  }

  private async recoverAtLoop(
    input: {
      readonly objective:
        string;
      readonly context:
        PreFreezeStageContext;
      readonly workerId:
        string;
    },
    checkpoint:
      CanonicalRuntimeRecoveryCheckpoint,
  ): Promise<
    DurableCanonicalEerOrchestratedResult
  > {
    const checkpointVersion =
      checkpoint.checkpointVersion - 1;

    const cursorStepVersion =
      checkpoint.cursor.stepVersion - 1;

    if (
      !Number.isSafeInteger(
        checkpointVersion,
      ) ||
      checkpointVersion < 1 ||
      !Number.isSafeInteger(
        cursorStepVersion,
      ) ||
      cursorStepVersion < 1
    ) {
      return refused(
        "durable-replay-invalid",
        "PRIOR_EER_VERSION_INVALID",
        checkpoint,
      );
    }

    const operationKey =
      canonicalFactoryCompletionOperationKey({
        missionId:
          this.missionId,
        factoryId:
          "EER",
        checkpointVersion,
        cursorStepVersion,
      });

    const stored =
      await this.executionStore
        .readCompletedOperation({
          missionId:
            this.missionId,
          operationKey,
        });

    if (!stored.ok) {
      return refused(
        "durable-replay-invalid",
        stored.reasonCode,
        checkpoint,
      );
    }

    const data =
      exactRecord(
        stored.completedValue,
      );

    if (
      !data ||
      data.schemaVersion !==
        V2_CANONICAL_FACTORY_COMPLETION_SCHEMA ||
      data.missionId !==
        this.missionId ||
      data.factoryId !==
        "EER" ||
      data.checkpointVersion !==
        checkpointVersion ||
      data.cursorStepVersion !==
        cursorStepVersion ||
      data.operationKey !==
        operationKey ||
      data.resultRef !==
        canonicalDurableResultRef(
          operationKey,
        ) ||
      typeof data.outputFingerprint !==
        "string" ||
      !/^[0-9a-f]{64}$/u.test(
        data.outputFingerprint,
      )
    ) {
      return refused(
        "durable-replay-invalid",
        "COMPLETION_VALUE_INVALID",
        checkpoint,
      );
    }

    const completion:
      CanonicalFactoryCompletion =
        Object.freeze({
          schemaVersion:
            V2_CANONICAL_FACTORY_COMPLETION_SCHEMA,
          missionId:
            this.missionId,
          factoryId:
            "EER",
          checkpointVersion,
          cursorStepVersion,
          operationKey,
          resultRef:
            data.resultRef,
          outputFingerprint:
            data.outputFingerprint,
        });

    const verified =
      await this.authority
        .verifyFactoryCompletion(
          completion,
        );

    if (!verified.ok) {
      return refused(
        "durable-replay-invalid",
        verified.reasonCode,
        checkpoint,
      );
    }

    const outputRead =
      await readCanonicalFactoryOutput(
        this.executionStore,
        completion,
      );

    if (!outputRead.ok) {
      return refused(
        "durable-replay-invalid",
        outputRead.reasonCode,
        checkpoint,
      );
    }

    const output =
      restoreCanonicalEerExecutionResult(
        outputRead.output,
        this.missionId,
        input.objective,
      );

    if (!output) {
      return refused(
        "durable-replay-invalid",
        "EER_OUTPUT_VALUE_INVALID",
        checkpoint,
      );
    }

    return Object.freeze({
      ok: true as const,
      status:
        "ALREADY_AT_LOOP_AFTER_EER" as const,
      reasonCode:
        "ok" as const,
      checkpoint,
      completion,
      output,
      writerStatus:
        "NOT_EXECUTED" as const,
    });
  }
}
