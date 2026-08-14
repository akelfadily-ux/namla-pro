/**
 * MemorySense: recalls relevant colony memory entry ids from context. Phase
 * 0 does not perform semantic search — it expects the caller to have
 * already selected candidate entries, and simply reports on them.
 */

import type { MemoryReading, SenseInput } from "../types/senseTypes";

export function recall(input: SenseInput): MemoryReading {
  const entryIds = Array.isArray(input.context.recalledEntryIds)
    ? (input.context.recalledEntryIds as string[])
    : [];

  return {
    senseType: "memory",
    summary: entryIds.length > 0
      ? `Recalled ${entryIds.length} memory entr(y/ies).`
      : "No memory entries recalled.",
    confidence: entryIds.length > 0 ? 0.6 : 0.1,
    generatedAt: new Date().toISOString(),
    recalledEntryIds: entryIds,
  };
}
