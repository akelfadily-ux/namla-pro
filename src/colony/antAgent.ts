/**
 * Colony Genesis G0 — the canonical per-ant state record.
 *
 * An AntAgent is PLAIN DATA describing one persistent identity. It is not a
 * class, has no methods, and holds no capability. Hundreds of genuinely
 * distinct ants come from one model plus a seeded genome derivation — never
 * from hundreds of subclasses.
 *
 * The anti-omniscience rule is the load-bearing constraint here: an ant may
 * hold summaries of what IT personally observed, and nothing else. There is
 * deliberately no field for the colony, the population, the nest graph, the
 * roster, a global counter, or another ant's state. That is what makes future
 * decentralization mechanically checkable instead of merely claimed — see
 * `colonyInvariants.ts`, which enforces it structurally.
 *
 * G0 initializes every behavioral field to a neutral resting value. The fields
 * exist so later phases have somewhere to write; no field is read by any
 * decision yet, because G0 has no decisions.
 *
 * No fs, no wall clock, no randomness beyond the injected seeded generator,
 * no module-level mutable state.
 */

import type {
  ActivationMode,
  Caste,
  ColonyPheromoneType,
  LifecycleState,
  SkillTendency,
  TaskCategory,
  WorkState,
} from "./colonyTypes";
import {
  COLONY_PHEROMONE_TYPES,
  SKILL_TENDENCIES,
  TASK_CATEGORIES,
  clamp,
  createSeededRandom,
  roundTo,
} from "./colonyTypes";
import type { AntGenomeProfile, ColonyGenome } from "./colonyGenome";
import { deriveAntGenomeProfile, initialResponseThresholds } from "./colonyGenome";
import type { ChamberId } from "./nestGraph";

/** How much of its own recent past an ant may remember. Bounded by design. */
export const ENCOUNTER_MEMORY_CAPACITY = 20 as const;

/**
 * One remembered encounter. An ant records WHAT STATE the other ant was in and
 * whether it was carrying a success — never the other ant's identity, genome,
 * thresholds, or history. Encounter rate over this window is the harvester-ant
 * signal future phases will read.
 */
export interface EncounterMemoryEntry {
  readonly tick: number;
  readonly otherWorkState: WorkState;
  readonly otherCarriedSuccess: boolean;
}

/** A private, personally-formed opinion about one colony-level candidate. */
export interface PrivateCandidateAssessment {
  readonly candidateId: string;
  readonly privateQuality: number;
  readonly assessedAtTick: number;
}

/** Temnothorax-style commitment ladder. Reversible until quorum (G5). */
export type CommitmentState = "uncommitted" | "assessing" | "recruiting" | "committed";

export interface AntAgent {
  // --- identity and inheritance (immutable for the ant's lifetime) ---
  readonly antId: string;
  readonly antIndex: number;
  readonly generation: number;
  readonly caste: Caste;
  readonly genomeProfile: AntGenomeProfile;

  // --- learned / heritable behavioral parameters ---
  readonly responseThresholds: Readonly<Record<TaskCategory, number>>;
  readonly taskPropensities: Readonly<Record<TaskCategory, number>>;
  readonly skillTendencies: Readonly<Record<SkillTendency, number>>;

  // --- physiology ---
  readonly energy: number;
  readonly health: number;
  readonly age: number;
  readonly lifecycleState: LifecycleState;
  readonly recoveryTicksRemaining: number;

  // --- behavioral state (a STATE, never a class and never an assignment) ---
  readonly activationMode: ActivationMode;
  readonly currentBehaviorState: WorkState;
  readonly taskSwitchCost: number;
  /**
   * Immutable genesis fact: was this ant created starting in reserve. G7
   * makes `activationMode` mutable (see cognitiveBudgetSystem.ts), so this
   * is the stable marker "started in reserve" now relies on instead.
   */
  readonly startsInReserve: boolean;

  // --- locality ---
  readonly chamberId: ChamberId;

  // --- bounded local observation (the anti-omniscience surface) ---
  readonly recentEncounterMemory: readonly EncounterMemoryEntry[];
  readonly encounterMemoryCapacity: number;
  readonly localStimulusObservations: Readonly<Record<TaskCategory, number>>;
  readonly localPheromoneObservations: Readonly<Record<ColonyPheromoneType, number>>;

  // --- private decision state ---
  readonly privateCandidateAssessments: readonly PrivateCandidateAssessment[];
  readonly commitmentState: CommitmentState;
  /**
   * G5: how many of this ant's own bounded chamber-local encounters have
   * reported a nestmate supporting this ant's own top candidate. Clamped to
   * `genome.quorumThreshold`, so it is bounded by construction — never an
   * unbounded accumulator, never read by any other ant.
   */
  readonly localQuorumSupportCount: number;

  // --- outcome history (own experience only) ---
  readonly successHistory: Readonly<Record<TaskCategory, number>>;
  readonly failureHistory: Readonly<Record<TaskCategory, number>>;
  readonly reliability: number;
}

function zeroedTaskRecord(): Record<TaskCategory, number> {
  const record = {} as Record<TaskCategory, number>;
  for (const category of TASK_CATEGORIES) record[category] = 0;
  return record;
}

function zeroedPheromoneRecord(): Record<ColonyPheromoneType, number> {
  const record = {} as Record<ColonyPheromoneType, number>;
  for (const type of COLONY_PHEROMONE_TYPES) record[type] = 0;
  return record;
}

