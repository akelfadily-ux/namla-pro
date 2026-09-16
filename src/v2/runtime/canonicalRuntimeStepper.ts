/**
 * NAMLA V2 Checkpointable Canonical Runtime Stepper (10E5).
 *
 * Responsibilities:
 * - deterministic traversal of CANONICAL_PIPELINE_SEQUENCE,
 * - serializable / restorable canonical cursor,
 * - exact one-node advancement,
 * - explicit NAMLA LOOP verdict handoff,
 * - explicit FROZEN_PLAN_CONTRACT authority crossing,
 * - fail-closed handling of unimplemented canonical factories,
 * - runtime adapter resolution without executing factories.
 *
 * Deliberately out of scope:
 * - legacy MissionCheckpoint persistence,
 * - DurableMissionBoundaryCoordinator mutation,
 * - PostgreSQL persistence,
 * - factory execution,
 * - NamlaRuntime migration.
 *
 * Those belong to 10E6.
 */

import {
  CANONICAL_FROZEN_PLAN_CONTRACT_BOUNDARY,
  CANONICAL_PIPELINE_SEQUENCE,
  type CanonicalFactoryId,
  type CanonicalLoopGateInstanceId,
  type CanonicalPipelineNode,
} from "../architecture/canonicalPipelineRegistry";

import {
  resolveCanonicalRuntimeAdapter,
  type CanonicalRuntimeAdapterBinding,
} from "./canonicalRuntimeAdapters";

import type {
  GateVerdict,
} from "../types/namlaLoopTypes";

export const V2_CANONICAL_RUNTIME_CURSOR_SCHEMA =
  "namla-v2-canonical-runtime-cursor-v1" as const;

export type CanonicalRuntimeContractPhase =
  | "PRE_FREEZE"
  | "CONTRACT_BOUND";

export interface CanonicalRuntimeCursor {
  readonly schemaVersion:
    typeof V2_CANONICAL_RUNTIME_CURSOR_SCHEMA;

  readonly missionId:
    string;

  readonly nodeIndex:
    number;

  readonly nodeId:
    CanonicalPipelineNode["id"];

  readonly nodeKind:
    CanonicalPipelineNode["kind"];

  /**
   * Monotonic cursor version.
   *
   * At 10E5 one successful canonical node transition increments this exactly
   * once. 10E6 will bind this to durable CAS ownership.
   */
  readonly stepVersion:
    number;

  /**
   * PRE_FREEZE until the exact canonical crossing into PRO.
   * CONTRACT_BOUND from PRO onward.
   */
  readonly contractPhase:
    CanonicalRuntimeContractPhase;
}

export type CanonicalRuntimeCursorValidationReason =
  | "ok"
  | "cursor-not-object"
  | "cursor-schema-invalid"
  | "cursor-mission-id-invalid"
  | "cursor-node-index-invalid"
  | "cursor-node-out-of-range"
  | "cursor-node-id-mismatch"
  | "cursor-node-kind-mismatch"
  | "cursor-step-version-invalid"
  | "cursor-step-version-mismatch"
  | "cursor-contract-phase-invalid"
  | "cursor-contract-phase-mismatch";

export interface CanonicalRuntimeCursorValidation {
  readonly ok:
    boolean;

  readonly reasonCode:
    CanonicalRuntimeCursorValidationReason;
}

export type CanonicalRuntimeCursorRestoreResult =
  | {
      readonly ok: true;
      readonly reasonCode: "ok";
      readonly cursor:
        CanonicalRuntimeCursor;
    }
  | {
      readonly ok: false;
      readonly reasonCode:
        | "cursor-json-invalid"
        | Exclude<
            CanonicalRuntimeCursorValidationReason,
            "ok"
          >;
    };

