/**
 * Electronic pheromone types. Pheromones are the colony's indirect
 * communication channel: ants emit them instead of messaging every other ant
 * directly, and other ants sense them and decide how to react.
 */

export type PheromoneType =
  | "PriorityPheromone"
  | "DangerPheromone"
  | "TrailPheromone"
  | "NeedHelpPheromone"
  | "ConfidencePheromone"
  | "BugPheromone"
  | "ArchitecturePheromone"
  | "HumanIntentPheromone"
  | "BlockedActionPheromone"
  | "SuccessPheromone"
  | "QuestionPheromone"
  | "MemoryPheromone";

/** Strength is a normalized 0..1 value. 1 is freshly emitted at full intensity. */
export type PheromoneStrength = number;

export interface ElectronicPheromone {
  pheromoneId: string;
  type: PheromoneType;
  emittedByAntId: string;
  strength: PheromoneStrength;
  topic: string;
  payload: Record<string, unknown>;
  missionId?: string;
  taskId?: string;
  emittedAt: string;
  lastReinforcedAt: string;
}

export interface PheromoneDecayRule {
  type: PheromoneType;
  halfLifeMs: number;
  minimumStrengthBeforeRemoval: number;
}

export interface PheromoneQuery {
  type?: PheromoneType;
  topic?: string;
  missionId?: string;
  taskId?: string;
  minStrength?: PheromoneStrength;
}
