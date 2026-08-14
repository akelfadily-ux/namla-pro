/**
 * Colony memory types. Memory entries are non-secret facts, decisions, or
 * observations the colony wants to recall later. ColonyMemory must refuse
 * anything that looks like a secret before it is ever stored.
 */

export type MemoryScope = "mission" | "task" | "ant" | "colony";

export type MemoryKind =
  | "fact"
  | "decision"
  | "observation"
  | "lesson-learned"
  | "pheromone-echo";

export interface MemoryEntry {
  memoryId: string;
  scope: MemoryScope;
  kind: MemoryKind;
  content: string;
  createdByAntId: string;
  createdAt: string;
  missionId?: string;
  taskId?: string;
}
