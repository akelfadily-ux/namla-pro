/**
 * C9E1D real canonical EER durable writer.
 *
 * First real factory execution slice:
 *
 *   EerEngine
 *     -> durable canonical.factory-output.v2
 *     -> durable canonical.factory-completion.v2
 *     -> independent C9D/C9E verification
 *
 * This component never advances the canonical cursor.
 */

import {
  isDeepStrictEqual,
  types,
} from "node:util";

import {
  EerEngine,
  type EerExecutionResult,
  type EerOutput,
} from "../eer/eerEngine";

import type {
  PreFreezeStageContext,
} from "../types/stageContext";

import type {
  TaskExecutionAuthority,
} from "../kernel/executionAuthority";

import type {
  AcquireTaskLeaseInput,
  ClaimDurableOperationInput,
  CompleteDurableOperationInput,
  PostgresCompletedOperationReadResult,
  PostgresOperationClaimResult,
  PostgresOperationClaimValidationResult,
  PostgresOperationFinalizeResult,
  ReadCompletedDurableOperationInput,
  TaskLeaseAcquireResult,
  ValidateDurableOperationClaimInput,
} from "../persistence/postgresExecutionAuthorityStore";

import {
  PostgresCanonicalFactoryEvidenceAuthority,
  CANONICAL_FACTORY_COMPLETION_OPERATION_TYPE,
  canonicalDurableResultRef,
  canonicalFactoryAuthorityScope,
  canonicalFactoryAuthorityTaskId,
  canonicalFactoryCompletionOperationKey,
} from "../persistence/postgresCanonicalFactoryEvidenceAuthority";

import {
  CANONICAL_FACTORY_OUTPUT_OPERATION_TYPE,
  canonicalFactoryOutputOperationKey,
  fingerprintCanonicalFactoryOutput,
  readCanonicalFactoryOutput,
} from "./canonicalFactoryDurableOutput";

import {
  V2_CANONICAL_FACTORY_COMPLETION_SCHEMA,
  type CanonicalFactoryCompletion,
} from "./durableCanonicalRuntimeOrchestrator";

export interface CanonicalEerExecutionStore {
  acquireTaskLease(
    input: AcquireTaskLeaseInput,
  ): Promise<TaskLeaseAcquireResult>;

  claimOperation(
    input: ClaimDurableOperationInput,
  ): Promise<PostgresOperationClaimResult>;

  validateOperationClaim(
    input: ValidateDurableOperationClaimInput,
  ): Promise<PostgresOperationClaimValidationResult>;

  completeOperation(
    input: CompleteDurableOperationInput,
  ): Promise<PostgresOperationFinalizeResult>;

  readCompletedOperation(
    input: ReadCompletedDurableOperationInput,
  ): Promise<PostgresCompletedOperationReadResult>;
}

export interface DurableCanonicalEerRuntimeInput {
  readonly objective: string;
  readonly context:
    PreFreezeStageContext;
  readonly checkpointVersion: number;
  readonly cursorStepVersion: number;
  readonly workerId: string;
}

export type DurableCanonicalEerRuntimeResult =
  | {
      readonly ok: true;
      readonly status:
        | "COMPLETED"
        | "REPLAY_COMPLETED"
        | "RECOVERED";
      readonly reasonCode: "ok";
      readonly completion:
        CanonicalFactoryCompletion;
      readonly output:
        EerExecutionResult;
    }
  | {
      readonly ok: false;
      readonly status: "REFUSED";
      readonly reasonCode:
        | "input-invalid"
        | "eer-refused"
        | "output-invalid"
        | "durable-state-invalid"
        | "lease-refused"
        | "output-claim-refused"
        | "output-claim-invalid"
        | "output-finalize-refused"
        | "output-replay-mismatch"
        | "completion-claim-refused"
        | "completion-claim-invalid"
        | "completion-finalize-refused"
        | "completion-replay-mismatch"
        | "post-verify-refused";
      readonly detailReasonCode?: string;
    };

const CONTEXT_REQUIRED = [
  "missionId",
  "authoritativeInputs",
  "policyVersions",
  "budgets",
  "evidenceRefs",
  "missionStateRef",
  "contractPhase",
] as const;

