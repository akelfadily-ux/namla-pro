/**
 * 10E4 Canonical Factory Shell Registry.
 *
 * Architecture-only convergence layer over the fixed 10E3 pipeline registry.
 *
 * This module intentionally does NOT:
 * - execute factories,
 * - adapt the legacy NamlaRuntime,
 * - invent behavior for factories without an implementation,
 * - replace TrustedKernel authority,
 * - turn PROTOCOL or COLONY_AB into top-level factories.
 *
 * Runtime adapter binding belongs to 10E5.
 */

import {
  CANONICAL_FACTORY_REGISTRY,
  type CanonicalFactoryDescriptor,
  type CanonicalFactoryId,
} from "./canonicalPipelineRegistry";

export type CanonicalFactoryImplementation =
  | {
      readonly kind: "EXISTING_CAPABILITY";
      readonly stepperBinding: "DEFERRED_TO_10E5";
    }
  | {
      readonly kind: "MISSING_RUNTIME_IMPLEMENTATION";
      readonly stepperBinding: "UNAVAILABLE";
      readonly executionPolicy: "FAIL_CLOSED";
      readonly reasonCode: "CANONICAL_FACTORY_RUNTIME_UNIMPLEMENTED";
    };

export interface CanonicalFactoryShell {
  readonly id: CanonicalFactoryId;

  /**
   * The 10E3 registry remains the architecture authority for:
   * lifecycle, entry authority, post-boundary, and internal lanes.
   */
  readonly architecture: CanonicalFactoryDescriptor;

  /**
   * 10E4 records implementation availability only.
   * It does not provide an execution adapter.
   */
  readonly implementation: CanonicalFactoryImplementation;
}

const EXISTING_CAPABILITY: CanonicalFactoryImplementation =
  Object.freeze({
    kind: "EXISTING_CAPABILITY" as const,
    stepperBinding: "DEFERRED_TO_10E5" as const,
  });


const IMPLEMENTATION_BY_FACTORY:
  Readonly<Record<CanonicalFactoryId, CanonicalFactoryImplementation>> =
    Object.freeze({
      EER: EXISTING_CAPABILITY,
      PLAN: EXISTING_CAPABILITY,
      PLAN_TEST: EXISTING_CAPABILITY,
      PRO: EXISTING_CAPABILITY,
      SON: EXISTING_CAPABILITY,
      LEGGO: EXISTING_CAPABILITY,
      PROMAX: EXISTING_CAPABILITY,
      FINAL_SPRINT_COURT: EXISTING_CAPABILITY,
      LIHU: EXISTING_CAPABILITY,
      DEVOPS: EXISTING_CAPABILITY,
      API_INTEGRATION: EXISTING_CAPABILITY,
      SECURITY: EXISTING_CAPABILITY,
      NAMLA_LAB: EXISTING_CAPABILITY,
    });

export const CANONICAL_FACTORY_SHELL_REGISTRY:
  readonly CanonicalFactoryShell[] =
    Object.freeze(
      CANONICAL_FACTORY_REGISTRY.map(
        (architecture) =>
          Object.freeze({
            id: architecture.id,
            architecture,
            implementation:
              IMPLEMENTATION_BY_FACTORY[
                architecture.id
              ],
          }),
      ),
    );

export const CANONICAL_RUNTIME_BACKED_FACTORY_IDS:
  readonly CanonicalFactoryId[] =
    Object.freeze(
      CANONICAL_FACTORY_SHELL_REGISTRY
        .filter(
          (shell) =>
            shell.implementation.kind ===
            "EXISTING_CAPABILITY",
        )
        .map((shell) => shell.id),
    );

export const CANONICAL_SHELL_ONLY_FACTORY_IDS:
  readonly CanonicalFactoryId[] =
    Object.freeze(
      CANONICAL_FACTORY_SHELL_REGISTRY
        .filter(
          (shell) =>
            shell.implementation.kind ===
            "MISSING_RUNTIME_IMPLEMENTATION",
        )
        .map((shell) => shell.id),
    );

export function getCanonicalFactoryShell(
  id: CanonicalFactoryId,
): CanonicalFactoryShell {
  const shell =
    CANONICAL_FACTORY_SHELL_REGISTRY.find(
      (candidate) =>
        candidate.id === id,
    );

  if (!shell) {
    throw new Error(
      `UNKNOWN_CANONICAL_FACTORY_SHELL:${id}`,
    );
  }

  return shell;
}

export interface CanonicalFactoryShellValidation {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

/**
 * Structural validation only.
 *
 * Runtime execution is intentionally out of scope until 10E5.
 */
export function validateCanonicalFactoryShellRegistry():
  CanonicalFactoryShellValidation {
  const errors: string[] = [];

  if (
    CANONICAL_FACTORY_SHELL_REGISTRY.length !==
    CANONICAL_FACTORY_REGISTRY.length
  ) {
    errors.push(
      "FACTORY_SHELL_COUNT_MISMATCH",
    );
  }

  const shellIds =
    CANONICAL_FACTORY_SHELL_REGISTRY.map(
      (shell) => shell.id,
    );

  if (
    new Set(shellIds).size !==
    shellIds.length
  ) {
    errors.push(
      "DUPLICATE_FACTORY_SHELL_ID",
    );
  }

  for (
    let index = 0;
    index <
      CANONICAL_FACTORY_REGISTRY.length;
    index += 1
  ) {
    const architecture =
      CANONICAL_FACTORY_REGISTRY[index];

    const shell =
      CANONICAL_FACTORY_SHELL_REGISTRY[
        index
      ];

    if (!shell) {
      errors.push(
        `FACTORY_SHELL_MISSING:${architecture.id}`,
      );
      continue;
    }

    if (
      shell.id !== architecture.id
    ) {
      errors.push(
        `FACTORY_SHELL_ORDER_MISMATCH:${architecture.id}`,
      );
    }

    if (
      shell.architecture !== architecture
    ) {
      errors.push(
        `FACTORY_SHELL_ARCHITECTURE_AUTHORITY_MISMATCH:${architecture.id}`,
      );
    }

    if (
      shell.implementation.kind ===
      "EXISTING_CAPABILITY"
    ) {
      if (
        shell.implementation
          .stepperBinding !==
        "DEFERRED_TO_10E5"
      ) {
        errors.push(
          `EXISTING_FACTORY_STEPPER_BINDING_INVALID:${shell.id}`,
        );
      }

      continue;
    }

    if (
      shell.implementation
        .stepperBinding !==
        "UNAVAILABLE" ||
      shell.implementation
        .executionPolicy !==
        "FAIL_CLOSED" ||
      shell.implementation
        .reasonCode !==
        "CANONICAL_FACTORY_RUNTIME_UNIMPLEMENTED"
    ) {
      errors.push(
        `SHELL_ONLY_FACTORY_FAIL_CLOSED_INVALID:${shell.id}`,
      );
    }
  }

  const frozenErrors =
    Object.freeze([...errors]);

  return Object.freeze({
    ok: frozenErrors.length === 0,
    errors: frozenErrors,
  });
}
