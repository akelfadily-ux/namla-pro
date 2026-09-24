import test from "node:test";
import assert from "node:assert/strict";

import {
  CANONICAL_FACTORY_ORDER,
} from "../v2/architecture/canonicalPipelineRegistry";

import {
  CANONICAL_RUNTIME_BACKED_FACTORY_IDS,
  CANONICAL_SHELL_ONLY_FACTORY_IDS,
  validateCanonicalFactoryShellRegistry,
} from "../v2/architecture/canonicalFactoryShells";

import {
  CANONICAL_RUNTIME_ADAPTER_BINDINGS,
  resolveCanonicalRuntimeAdapter,
  validateCanonicalRuntimeAdapterBindings,
} from "../v2/runtime/canonicalRuntimeAdapters";

import {
  inspectCanonicalRuntimeStep,
  type CanonicalRuntimeCursor,
} from "../v2/runtime/canonicalRuntimeStepper";

import {
  CANONICAL_PIPELINE_SEQUENCE,
} from "../v2/architecture/canonicalPipelineRegistry";

const ACTIVATED = [
  "PLAN_TEST",
  "FINAL_SPRINT_COURT",
  "LIHU",
  "DEVOPS",
  "API_INTEGRATION",
  "SECURITY",
] as const;

function cursorAt(
  id: typeof ACTIVATED[number],
): CanonicalRuntimeCursor {
  const nodeIndex =
    CANONICAL_PIPELINE_SEQUENCE.findIndex(
      (node) =>
        node.kind === "FACTORY" &&
        node.id === id,
    );

  assert.ok(nodeIndex >= 0);

  const node =
    CANONICAL_PIPELINE_SEQUENCE[nodeIndex];

  assert.equal(node.kind, "FACTORY");

  const proIndex =
    CANONICAL_PIPELINE_SEQUENCE.findIndex(
      (candidate) =>
        candidate.kind === "FACTORY" &&
        candidate.id === "PRO",
    );

  return {
    schemaVersion:
      "namla-v2-canonical-runtime-cursor-v1",
    missionId:
      "c9c3-activation",
    nodeIndex,
    nodeId:
      id,
    nodeKind:
      "FACTORY",
    stepVersion:
      nodeIndex + 1,
    contractPhase:
      nodeIndex < proIndex
        ? "PRE_FREEZE"
        : "CONTRACT_BOUND",
  };
}

test(
  "C9C3 all canonical factories are runtime-backed in exact pipeline order",
  () => {
    assert.deepEqual(
      CANONICAL_RUNTIME_BACKED_FACTORY_IDS,
      CANONICAL_FACTORY_ORDER,
    );
  },
);

test(
  "C9C3 zero canonical factories remain shell-only",
  () => {
    assert.deepEqual(
      CANONICAL_SHELL_ONLY_FACTORY_IDS,
      [],
    );
  },
);

test(
  "C9C3 shell registry validator remains green after activation",
  () => {
    assert.deepEqual(
      validateCanonicalFactoryShellRegistry(),
      {
        ok: true,
        errors: [],
      },
    );
  },
);

test(
  "C9C3 adapter registry validator remains green after activation",
  () => {
    assert.deepEqual(
      validateCanonicalRuntimeAdapterBindings(),
      {
        ok: true,
        errors: [],
      },
    );
  },
);

test(
  "C9C3 adapter order is exactly the canonical factory order",
  () => {
    assert.deepEqual(
      CANONICAL_RUNTIME_ADAPTER_BINDINGS.map(
        (binding) =>
          binding.factoryId,
      ),
      CANONICAL_FACTORY_ORDER,
    );
  },
);

test(
  "C9C3 PLAN_TEST remains pre-freeze and exposes only validateAndFreezePlan",
  () => {
    const resolution =
      resolveCanonicalRuntimeAdapter(
        "PLAN_TEST",
      );

    assert.equal(
      resolution.kind,
      "BOUND",
    );

    if (
      resolution.kind !==
        "BOUND"
    ) {
      return;
    }

    assert.equal(
      resolution.binding.requiredContextPhase,
      "PRE_FREEZE",
    );

    assert.deepEqual(
      resolution.binding.methods,
      ["validateAndFreezePlan"],
    );
  },
);

test(
  "C9C3 post-ProMax bindings remain contract-bound with exact method surfaces",
  () => {
    const expected = {
      FINAL_SPRINT_COURT:
        ["adjudicate"],
      LIHU:
        ["evaluate"],
      DEVOPS:
        ["qualifyRelease"],
      API_INTEGRATION:
        ["verifyIntegrations"],
      SECURITY:
        ["verifySecurity"],
    } as const;

    for (
      const factoryId
      of Object.keys(expected) as
        (keyof typeof expected)[]
    ) {
      const resolution =
        resolveCanonicalRuntimeAdapter(
          factoryId,
        );

      assert.equal(
        resolution.kind,
        "BOUND",
      );

      if (
        resolution.kind !==
          "BOUND"
      ) {
        continue;
      }

      assert.equal(
        resolution.binding.requiredContextPhase,
        "CONTRACT_BOUND",
      );

      assert.deepEqual(
        resolution.binding.methods,
        expected[factoryId],
      );
    }
  },
);

test(
  "C9C3 stepper exposes RUN_FACTORY for all six newly activated factories",
  () => {
    for (
      const factoryId
      of ACTIVATED
    ) {
      const decision =
        inspectCanonicalRuntimeStep(
          cursorAt(factoryId),
        );

      assert.equal(
        decision.kind,
        "RUN_FACTORY",
        factoryId,
      );

      if (
        decision.kind ===
          "RUN_FACTORY"
      ) {
        assert.equal(
          decision.factoryId,
          factoryId,
        );
      }
    }
  },
);
