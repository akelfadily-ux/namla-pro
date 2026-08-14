/**
 * PheromoneBus is the colony's shared, in-memory pheromone space. Ants emit
 * pheromones onto the bus and query it to sense what other ants have left
 * behind, instead of messaging each other directly.
 */

import type { ElectronicPheromone, PheromoneQuery, PheromoneType } from "../types/pheromoneTypes";
import { createPheromone } from "../pheromones/pheromoneFactory";
import { decayPheromone, isExpired } from "../pheromones/pheromoneDecay";
import { reinforcePheromone } from "../pheromones/pheromoneReinforcement";
import { queryPheromones } from "../pheromones/pheromoneQuery";

export class PheromoneBus {
  private pheromones: ElectronicPheromone[] = [];

  emit(params: {
    type: PheromoneType;
    emittedByAntId: string;
    topic: string;
    payload?: Record<string, unknown>;
    missionId?: string;
    taskId?: string;
    strength?: number;
  }): ElectronicPheromone {
    const pheromone = createPheromone(params);
    this.pheromones.push(pheromone);
    return pheromone;
  }

  list(): ElectronicPheromone[] {
    return [...this.pheromones];
  }

  query(query: PheromoneQuery): ElectronicPheromone[] {
    return queryPheromones(this.pheromones, query);
  }

  reinforce(pheromoneId: string, amount = 0.2): ElectronicPheromone | undefined {
    const target = this.pheromones.find((p) => p.pheromoneId === pheromoneId);
    if (!target) return undefined;
    const reinforced = reinforcePheromone(target, amount);
    this.pheromones = this.pheromones.map((p) => (p.pheromoneId === pheromoneId ? reinforced : p));
    return reinforced;
  }

  /** Decays all pheromones based on elapsed time and drops ones below their removal threshold. */
  tickDecay(now: Date = new Date()): void {
    this.pheromones = this.pheromones
      .map((p) => decayPheromone(p, now))
      .filter((p) => !isExpired(p));
  }
}
