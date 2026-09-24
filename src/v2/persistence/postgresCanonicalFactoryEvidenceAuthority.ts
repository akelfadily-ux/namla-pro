/**
 * C9D1 durable canonical factory/proof authority.
 *
 * Reuses the existing PostgreSQL execution-authority ledger. A canonical
 * completion/proof is accepted only when an already-COMPLETED durable operation
 * is bound to the exact mission, task, authority scope, operation type, input
 * fingerprint and JSON result.
 *
 * This module is VERIFY-ONLY. It cannot acquire leases, claim operations,
 * complete operations or execute factories.
 */

import { createHash } from "node:crypto";
import {
  isDeepStrictEqual,
  types,
} from "node:util";

import {
  CANONICAL_FACTORY_ORDER,
  type CanonicalFactoryId,
} from "../architecture/canonicalPipelineRegistry";

import {
  fingerprintOperationIdentity,
} from "../kernel/operationIdentity";

import {
  V2_CANONICAL_FACTORY_COMPLETION_SCHEMA,
  type CanonicalFactoryCompletion,
  type CanonicalFactoryCompletionAuthority,
  type CanonicalFactoryCompletionAuthorityResult,
} from "../runtime/durableCanonicalRuntimeOrchestrator";

import {
  V2_CANONICAL_POST_PROMAX_PROOF_SCHEMA,
  type CanonicalPostProMaxProof,
  type CanonicalPostProMaxProofAuthority,
  type CanonicalPostProMaxProofAuthorityResult,
  type CanonicalPostProMaxStageId,
} from "../assurance/postProMaxAssuranceFactories";

import type {
  OperationExecutionRecord,
} from "../kernel/executionAuthority";

import type {
  PostgresCompletedOperationReadResult,
  ReadCompletedDurableOperationInput,
} from "./postgresExecutionAuthorityStore";

export const CANONICAL_FACTORY_COMPLETION_OPERATION_TYPE =
  "canonical.factory-completion.v1" as const;

export const CANONICAL_ASSURANCE_PROOF_OPERATION_TYPE =
  "canonical.assurance-proof.v1" as const;

export interface DurableCompletedOperationReader {
  readCompletedOperation(
    input: ReadCompletedDurableOperationInput,
  ): Promise<PostgresCompletedOperationReadResult>;
}

export interface CanonicalFactoryCompletionKeyInput {
  readonly missionId: string;
  readonly factoryId: CanonicalFactoryId;
  readonly checkpointVersion: number;
  readonly cursorStepVersion: number;
  readonly outputFingerprint: string;
}

export interface CanonicalAssuranceProofKeyInput {
  readonly missionId: string;
  readonly candidateId: string;
  readonly contractId: string;
  readonly contractVersion: string;
  readonly contractHash: string;
  readonly stageId: CanonicalPostProMaxStageId;
  readonly outputFingerprint: string;
}

const HASH = /^[0-9a-f]{64}$/u;

const FACTORY_IDS =
  new Set<string>(
    CANONICAL_FACTORY_ORDER,
  );

const ASSURANCE_STAGES =
  new Set<string>([
    "PROMAX",
    "FINAL_SPRINT_COURT",
    "LIHU",
    "DEVOPS",
    "API_INTEGRATION",
    "SECURITY",
  ]);

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

const PROOF_FIELDS = [
  "schemaVersion",
  "missionId",
  "candidateId",
  "contractId",
  "contractVersion",
  "contractHash",
  "stageId",
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

    const prototype: unknown =
      Object.getPrototypeOf(value);

    if (
      prototype !== Object.prototype &&
      prototype !== null
    ) {
      return null;
    }

    if (
      Reflect.ownKeys(value).length !== fields.length
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

      result[field] = descriptor.value;
    }

    return result;
  } catch {
    return null;
  }
}

function text(
  value: unknown,
  max = 2048,
): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= max &&
    !/[\u0000-\u001f\u007f]/u.test(value)
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

function digest(
  domain: string,
  payload: unknown,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        domain,
        1,
        payload,
      ]),
      "utf8",
    )
    .digest("hex");
}

export function canonicalFactoryAuthorityScope(
  factoryId: CanonicalFactoryId,
): string {
  return `CANONICAL_FACTORY/${factoryId}`;
}

export function canonicalFactoryAuthorityTaskId(
  factoryId: CanonicalFactoryId,
): string {
  return `canonical-factory:${factoryId}`;
}

export function canonicalAssuranceAuthorityScope(
  stageId: CanonicalPostProMaxStageId,
): string {
  return `CANONICAL_ASSURANCE/${stageId}`;
}

export function canonicalAssuranceAuthorityTaskId(
  stageId: CanonicalPostProMaxStageId,
): string {
  return `canonical-assurance:${stageId}`;
}

