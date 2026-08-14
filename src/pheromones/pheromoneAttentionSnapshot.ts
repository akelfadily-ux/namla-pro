/**
 * PheromoneAttentionSnapshot: the read side of the pheromone system.
 *
 * Architecture Hardening 2 Step 4D: pheromones were emitted and decayed by
 * the runtime but never read by it — write-only decoration. This module is
 * the first runtime consumer: a pure aggregation of the bus into stable,
 * safe attention metadata for reports and observability.
 *
 * Deliberately NOT decision-driving: nothing about scheduling, ordering,
 * or ant selection reads this snapshot. That step, if it ever comes, is a
 * separate hardening decision.
 *
 * Safety: the snapshot carries counts, types, and rounded strength buckets
 * only. Topics and payloads are never included — topics can contain task
 * titles (gated text, but still mission content that a report aggregate
 * has no need to carry).
 *
 * Pure by construction: no fs, no process, no network, no timers, no
 * mutation of the input — the caller hands in a listed copy of the bus.
 */

import type { ElectronicPheromone, PheromoneType } from "../types/pheromoneTypes";

export type PheromoneStrengthBucket = "faint" | "weak" | "moderate" | "strong";

export interface PheromoneAttentionEntry {
  type: PheromoneType;
  activeCount: number;
  strengthBuckets: Record<PheromoneStrengthBucket, number>;
  /** Sum of strengths, rounded to 2 decimals: a stable attention weight. */
  totalStrength: number;
}

export interface PheromoneAttentionSnapshot {
  totalActive: number;
  /** Virtual tick at snapshot time, when the caller runs on virtual time. */
  atTick?: number;
  /** One entry per active pheromone type, sorted by type for determinism. */
  entries: PheromoneAttentionEntry[];
}

function bucketOf(strength: number): PheromoneStrengthBucket {
  if (strength >= 0.75) return "strong";
  if (strength >= 0.4) return "moderate";
  if (strength >= 0.1) return "weak";
  return "faint";
}

export function createPheromoneAttentionSnapshot(
  pheromones: ElectronicPheromone[],
  atTick?: number
): PheromoneAttentionSnapshot {
  const byType = new Map<PheromoneType, PheromoneAttentionEntry>();

  for (const pheromone of pheromones) {
    let entry = byType.get(pheromone.type);
    if (!entry) {
      entry = {
        type: pheromone.type,
        activeCount: 0,
        strengthBuckets: { faint: 0, weak: 0, moderate: 0, strong: 0 },
        totalStrength: 0,
      };
      byType.set(pheromone.type, entry);
    }
    entry.activeCount += 1;
    entry.strengthBuckets[bucketOf(pheromone.strength)] += 1;
    entry.totalStrength += pheromone.strength;
  }

  const entries = [...byType.values()]
    .map((entry) => ({ ...entry, totalStrength: Math.round(entry.totalStrength * 100) / 100 }))
    .sort((a, b) => a.type.localeCompare(b.type));

  return { totalActive: pheromones.length, atTick, entries };
}
