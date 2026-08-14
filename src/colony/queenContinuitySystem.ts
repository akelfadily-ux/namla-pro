/**
 * Colony Genesis G0 — the Queen-system identity.
 *
 * The Queen is CONTINUITY, not COMMAND. She represents reproduction, colony
 * identity, genetic continuity, brood production, generation transition, and
 * population renewal. She does not decide what any ant does.
 *
 * In a real colony the queen influences work without commanding it: she
 * produces brood, and brood generates local nursing demand that nearby ants
 * respond to on their own. Influence flows through the environment. That is
 * the model here — and the architectural test for whether it has been honored
 * is simple: this record holds no reference to the worker population. If a
 * future phase ever needs to hand the Queen the roster, the design has failed.
 *
 * The four authority fields below are typed as the literal `false`, so a Queen
 * that claims scheduling, routing, quorum-selection, or population-memory
 * authority is not merely forbidden — it is unrepresentable in the type
 * system, and `colonyInvariants.ts` re-checks it at runtime against casts.
 *
 * No fs, no wall clock, no randomness, no module-level mutable state.
 */

import type { ChamberId } from "./nestGraph";

export interface QueenContinuityRecord {
  readonly queenId: string;
  readonly colonyId: string;
  /** Which generation of the lineage this queen heads. */
  readonly generation: number;
  /** Reference to the genome by id. The genome itself lives on the colony. */
  readonly genomeId: string;
  /** How many brood the colony's genome permits per generation (G6 reads it). */
  readonly broodCapacityPerGeneration: number;
  /** How many generations deep the lineage runs. Genesis is depth 1. */
  readonly lineageDepth: number;
  /** Where the queen resides. Location, not jurisdiction. */
  readonly chamberId: ChamberId;

  // --- explicit absence of authority (literal false: cannot be widened) ---
  readonly taskAssignmentAuthority: false;
  readonly routingAuthority: false;
  readonly quorumSelectionAuthority: false;
  readonly populationMemoryAccess: false;

  /** Count of tasks this queen has ever assigned. Literal 0 in every phase. */
  readonly queenTaskAssignments: 0;
}

export interface CreateQueenContinuityInput {
  readonly queenId: string;
  readonly colonyId: string;
  readonly generation: number;
  readonly genomeId: string;
  readonly broodCapacityPerGeneration: number;
  readonly chamberId: ChamberId;
}

/**
 * Create the single Queen-system identity for a colony. Pure and
 * deterministic; the caller supplies every value.
 */
export function createQueenContinuitySystem(
  input: CreateQueenContinuityInput
): QueenContinuityRecord {
  return {
    queenId: input.queenId,
    colonyId: input.colonyId,
    generation: input.generation,
    genomeId: input.genomeId,
    broodCapacityPerGeneration: input.broodCapacityPerGeneration,
    lineageDepth: input.generation,
    chamberId: input.chamberId,

    taskAssignmentAuthority: false,
    routingAuthority: false,
    quorumSelectionAuthority: false,
    populationMemoryAccess: false,

    queenTaskAssignments: 0,
  };
}

/**
 * G6: advance the Queen's OWN generation/lineage counters when a full
 * generation's worth of brood has been admitted into the persistent
 * population. Reads and writes only the queen record passed in — no
 * population, no roster, no worker reference, preserving the same
 * "no population reference" guarantee `queenHoldsNoAuthority` checks. This
 * is continuity bookkeeping, not a decision about any ant's task.
 *
 * Authorized by NAMLA_BUILD_LAW.md Section 15 (Colony Genesis G6-G7).
 */
export function maybeAdvanceGeneration(
  queen: QueenContinuityRecord,
  admittedThisGeneration: number
): { readonly queen: QueenContinuityRecord; readonly advanced: boolean } {
  if (admittedThisGeneration < queen.broodCapacityPerGeneration) {
    return { queen, advanced: false };
  }

  return {
    queen: {
      ...queen,
      generation: queen.generation + 1,
      lineageDepth: queen.lineageDepth + 1,
    },
    advanced: true,
  };
}

/**
 * Runtime re-check of the Queen's authority absence, including fields a cast
 * could have smuggled in. Types stop honest mistakes; this stops casts.
 */
export function queenHoldsNoAuthority(queen: QueenContinuityRecord): boolean {
  const asRecord = queen as unknown as Record<string, unknown>;

  const declaredFalse =
    asRecord.taskAssignmentAuthority === false &&
    asRecord.routingAuthority === false &&
    asRecord.quorumSelectionAuthority === false &&
    asRecord.populationMemoryAccess === false &&
    asRecord.queenTaskAssignments === 0;

  // A Queen that acquired any of these keys by cast is a central planner
  // wearing a biology costume, whatever the values happen to be.
  const forbiddenKeys = [
    "taskAssignments",
    "assignedTasks",
    "taskQueue",
    "routingTable",
    "routes",
    "scheduler",
    "quorumWinner",
    "quorumWinnerId",
    "population",
    "workers",
    "antMemories",
    "colonyState",
  ];
  const hasForbiddenKey = forbiddenKeys.some((key) =>
    Object.prototype.hasOwnProperty.call(asRecord, key)
  );

  return declaredFalse && !hasForbiddenKey;
}