export type CanonicalRuntimeStepDecision =
  | {
      readonly kind:
        "RUN_FACTORY";

      readonly factoryId:
        CanonicalFactoryId;

      readonly nodeIndex:
        number;

      readonly requiredContextPhase:
        CanonicalRuntimeContractPhase;

      readonly adapterBinding:
        CanonicalRuntimeAdapterBinding;
    }
  | {
      readonly kind:
        "FACTORY_UNAVAILABLE";

      readonly factoryId:
        CanonicalFactoryId;

      readonly nodeIndex:
        number;

      readonly executionPolicy:
        "FAIL_CLOSED";

      readonly reasonCode:
        "CANONICAL_FACTORY_RUNTIME_UNIMPLEMENTED";
    }
  | {
      readonly kind:
        "EVALUATE_NAMLA_LOOP";

      readonly gateInstanceId:
        CanonicalLoopGateInstanceId;

      readonly afterFactory:
        CanonicalFactoryId;

      readonly nodeIndex:
        number;

      readonly contractPhase:
        CanonicalRuntimeContractPhase;
    }
  | {
      readonly kind:
        "TERMINAL";

      readonly terminalId:
        "DELIVERY";

      readonly nodeIndex:
        number;
    }
  | {
      readonly kind:
        "FAIL_CLOSED";

      readonly reasonCode:
        | "CURSOR_INVALID"
        | "FACTORY_CONTEXT_PHASE_MISMATCH";

      readonly validationReasonCode?:
        CanonicalRuntimeCursorValidationReason;
    };

export interface FrozenPlanContractAuthorityAttestation {
  readonly boundaryId:
    "FROZEN_PLAN_CONTRACT";

  readonly established:
    true;
}

export type CanonicalRuntimeCompletion =
  | {
      readonly kind:
        "FACTORY_COMPLETED";

      readonly factoryId:
        CanonicalFactoryId;
    }
  | {
      readonly kind:
        "GATE_VERDICT";

      readonly gateInstanceId:
        CanonicalLoopGateInstanceId;

      readonly verdict:
        GateVerdict;

      /**
       * Required only when the PASS verdict crosses:
       *
       * PLAN_TEST -> LOOP_AFTER_PLAN_TEST -> PRO
       *
       * 10E5 records only the authority transition attestation.
       * 10E6 must bind this to the actual immutable PlanContract.
       */
      readonly authorityBoundary?:
        FrozenPlanContractAuthorityAttestation;
    };

export interface CanonicalRuntimeAdvanceInput {
  readonly expectedStepVersion:
    number;

  readonly completion:
    CanonicalRuntimeCompletion;
}

export type CanonicalRuntimeAdvanceReasonCode =
  | "ok"
  | "cursor-invalid"
  | "stale-step-version"
  | "terminal-boundary"
  | "completion-kind-mismatch"
  | "factory-id-mismatch"
  | "gate-id-mismatch"
  | "factory-runtime-unimplemented"
  | "factory-context-phase-mismatch"
  | "gate-verdict-not-pass"
  | "frozen-plan-contract-required"
  | "frozen-plan-contract-boundary-invalid";

export type CanonicalRuntimeAdvanceResult =
  | {
      readonly ok: true;

      readonly status:
        "ADVANCED";

      readonly reasonCode:
        "ok";

      readonly cursor:
        CanonicalRuntimeCursor;
    }
  | {
      readonly ok: false;

      readonly status:
        "REFUSED";

      readonly reasonCode:
        Exclude<
          CanonicalRuntimeAdvanceReasonCode,
          "ok"
        >;

      readonly cursor:
        CanonicalRuntimeCursor;

      readonly validationReasonCode?:
        CanonicalRuntimeCursorValidationReason;

      readonly gateNextAction?:
        GateVerdict["nextAction"];
    };

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function proNodeIndex():
  number {
  return CANONICAL_PIPELINE_SEQUENCE
    .findIndex(
      (node) =>
        node.kind === "FACTORY" &&
        node.id === "PRO",
    );
}

function expectedContractPhaseForIndex(
  nodeIndex: number,
): CanonicalRuntimeContractPhase {
  return (
    nodeIndex <
    proNodeIndex()
  )
    ? "PRE_FREEZE"
    : "CONTRACT_BOUND";
}

function freezeCursor(
  cursor:
    CanonicalRuntimeCursor,
): CanonicalRuntimeCursor {
  return Object.freeze({
    ...cursor,
  });
}

function nodeAt(
  nodeIndex: number,
): CanonicalPipelineNode {
  const node =
    CANONICAL_PIPELINE_SEQUENCE[
      nodeIndex
    ];

  if (!node) {
    throw new Error(
      `CANONICAL_PIPELINE_NODE_NOT_FOUND:${nodeIndex}`,
    );
  }

  return node;
}

