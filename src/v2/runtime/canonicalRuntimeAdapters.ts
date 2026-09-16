/**
 * NAMLA V2 canonical runtime adapter bindings (10E5).
 *
 * This module preserves the real heterogeneous APIs of the runtime-backed
 * canonical factories. It does not invent a generic execute(input) contract,
 * instantiate factories, execute factories, or bypass TrustedKernel authority.
 *
 * 10E6 may inject concrete implementations satisfying
 * CanonicalRuntimeAdapterBundle.
 */

import type { EerEngine } from "../eer/eerEngine";
import type { PlanEngine } from "../plan/planEngine";
import type { ProDispatcher } from "../pro/proDispatcher";
import type { SonAnalyzer } from "../son/sonAnalyzer";
import type { LeggoIntegrator } from "../leggo/leggoIntegrator";
import type { ProMaxVerifier } from "../promax/proMaxVerifier";
import type { LabPackager } from "../lab/labPackager";

import {
  CANONICAL_RUNTIME_BACKED_FACTORY_IDS,
  getCanonicalFactoryShell,
} from "../architecture/canonicalFactoryShells";

import type {
  CanonicalFactoryId,
} from "../architecture/canonicalPipelineRegistry";

export interface CanonicalRuntimeAdapterBundle {
  readonly EER:
    Pick<EerEngine, "evaluateObjective">;

  readonly PLAN:
    Pick<PlanEngine, "generatePlan">;

  readonly PRO:
    Pick<
      ProDispatcher,
      | "computeSchedule"
      | "createDualExecutions"
      | "transitionExecutionState"
    >;

  readonly SON:
    Pick<SonAnalyzer, "compareResults">;

  readonly LEGGO:
    Pick<LeggoIntegrator, "integrate">;

  readonly PROMAX:
    Pick<ProMaxVerifier, "verifyCandidate">;

  readonly NAMLA_LAB:
    Pick<LabPackager, "packageDeliverables">;
}

export type CanonicalRuntimeBackedFactoryId =
  keyof CanonicalRuntimeAdapterBundle;

export type CanonicalAdapterContextPhase =
  | "PRE_FREEZE"
  | "CONTRACT_BOUND";

export interface CanonicalRuntimeAdapterBindingFor<
  K extends CanonicalRuntimeBackedFactoryId,
> {
  readonly factoryId: K;
  readonly status: "BOUND";
  readonly owner: string;
  readonly methods:
    readonly Extract<
      keyof CanonicalRuntimeAdapterBundle[K],
      string
    >[];
  readonly requiredContextPhase:
    CanonicalAdapterContextPhase;
}

export type CanonicalRuntimeAdapterBinding = {
  [K in CanonicalRuntimeBackedFactoryId]:
    CanonicalRuntimeAdapterBindingFor<K>;
}[CanonicalRuntimeBackedFactoryId];

export type CanonicalRuntimeAdapterResolution =
  | {
      readonly kind: "BOUND";
      readonly binding:
        CanonicalRuntimeAdapterBinding;
    }
  | {
      readonly kind: "UNAVAILABLE";
      readonly factoryId:
        CanonicalFactoryId;
      readonly executionPolicy:
        "FAIL_CLOSED";
      readonly reasonCode:
        "CANONICAL_FACTORY_RUNTIME_UNIMPLEMENTED";
    };

function binding<
  K extends CanonicalRuntimeBackedFactoryId,
>(
  factoryId: K,
  owner: string,
  methods:
    readonly Extract<
      keyof CanonicalRuntimeAdapterBundle[K],
      string
    >[],
  requiredContextPhase:
    CanonicalAdapterContextPhase,
): CanonicalRuntimeAdapterBindingFor<K> {
  return Object.freeze({
    factoryId,
    status: "BOUND" as const,
    owner,
    methods:
      Object.freeze([
        ...methods,
      ]),
    requiredContextPhase,
  });
}

