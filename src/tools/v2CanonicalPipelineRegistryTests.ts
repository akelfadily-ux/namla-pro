import test from "node:test";
import assert from "node:assert/strict";

import {
  CANONICAL_FACTORY_ORDER,
  CANONICAL_FACTORY_REGISTRY,
  CANONICAL_FROZEN_PLAN_CONTRACT_BOUNDARY,
  CANONICAL_PIPELINE_SEQUENCE,
  CANONICAL_TRUSTED_KERNEL_PLANE,
  FACTORY_EXTERNAL_LIFECYCLE,
  LEGACY_ARCHITECTURE_CLASSIFICATION,
  PRO_INTERNAL_EXECUTION_LANES,
  canonicalPipelinePath,
  getCanonicalFactory,
  validateCanonicalPipelineRegistry,
} from "../v2/architecture/canonicalPipelineRegistry";

const EXPECTED_FACTORY_ORDER = [
  "EER",
  "PLAN",
  "PLAN_TEST",
  "PRO",
  "SON",
  "LEGGO",
  "PROMAX",
  "FINAL_SPRINT_COURT",
  "LIHU",
  "DEVOPS",
  "API_INTEGRATION",
  "SECURITY",
  "NAMLA_LAB",
] as const;

const EXPECTED_NODE_IDS = [
  "EER",
  "LOOP_AFTER_EER",

  "PLAN",
  "LOOP_AFTER_PLAN",

  "PLAN_TEST",
  "LOOP_AFTER_PLAN_TEST",

  "PRO",
  "LOOP_AFTER_PRO",

  "SON",
  "LOOP_AFTER_SON",

  "LEGGO",
  "LOOP_AFTER_LEGGO",

  "PROMAX",
  "LOOP_AFTER_PROMAX",

  "FINAL_SPRINT_COURT",
  "LOOP_AFTER_FINAL_SPRINT_COURT",

  "LIHU",
  "LOOP_AFTER_LIHU",

  "DEVOPS",
  "LOOP_AFTER_DEVOPS",

  "API_INTEGRATION",
  "LOOP_AFTER_API_INTEGRATION",

  "SECURITY",
  "LOOP_AFTER_SECURITY",

  "NAMLA_LAB",

  "DELIVERY",
] as const;

test(
  "10E3 canonical factory order matches the fixed NAMLA external spine",
  () => {
    assert.deepEqual(
      CANONICAL_FACTORY_ORDER,
      EXPECTED_FACTORY_ORDER,
    );
  },
);

test(
  "10E3 external pipeline node order is exact and deterministic",
  () => {
    assert.deepEqual(
      CANONICAL_PIPELINE_SEQUENCE.map(
        (node) => node.id,
      ),
      EXPECTED_NODE_IDS,
    );
  },
);

test(
  "10E3 human-readable external path matches canonical factory/gate flow",
  () => {
    assert.equal(
      canonicalPipelinePath(),
      [
        "EER",
        "LOOP",
        "PLAN",
        "LOOP",
        "PLAN_TEST",
        "LOOP",
        "PRO",
        "LOOP",
        "SON",
        "LOOP",
        "LEGGO",
        "LOOP",
        "PROMAX",
        "LOOP",
        "FINAL_SPRINT_COURT",
        "LOOP",
        "LIHU",
        "LOOP",
        "DEVOPS",
        "LOOP",
        "API_INTEGRATION",
        "LOOP",
        "SECURITY",
        "LOOP",
        "NAMLA_LAB",
        "DELIVERY",
      ].join(" -> "),
    );
  },
);

test(
  "10E3 NAMLA LOOP is always a gate and never a factory",
  () => {
    const gates =
      CANONICAL_PIPELINE_SEQUENCE.filter(
        (node) =>
          node.kind === "GATE",
      );

    assert.equal(
      gates.length,
      12,
    );

    for (const gate of gates) {
      assert.equal(
        gate.kind,
        "GATE",
      );

      if (gate.kind === "GATE") {
        assert.equal(
          gate.gateType,
          "NAMLA_LOOP",
        );
      }
    }

    assert.equal(
      CANONICAL_FACTORY_REGISTRY.some(
        (factory) =>
          (factory.id as string) ===
          "NAMLA_LOOP",
      ),
      false,
    );
  },
);