const CONTEXT_ALLOWED =
  new Set<string>([
    ...CONTEXT_REQUIRED,
    "executionMode",
    "projectClass",
  ]);

const BUDGET_FIELDS = [
  "virtualTicks",
  "providerCalls",
  "maxFixAttempts",
] as const;

const EER_RESULT_FIELDS = [
  "success",
  "eerOutput",
  "humanRequired",
  "reasonCode",
] as const;

const EER_OUTPUT_FIELDS = [
  "missionId",
  "originalObjective",
  "interpretedIntent",
  "identifiedConstraints",
  "requiredCapabilities",
  "securityImplications",
  "riskClass",
  "unresolvedAmbiguities",
  "authoritySensitive",
] as const;

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
  fields: readonly string[],
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
        fields.length
    ) {
      return null;
    }

    const result:
      Record<string, unknown> =
        Object.create(null);

    for (const field of fields) {
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

      result[field] =
        descriptor.value;
    }

    return result;
  } catch {
    return null;
  }
}

function allowedRecord(
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

    const result:
      Record<string, unknown> =
        Object.create(null);

    for (
      const key
      of Reflect.ownKeys(value)
    ) {
      if (
        typeof key !== "string" ||
        !CONTEXT_ALLOWED.has(key)
      ) {
        return null;
      }

      const descriptor =
        Object.getOwnPropertyDescriptor(
          value,
          key,
        );

      if (
        !descriptor ||
        !("value" in descriptor) ||
        !descriptor.enumerable
      ) {
        return null;
      }

      result[key] =
        descriptor.value;
    }

    for (
      const required
      of CONTEXT_REQUIRED
    ) {
      if (
        !Object.prototype
          .hasOwnProperty.call(
            result,
            required,
          )
      ) {
        return null;
      }
    }

    return result;
  } catch {
    return null;
  }
}

function identifier(
  value: unknown,
  max = 2048,
): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= max &&
    !/[\u0000-\u001f\u007f]/u.test(
      value,
    )
  );
}

function contentText(
  value: unknown,
  max = 65_536,
): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= max &&
    !value.includes("\u0000")
  );
}

function positive(
  value: unknown,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
  );
}