export function createCanonicalRuntimeCursor(
  missionId: string,
): CanonicalRuntimeCursor {
  if (
    missionId.trim().length === 0
  ) {
    throw new Error(
      "CANONICAL_RUNTIME_MISSION_ID_EMPTY",
    );
  }

  const initialNode =
    nodeAt(0);

  return freezeCursor({
    schemaVersion:
      V2_CANONICAL_RUNTIME_CURSOR_SCHEMA,

    missionId,

    nodeIndex:
      0,

    nodeId:
      initialNode.id,

    nodeKind:
      initialNode.kind,

    stepVersion:
      1,

    contractPhase:
      "PRE_FREEZE",
  });
}

export function validateCanonicalRuntimeCursor(
  cursor: unknown,
): CanonicalRuntimeCursorValidation {
  if (!isRecord(cursor)) {
    return Object.freeze({
      ok: false,
      reasonCode:
        "cursor-not-object",
    });
  }

  if (
    cursor.schemaVersion !==
    V2_CANONICAL_RUNTIME_CURSOR_SCHEMA
  ) {
    return Object.freeze({
      ok: false,
      reasonCode:
        "cursor-schema-invalid",
    });
  }

  if (
    typeof cursor.missionId !==
      "string" ||
    cursor.missionId.trim().length ===
      0
  ) {
    return Object.freeze({
      ok: false,
      reasonCode:
        "cursor-mission-id-invalid",
    });
  }

  if (
    !Number.isSafeInteger(
      cursor.nodeIndex,
    ) ||
    (cursor.nodeIndex as number) < 0
  ) {
    return Object.freeze({
      ok: false,
      reasonCode:
        "cursor-node-index-invalid",
    });
  }

  const nodeIndex =
    cursor.nodeIndex as number;

  if (
    nodeIndex >=
    CANONICAL_PIPELINE_SEQUENCE.length
  ) {
    return Object.freeze({
      ok: false,
      reasonCode:
        "cursor-node-out-of-range",
    });
  }

  const expectedNode =
    CANONICAL_PIPELINE_SEQUENCE[
      nodeIndex
    ];

  if (
    cursor.nodeId !==
    expectedNode.id
  ) {
    return Object.freeze({
      ok: false,
      reasonCode:
        "cursor-node-id-mismatch",
    });
  }

  if (
    cursor.nodeKind !==
    expectedNode.kind
  ) {
    return Object.freeze({
      ok: false,
      reasonCode:
        "cursor-node-kind-mismatch",
    });
  }

  if (
    !Number.isSafeInteger(
      cursor.stepVersion,
    ) ||
    (cursor.stepVersion as number) < 1
  ) {
    return Object.freeze({
      ok: false,
      reasonCode:
        "cursor-step-version-invalid",
    });
  }

  if (
    cursor.stepVersion !==
    nodeIndex + 1
  ) {
    return Object.freeze({
      ok: false,
      reasonCode:
        "cursor-step-version-mismatch",
    });
  }

  if (
    cursor.contractPhase !==
      "PRE_FREEZE" &&
    cursor.contractPhase !==
      "CONTRACT_BOUND"
  ) {
    return Object.freeze({
      ok: false,
      reasonCode:
        "cursor-contract-phase-invalid",
    });
  }

  if (
    cursor.contractPhase !==
    expectedContractPhaseForIndex(
      nodeIndex,
    )
  ) {
    return Object.freeze({
      ok: false,
      reasonCode:
        "cursor-contract-phase-mismatch",
    });
  }

  return Object.freeze({
    ok: true,
    reasonCode:
      "ok",
  });
}

export function serializeCanonicalRuntimeCursor(
  cursor:
    CanonicalRuntimeCursor,
): string {
  const validation =
    validateCanonicalRuntimeCursor(
      cursor,
    );

  if (!validation.ok) {
    throw new Error(
      `CANONICAL_RUNTIME_CURSOR_INVALID:${validation.reasonCode}`,
    );
  }

  return JSON.stringify(cursor);
}

