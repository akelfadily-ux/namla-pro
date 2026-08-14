/**
 * Colony Genesis G2/G3 — response-threshold task selection and specialization.
 *
 * Source: the fixed-threshold model (Bonabeau, Theraulaz, Deneubourg). Each
 * ant has a per-task threshold theta; it engages when local stimulus S
 * overcomes theta, with probability `P = S^n / (S^n + theta^n)`. Performing a
 * task lowers its threshold (specialization, G3); disuse lets it drift back
 * (forgetting, G3).
 *
 * Every function here reads ONLY what one ant could plausibly know: its own
 * chamber's raw task stimulus, its own chamber's pheromone reads, its own
 * recent-encounter rate, and its own genome/threshold state. Nothing here
 * accepts the population, the nest graph, or another ant's data.
 *
 * Authorized by NAMLA_BUILD_LAW.md Section 13 (Colony Genesis G1-G3).
 *
 * No fs, no wall clock, no ambient randomness, no module-level mutable state.
 */

import type { AntAgent } from "./antAgent";
import type { ColonyGenome } from "./colonyGenome";
import { initialResponseThresholds } from "./colonyGenome";
import type { ColonyPheromoneType, TaskCategory } from "./colonyTypes";
import { TASK_CATEGORIES, clamp, roundTo } from "./colonyTypes";

/** Bonabeau engagement probability for one category. */
export function computeEngagementProbability(stimulus: number, threshold: number, exponent = 2): number {
  const s = Math.pow(clamp(stimulus, 0, 1), exponent);
  const t = Math.pow(clamp(threshold, 0.0001, 1), exponent);
  return s / (s + t);
}

/**
 * Blend raw chamber stimulus with the pheromone reads that bear on THIS
 * category (see `PHEROMONE_DECISION_SITES` in pheromoneField.ts for the full
 * per-type map) and the ant's own recent-encounter success rate — the real
 * harvester-ant mechanism of regulating engagement by the return rate of
 * successful nestmates.
 */
export function computeEffectiveStimulus(
  category: TaskCategory,
  rawStimulus: number,
  pheromones: Readonly<Record<ColonyPheromoneType, number>>,
  encounterSuccessRate: number
): number {
  let stimulus = rawStimulus;
  stimulus += pheromones["task-demand"] * 0.5;
  stimulus += pheromones.success * 0.15;
  stimulus += encounterSuccessRate * 0.2;
  if (category === "guarding") stimulus += pheromones.danger * 0.6;
  if (category === "foraging" || category === "transporting") stimulus += pheromones.resource * 0.4;
  if (category === "repairing") stimulus += pheromones["repair-needed"] * 0.5;
  stimulus -= pheromones.congestion * 0.2;
  return roundTo(clamp(stimulus, 0, 1), 4);
}

export interface LearningResult {
  readonly ant: AntAgent;
  readonly thresholdChanged: boolean;
}

/**
 * Apply the outcome of one attempted task to the attempting ant only: success
 * lowers that category's threshold (specialization) and nudges reliability
 * up; failure raises it and nudges reliability down. Own history only.
 */
export function applyLearning(
  ant: AntAgent,
  category: TaskCategory,
  succeeded: boolean,
  genome: ColonyGenome
): LearningResult {
  const before = ant.responseThresholds[category];
  const after = succeeded
    ? roundTo(clamp(before - genome.learningRate * before, 0.05, 0.98), 4)
    : roundTo(clamp(before + genome.forgettingRate * 1.5, 0.05, 0.98), 4);

  const responseThresholds = { ...ant.responseThresholds, [category]: after };

  const successHistory = succeeded
    ? { ...ant.successHistory, [category]: ant.successHistory[category] + 1 }
    : ant.successHistory;
  const failureHistory = succeeded
    ? ant.failureHistory
    : { ...ant.failureHistory, [category]: ant.failureHistory[category] + 1 };

  const reliability = succeeded
    ? roundTo(clamp(ant.reliability + 0.02 * (1 - ant.reliability), 0, 1), 4)
    : roundTo(clamp(ant.reliability - 0.02 * ant.reliability, 0, 1), 4);

  const propensityDelta = succeeded ? 0.05 : -0.03;
  const taskPropensities = {
    ...ant.taskPropensities,
    [category]: roundTo(clamp(ant.taskPropensities[category] + propensityDelta, 0, 1), 4),
  };

  return {
    ant: { ...ant, responseThresholds, successHistory, failureHistory, reliability, taskPropensities },
    thresholdChanged: after !== before,
  };
}

/**
 * Disuse drift: every category the ant did NOT attempt this tick relaxes
 * toward its own unbiased genome baseline (recomputed from the ant's stored
 * genome profile, never a stored mutable field). Reserve status is a genesis
 * condition, not a permanent floor, so forgetting targets the unbiased
 * baseline rather than the reserve-scaled starting point.
 */
export function applyForgetting(ant: AntAgent, attemptedCategory: TaskCategory | null, genome: ColonyGenome): AntAgent {
  const baseline = initialResponseThresholds(genome, ant.genomeProfile);
  const responseThresholds = { ...ant.responseThresholds };
  for (const category of TASK_CATEGORIES) {
    if (category === attemptedCategory) continue;
    const current = responseThresholds[category];
    const target = baseline[category];
    responseThresholds[category] = roundTo(clamp(current + (target - current) * genome.forgettingRate, 0.05, 0.98), 4);
  }
  return { ...ant, responseThresholds };
}