export const CANONICAL_RUNTIME_ADAPTER_BINDINGS:
  readonly CanonicalRuntimeAdapterBinding[] =
    Object.freeze([
      binding(
        "EER",
        "EerEngine",
        ["evaluateObjective"],
        "PRE_FREEZE",
      ),

      binding(
        "PLAN",
        "PlanEngine",
        ["generatePlan"],
        "PRE_FREEZE",
      ),

      binding(
        "PRO",
        "ProDispatcher",
        [
          "computeSchedule",
          "createDualExecutions",
          "transitionExecutionState",
        ],
        "CONTRACT_BOUND",
      ),

      binding(
        "SON",
        "SonAnalyzer",
        ["compareResults"],
        "CONTRACT_BOUND",
      ),

      binding(
        "LEGGO",
        "LeggoIntegrator",
        ["integrate"],
        "CONTRACT_BOUND",
      ),

      binding(
        "PROMAX",
        "ProMaxVerifier",
        ["verifyCandidate"],
        "CONTRACT_BOUND",
      ),

      binding(
        "NAMLA_LAB",
        "LabPackager",
        ["packageDeliverables"],
        "CONTRACT_BOUND",
      ),
    ]);

export function resolveCanonicalRuntimeAdapter(
  factoryId:
    CanonicalFactoryId,
): CanonicalRuntimeAdapterResolution {
  const shell =
    getCanonicalFactoryShell(factoryId);

  if (
    shell.implementation.kind ===
    "MISSING_RUNTIME_IMPLEMENTATION"
  ) {
    return Object.freeze({
      kind:
        "UNAVAILABLE" as const,
      factoryId,
      executionPolicy:
        "FAIL_CLOSED" as const,
      reasonCode:
        shell.implementation.reasonCode,
    });
  }

  const adapter =
    CANONICAL_RUNTIME_ADAPTER_BINDINGS
      .find(
        (candidate) =>
          candidate.factoryId ===
          factoryId,
      );

  if (!adapter) {
    throw new Error(
      `CANONICAL_RUNTIME_ADAPTER_BINDING_MISSING:${factoryId}`,
    );
  }

  return Object.freeze({
    kind:
      "BOUND" as const,
    binding:
      adapter,
  });
}

export interface CanonicalRuntimeAdapterValidation {
  readonly ok: boolean;
  readonly errors:
    readonly string[];
}

export function validateCanonicalRuntimeAdapterBindings():
  CanonicalRuntimeAdapterValidation {
  const errors:
    string[] = [];

  const bindingIds =
    CANONICAL_RUNTIME_ADAPTER_BINDINGS
      .map(
        (adapter) =>
          adapter.factoryId,
      );

  if (
    new Set(bindingIds).size !==
    bindingIds.length
  ) {
    errors.push(
      "DUPLICATE_RUNTIME_ADAPTER_BINDING",
    );
  }

  if (
    bindingIds.length !==
    CANONICAL_RUNTIME_BACKED_FACTORY_IDS
      .length
  ) {
    errors.push(
      "RUNTIME_ADAPTER_BINDING_COUNT_MISMATCH",
    );
  }

  for (
    let index = 0;
    index <
      CANONICAL_RUNTIME_BACKED_FACTORY_IDS
        .length;
    index += 1
  ) {
    if (
      bindingIds[index] !==
      CANONICAL_RUNTIME_BACKED_FACTORY_IDS[
        index
      ]
    ) {
      errors.push(
        "RUNTIME_ADAPTER_BINDING_ORDER_MISMATCH",
      );

      break;
    }
  }

  for (
    const factoryId
    of CANONICAL_RUNTIME_BACKED_FACTORY_IDS
  ) {
    const resolution =
      resolveCanonicalRuntimeAdapter(
        factoryId,
      );

    if (
      resolution.kind !==
      "BOUND"
    ) {
      errors.push(
        `RUNTIME_ADAPTER_NOT_BOUND:${factoryId}`,
      );
    }
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