/**
 * NAMLA V2 Canonical External Pipeline Registry.
 *
 * This module is the architecture source of truth for the external NAMLA spine.
 *
 * Important distinctions:
 *
 * - Major architecture blocks are FACTORIES.
 * - NAMLA LOOP is a mandatory GATE between factories, not a factory.
 * - Frozen Plan/Contract is an AUTHORITY BOUNDARY, not a factory.
 * - COLONY_A and COLONY_B are internal PRO execution lanes, not top-level factories.
 * - DELIVERY is a terminal handoff, not a factory.
 * - Trusted Kernel is the authority/security plane beneath the full pipeline.
 *
 * Factory internals are intentionally out of scope here. A factory may later contain:
 *
 *   Kingdoms -> Colonies/Teams -> Ants -> Guards/Reviewers ->
 *   Internal DAG -> Internal Tests -> Internal Courts/Loops
 *
 * This registry describes only the external spine.
 */

export type CanonicalFactoryId =
  | "EER"
  | "PLAN"
  | "PLAN_TEST"
  | "PRO"
  | "SON"
  | "LEGGO"
  | "PROMAX"
  | "FINAL_SPRINT_COURT"
  | "LIHU"
  | "DEVOPS"
  | "API_INTEGRATION"
  | "SECURITY"
  | "NAMLA_LAB";

export type CanonicalLoopGateInstanceId =
  | "LOOP_AFTER_EER"
  | "LOOP_AFTER_PLAN"
  | "LOOP_AFTER_PLAN_TEST"
  | "LOOP_AFTER_PRO"
  | "LOOP_AFTER_SON"
  | "LOOP_AFTER_LEGGO"
  | "LOOP_AFTER_PROMAX"
  | "LOOP_AFTER_FINAL_SPRINT_COURT"
  | "LOOP_AFTER_LIHU"
  | "LOOP_AFTER_DEVOPS"
  | "LOOP_AFTER_API_INTEGRATION"
  | "LOOP_AFTER_SECURITY";

export type FactoryExternalLifecycleStep =
  | "INPUT_CONTRACT"
  | "AUTHORITY"
  | "RUNTIME"
  | "OUTPUT_CONTRACT"
  | "EVIDENCE";

export type FactoryEntryAuthority =
  | "STANDARD_FACTORY_AUTHORITY"
  | "FROZEN_PLAN_CONTRACT";

export type ProInternalExecutionLane =
  | "COLONY_A"
  | "COLONY_B";

export type CanonicalFactoryPostBoundary =
  | {
      readonly kind: "NAMLA_LOOP";
      readonly gateInstanceId:
        CanonicalLoopGateInstanceId;
    }
  | {
      readonly kind: "DELIVERY";
    };

export interface CanonicalFactoryDescriptor {
  readonly id: CanonicalFactoryId;
  readonly displayName: string;

  /**
   * External shell lifecycle:
   *
   * Input Contract -> Authority -> Runtime ->
   * Output Contract -> Evidence
   *
   * A NAMLA LOOP gate follows each inter-factory handoff.
   */
  readonly externalLifecycle:
    readonly FactoryExternalLifecycleStep[];

  readonly entryAuthority:
    FactoryEntryAuthority;

  readonly postBoundary:
    CanonicalFactoryPostBoundary;

  /**
   * Present only for factories that own internal execution lanes.
   *
   * At 10E3 this is PRO only.
   */
  readonly internalExecutionLanes?:
    readonly ProInternalExecutionLane[];
}

export interface CanonicalFactoryNode {
  readonly kind: "FACTORY";
  readonly id: CanonicalFactoryId;
}

export interface CanonicalLoopGateNode {
  readonly kind: "GATE";
  readonly id:
    CanonicalLoopGateInstanceId;
  readonly gateType: "NAMLA_LOOP";
  readonly afterFactory:
    CanonicalFactoryId;
}

export interface CanonicalDeliveryNode {
  readonly kind: "TERMINAL";
  readonly id: "DELIVERY";
}

export type CanonicalPipelineNode =
  | CanonicalFactoryNode
  | CanonicalLoopGateNode
  | CanonicalDeliveryNode;