function nonNegative(
  value: unknown,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function stringArray(
  value: unknown,
  allowEmpty = true,
): readonly string[] | null {
  try {
    if (
      !Array.isArray(value) ||
      types.isProxy(value) ||
      Object.getPrototypeOf(value) !==
        Array.prototype ||
      value.length > 4096 ||
      (!allowEmpty && value.length === 0) ||
      Reflect.ownKeys(value).length !==
        value.length + 1
    ) {
      return null;
    }

    const result:
      string[] = [];

    for (
      let index = 0;
      index < value.length;
      index += 1
    ) {
      const descriptor =
        Object.getOwnPropertyDescriptor(
          value,
          String(index),
        );

      if (
        !descriptor ||
        !("value" in descriptor) ||
        !descriptor.enumerable ||
        !contentText(
          descriptor.value,
          4096,
        )
      ) {
        return null;
      }

      result.push(
        descriptor.value,
      );
    }

    return Object.freeze(result);
  } catch {
    return null;
  }
}

export function captureCanonicalEerPreFreezeContext(
  value: unknown,
): PreFreezeStageContext | null {
  const data =
    allowedRecord(
      value,
    );

  if (!data) {
    return null;
  }

  const budgets =
    exactRecord(
      data.budgets,
      BUDGET_FIELDS,
    );

  const authoritativeInputs =
    stringArray(
      data.authoritativeInputs,
    );

  const policyVersions =
    stringArray(
      data.policyVersions,
    );

  const evidenceRefs =
    stringArray(
      data.evidenceRefs,
    );

  if (
    !budgets ||
    data.contractPhase !==
      "PRE_FREEZE" ||
    !identifier(
      data.missionId,
      512,
    ) ||
    !identifier(
      data.missionStateRef,
      2048,
    ) ||
    !authoritativeInputs ||
    !policyVersions ||
    !evidenceRefs ||
    !nonNegative(
      budgets.virtualTicks,
    ) ||
    !nonNegative(
      budgets.providerCalls,
    ) ||
    !nonNegative(
      budgets.maxFixAttempts,
    )
  ) {
    return null;
  }

  const executionMode =
    data.executionMode;

  if (
    executionMode !== undefined &&
    executionMode !== "TEST_MODE" &&
    executionMode !==
      "DETERMINISTIC_FIXTURE_MODE" &&
    executionMode !==
      "PRODUCTION_MODE"
  ) {
    return null;
  }

  const projectClass =
    data.projectClass;

  if (
    projectClass !== undefined &&
    projectClass !==
      "TYPESCRIPT_LIBRARY" &&
    projectClass !==
      "CLI_APPLICATION" &&
    projectClass !==
      "REST_API" &&
    projectClass !==
      "WEB_APPLICATION" &&
    projectClass !==
      "FULLSTACK_APPLICATION" &&
    projectClass !==
      "DATABASE_SERVICE" &&
    projectClass !==
      "DOCKERIZED_SERVICE"
  ) {
    return null;
  }

  return Object.freeze({
    missionId:
      data.missionId,
    authoritativeInputs,
    policyVersions,
    budgets:
      Object.freeze({
        virtualTicks:
          budgets.virtualTicks,
        providerCalls:
          budgets.providerCalls,
        maxFixAttempts:
          budgets.maxFixAttempts,
      }),
    evidenceRefs,
    missionStateRef:
      data.missionStateRef,
    contractPhase:
      "PRE_FREEZE" as const,
    ...(executionMode === undefined
      ? {}
      : {
          executionMode,
        }),
    ...(projectClass === undefined
      ? {}
      : {
          projectClass,
        }),
  });
}

function captureEerOutput(
  value: unknown,
  missionId: string,
  objective: string,
): EerOutput | null {
  const data =
    exactRecord(
      value,
      EER_OUTPUT_FIELDS,
    );

  const identifiedConstraints =
    data
      ? stringArray(
          data.identifiedConstraints,
        )
      : null;

  const requiredCapabilities =
    data
      ? stringArray(
          data.requiredCapabilities,
        )
      : null;

  const securityImplications =
    data
      ? stringArray(
          data.securityImplications,
        )
      : null;

  const unresolvedAmbiguities =
    data
      ? stringArray(
          data.unresolvedAmbiguities,
        )
      : null;

  if (
    !data ||
    data.missionId !==
      missionId ||
    data.originalObjective !==
      objective ||
    !contentText(
      data.interpretedIntent,
    ) ||
    !identifiedConstraints ||
    !requiredCapabilities ||
    !securityImplications ||
    !unresolvedAmbiguities ||
    unresolvedAmbiguities.length !==
      0 ||
    !(
      data.riskClass === "LOW" ||
      data.riskClass === "MEDIUM" ||
      data.riskClass === "HIGH" ||
      data.riskClass === "CRITICAL"
    ) ||
    data.authoritySensitive !==
      false
  ) {
    return null;
  }

  return Object.freeze({
    missionId,
    originalObjective:
      objective,
    interpretedIntent:
      data.interpretedIntent,
    identifiedConstraints,
    requiredCapabilities,
    securityImplications,
    riskClass:
      data.riskClass,
    unresolvedAmbiguities,
    authoritySensitive:
      false,
  });
}

export function restoreCanonicalEerExecutionResult(
  value: unknown,
  missionId: string,
  objective: string,
): EerExecutionResult | null {
  const data =
    exactRecord(
      value,
      EER_RESULT_FIELDS,
    );

  if (
    !data ||
    data.success !== true ||
    data.humanRequired !== false ||
    data.reasonCode !== "OK"
  ) {
    return null;
  }

  const eerOutput =
    captureEerOutput(
      data.eerOutput,
      missionId,
      objective,
    );

  if (!eerOutput) {
    return null;
  }

  return Object.freeze({
    success:
      true,
    eerOutput,
    humanRequired:
      false,
    reasonCode:
      "OK",
  });
}

function captureCompletion(
  value: unknown,
  input:
    DurableCanonicalEerRuntimeInput,
  operationKey: string,
): CanonicalFactoryCompletion | null {
  const data =
    exactRecord(
      value,
      COMPLETION_FIELDS,
    );

  if (
    !data ||
    data.schemaVersion !==
      V2_CANONICAL_FACTORY_COMPLETION_SCHEMA ||
    data.missionId !==
      input.context.missionId ||
    data.factoryId !==
      "EER" ||
    data.checkpointVersion !==
      input.checkpointVersion ||
    data.cursorStepVersion !==
      input.cursorStepVersion ||
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
    return null;
  }

  return Object.freeze({
    schemaVersion:
      V2_CANONICAL_FACTORY_COMPLETION_SCHEMA,
    missionId:
      data.missionId,
    factoryId:
      "EER",
    checkpointVersion:
      data.checkpointVersion,
    cursorStepVersion:
      data.cursorStepVersion,
    operationKey,
    resultRef:
      data.resultRef,
    outputFingerprint:
      data.outputFingerprint,
  });
}

function refused(
  reasonCode:
    Exclude<
      DurableCanonicalEerRuntimeResult[
        "reasonCode"
      ],
      "ok"
    >,
  detailReasonCode?:
    string,
): DurableCanonicalEerRuntimeResult {
  return Object.freeze({
    ok:
      false as const,
    status:
      "REFUSED" as const,
    reasonCode,
    ...(detailReasonCode === undefined
      ? {}
      : {
          detailReasonCode,
        }),
  });
}

function isAbsenceReason(
  reasonCode: string,
): boolean {
  return (
    reasonCode ===
      "operation-not-found" ||
    reasonCode ===
      "operation-not-completed"
  );
}

interface PersistResult {
  readonly ok: boolean;
  readonly replayed: boolean;
  readonly reasonCode?:
    | "claim-refused"
    | "claim-invalid"
    | "finalize-refused"
    | "replay-mismatch";
}

export class DurableCanonicalEerRuntime {
  private readonly engine =
    new EerEngine();

  public constructor(
    private readonly store:
      CanonicalEerExecutionStore,
  ) {}

  public async execute(
    rawInput:
      DurableCanonicalEerRuntimeInput,
  ): Promise<
    DurableCanonicalEerRuntimeResult
  > {
    const context =
      captureCanonicalEerPreFreezeContext(
        rawInput.context,
      );

    if (
      !context ||
      !contentText(
        rawInput.objective,
      ) ||
      !positive(
        rawInput.checkpointVersion,
      ) ||
      !positive(
        rawInput.cursorStepVersion,
      ) ||
      !identifier(
        rawInput.workerId,
        512,
      )
    ) {
      return refused(
        "input-invalid",
      );
    }

    const input:
      DurableCanonicalEerRuntimeInput =
        Object.freeze({
          objective:
            rawInput.objective,
          context,
          checkpointVersion:
            rawInput.checkpointVersion,
          cursorStepVersion:
            rawInput.cursorStepVersion,
          workerId:
            rawInput.workerId,
        });

    const operationKey =
      canonicalFactoryCompletionOperationKey({
        missionId:
          context.missionId,
        factoryId:
          "EER",
        checkpointVersion:
          input.checkpointVersion,
        cursorStepVersion:
          input.cursorStepVersion,
      });

    let existing:
      PostgresCompletedOperationReadResult;

    try {
      existing =
        await this.store
          .readCompletedOperation({
            missionId:
              context.missionId,
            operationKey,
          });
    } catch {
      return refused(
        "durable-state-invalid",
        "COMPLETION_READ_FAILED",
      );
    }

    if (existing.ok) {
      const completion =
        captureCompletion(
          existing.completedValue,
          input,
          operationKey,
        );

      if (!completion) {
        return refused(
          "durable-state-invalid",
          "COMPLETION_VALUE_INVALID",
        );
      }

      const authority =
        new PostgresCanonicalFactoryEvidenceAuthority(
          this.store,
        );

      const verified =
        await authority
          .verifyFactoryCompletion(
            completion,
          );

      if (!verified.ok) {
        return refused(
          "durable-state-invalid",
          verified.reasonCode,
        );
      }

      const durableOutput =
        await readCanonicalFactoryOutput(
          this.store,
          completion,
        );

      if (!durableOutput.ok) {
        return refused(
          "durable-state-invalid",
          durableOutput.reasonCode,
        );
      }

      const output =
        restoreCanonicalEerExecutionResult(
          durableOutput.output,
          context.missionId,
          input.objective,
        );

      if (!output) {
        return refused(
          "durable-state-invalid",
          "EER_OUTPUT_VALUE_INVALID",
        );
      }

      return Object.freeze({
        ok:
          true as const,
        status:
          "REPLAY_COMPLETED" as const,
        reasonCode:
          "ok" as const,
        completion,
        output,
      });
    }

    if (
      !isAbsenceReason(
        existing.reasonCode,
      )
    ) {
      return refused(
        "durable-state-invalid",
        existing.reasonCode,
      );
    }

    let rawOutput:
      EerExecutionResult;

    try {
      rawOutput =
        this.engine.evaluateObjective(
          input.objective,
          context,
        );
    } catch {
      return refused(
        "eer-refused",
        "EER_ENGINE_FAILED",
      );
    }

    if (
      rawOutput.success !== true ||
      rawOutput.humanRequired !==
        false ||
      rawOutput.reasonCode !==
        "OK"
    ) {
      return refused(
        "eer-refused",
        rawOutput.reasonCode,
      );
    }

    const output =
      restoreCanonicalEerExecutionResult(
        rawOutput,
        context.missionId,
        input.objective,
      );

    if (!output) {
      return refused(
        "output-invalid",
        "EER_OUTPUT_CAPTURE_FAILED",
      );
    }

    let outputFingerprint:
      string;

    try {
      outputFingerprint =
        fingerprintCanonicalFactoryOutput(
          "EER",
          output,
        );
    } catch {
      return refused(
        "output-invalid",
        "OUTPUT_FINGERPRINT_FAILED",
      );
    }

    const completion:
      CanonicalFactoryCompletion =
        Object.freeze({
          schemaVersion:
            V2_CANONICAL_FACTORY_COMPLETION_SCHEMA,
          missionId:
            context.missionId,
          factoryId:
            "EER",
          checkpointVersion:
            input.checkpointVersion,
          cursorStepVersion:
            input.cursorStepVersion,
          operationKey,
          resultRef:
            canonicalDurableResultRef(
              operationKey,
            ),
          outputFingerprint,
        });

    let lease:
      TaskLeaseAcquireResult;

    try {
      lease =
        await this.store
          .acquireTaskLease({
            missionId:
              context.missionId,
            taskId:
              canonicalFactoryAuthorityTaskId(
                "EER",
              ),
            workerId:
              input.workerId,
            authorityScope:
              canonicalFactoryAuthorityScope(
                "EER",
              ),
            leaseDurationMs:
              60_000,
          });
    } catch {
      return refused(
        "lease-refused",
        "LEASE_ACQUIRE_FAILED",
      );
    }

    if (!lease.ok) {
      return refused(
        "lease-refused",
        lease.reasonCode,
      );
    }

    const outputPersist =
      await this.persist(
        canonicalFactoryOutputOperationKey(
          completion,
        ),
        CANONICAL_FACTORY_OUTPUT_OPERATION_TYPE,
        completion,
        output,
        lease.authority,
      );

    if (!outputPersist.ok) {
      return refused(
        outputPersist.reasonCode ===
          "claim-refused"
          ? "output-claim-refused"
          : outputPersist.reasonCode ===
              "claim-invalid"
            ? "output-claim-invalid"
            : outputPersist.reasonCode ===
                "finalize-refused"
              ? "output-finalize-refused"
              : "output-replay-mismatch",
        outputPersist.reasonCode,
      );
    }

    const completionPersist =
      await this.persist(
        completion.operationKey,
        CANONICAL_FACTORY_COMPLETION_OPERATION_TYPE,
        completion,
        completion,
        lease.authority,
      );

    if (!completionPersist.ok) {
      return refused(
        completionPersist.reasonCode ===
          "claim-refused"
          ? "completion-claim-refused"
          : completionPersist.reasonCode ===
              "claim-invalid"
            ? "completion-claim-invalid"
            : completionPersist.reasonCode ===
                "finalize-refused"
              ? "completion-finalize-refused"
              : "completion-replay-mismatch",
        completionPersist.reasonCode,
      );
    }

    const authority =
      new PostgresCanonicalFactoryEvidenceAuthority(
        this.store,
      );

    const completionVerified =
      await authority
        .verifyFactoryCompletion(
          completion,
        );

    if (!completionVerified.ok) {
      return refused(
        "post-verify-refused",
        completionVerified.reasonCode,
      );
    }

    const outputVerified =
      await readCanonicalFactoryOutput(
        this.store,
        completion,
      );

    if (
      !outputVerified.ok ||
      !isDeepStrictEqual(
        outputVerified.output,
        output,
      )
    ) {
      return refused(
        "post-verify-refused",
        outputVerified.ok
          ? "OUTPUT_VALUE_MISMATCH"
          : outputVerified.reasonCode,
      );
    }

    return Object.freeze({
      ok:
        true as const,
      status:
        outputPersist.replayed ||
        completionPersist.replayed
          ? "RECOVERED" as const
          : "COMPLETED" as const,
      reasonCode:
        "ok" as const,
      completion,
      output,
    });
  }

  private async persist(
    operationKey: string,
    operationType: string,
    identityValue: unknown,
    completedValue: unknown,
    authority:
      TaskExecutionAuthority,
  ): Promise<PersistResult> {
    let claim:
      PostgresOperationClaimResult;

    try {
      claim =
        await this.store
          .claimOperation({
            operationKey,
            operationType,
            value:
              identityValue,
            authority,
            claimDurationMs:
              30_000,
          });
    } catch {
      return {
        ok:
          false,
        replayed:
          false,
        reasonCode:
          "claim-refused",
      };
    }

    if (!claim.ok) {
      return {
        ok:
          false,
        replayed:
          false,
        reasonCode:
          "claim-refused",
      };
    }

    if (
      claim.status ===
        "REPLAY_COMPLETED"
    ) {
      if (
        !isDeepStrictEqual(
          claim.completedValue,
          completedValue,
        )
      ) {
        return {
          ok:
            false,
          replayed:
            true,
          reasonCode:
            "replay-mismatch",
        };
      }

      return {
        ok:
          true,
        replayed:
          true,
      };
    }

    if (
      (
        claim.status !== "CLAIMED" &&
        claim.status !==
          "ALREADY_CLAIMED_BY_CALLER"
      ) ||
      !claim.record
    ) {
      return {
        ok:
          false,
        replayed:
          false,
        reasonCode:
          "claim-invalid",
      };
    }

    let current:
      PostgresOperationClaimValidationResult;

    try {
      current =
        await this.store
          .validateOperationClaim({
            operationKey,
            authority,
            claimToken:
              claim.record.claimToken,
            claimEpoch:
              claim.record.claimEpoch,
          });
    } catch {
      return {
        ok:
          false,
        replayed:
          false,
        reasonCode:
          "claim-invalid",
      };
    }

    if (!current.ok) {
      return {
        ok:
          false,
        replayed:
          false,
        reasonCode:
          "claim-invalid",
      };
    }

    let finalized:
      PostgresOperationFinalizeResult;

    try {
      finalized =
        await this.store
          .completeOperation({
            operationKey,
            authority,
            claimToken:
              claim.record.claimToken,
            claimEpoch:
              claim.record.claimEpoch,
            value:
              completedValue,
          });
    } catch {
      return {
        ok:
          false,
        replayed:
          false,
        reasonCode:
          "finalize-refused",
      };
    }

    if (!finalized.ok) {
      return {
        ok:
          false,
        replayed:
          false,
        reasonCode:
          "finalize-refused",
      };
    }

    return {
      ok:
        true,
      replayed:
        false,
    };
  }
}
