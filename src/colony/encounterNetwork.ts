/**
 * Colony Genesis G2 — bounded chamber-local encounters.
 *
 * Source: Pogonomyrmex barbatus task allocation without central control
 * (Deborah Gordon). An ant estimates conditions from the RATE and KIND of its
 * recent encounters, never from a global view. This module is the mechanism
 * that produces those encounters: bounded per ant, per tick, per chamber —
 * never population-wide, never O(population^2).
 *
 * An encounter records only `{tick, otherWorkState, otherCarriedSuccess}` —
 * never the other ant's identity, genome, thresholds, or history (the
 * anti-omniscience rule from antAgent.ts). Partner selection is O(1) per ant
 * (a seeded modular offset within the chamber group), so cost never depends
 * on chamber size beyond the group itself.
 *
 * Authorized by NAMLA_BUILD_LAW.md Section 13 (Colony Genesis G1-G3).
 *
 * No fs, no wall clock, no ambient randomness, no module-level mutable state.
 */

import type { AntAgent, EncounterMemoryEntry } from "./antAgent";
import { createSeededRandom } from "./colonyTypes";
import type { ChamberId } from "./nestGraph";

/** Bounded: at most this many encounters recorded per ant per tick. */
export const MAX_ENCOUNTERS_PER_ANT_PER_TICK = 2 as const;

const ENCOUNTER_SALT_1 = 0x7f4a7c15;
const ENCOUNTER_SALT_2 = 0x2545f491;

function offsetDraw(colonySeed: number, antIndex: number, tick: number, salt: number): number {
  const h = (Math.imul(colonySeed ^ salt, 2246822519) ^ Math.imul(antIndex + 1, 3266489917) ^ Math.imul(tick + 1, 668265263)) >>> 0;
  return createSeededRandom(h)();
}

/**
 * The same bounded, chamber-local partner offset `runChamberEncounters` uses
 * for an ant's first encounter this tick. Exported so G5 recruitment/quorum
 * sensing (`recruitmentQuorumSystem.ts`) reuses the ant's own real encounter
 * contact rather than inventing a second, separate bounded contact — "the
 * ant's own bounded chamber-local encounter" is the same encounter both
 * mechanisms read from.
 */
export function firstEncounterOffset(colonySeed: number, antIndex: number, tick: number, groupSize: number): number {
  const draw1 = offsetDraw(colonySeed, antIndex, tick, ENCOUNTER_SALT_1);
  return 1 + Math.floor(draw1 * (groupSize - 1));
}

export interface EncounterNetworkResult {
  readonly ants: readonly AntAgent[];
  readonly encounterCount: number;
}

/**
 * Group ants sharing a chamber and let each ant record up to
 * `MAX_ENCOUNTERS_PER_ANT_PER_TICK` bounded local encounters. `succeededThisTick`
 * carries only which ant ids just resolved a successful task attempt this
 * tick — nothing else about them is ever shared.
 */
export function runChamberEncounters(
  ants: readonly AntAgent[],
  colonySeed: number,
  tick: number,
  succeededThisTick: ReadonlySet<string>
): EncounterNetworkResult {
  const groups = new Map<ChamberId, AntAgent[]>();
  for (const ant of ants) {
    const group = groups.get(ant.chamberId);
    if (group) group.push(ant);
    else groups.set(ant.chamberId, [ant]);
  }

  const updatedById = new Map<string, AntAgent>();
  let encounterCount = 0;

  for (const members of groups.values()) {
    const groupSize = members.length;
    if (groupSize < 2) continue;

    for (let i = 0; i < groupSize; i += 1) {
      const ant = members[i];
      const partnerIndices = new Set<number>();

      const offset1 = firstEncounterOffset(colonySeed, ant.antIndex, tick, groupSize);
      partnerIndices.add((i + offset1) % groupSize);

      if (MAX_ENCOUNTERS_PER_ANT_PER_TICK > 1 && groupSize > 2) {
        const draw2 = offsetDraw(colonySeed, ant.antIndex, tick, ENCOUNTER_SALT_2);
        const offset2 = 1 + Math.floor(draw2 * (groupSize - 1));
        const candidate = (i + offset2) % groupSize;
        if (candidate !== i) partnerIndices.add(candidate);
      }

      const entries: EncounterMemoryEntry[] = [];
      for (const partnerIndex of partnerIndices) {
        if (entries.length >= MAX_ENCOUNTERS_PER_ANT_PER_TICK) break;
        const other = members[partnerIndex];
        entries.push({
          tick,
          otherWorkState: other.currentBehaviorState,
          otherCarriedSuccess: succeededThisTick.has(other.antId),
        });
      }

      if (entries.length === 0) continue;
      const merged = [...ant.recentEncounterMemory, ...entries];
      const capped = merged.length > ant.encounterMemoryCapacity ? merged.slice(merged.length - ant.encounterMemoryCapacity) : merged;
      updatedById.set(ant.antId, { ...ant, recentEncounterMemory: capped });
      encounterCount += entries.length;
    }
  }

  const resultAnts = ants.map((ant) => updatedById.get(ant.antId) ?? ant);
  return { ants: resultAnts, encounterCount };
}

/** The fraction of an ant's remembered encounters that carried a success. */
export function encounterSuccessRate(ant: AntAgent): number {
  if (ant.recentEncounterMemory.length === 0) return 0;
  const successes = ant.recentEncounterMemory.filter((entry) => entry.otherCarriedSuccess).length;
  return successes / ant.recentEncounterMemory.length;
}