export interface CanonicalAuthorityBoundary {
  readonly id:
    "FROZEN_PLAN_CONTRACT";
  readonly kind:
    "AUTHORITY_BOUNDARY";
  readonly requiredAfterFactory:
    "PLAN_TEST";
  readonly requiredBeforeFactory:
    "PRO";
  readonly bypassAllowed:
    false;
  readonly mutableAfterFreeze:
    false;
}

export interface CanonicalTrustedKernelPlane {
  readonly id: "TRUSTED_KERNEL";
  readonly kind:
    "AUTHORITY_SECURITY_PLANE";
  readonly appliesTo:
    "ALL_FACTORIES_GATES_AND_DELIVERY";
  readonly bypassAllowed:
    false;
}

export interface LegacyArchitectureClassification {
  readonly legacyId:
    "PROTOCOL" | "COLONY_AB";
  readonly canonicalRole:
    "AUTHORITY_BOUNDARY" |
    "PRO_INTERNAL_EXECUTION";
  readonly topLevelFactory:
    false;
  readonly canonicalTarget:
    "FROZEN_PLAN_CONTRACT" |
    "PRO";
}

export const FACTORY_EXTERNAL_LIFECYCLE:
  readonly FactoryExternalLifecycleStep[] =
    Object.freeze([
      "INPUT_CONTRACT",
      "AUTHORITY",
      "RUNTIME",
      "OUTPUT_CONTRACT",
      "EVIDENCE",
    ]);

export const CANONICAL_FROZEN_PLAN_CONTRACT_BOUNDARY:
  CanonicalAuthorityBoundary =
    Object.freeze({
      id:
        "FROZEN_PLAN_CONTRACT",
      kind:
        "AUTHORITY_BOUNDARY",
      requiredAfterFactory:
        "PLAN_TEST",
      requiredBeforeFactory:
        "PRO",
      bypassAllowed:
        false,
      mutableAfterFreeze:
        false,
    });

export const CANONICAL_TRUSTED_KERNEL_PLANE:
  CanonicalTrustedKernelPlane =
    Object.freeze({
      id: "TRUSTED_KERNEL",
      kind:
        "AUTHORITY_SECURITY_PLANE",
      appliesTo:
        "ALL_FACTORIES_GATES_AND_DELIVERY",
      bypassAllowed:
        false,
    });

export const PRO_INTERNAL_EXECUTION_LANES:
  readonly ProInternalExecutionLane[] =
    Object.freeze([
      "COLONY_A",
      "COLONY_B",
    ]);

function loopBoundary(
  gateInstanceId:
    CanonicalLoopGateInstanceId,
): CanonicalFactoryPostBoundary {
  return Object.freeze({
    kind: "NAMLA_LOOP" as const,
    gateInstanceId,
  });
}

const DELIVERY_BOUNDARY:
  CanonicalFactoryPostBoundary =
    Object.freeze({
      kind: "DELIVERY" as const,
    });

function factory(
  descriptor: {
    readonly id:
      CanonicalFactoryId;
    readonly displayName:
      string;
    readonly entryAuthority?:
      FactoryEntryAuthority;
    readonly postBoundary:
      CanonicalFactoryPostBoundary;
    readonly internalExecutionLanes?:
      readonly ProInternalExecutionLane[];
  },
): CanonicalFactoryDescriptor {
  return Object.freeze({
    id:
      descriptor.id,

    displayName:
      descriptor.displayName,

    externalLifecycle:
      FACTORY_EXTERNAL_LIFECYCLE,

    entryAuthority:
      descriptor.entryAuthority ??
      "STANDARD_FACTORY_AUTHORITY",

    postBoundary:
      descriptor.postBoundary,

    ...(descriptor.internalExecutionLanes
      ? {
          internalExecutionLanes:
            Object.freeze([
              ...descriptor
                .internalExecutionLanes,
            ]),
        }
      : {}),
  });
}

/**
 * Canonical factory order.
 *
 * This exact order is intentionally independent from the legacy MissionStage
 * union and legacy NamlaRuntime implementation. Those will migrate later
 * through a compatibility stepper instead of being rewritten in-place here.
 */