test(
  "10E3 every inter-factory handoff has exactly one NAMLA LOOP gate",
  () => {
    for (
      let index = 0;
      index <
        CANONICAL_PIPELINE_SEQUENCE.length;
      index += 1
    ) {
      const node =
        CANONICAL_PIPELINE_SEQUENCE[index];

      if (
        node.kind !== "FACTORY" ||
        node.id === "NAMLA_LAB"
      ) {
        continue;
      }

      const gate =
        CANONICAL_PIPELINE_SEQUENCE[
          index + 1
        ];

      const nextFactory =
        CANONICAL_PIPELINE_SEQUENCE[
          index + 2
        ];

      assert.ok(gate);
      assert.equal(
        gate.kind,
        "GATE",
      );

      if (gate.kind === "GATE") {
        assert.equal(
          gate.gateType,
          "NAMLA_LOOP",
        );

        assert.equal(
          gate.afterFactory,
          node.id,
        );
      }

      assert.ok(nextFactory);
      assert.equal(
        nextFactory.kind,
        "FACTORY",
      );
    }
  },
);

test(
  "10E3 NAMLA LAB hands off directly to terminal DELIVERY",
  () => {
    const labIndex =
      CANONICAL_PIPELINE_SEQUENCE
        .findIndex(
          (node) =>
            node.kind === "FACTORY" &&
            node.id === "NAMLA_LAB",
        );

    assert.notEqual(
      labIndex,
      -1,
    );

    const terminal =
      CANONICAL_PIPELINE_SEQUENCE[
        labIndex + 1
      ];

    assert.deepEqual(
      terminal,
      {
        kind: "TERMINAL",
        id: "DELIVERY",
      },
    );

    assert.equal(
      labIndex + 1,
      CANONICAL_PIPELINE_SEQUENCE
        .length - 1,
    );
  },
);

test(
  "10E3 frozen Plan Contract is mandatory authority between PLAN_TEST and PRO",
  () => {
    assert.deepEqual(
      CANONICAL_FROZEN_PLAN_CONTRACT_BOUNDARY,
      {
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
      },
    );

    const pro =
      getCanonicalFactory(
        "PRO",
      );

    assert.equal(
      pro.entryAuthority,
      "FROZEN_PLAN_CONTRACT",
    );
  },
);

test(
  "10E3 PROTOCOL is classified as authority boundary, not a top-level factory",
  () => {
    const protocol =
      LEGACY_ARCHITECTURE_CLASSIFICATION
        .find(
          (entry) =>
            entry.legacyId ===
            "PROTOCOL",
        );

    assert.ok(protocol);

    assert.equal(
      protocol.topLevelFactory,
      false,
    );

    assert.equal(
      protocol.canonicalRole,
      "AUTHORITY_BOUNDARY",
    );

    assert.equal(
      protocol.canonicalTarget,
      "FROZEN_PLAN_CONTRACT",
    );

    assert.equal(
      CANONICAL_FACTORY_REGISTRY.some(
        (factory) =>
          (factory.id as string) ===
          "PROTOCOL",
      ),
      false,
    );
  },
);

test(
  "10E3 Colony A and B are internal PRO lanes and not top-level factories",
  () => {
    assert.deepEqual(
      PRO_INTERNAL_EXECUTION_LANES,
      [
        "COLONY_A",
        "COLONY_B",
      ],
    );

    const pro =
      getCanonicalFactory(
        "PRO",
      );

    assert.deepEqual(
      pro.internalExecutionLanes,
      [
        "COLONY_A",
        "COLONY_B",
      ],
    );

    const colonyClassification =
      LEGACY_ARCHITECTURE_CLASSIFICATION
        .find(
          (entry) =>
            entry.legacyId ===
            "COLONY_AB",
        );

    assert.ok(
      colonyClassification,
    );

    assert.equal(
      colonyClassification
        .topLevelFactory,
      false,
    );

    assert.equal(
      colonyClassification
        .canonicalRole,
      "PRO_INTERNAL_EXECUTION",
    );

    assert.equal(
      colonyClassification
        .canonicalTarget,
      "PRO",
    );

    assert.equal(
      CANONICAL_PIPELINE_SEQUENCE.some(
        (node) =>
          (node.id as string) ===
          "COLONY_AB",
      ),
      false,
    );
  },
);