export function restoreCanonicalRuntimeCursor(
  serialized: string,
): CanonicalRuntimeCursorRestoreResult {
  let parsed:
    unknown;

  try {
    parsed =
      JSON.parse(serialized);
  }
  catch {
    return Object.freeze({
      ok: false,
      reasonCode:
        "cursor-json-invalid" as const,
    });
  }

  const validation =
    validateCanonicalRuntimeCursor(
      parsed,
    );

  if (!validation.ok) {
    return Object.freeze({
      ok: false,
      reasonCode:
        validation.reasonCode as Exclude<
          CanonicalRuntimeCursorValidationReason,
          "ok"
        >,
    });
  }

  const record =
    parsed as Record<string, unknown>;

  return Object.freeze({
    ok: true,
    reasonCode:
      "ok" as const,
    cursor:
      freezeCursor({
        schemaVersion:
          V2_CANONICAL_RUNTIME_CURSOR_SCHEMA,

        missionId:
          record.missionId as string,

        nodeIndex:
          record.nodeIndex as number,

        nodeId:
          record.nodeId as
            CanonicalPipelineNode["id"],

        nodeKind:
          record.nodeKind as
            CanonicalPipelineNode["kind"],

        stepVersion:
          record.stepVersion as number,

        contractPhase:
          record.contractPhase as
            CanonicalRuntimeContractPhase,
      }),
  });
}

export function inspectCanonicalRuntimeStep(
  cursor:
    CanonicalRuntimeCursor,
): CanonicalRuntimeStepDecision {
  const validation =
    validateCanonicalRuntimeCursor(
      cursor,
    );

  if (!validation.ok) {
    return Object.freeze({
      kind:
        "FAIL_CLOSED" as const,

      reasonCode:
        "CURSOR_INVALID" as const,

      validationReasonCode:
        validation.reasonCode,
    });
  }

  const node =
    nodeAt(
      cursor.nodeIndex,
    );

  if (
    node.kind ===
    "TERMINAL"
  ) {
    return Object.freeze({
      kind:
        "TERMINAL" as const,

      terminalId:
        "DELIVERY" as const,

      nodeIndex:
        cursor.nodeIndex,
    });
  }

  if (
    node.kind ===
    "GATE"
  ) {
    return Object.freeze({
      kind:
        "EVALUATE_NAMLA_LOOP" as const,

      gateInstanceId:
        node.id,

      afterFactory:
        node.afterFactory,

      nodeIndex:
        cursor.nodeIndex,

      contractPhase:
        cursor.contractPhase,
    });
  }

  const resolution =
    resolveCanonicalRuntimeAdapter(
      node.id,
    );

  if (
    resolution.kind ===
    "UNAVAILABLE"
  ) {
    return Object.freeze({
      kind:
        "FACTORY_UNAVAILABLE" as const,

      factoryId:
        node.id,

      nodeIndex:
        cursor.nodeIndex,

      executionPolicy:
        "FAIL_CLOSED" as const,

      reasonCode:
        resolution.reasonCode,
    });
  }

  if (
    resolution.binding
      .requiredContextPhase !==
    cursor.contractPhase
  ) {
    return Object.freeze({
      kind:
        "FAIL_CLOSED" as const,

      reasonCode:
        "FACTORY_CONTEXT_PHASE_MISMATCH" as const,
    });
  }

  return Object.freeze({
    kind:
      "RUN_FACTORY" as const,

    factoryId:
      node.id,

    nodeIndex:
      cursor.nodeIndex,

    requiredContextPhase:
      resolution.binding
        .requiredContextPhase,

    adapterBinding:
      resolution.binding,
  });
}

function refused(
  cursor:
    CanonicalRuntimeCursor,

  reasonCode:
    Exclude<
      CanonicalRuntimeAdvanceReasonCode,
      "ok"
    >,

  options: {
    readonly validationReasonCode?:
      CanonicalRuntimeCursorValidationReason;

    readonly gateNextAction?:
      GateVerdict["nextAction"];
  } = {},
): CanonicalRuntimeAdvanceResult {
  return Object.freeze({
    ok: false,
    status:
      "REFUSED" as const,
    reasonCode,
    cursor:
      freezeCursor(cursor),

    ...(options.validationReasonCode
      ? {
          validationReasonCode:
            options.validationReasonCode,
        }
      : {}),

    ...(options.gateNextAction
      ? {
          gateNextAction:
            options.gateNextAction,
        }
      : {}),
  });
}

