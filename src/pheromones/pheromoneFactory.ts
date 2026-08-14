/**
 * pheromoneFactory builds well-formed ElectronicPheromone objects and
 * enforces PheromoneSafetyPolicy before anything is allowed onto the bus.
 */

import type { ElectronicPheromone, PheromoneType } from "../types/pheromoneTypes";
import { assertPheromoneSafe } from "../policies/pheromoneSafetyPolicy";

let pheromoneCounter = 0;

function nextPheromoneId(): string {
  pheromoneCounter += 1;
  return `pheromone-${pheromoneCounter}`;
}

export function createPheromone(params: {
  type: PheromoneType;
  emittedByAntId: string;
  topic: string;
  payload?: Record<string, unknown>;
  missionId?: string;
  taskId?: string;
  strength?: number;
}): ElectronicPheromone {
  const payload = params.payload ?? {};
  assertPheromoneSafe(params.topic, payload);

  const now = new Date().toISOString();

  return {
    pheromoneId: nextPheromoneId(),
    type: params.type,
    emittedByAntId: params.emittedByAntId,
    strength: params.strength ?? 1,
    topic: params.topic,
    payload,
    missionId: params.missionId,
    taskId: params.taskId,
    emittedAt: now,
    lastReinforcedAt: now,
  };
}
