/**
 * pheromoneQuery filters a list of pheromones by type, topic, mission, task,
 * or minimum strength. This is how ants "smell" the colony for relevant
 * trails without needing a direct message.
 */

import type { ElectronicPheromone, PheromoneQuery } from "../types/pheromoneTypes";

export function queryPheromones(pheromones: ElectronicPheromone[], query: PheromoneQuery): ElectronicPheromone[] {
  return pheromones.filter((p) => {
    if (query.type && p.type !== query.type) return false;
    if (query.topic && p.topic !== query.topic) return false;
    if (query.missionId && p.missionId !== query.missionId) return false;
    if (query.taskId && p.taskId !== query.taskId) return false;
    if (query.minStrength !== undefined && p.strength < query.minStrength) return false;
    return true;
  });
}