export function canonicalFactoryCompletionOperationKey(
  input: CanonicalFactoryCompletionKeyInput,
): string {
  return (
    "factory-completion:" +
    digest(
      "NAMLA_V2_CANONICAL_FACTORY_COMPLETION",
      {
        missionId: input.missionId,
        factoryId: input.factoryId,
        checkpointVersion: input.checkpointVersion,
        cursorStepVersion: input.cursorStepVersion,
        outputFingerprint: input.outputFingerprint,
      },
    )
  );
}

export function canonicalAssuranceProofOperationKey(
  input: CanonicalAssuranceProofKeyInput,
): string {
  return (
    "assurance-proof:" +
    digest(
      "NAMLA_V2_CANONICAL_ASSURANCE_PROOF",
      {
        missionId: input.missionId,
        candidateId: input.candidateId,
        contractId: input.contractId,
        contractVersion: input.contractVersion,
        contractHash: input.contractHash,
        stageId: input.stageId,
        outputFingerprint: input.outputFingerprint,
      },
    )
  );
}

export function canonicalDurableResultRef(
  operationKey: string,
): string {
  return `pgop:${operationKey}`;
}

function readCompletion(
  value: unknown,
): CanonicalFactoryCompletion | null {
  const data =
    exactRecord(value, COMPLETION_FIELDS);

  if (
    !data ||
    data.schemaVersion !==
      V2_CANONICAL_FACTORY_COMPLETION_SCHEMA ||
    !text(data.missionId, 512) ||
    typeof data.factoryId !== "string" ||
    !FACTORY_IDS.has(data.factoryId) ||
    !positive(data.checkpointVersion) ||
    !positive(data.cursorStepVersion) ||
    !text(data.operationKey, 512) ||
    !text(data.resultRef, 1024) ||
    typeof data.outputFingerprint !== "string" ||
    !HASH.test(data.outputFingerprint)
  ) {
    return null;
  }

  return Object.freeze({
    schemaVersion:
      V2_CANONICAL_FACTORY_COMPLETION_SCHEMA,
    missionId: data.missionId,
    factoryId:
      data.factoryId as CanonicalFactoryId,
    checkpointVersion:
      data.checkpointVersion,
    cursorStepVersion:
      data.cursorStepVersion,
    operationKey:
      data.operationKey,
    resultRef:
      data.resultRef,
    outputFingerprint:
      data.outputFingerprint,
  });
}

function readProof(
  value: unknown,
): CanonicalPostProMaxProof | null {
  const data =
    exactRecord(value, PROOF_FIELDS);

  if (
    !data ||
    data.schemaVersion !==
      V2_CANONICAL_POST_PROMAX_PROOF_SCHEMA ||
    !text(data.missionId, 512) ||
    !text(data.candidateId, 512) ||
    !text(data.contractId, 512) ||
    !text(data.contractVersion, 512) ||
    typeof data.contractHash !== "string" ||
    !HASH.test(data.contractHash) ||
    typeof data.stageId !== "string" ||
    !ASSURANCE_STAGES.has(data.stageId) ||
    !text(data.resultRef, 1024) ||
    typeof data.outputFingerprint !== "string" ||
    !HASH.test(data.outputFingerprint)
  ) {
    return null;
  }

  return Object.freeze({
    schemaVersion:
      V2_CANONICAL_POST_PROMAX_PROOF_SCHEMA,
    missionId: data.missionId,
    candidateId: data.candidateId,
    contractId: data.contractId,
    contractVersion: data.contractVersion,
    contractHash: data.contractHash,
    stageId:
      data.stageId as CanonicalPostProMaxStageId,
    resultRef: data.resultRef,
    outputFingerprint:
      data.outputFingerprint,
  });
}

function recordMatches(
  record: OperationExecutionRecord,
  expected: {
    readonly taskId: string;
    readonly authorityScope: string;
    readonly operationType: string;
    readonly inputFingerprint: string;
  },
): boolean {
  return (
    record.status === "COMPLETED" &&
    record.taskId === expected.taskId &&
    record.authorityScope === expected.authorityScope &&
    record.operationType === expected.operationType &&
    record.inputFingerprint === expected.inputFingerprint
  );
}