test(
  "10E3 every factory shell has the same external lifecycle contract",
  () => {
    assert.deepEqual(
      FACTORY_EXTERNAL_LIFECYCLE,
      [
        "INPUT_CONTRACT",
        "AUTHORITY",
        "RUNTIME",
        "OUTPUT_CONTRACT",
        "EVIDENCE",
      ],
    );

    for (
      const factory
      of CANONICAL_FACTORY_REGISTRY
    ) {
      assert.deepEqual(
        factory.externalLifecycle,
        FACTORY_EXTERNAL_LIFECYCLE,
      );
    }
  },
);

test(
  "10E3 Trusted Kernel is global non-bypassable authority/security plane",
  () => {
    assert.deepEqual(
      CANONICAL_TRUSTED_KERNEL_PLANE,
      {
        id:
          "TRUSTED_KERNEL",

        kind:
          "AUTHORITY_SECURITY_PLANE",

        appliesTo:
          "ALL_FACTORIES_GATES_AND_DELIVERY",

        bypassAllowed:
          false,
      },
    );
  },
);

test(
  "10E3 registry contains no duplicate factory or pipeline node identifiers",
  () => {
    const factoryIds =
      CANONICAL_FACTORY_REGISTRY.map(
        (factory) => factory.id,
      );

    assert.equal(
      new Set(factoryIds).size,
      factoryIds.length,
    );

    const nodeIds =
      CANONICAL_PIPELINE_SEQUENCE.map(
        (node) => node.id,
      );

    assert.equal(
      new Set(nodeIds).size,
      nodeIds.length,
    );
  },
);

test(
  "10E3 PLAN and PLAN_TEST remain distinct factories",
  () => {
    const plan =
      getCanonicalFactory(
        "PLAN",
      );

    const planTest =
      getCanonicalFactory(
        "PLAN_TEST",
      );

    assert.notEqual(
      plan.id,
      planTest.id,
    );

    assert.equal(
      plan.displayName,
      "Plan Factory",
    );

    assert.equal(
      planTest.displayName,
      "Plan Test Factory",
    );
  },
);

test(
  "10E3 registry objects are frozen architecture authority",
  () => {
    assert.equal(
      Object.isFrozen(
        CANONICAL_FACTORY_REGISTRY,
      ),
      true,
    );

    assert.equal(
      Object.isFrozen(
        CANONICAL_PIPELINE_SEQUENCE,
      ),
      true,
    );

    assert.equal(
      Object.isFrozen(
        FACTORY_EXTERNAL_LIFECYCLE,
      ),
      true,
    );

    assert.equal(
      Object.isFrozen(
        PRO_INTERNAL_EXECUTION_LANES,
      ),
      true,
    );

    assert.equal(
      Object.isFrozen(
        CANONICAL_FROZEN_PLAN_CONTRACT_BOUNDARY,
      ),
      true,
    );

    assert.equal(
      Object.isFrozen(
        CANONICAL_TRUSTED_KERNEL_PLANE,
      ),
      true,
    );

    for (
      const factory
      of CANONICAL_FACTORY_REGISTRY
    ) {
      assert.equal(
        Object.isFrozen(factory),
        true,
      );
    }

    for (
      const node
      of CANONICAL_PIPELINE_SEQUENCE
    ) {
      assert.equal(
        Object.isFrozen(node),
        true,
      );
    }
  },
);

test(
  "10E3 built-in registry validator reports no architecture violations",
  () => {
    const validation =
      validateCanonicalPipelineRegistry();

    assert.equal(
      validation.ok,
      true,
    );

    assert.deepEqual(
      validation.errors,
      [],
    );

    assert.equal(
      Object.isFrozen(
        validation.errors,
      ),
      true,
    );
  },
);

test(
  "10E3 DELIVERY is terminal and never classified as a factory",
  () => {
    const deliveryNodes =
      CANONICAL_PIPELINE_SEQUENCE.filter(
        (node) =>
          node.id === "DELIVERY",
      );

    assert.equal(
      deliveryNodes.length,
      1,
    );

    assert.equal(
      deliveryNodes[0]?.kind,
      "TERMINAL",
    );

    assert.equal(
      CANONICAL_FACTORY_REGISTRY.some(
        (factory) =>
          (factory.id as string) ===
          "DELIVERY",
      ),
      false,
    );
  },
);