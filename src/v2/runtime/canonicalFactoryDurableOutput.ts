/**
 * C9E1A durable canonical factory-output contract.
 *
 * Canonical factory completion and heterogeneous factory output are distinct
 * durable records. Completion remains the C9D/C9B authority token; output is
 * recovered through a deterministic second operation derived from that exact
 * completion.
 */

import { createHash } from "node:crypto";

import {
  canonicalizeOperationValue,
  fingerprintOperationIdentity,
} from "../kernel/operationIdentity";

import type {
  CanonicalFactoryId,
} from "../architecture/canonicalPipelineRegistry";

import type {
  CanonicalFactoryCompletion,
} from "./durableCanonicalRuntimeOrchestrator";

import {
  canonicalFactoryAuthorityScope,
  canonicalFactoryAuthorityTaskId,
  type DurableCompletedOperationReader,
} from "../persistence/postgresCanonicalFactoryEvidenceAuthority";

export const CANONICAL_FACTORY_OUTPUT_OPERATION_TYPE =
  "canonical.factory-output.v2" as const;

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

export function fingerprintCanonicalFactoryOutput(
  factoryId: CanonicalFactoryId,
  output: unknown,
): string {
  return digest(
    "NAMLA_V2_CANONICAL_FACTORY_OUTPUT",
    {
      factoryId,
      canonicalOutput:
        canonicalizeOperationValue(output),
    },
  );
}

export function canonicalFactoryOutputOperationKey(
  completion: CanonicalFactoryCompletion,
): string {
  return (
    "factory-output:" +
    digest(
      "NAMLA_V2_CANONICAL_FACTORY_OUTPUT_STEP",
      {
        operationKey:
          completion.operationKey,
      },
    )
  );
}

export function canonicalFactoryOutputInputFingerprint(
  completion: CanonicalFactoryCompletion,
): string {
  return fingerprintOperationIdentity({
    missionId:
      completion.missionId,
    authorityScope:
      canonicalFactoryAuthorityScope(
        completion.factoryId,
      ),
    operationType:
      CANONICAL_FACTORY_OUTPUT_OPERATION_TYPE,
    value:
      completion,
  });
}

export type CanonicalFactoryOutputReadResult =
  | {
      readonly ok: true;
      readonly status: "VERIFIED";
      readonly reasonCode: "ok";
      readonly output: unknown;
    }
  | {
      readonly ok: false;
      readonly status: "REFUSED";
      readonly reasonCode:
        | "output-read-failed"
        | "output-not-completed"
        | "output-binding-mismatch"
        | "output-fingerprint-mismatch"
        | "output-invalid";
    };

export async function readCanonicalFactoryOutput(
  reader: DurableCompletedOperationReader,
  completion: CanonicalFactoryCompletion,
): Promise<CanonicalFactoryOutputReadResult> {
  const operationKey =
    canonicalFactoryOutputOperationKey(
      completion,
    );

  let durable:
    Awaited<
      ReturnType<
        DurableCompletedOperationReader[
          "readCompletedOperation"
        ]
      >
    >;

  try {
    durable =
      await reader.readCompletedOperation({
        missionId:
          completion.missionId,
        operationKey,
      });
  } catch {
    return Object.freeze({
      ok: false as const,
      status: "REFUSED" as const,
      reasonCode:
        "output-read-failed" as const,
    });
  }

  if (!durable.ok) {
    return Object.freeze({
      ok: false as const,
      status: "REFUSED" as const,
      reasonCode:
        "output-not-completed" as const,
    });
  }

  if (
    durable.record.operationKey !==
      operationKey ||
    durable.record.taskId !==
      canonicalFactoryAuthorityTaskId(
        completion.factoryId,
      ) ||
    durable.record.authorityScope !==
      canonicalFactoryAuthorityScope(
        completion.factoryId,
      ) ||
    durable.record.operationType !==
      CANONICAL_FACTORY_OUTPUT_OPERATION_TYPE ||
    durable.record.inputFingerprint !==
      canonicalFactoryOutputInputFingerprint(
        completion,
      )
  ) {
    return Object.freeze({
      ok: false as const,
      status: "REFUSED" as const,
      reasonCode:
        "output-binding-mismatch" as const,
    });
  }

  let fingerprint:
    string;

  try {
    fingerprint =
      fingerprintCanonicalFactoryOutput(
        completion.factoryId,
        durable.completedValue,
      );
  } catch {
    return Object.freeze({
      ok: false as const,
      status: "REFUSED" as const,
      reasonCode:
        "output-invalid" as const,
    });
  }

  if (
    fingerprint !==
      completion.outputFingerprint
  ) {
    return Object.freeze({
      ok: false as const,
      status: "REFUSED" as const,
      reasonCode:
        "output-fingerprint-mismatch" as const,
    });
  }

  return Object.freeze({
    ok: true as const,
    status: "VERIFIED" as const,
    reasonCode: "ok" as const,
    output:
      structuredClone(
        durable.completedValue,
      ),
  });
}