export function advanceCanonicalRuntimeCursor(
  cursor:
    CanonicalRuntimeCursor,

  input:
    CanonicalRuntimeAdvanceInput,
): CanonicalRuntimeAdvanceResult {
  const validation =
    validateCanonicalRuntimeCursor(
      cursor,
    );

  if (!validation.ok) {
    return refused(
      cursor,
      "cursor-invalid",
      {
        validationReasonCode:
          validation.reasonCode,
      },
    );
  }

  if (
    input.expectedStepVersion !==
    cursor.stepVersion
  ) {
    return refused(
      cursor,
      "stale-step-version",
    );
  }

  const node =
    nodeAt(
      cursor.nodeIndex,
    );

  if (
    node.kind ===
    "TERMINAL"
  ) {
    return refused(
      cursor,
      "terminal-boundary",
    );
  }

  if (
    node.kind ===
    "FACTORY"
  ) {
    if (
      input.completion.kind !==
      "FACTORY_COMPLETED"
    ) {
      return refused(
        cursor,
        "completion-kind-mismatch",
      );
    }

    if (
      input.completion.factoryId !==
      node.id
    ) {
      return refused(
        cursor,
        "factory-id-mismatch",
      );
    }

    const resolution =
      resolveCanonicalRuntimeAdapter(
        node.id,
      );

    if (
      resolution.kind ===
      "UNAVAILABLE"
    ) {
      return refused(
        cursor,
        "factory-runtime-unimplemented",
      );
    }

    if (
      resolution.binding
        .requiredContextPhase !==
      cursor.contractPhase
    ) {
      return refused(
        cursor,
        "factory-context-phase-mismatch",
      );
    }
  }
  else {
    if (
      input.completion.kind !==
      "GATE_VERDICT"
    ) {
      return refused(
        cursor,
        "completion-kind-mismatch",
      );
    }

    if (
      input.completion.gateInstanceId !==
      node.id
    ) {
      return refused(
        cursor,
        "gate-id-mismatch",
      );
    }

    if (
      input.completion.verdict.status !==
        "PASS" ||
      input.completion.verdict.nextAction !==
        "NEXT"
    ) {
      return refused(
        cursor,
        "gate-verdict-not-pass",
        {
          gateNextAction:
            input.completion.verdict
              .nextAction,
        },
      );
    }
  }

  const nextNodeIndex =
    cursor.nodeIndex + 1;

  const nextNode =
    CANONICAL_PIPELINE_SEQUENCE[
      nextNodeIndex
    ];

  if (!nextNode) {
    return refused(
      cursor,
      "terminal-boundary",
    );
  }

  const crossingFrozenBoundary =
    node.kind === "GATE" &&
    node.id ===
      "LOOP_AFTER_PLAN_TEST" &&
    nextNode.kind ===
      "FACTORY" &&
    nextNode.id ===
      CANONICAL_FROZEN_PLAN_CONTRACT_BOUNDARY
        .requiredBeforeFactory;

  let nextContractPhase:
    CanonicalRuntimeContractPhase =
      cursor.contractPhase;

  if (
    crossingFrozenBoundary
  ) {
    if (
      input.completion.kind !==
        "GATE_VERDICT" ||
      input.completion
        .authorityBoundary
        ?.boundaryId !==
        CANONICAL_FROZEN_PLAN_CONTRACT_BOUNDARY
          .id ||
      input.completion
        .authorityBoundary
        ?.established !==
        true
    ) {
      return refused(
        cursor,
        "frozen-plan-contract-required",
      );
    }

    nextContractPhase =
      "CONTRACT_BOUND";
  }
  else if (
    input.completion.kind ===
      "GATE_VERDICT" &&
    input.completion
      .authorityBoundary !==
      undefined
  ) {
    return refused(
      cursor,
      "frozen-plan-contract-boundary-invalid",
    );
  }

  const nextCursor =
    freezeCursor({
      schemaVersion:
        V2_CANONICAL_RUNTIME_CURSOR_SCHEMA,

      missionId:
        cursor.missionId,

      nodeIndex:
        nextNodeIndex,

      nodeId:
        nextNode.id,

      nodeKind:
        nextNode.kind,

      stepVersion:
        cursor.stepVersion + 1,

      contractPhase:
        nextContractPhase,
    });

  const nextValidation =
    validateCanonicalRuntimeCursor(
      nextCursor,
    );

  if (!nextValidation.ok) {
    return refused(
      cursor,
      "cursor-invalid",
      {
        validationReasonCode:
          nextValidation.reasonCode,
      },
    );
  }

  return Object.freeze({
    ok: true,
    status:
      "ADVANCED" as const,
    reasonCode:
      "ok" as const,
    cursor:
      nextCursor,
  });
}