export const CANONICAL_FACTORY_REGISTRY:
  readonly CanonicalFactoryDescriptor[] =
    Object.freeze([
      factory({
        id: "EER",
        displayName:
          "EER Factory",
        postBoundary:
          loopBoundary(
            "LOOP_AFTER_EER",
          ),
      }),

      factory({
        id: "PLAN",
        displayName:
          "Plan Factory",
        postBoundary:
          loopBoundary(
            "LOOP_AFTER_PLAN",
          ),
      }),

      factory({
        id: "PLAN_TEST",
        displayName:
          "Plan Test Factory",
        postBoundary:
          loopBoundary(
            "LOOP_AFTER_PLAN_TEST",
          ),
      }),

      factory({
        id: "PRO",
        displayName:
          "Pro Factory",
        entryAuthority:
          "FROZEN_PLAN_CONTRACT",
        internalExecutionLanes:
          PRO_INTERNAL_EXECUTION_LANES,
        postBoundary:
          loopBoundary(
            "LOOP_AFTER_PRO",
          ),
      }),

      factory({
        id: "SON",
        displayName:
          "Son Factory",
        postBoundary:
          loopBoundary(
            "LOOP_AFTER_SON",
          ),
      }),

      factory({
        id: "LEGGO",
        displayName:
          "Leggo Factory",
        postBoundary:
          loopBoundary(
            "LOOP_AFTER_LEGGO",
          ),
      }),

      factory({
        id: "PROMAX",
        displayName:
          "Pro Max Factory",
        postBoundary:
          loopBoundary(
            "LOOP_AFTER_PROMAX",
          ),
      }),

      factory({
        id:
          "FINAL_SPRINT_COURT",
        displayName:
          "Final Sprint Court Factory",
        postBoundary:
          loopBoundary(
            "LOOP_AFTER_FINAL_SPRINT_COURT",
          ),
      }),

      factory({
        id: "LIHU",
        displayName:
          "Lihu Factory",
        postBoundary:
          loopBoundary(
            "LOOP_AFTER_LIHU",
          ),
      }),

      factory({
        id: "DEVOPS",
        displayName:
          "DevOps Factory",
        postBoundary:
          loopBoundary(
            "LOOP_AFTER_DEVOPS",
          ),
      }),

      factory({
        id: "API_INTEGRATION",
        displayName:
          "API / Integration Factory",
        postBoundary:
          loopBoundary(
            "LOOP_AFTER_API_INTEGRATION",
          ),
      }),

      factory({
        id: "SECURITY",
        displayName:
          "Security Factory",
        postBoundary:
          loopBoundary(
            "LOOP_AFTER_SECURITY",
          ),
      }),

      factory({
        id: "NAMLA_LAB",
        displayName:
          "Namla Lab Factory",
        postBoundary:
          DELIVERY_BOUNDARY,
      }),
    ]);

export const CANONICAL_FACTORY_ORDER:
  readonly CanonicalFactoryId[] =
    Object.freeze(
      CANONICAL_FACTORY_REGISTRY.map(
        (descriptor) =>
          descriptor.id,
      ),
    );

export const LEGACY_ARCHITECTURE_CLASSIFICATION:
  readonly LegacyArchitectureClassification[] =
    Object.freeze([
      Object.freeze({
        legacyId:
          "PROTOCOL",
        canonicalRole:
          "AUTHORITY_BOUNDARY",
        topLevelFactory:
          false,
        canonicalTarget:
          "FROZEN_PLAN_CONTRACT",
      }),

      Object.freeze({
        legacyId:
          "COLONY_AB",
        canonicalRole:
          "PRO_INTERNAL_EXECUTION",
        topLevelFactory:
          false,
        canonicalTarget:
          "PRO",
      }),
    ]);