function copySkillTendencies(profile: AntGenomeProfile): Record<SkillTendency, number> {
  const record = {} as Record<SkillTendency, number>;
  for (const skill of SKILL_TENDENCIES) record[skill] = profile.skillTendencies[skill];
  return record;
}

/**
 * Reliability with no evidence yet. A neutral prior rather than 0, because
 * zero would read as "known unreliable" — which is a claim G0 has not earned.
 */
export const NEUTRAL_RELIABILITY = 0.5 as const;

export interface CreateAntAgentInput {
  readonly antId: string;
  readonly antIndex: number;
  readonly generation: number;
  readonly caste: Caste;
  readonly genome: ColonyGenome;
  readonly chamberId: ChamberId;
  /** Reserve ants are ordinary ants with higher thresholds, never a subclass. */
  readonly startsInReserve: boolean;
  /**
   * G6: a brood-origin ant inherits an already-derived (and possibly
   * mutated) genome profile from broodLifecycleSystem.ts rather than
   * deriving a fresh one from its index. Genesis workers never pass this.
   */
  readonly genomeProfileOverride?: AntGenomeProfile;
}

/**
 * Build one persistent ant identity deterministically. Same input always
 * yields the same ant: the genome profile is derived from the ant's index (or
 * inherited from its brood record for a G6 admission), and nothing here reads
 * a clock, a counter, or an ambient random source.
 */
export function createAntAgent(input: CreateAntAgentInput): AntAgent {
  const genomeProfile = input.genomeProfileOverride ?? deriveAntGenomeProfile(input.genome, input.antIndex, input.caste);
  const responseThresholds = initialResponseThresholds(input.genome, genomeProfile);

  // Reserve ants are LESS SENSITIVE, not idle: every threshold is raised, so
  // they engage only once local demand rises far enough to cross it. That one
  // multiplier is the whole reserve mechanism — no separate class, no flag
  // consulted by a scheduler, and nothing that can "activate everyone at once".
  const reserveMultiplier = input.startsInReserve ? 1.45 : 1;
  const thresholds = {} as Record<TaskCategory, number>;
  for (const category of TASK_CATEGORIES) {
    thresholds[category] = roundTo(clamp(responseThresholds[category] * reserveMultiplier, 0.05, 0.98), 4);
  }

  // Switch cost varies per ant so future hysteresis is not uniform. Derived
  // from the ant's own seeded stream, never from a shared one.
  const random = createSeededRandom(0x85ebca6b ^ (input.antIndex * 374761393));
  const taskSwitchCost = roundTo(0.02 + (1 - genomeProfile.resilience) * 0.05 + random() * 0.01, 4);

  return {
    antId: input.antId,
    antIndex: input.antIndex,
    generation: input.generation,
    caste: input.caste,
    genomeProfile,

    responseThresholds: thresholds,
    taskPropensities: zeroedTaskRecord(),
    skillTendencies: copySkillTendencies(genomeProfile),

    energy: 1,
    health: 1,
    age: 0,
    lifecycleState: "adult" as LifecycleState,
    recoveryTicksRemaining: 0,

    // Nothing has happened yet, so nobody is working and nobody is thinking.
    // Cognitive activation is a G7 concern; at genesis the active count is 0.
    activationMode: (input.startsInReserve ? "reserve" : "resting") as ActivationMode,
    currentBehaviorState: (input.startsInReserve ? "reserve" : "resting") as WorkState,
    taskSwitchCost,
    startsInReserve: input.startsInReserve,

    chamberId: input.chamberId,

    recentEncounterMemory: [],
    encounterMemoryCapacity: ENCOUNTER_MEMORY_CAPACITY,
    localStimulusObservations: zeroedTaskRecord(),
    localPheromoneObservations: zeroedPheromoneRecord(),

    privateCandidateAssessments: [],
    commitmentState: "uncommitted",
    localQuorumSupportCount: 0,

    successHistory: zeroedTaskRecord(),
    failureHistory: zeroedTaskRecord(),
    reliability: NEUTRAL_RELIABILITY,
  };
}

/** True when every required local-observation surface is present and bounded. */
export function hasCompleteLocalState(ant: AntAgent): boolean {
  const stimulusKeys = Object.keys(ant.localStimulusObservations);
  const pheromoneKeys = Object.keys(ant.localPheromoneObservations);
  return (
    stimulusKeys.length === TASK_CATEGORIES.length &&
    pheromoneKeys.length === COLONY_PHEROMONE_TYPES.length &&
    Array.isArray(ant.recentEncounterMemory) &&
    ant.recentEncounterMemory.length <= ant.encounterMemoryCapacity &&
    ant.encounterMemoryCapacity === ENCOUNTER_MEMORY_CAPACITY &&
    Array.isArray(ant.privateCandidateAssessments)
  );
}

/** True when the ant carries a full response-threshold table. */
export function hasCompleteThresholds(ant: AntAgent): boolean {
  const keys = Object.keys(ant.responseThresholds);
  if (keys.length !== TASK_CATEGORIES.length) return false;
  return TASK_CATEGORIES.every((category) => {
    const value = ant.responseThresholds[category];
    return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1;
  });
}

/** True when the ant carries a derived genome profile with per-category bias. */
export function hasGenomeProfile(ant: AntAgent): boolean {
  const bias = ant.genomeProfile?.thresholdBias;
  if (!bias) return false;
  return (
    Object.keys(bias).length === TASK_CATEGORIES.length &&
    Object.keys(ant.genomeProfile.skillTendencies).length === SKILL_TENDENCIES.length
  );
}