export class PostgresCanonicalFactoryEvidenceAuthority
  implements
    CanonicalFactoryCompletionAuthority,
    CanonicalPostProMaxProofAuthority
{
  public constructor(
    private readonly reader:
      DurableCompletedOperationReader,
  ) {}

  public async verifyFactoryCompletion(
    value: CanonicalFactoryCompletion,
  ): Promise<CanonicalFactoryCompletionAuthorityResult> {
    const completion =
      readCompletion(value);

    if (!completion) {
      return this.factoryRefused(
        "DURABLE_COMPLETION_INVALID",
      );
    }

    const expectedKey =
      canonicalFactoryCompletionOperationKey({
        missionId: completion.missionId,
        factoryId: completion.factoryId,
        checkpointVersion:
          completion.checkpointVersion,
        cursorStepVersion:
          completion.cursorStepVersion,
        outputFingerprint:
          completion.outputFingerprint,
      });

    if (
      completion.operationKey !== expectedKey ||
      completion.resultRef !==
        canonicalDurableResultRef(expectedKey)
    ) {
      return this.factoryRefused(
        "DURABLE_COMPLETION_REFERENCE_MISMATCH",
      );
    }

    const scope =
      canonicalFactoryAuthorityScope(
        completion.factoryId,
      );

    const inputFingerprint =
      fingerprintOperationIdentity({
        missionId: completion.missionId,
        authorityScope: scope,
        operationType:
          CANONICAL_FACTORY_COMPLETION_OPERATION_TYPE,
        value: completion,
      });

    let durable:
      PostgresCompletedOperationReadResult;

    try {
      durable =
        await this.reader
          .readCompletedOperation({
            missionId:
              completion.missionId,
            operationKey:
              completion.operationKey,
          });
    } catch {
      return this.factoryRefused(
        "DURABLE_COMPLETION_READ_FAILED",
      );
    }

    if (!durable.ok) {
      return this.factoryRefused(
        `DURABLE_COMPLETION_${durable.reasonCode.toUpperCase().replace(/-/g, "_")}`,
      );
    }

    if (
      !recordMatches(
        durable.record,
        {
          taskId:
            canonicalFactoryAuthorityTaskId(
              completion.factoryId,
            ),
          authorityScope:
            scope,
          operationType:
            CANONICAL_FACTORY_COMPLETION_OPERATION_TYPE,
          inputFingerprint,
        },
      )
    ) {
      return this.factoryRefused(
        "DURABLE_COMPLETION_BINDING_MISMATCH",
      );
    }

    if (
      !isDeepStrictEqual(
        durable.completedValue,
        completion,
      )
    ) {
      return this.factoryRefused(
        "DURABLE_COMPLETION_RESULT_MISMATCH",
      );
    }

    return Object.freeze({
      ok: true as const,
      status: "VERIFIED" as const,
      reasonCode: "ok" as const,
      completion,
    });
  }

  public async verifyProof(
    value: CanonicalPostProMaxProof,
  ): Promise<CanonicalPostProMaxProofAuthorityResult> {
    const proof =
      readProof(value);

    if (!proof) {
      return this.proofRefused(
        "DURABLE_PROOF_INVALID",
      );
    }

    const expectedKey =
      canonicalAssuranceProofOperationKey({
        missionId: proof.missionId,
        candidateId: proof.candidateId,
        contractId: proof.contractId,
        contractVersion:
          proof.contractVersion,
        contractHash: proof.contractHash,
        stageId: proof.stageId,
        outputFingerprint:
          proof.outputFingerprint,
      });

    if (
      proof.resultRef !==
        canonicalDurableResultRef(expectedKey)
    ) {
      return this.proofRefused(
        "DURABLE_PROOF_REFERENCE_MISMATCH",
      );
    }

    const scope =
      canonicalAssuranceAuthorityScope(
        proof.stageId,
      );

    const inputFingerprint =
      fingerprintOperationIdentity({
        missionId: proof.missionId,
        authorityScope: scope,
        operationType:
          CANONICAL_ASSURANCE_PROOF_OPERATION_TYPE,
        value: proof,
      });

    let durable:
      PostgresCompletedOperationReadResult;

    try {
      durable =
        await this.reader
          .readCompletedOperation({
            missionId:
              proof.missionId,
            operationKey:
              expectedKey,
          });
    } catch {
      return this.proofRefused(
        "DURABLE_PROOF_READ_FAILED",
      );
    }

    if (!durable.ok) {
      return this.proofRefused(
        `DURABLE_PROOF_${durable.reasonCode.toUpperCase().replace(/-/g, "_")}`,
      );
    }

    if (
      durable.record.operationKey !==
        expectedKey ||
      !recordMatches(
        durable.record,
        {
          taskId:
            canonicalAssuranceAuthorityTaskId(
              proof.stageId,
            ),
          authorityScope:
            scope,
          operationType:
            CANONICAL_ASSURANCE_PROOF_OPERATION_TYPE,
          inputFingerprint,
        },
      )
    ) {
      return this.proofRefused(
        "DURABLE_PROOF_BINDING_MISMATCH",
      );
    }

    if (
      !isDeepStrictEqual(
        durable.completedValue,
        proof,
      )
    ) {
      return this.proofRefused(
        "DURABLE_PROOF_RESULT_MISMATCH",
      );
    }

    return Object.freeze({
      ok: true as const,
      status: "VERIFIED" as const,
      reasonCode: "ok" as const,
      proof,
    });
  }

  private factoryRefused(
    reasonCode: string,
  ): CanonicalFactoryCompletionAuthorityResult {
    return Object.freeze({
      ok: false as const,
      status: "REFUSED" as const,
      reasonCode,
    });
  }

  private proofRefused(
    reasonCode: string,
  ): CanonicalPostProMaxProofAuthorityResult {
    return Object.freeze({
      ok: false as const,
      status: "REFUSED" as const,
      reasonCode,
    });
  }
}