function buildCanonicalPipelineSequence():
  readonly CanonicalPipelineNode[] {
  const nodes:
    CanonicalPipelineNode[] = [];

  for (
    const descriptor
    of CANONICAL_FACTORY_REGISTRY
  ) {
    nodes.push(
      Object.freeze({
        kind:
          "FACTORY" as const,
        id:
          descriptor.id,
      }),
    );

    if (
      descriptor.postBoundary.kind ===
      "NAMLA_LOOP"
    ) {
      nodes.push(
        Object.freeze({
          kind:
            "GATE" as const,

          id:
            descriptor
              .postBoundary
              .gateInstanceId,

          gateType:
            "NAMLA_LOOP" as const,

          afterFactory:
            descriptor.id,
        }),
      );

      continue;
    }

    nodes.push(
      Object.freeze({
        kind:
          "TERMINAL" as const,
        id:
          "DELIVERY" as const,
      }),
    );
  }

  return Object.freeze(nodes);
}

export const CANONICAL_PIPELINE_SEQUENCE:
  readonly CanonicalPipelineNode[] =
    buildCanonicalPipelineSequence();

export function getCanonicalFactory(
  id: CanonicalFactoryId,
): CanonicalFactoryDescriptor {
  const descriptor =
    CANONICAL_FACTORY_REGISTRY.find(
      (candidate) =>
        candidate.id === id,
    );

  if (!descriptor) {
    throw new Error(
      `CANONICAL_FACTORY_NOT_FOUND:${id}`,
    );
  }

  return descriptor;
}

export function canonicalPipelinePath():
  string {
  return CANONICAL_PIPELINE_SEQUENCE
    .map((node) => {
      if (node.kind === "GATE") {
        return "LOOP";
      }

      return node.id;
    })
    .join(" -> ");
}

export interface CanonicalPipelineValidation {
  readonly ok: boolean;
  readonly errors:
    readonly string[];
}

/**
 * Runtime-independent self-validation.
 *
 * This intentionally validates only architecture registry invariants.
 * It does not inspect or mutate the legacy runtime.
 */
