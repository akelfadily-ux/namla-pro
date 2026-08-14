/**
 * Colony Genesis G2 — local movement.
 *
 * An ant may move to at most one chamber per tick, and only to a chamber
 * directly adjacent to its current one in the existing G0 `NestGraph` — never
 * a teleport, never a population-wide placement. The decision uses only the
 * ant's own chosen work state, its own chamber's pheromone reads, and the
 * static list of chambers adjacent to where it already is.
 *
 * Authorized by NAMLA_BUILD_LAW.md Section 13 (Colony Genesis G1-G3).
 *
 * No fs, no wall clock, no ambient randomness, no module-level mutable state.
 */

import type { AntAgent } from "./antAgent";
import type { ColonyPheromoneType, TaskCategory, WorkState } from "./colonyTypes";
import { clamp } from "./colonyTypes";
import { isTaskCategory } from "./localTaskChoice";
import type { ChamberId } from "./nestGraph";

/**
 * Chambers a category is plausibly done in. Domain knowledge an ant is born
 * with (like the caste home-chamber table in antPopulation.ts) — never a
 * colony-scale reference. The queen-chamber is deliberately never a target.
 */
export const TASK_CHAMBER_AFFINITY: Readonly<Record<TaskCategory, readonly ChamberId[]>> = {
  scouting: ["entrance", "foraging-zone-1", "foraging-zone-2", "foraging-zone-3"],
  foraging: ["foraging-zone-1", "foraging-zone-2", "foraging-zone-3"],
  building: ["workshop"],
  repairing: ["repair-chamber"],
  nursing: ["nursery", "brood-chamber"],
  guarding: ["defense-gate", "entrance"],
  cleaning: ["waste-chamber"],
  transporting: ["food-storage", "workshop"],
  storing: ["food-storage", "knowledge-storage"],
  communicating: ["knowledge-storage"],
};

/** How likely this ant is to leave its current chamber this tick. */
function scoreLeaveChamber(
  ant: AntAgent,
  chosenState: WorkState,
  currentChamberId: ChamberId,
  pheromones: Readonly<Record<ColonyPheromoneType, number>>
): number {
  let score = 0.06;
  score += pheromones.congestion * 0.4;

  const isDefender = ant.caste === "soldier" || ant.caste === "scout";
  if (pheromones.danger > 0.3 && !isDefender) score += 0.3;

  if (isTaskCategory(chosenState)) {
    const affinity = TASK_CHAMBER_AFFINITY[chosenState];
    score += affinity.includes(currentChamberId) ? -0.3 : 0.15;
  }

  return clamp(score, 0, 0.95);
}

function chooseDestination(
  chosenState: WorkState,
  adjacentChamberIds: readonly ChamberId[],
  destinationDraw: number
): ChamberId | null {
  if (adjacentChamberIds.length === 0) return null;

  if (isTaskCategory(chosenState)) {
    const affinity = TASK_CHAMBER_AFFINITY[chosenState];
    const matches = adjacentChamberIds.filter((id) => affinity.includes(id));
    if (matches.length > 0) return matches[0];
  }

  const index = Math.min(adjacentChamberIds.length - 1, Math.floor(destinationDraw * adjacentChamberIds.length));
  return adjacentChamberIds[index];
}

export interface AntMovementInput {
  readonly ant: AntAgent;
  readonly chosenState: WorkState;
  readonly pheromones: Readonly<Record<ColonyPheromoneType, number>>;
  /** The current chamber's neighbors from the G0 NestGraph — already bounded. */
  readonly adjacentChamberIds: readonly ChamberId[];
  readonly leaveDraw: number;
  readonly destinationDraw: number;
}

export interface AntMovementResult {
  readonly chamberId: ChamberId;
  readonly moved: boolean;
}

/** Decide whether this ant leaves its chamber, and if so, to which neighbor. */
export function decideMovement(input: AntMovementInput): AntMovementResult {
  const leaveScore = scoreLeaveChamber(input.ant, input.chosenState, input.ant.chamberId, input.pheromones);
  if (input.leaveDraw >= leaveScore) {
    return { chamberId: input.ant.chamberId, moved: false };
  }

  const destination = chooseDestination(input.chosenState, input.adjacentChamberIds, input.destinationDraw);
  if (destination === null) return { chamberId: input.ant.chamberId, moved: false };
  return { chamberId: destination, moved: destination !== input.ant.chamberId };
}
