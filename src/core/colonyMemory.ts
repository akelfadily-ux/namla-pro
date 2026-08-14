/**
 * ColonyMemory stores non-secret memory entries the colony wants to recall
 * later. It refuses anything that looks like a secret before storing it —
 * memory must never become a place secrets leak into.
 */

import type { MemoryEntry, MemoryKind, MemoryScope } from "../types/memoryTypes";
import { looksLikeSecret } from "../policies/secretProtectionPolicy";

let memoryCounter = 0;

function nextMemoryId(): string {
  memoryCounter += 1;
  return `memory-${memoryCounter}`;
}

export class ColonyMemory {
  private readonly entries: MemoryEntry[] = [];

  remember(params: {
    scope: MemoryScope;
    kind: MemoryKind;
    content: string;
    createdByAntId: string;
    missionId?: string;
    taskId?: string;
  }): MemoryEntry {
    if (looksLikeSecret(params.content)) {
      throw new Error("ColonyMemory refused to store content that looks like a secret.");
    }

    const entry: MemoryEntry = {
      memoryId: nextMemoryId(),
      scope: params.scope,
      kind: params.kind,
      content: params.content,
      createdByAntId: params.createdByAntId,
      createdAt: new Date().toISOString(),
      missionId: params.missionId,
      taskId: params.taskId,
    };

    this.entries.push(entry);
    return entry;
  }

  recall(scope?: MemoryScope): MemoryEntry[] {
    return scope ? this.entries.filter((e) => e.scope === scope) : [...this.entries];
  }

  recallByMission(missionId: string): MemoryEntry[] {
    return this.entries.filter((e) => e.missionId === missionId);
  }
}