export function validateCanonicalPipelineRegistry():
  CanonicalPipelineValidation {
  const errors:
    string[] = [];

  const factoryIds =
    CANONICAL_FACTORY_REGISTRY.map(
      (factoryDescriptor) =>
        factoryDescriptor.id,
    );

  if (
    new Set(factoryIds).size !==
    factoryIds.length
  ) {
    errors.push(
      "DUPLICATE_FACTORY_ID",
    );
  }

  const nodeIds =
    CANONICAL_PIPELINE_SEQUENCE.map(
      (node) => node.id,
    );

  if (
    new Set(nodeIds).size !==
    nodeIds.length
  ) {
    errors.push(
      "DUPLICATE_PIPELINE_NODE_ID",
    );
  }

  const terminalNodes =
    CANONICAL_PIPELINE_SEQUENCE.filter(
      (node) =>
        node.kind === "TERMINAL",
    );

  if (
    terminalNodes.length !== 1 ||
    terminalNodes[0]?.id !==
      "DELIVERY"
  ) {
    errors.push(
      "DELIVERY_TERMINAL_INVALID",
    );
  }

  const lastNode =
    CANONICAL_PIPELINE_SEQUENCE[
      CANONICAL_PIPELINE_SEQUENCE.length -
      1
    ];

  if (
    lastNode?.kind !== "TERMINAL" ||
    lastNode.id !== "DELIVERY"
  ) {
    errors.push(
      "DELIVERY_NOT_LAST",
    );
  }

  for (
    let index = 0;
    index <
      CANONICAL_FACTORY_REGISTRY.length;
    index += 1
  ) {
    const descriptor =
      CANONICAL_FACTORY_REGISTRY[index];

    if (
      descriptor.externalLifecycle
        .length !==
      FACTORY_EXTERNAL_LIFECYCLE
        .length
    ) {
      errors.push(
        `LIFECYCLE_LENGTH_INVALID:${descriptor.id}`,
      );
    }

    for (
      let lifecycleIndex = 0;
      lifecycleIndex <
        FACTORY_EXTERNAL_LIFECYCLE.length;
      lifecycleIndex += 1
    ) {
      if (
        descriptor
          .externalLifecycle[
            lifecycleIndex
          ] !==
        FACTORY_EXTERNAL_LIFECYCLE[
          lifecycleIndex
        ]
      ) {
        errors.push(
          `LIFECYCLE_INVALID:${descriptor.id}`,
        );

        break;
      }
    }

    const nodeIndex =
      CANONICAL_PIPELINE_SEQUENCE
        .findIndex(
          (node) =>
            node.kind === "FACTORY" &&
            node.id ===
              descriptor.id,
        );

    if (nodeIndex < 0) {
      errors.push(
        `FACTORY_NODE_MISSING:${descriptor.id}`,
      );

      continue;
    }

    const nextNode =
      CANONICAL_PIPELINE_SEQUENCE[
        nodeIndex + 1
      ];

    if (
      descriptor.postBoundary.kind ===
      "NAMLA_LOOP"
    ) {
      if (
        nextNode?.kind !== "GATE" ||
        nextNode.gateType !==
          "NAMLA_LOOP" ||
        nextNode.afterFactory !==
          descriptor.id ||
        nextNode.id !==
          descriptor
            .postBoundary
            .gateInstanceId
      ) {
        errors.push(
          `LOOP_BOUNDARY_INVALID:${descriptor.id}`,
        );
      }
    }
    else {
      if (
        descriptor.id !==
          "NAMLA_LAB" ||
        nextNode?.kind !==
          "TERMINAL" ||
        nextNode.id !==
          "DELIVERY"
      ) {
        errors.push(
          "NAMLA_LAB_DELIVERY_BOUNDARY_INVALID",
        );
      }
    }
  }

  const pro =
    CANONICAL_FACTORY_REGISTRY.find(
      (descriptor) =>
        descriptor.id === "PRO",
    );

  if (
    !pro ||
    pro.entryAuthority !==
      "FROZEN_PLAN_CONTRACT"
  ) {
    errors.push(
      "PRO_FROZEN_CONTRACT_AUTHORITY_MISSING",
    );
  }

  if (
    !pro?.internalExecutionLanes ||
    pro.internalExecutionLanes.length !==
      2 ||
    pro.internalExecutionLanes[0] !==
      "COLONY_A" ||
    pro.internalExecutionLanes[1] !==
      "COLONY_B"
  ) {
    errors.push(
      "PRO_INTERNAL_LANES_INVALID",
    );
  }

  const topLevelNodeIds =
    new Set(
      CANONICAL_PIPELINE_SEQUENCE.map(
        (node) => node.id,
      ),
    );

  if (
    topLevelNodeIds.has(
      "PROTOCOL" as never,
    )
  ) {
    errors.push(
      "PROTOCOL_MUST_NOT_BE_TOP_LEVEL_FACTORY",
    );
  }

  if (
    topLevelNodeIds.has(
      "COLONY_AB" as never,
    )
  ) {
    errors.push(
      "COLONY_AB_MUST_NOT_BE_TOP_LEVEL_FACTORY",
    );
  }

  if (
    CANONICAL_FROZEN_PLAN_CONTRACT_BOUNDARY
      .requiredAfterFactory !==
      "PLAN_TEST" ||
    CANONICAL_FROZEN_PLAN_CONTRACT_BOUNDARY
      .requiredBeforeFactory !==
      "PRO" ||
    CANONICAL_FROZEN_PLAN_CONTRACT_BOUNDARY
      .bypassAllowed !==
      false ||
    CANONICAL_FROZEN_PLAN_CONTRACT_BOUNDARY
      .mutableAfterFreeze !==
      false
  ) {
    errors.push(
      "FROZEN_PLAN_CONTRACT_BOUNDARY_INVALID",
    );
  }

  if (
    CANONICAL_TRUSTED_KERNEL_PLANE
      .bypassAllowed !==
      false ||
    CANONICAL_TRUSTED_KERNEL_PLANE
      .appliesTo !==
      "ALL_FACTORIES_GATES_AND_DELIVERY"
  ) {
    errors.push(
      "TRUSTED_KERNEL_PLANE_INVALID",
    );
  }

  return Object.freeze({
    ok:
      errors.length === 0,

    errors:
      Object.freeze([
        ...errors,
      ]),
  });
}