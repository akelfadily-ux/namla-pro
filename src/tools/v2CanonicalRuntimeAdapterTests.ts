import assert from "node:assert/strict";
import test from "node:test";

import {
  CANONICAL_RUNTIME_ADAPTER_BINDINGS,
  resolveCanonicalRuntimeAdapter,
  validateCanonicalRuntimeAdapterBindings,
} from "../v2/runtime/canonicalRuntimeAdapters";

import {
  CANONICAL_RUNTIME_BACKED_FACTORY_IDS,
  CANONICAL_SHELL_ONLY_FACTORY_IDS,
  getCanonicalFactoryShell,
} from "../v2/architecture/canonicalFactoryShells";

const EXPECTED_BINDINGS = [
  {
    factoryId: "EER",
    owner: "EerEngine",
    methods: ["evaluateObjective"],
    requiredContextPhase: "PRE_FREEZE",
  },
  {
    factoryId: "PLAN",
    owner: "PlanEngine",
    methods: ["generatePlan"],
    requiredContextPhase: "PRE_FREEZE",
  },
  {
    factoryId: "PRO",
    owner: "ProDispatcher",
    methods: [
      "computeSchedule",
      "createDualExecutions",
      "transitionExecutionState",
    ],
    requiredContextPhase: "CONTRACT_BOUND",
  },
  {
    factoryId: "SON",
    owner: "SonAnalyzer",
    methods: ["compareResults"],
    requiredContextPhase: "CONTRACT_BOUND",
  },
  {
    factoryId: "LEGGO",
    owner: "LeggoIntegrator",
    methods: ["integrate"],
    requiredContextPhase: "CONTRACT_BOUND",
  },
  {
    factoryId: "PROMAX",
    owner: "ProMaxVerifier",
    methods: ["verifyCandidate"],
    requiredContextPhase: "CONTRACT_BOUND",
  },
  {
    factoryId: "NAMLA_LAB",
    owner: "LabPackager",
    methods: ["packageDeliverables"],
    requiredContextPhase: "CONTRACT_BOUND",
  },
] as const;

test(
  "10E5 runtime adapter bindings cover exactly the runtime-backed canonical factories",
  () => {
    assert.deepEqual(
      CANONICAL_RUNTIME_ADAPTER_BINDINGS.map(
        (binding) => binding.factoryId,
      ),
      CANONICAL_RUNTIME_BACKED_FACTORY_IDS,
    );

    assert.equal(
      CANONICAL_RUNTIME_ADAPTER_BINDINGS.length,
      7,
    );
  },
);

test(
  "10E5 preserves the real heterogeneous runtime owners and method surfaces",
  () => {
    assert.deepEqual(
      CANONICAL_RUNTIME_ADAPTER_BINDINGS,
      EXPECTED_BINDINGS.map(
        (expected) => ({
          ...expected,
          status: "BOUND",
          methods: [...expected.methods],
        }),
      ),
    );
  },
);

test(
  "10E5 only EER and PLAN are pre-freeze runtime bindings",
  () => {
    assert.deepEqual(
      CANONICAL_RUNTIME_ADAPTER_BINDINGS
        .filter(
          (binding) =>
            binding.requiredContextPhase ===
            "PRE_FREEZE",
        )
        .map(
          (binding) =>
            binding.factoryId,
        ),
      ["EER", "PLAN"],
    );
  },
);

test(
  "10E5 all post-freeze runtime-backed factories require contract-bound context",
  () => {
    assert.deepEqual(
      CANONICAL_RUNTIME_ADAPTER_BINDINGS
        .filter(
          (binding) =>
            binding.requiredContextPhase ===
            "CONTRACT_BOUND",
        )
        .map(
          (binding) =>
            binding.factoryId,
        ),
      [
        "PRO",
        "SON",
        "LEGGO",
        "PROMAX",
        "NAMLA_LAB",
      ],
    );
  },
);

test(
  "10E5 runtime-backed canonical factories resolve to bound adapters",
  () => {
    for (
      const factoryId
      of CANONICAL_RUNTIME_BACKED_FACTORY_IDS
    ) {
      const shell =
        getCanonicalFactoryShell(
          factoryId,
        );

      assert.equal(
        shell.implementation.kind,
        "EXISTING_CAPABILITY",
      );

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
        resolution.binding.factoryId,
        factoryId,
      );
    }
  },
);

test(
  "10E5 shell-only factories remain unavailable and fail closed",
  () => {
    for (
      const factoryId
      of CANONICAL_SHELL_ONLY_FACTORY_IDS
    ) {
      const resolution =
        resolveCanonicalRuntimeAdapter(
          factoryId,
        );

      assert.deepEqual(
        resolution,
        {
          kind: "UNAVAILABLE",
          factoryId,
          executionPolicy:
            "FAIL_CLOSED",
          reasonCode:
            "CANONICAL_FACTORY_RUNTIME_UNIMPLEMENTED",
        },
      );
    }
  },
);

test(
  "10E5 adapter metadata is immutable",
  () => {
    assert.equal(
      Object.isFrozen(
        CANONICAL_RUNTIME_ADAPTER_BINDINGS,
      ),
      true,
    );

    for (
      const binding
      of CANONICAL_RUNTIME_ADAPTER_BINDINGS
    ) {
      assert.equal(
        Object.isFrozen(binding),
        true,
      );

      assert.equal(
        Object.isFrozen(
          binding.methods,
        ),
        true,
      );
    }
  },
);

test(
  "10E5 adapter resolver refuses non-canonical factory ids",
  () => {
    assert.throws(
      () =>
        resolveCanonicalRuntimeAdapter(
          "PROTOCOL" as never,
        ),
      /UNKNOWN_CANONICAL_FACTORY_SHELL:PROTOCOL/,
    );
  },
);

test(
  "10E5 built-in adapter validator reports no binding violations",
  () => {
    const validation =
      validateCanonicalRuntimeAdapterBindings();

    assert.equal(
      validation.ok,
      true,
    );

    assert.deepEqual(
      validation.errors,
      [],
    );

    assert.equal(
      Object.isFrozen(validation),
      true,
    );

    assert.equal(
      Object.isFrozen(
        validation.errors,
      ),
      true,
    );
  },
);