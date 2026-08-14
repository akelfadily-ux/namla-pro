/**
 * Colony Genesis V1 — ColonyGenome and per-ant genome profiles.
 *
 * The ColonyGenome is the colony's heritable parameter set: base response
 * thresholds, learning/forgetting rates, pheromone decay, quorum fraction,
 * cognitive budget, reserve fraction. The queen system carries and reproduces
 * this genome — it does NOT use it to command tasks.
 *
 * An AntGenomeProfile is one ant's heritable variation on that genome. Because
 * every profile is derived deterministically from the colony genome plus the
 * ant's index, hundreds or thousands of genuinely distinct ants come from ONE
 * model — no per-ant classes.
 *
 * Pure arithmetic: no fs, no process/env, no timers, no network.
 */

import {
  Caste,
  SKILL_TENDENCIES,
  SkillTendency,
  TASK_CATEGORIES,
  TaskCategory,
  clamp,
  createSeededRandom,
  roundTo,
} from "./colonyTypes";

export interface ColonyGenome {
  genomeId: string;
  generation: number;
  /** Baseline engagement threshold per task category (lower = keener). */
  baseThresholds: Record<TaskCategory, number>;
  /** How fast success lowers a threshold (specialization gain). */
  learningRate: number;
  /** How fast disuse raises a threshold back toward baseline. */
  forgettingRate: number;
  /** Per-tick multiplicative pheromone decay. */
  pheromoneDecayRate: number;
  /** Supporters required for a colony-level proposal to commit. */
  quorumThreshold: number;
  /** Hard cap on simultaneously cognitively active ants. */
  cognitiveBudget: number;
  /** Fraction of the worker population held in reserve at genesis. */
  reserveFraction: number;
  /** Energy drained per unit of work. */
  workEnergyCost: number;
  /** Energy recovered per resting tick. */
  restEnergyGain: number;
}

export interface AntGenomeProfile {
  /** Per-category multiplicative bias applied to the colony baseline. */
  thresholdBias: Record<TaskCategory, number>;
  /** Weighted digital skill tendencies (0..1). */
  skillTendencies: Record<SkillTendency, number>;
  energyCapacity: number;
  resilience: number;
  /** Bias toward exploring new work rather than repeating known work. */
  exploration: number;
}

/** The default colony genome for Colony Genesis V1. */
export function createDefaultColonyGenome(): ColonyGenome {
  const baseThresholds = {} as Record<TaskCategory, number>;
  for (const category of TASK_CATEGORIES) baseThresholds[category] = 0.55;
  // A few categories are innately keener or more reluctant across the colony.
  baseThresholds.foraging = 0.42;
  baseThresholds.building = 0.48;
  baseThresholds.nursing = 0.5;
  baseThresholds.guarding = 0.62;
  baseThresholds.cleaning = 0.6;
  baseThresholds.communicating = 0.52;

  return {
    genomeId: "colony-genome-v1",
    generation: 1,
    baseThresholds,
    learningRate: 0.06,
    forgettingRate: 0.012,
    pheromoneDecayRate: 0.18,
    quorumThreshold: 25,
    cognitiveBudget: 30,
    reserveFraction: 0.45,
    workEnergyCost: 0.055,
    restEnergyGain: 0.09,
  };
}

/** Caste-level morphological bias, applied on top of the colony baseline. */
function casteBias(caste: Caste, category: TaskCategory): number {
  if (caste === "scout") {
    if (category === "scouting") return 0.62;
    if (category === "communicating") return 0.8;
    if (category === "foraging") return 0.85;
  }
  if (caste === "soldier") {
    if (category === "guarding") return 0.6;
    if (category === "repairing") return 0.9;
    if (category === "nursing") return 1.3;
  }
  if (caste === "major-worker") {
    if (category === "building") return 0.72;
    if (category === "transporting") return 0.78;
    if (category === "storing") return 0.85;
  }
  if (caste === "minor-worker") {
    if (category === "nursing") return 0.72;
    if (category === "cleaning") return 0.75;
    if (category === "storing") return 0.9;
  }
  return 1;
}

/**
 * Derive one ant's genome profile deterministically from the colony genome and
 * the ant's ordinal index. Same colony + same index always yields the same ant.
 */
export function deriveAntGenomeProfile(
  genome: ColonyGenome,
  antIndex: number,
  caste: Caste
): AntGenomeProfile {
  const random = createSeededRandom(0x9e3779b9 ^ (antIndex * 2654435761));

  const thresholdBias = {} as Record<TaskCategory, number>;
  for (const category of TASK_CATEGORIES) {
    // Individual variation (±35%) multiplied by caste morphology.
    const individual = 0.65 + random() * 0.7;
    thresholdBias[category] = roundTo(clamp(individual * casteBias(caste, category), 0.3, 2.2), 4);
  }

  const skillTendencies = {} as Record<SkillTendency, number>;
  for (const skill of SKILL_TENDENCIES) {
    skillTendencies[skill] = roundTo(random(), 4);
  }

  return {
    thresholdBias,
    skillTendencies,
    energyCapacity: roundTo(0.8 + random() * 0.4, 4),
    resilience: roundTo(0.5 + random() * 0.5, 4),
    exploration: roundTo(0.1 + random() * 0.35, 4),
  };
}

/** The starting response thresholds for one ant (colony baseline × its bias). */
export function initialResponseThresholds(
  genome: ColonyGenome,
  profile: AntGenomeProfile
): Record<TaskCategory, number> {
  const thresholds = {} as Record<TaskCategory, number>;
  for (const category of TASK_CATEGORIES) {
    thresholds[category] = roundTo(
      clamp(genome.baseThresholds[category] * profile.thresholdBias[category], 0.05, 0.98),
      4
    );
  }
  return thresholds;
}
