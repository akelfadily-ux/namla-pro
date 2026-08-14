/**
 * Colony Genesis G2 — local task choice.
 *
 * The single place an ant turns "what do I locally observe" into "what do I
 * do next". It reads only the calling ant's own state and its own chamber's
 * stimulus/pheromone rows — nothing population-scale. There is no central
 * chooser: `colonyTickRunner` calls this once per eligible ant, per tick, and
 * the ant answers for itself.
 *
 * Authorized by NAMLA_BUILD_LAW.md Section 13 (Colony Genesis G1-G3).
 *
 * No fs, no wall clock, no ambient randomness, no module-level mutable state.
 */

import type { AntAgent } from "./antAgent";
import { computeEffectiveStimulus, computeEngagementProbability } from "./responseThresholdSystem";
import type { ColonyPheromoneType, TaskCategory, WorkState } from "./colonyTypes";
import { TASK_CATEGORIES } from "./colonyTypes";

export function isTaskCategory(state: WorkState): state is TaskCategory {
  return (TASK_CATEGORIES as readonly string[]).includes(state);
}

export interface LocalTaskChoiceInput {
  readonly ant: AntAgent;
  readonly rawStimulus: Readonly<Record<TaskCategory, number>>;
  readonly pheromones: Readonly<Record<ColonyPheromoneType, number>>;
  readonly encounterSuccessRate: number;
  /** A single draw from the ant's own seeded stream for this tick. */
  readonly engagementDraw: number;
}

export interface LocalTaskChoiceResult {
  readonly nextState: WorkState;
  readonly switched: boolean;
  readonly probabilities: Readonly<Record<TaskCategory, number>>;
}

/**
 * Per-category weight adjustments that are specific to CHOOSING among
 * categories (as opposed to the general stimulus/threshold math in
 * responseThresholdSystem.ts). See `PHEROMONE_DECISION_SITES` in
 * pheromoneField.ts for the authoritative list of which type is read where.
 */
function categoryChoiceBias(
  category: TaskCategory,
  pheromones: Readonly<Record<ColonyPheromoneType, number>>,
  ant: AntAgent
): number {
  let bias = 0;
  if (category === "scouting" || category === "foraging") bias += pheromones.opportunity * 0.3;
  if (category === "communicating" || category === "storing") bias += pheromones["knowledge-found"] * 0.3;
  if (isTaskCategory(ant.currentBehaviorState) && category === ant.currentBehaviorState) {
    // Recruitment reinforces the work already under way in this chamber
    // rather than naming a category of its own — it is a derived "more
    // hands here" signal, not a directed channel (that remains G5).
    bias += pheromones.recruitment * 0.35;
    // Failure pheromone dampens repeating the very category that has
    // recently been failing in this chamber, rewarding a switch instead.
    bias -= pheromones.failure * 0.3;
  }
  return bias;
}

/**
 * Choose the ant's next `WorkState` from purely local information. Ants
 * already engaged in a task get a small continuity bonus (`taskSwitchCost`)
 * so hysteresis is not uniform across the population.
 */
export function chooseWorkState(input: LocalTaskChoiceInput): LocalTaskChoiceResult {
  const { ant, rawStimulus, pheromones, encounterSuccessRate, engagementDraw } = input;

  const probabilities = {} as Record<TaskCategory, number>;
  for (const category of TASK_CATEGORIES) {
    const effectiveStimulus = computeEffectiveStimulus(category, rawStimulus[category], pheromones, encounterSuccessRate);
    const bias = categoryChoiceBias(category, pheromones, ant);
    const stayBonus = isTaskCategory(ant.currentBehaviorState) && category === ant.currentBehaviorState ? ant.taskSwitchCost : 0;
    probabilities[category] = computeEngagementProbability(
      Math.min(1, Math.max(0, effectiveStimulus + bias)),
      Math.max(0.0001, ant.responseThresholds[category] - stayBonus)
    );
  }

  let winner: TaskCategory = TASK_CATEGORIES[0];
  let winnerProbability = -1;
  for (const category of TASK_CATEGORIES) {
    if (probabilities[category] > winnerProbability) {
      winner = category;
      winnerProbability = probabilities[category];
    }
  }

  const nextState: WorkState = winnerProbability > engagementDraw ? winner : "resting";
  return { nextState, switched: nextState !== ant.currentBehaviorState, probabilities };
}
