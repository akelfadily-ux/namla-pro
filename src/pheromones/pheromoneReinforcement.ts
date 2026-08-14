/**
 * pheromoneReinforcement lets ants "re-walk a trail": strengthening a
 * pheromone instead of emitting a duplicate one, the way real ants
 * reinforce a path by walking it again.
 */

import type { ElectronicPheromone } from "../types/pheromoneTypes";

export function reinforcePheromone(pheromone: ElectronicPheromone, amount = 0.2): ElectronicPheromone {
  const boosted = Math.min(1, pheromone.strength + amount);

  return {
    ...pheromone,
    strength: boosted,
    lastReinforcedAt: new Date().toISOString(),
  };
}
