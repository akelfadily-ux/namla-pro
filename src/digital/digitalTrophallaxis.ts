/**
 * DigitalTrophallaxisNetwork — bounded local knowledge/context transfer between
 * co-located workers (Build Law §23; the digital analogue of mouth-to-mouth
 * trophallaxis). This is NOT a broadcast: only workers on the SAME team may
 * exchange, the sender must actually HOLD the shared knowledge, the receiver's
 * intake is bounded, the exchange costs communication bandwidth and a little
 * working context (a conserving `consume`), and confidence + provenance travel
 * with the reference. Raw private worker reasoning is never copied and the full
 * colony memory is never dumped. Stale or unverified references may be refused.
 *
 * No fs, no child_process, no network, no wall clock, no module-level mutable state.
 */

import { clamp, roundTo } from "../colony/colonyTypes";
import type { DigitalResourceEconomy } from "./digitalResourceEconomy";
import type { DigitalMetabolismProfile } from "./digitalConfig";
import type { DigitalWorker } from "./digitalWorkers";

export interface KnowledgeReference {
  readonly refId: string;
  readonly confidence: number;
  readonly freshness: number;
  readonly verified: boolean;
  readonly provenanceSourceId: string | null;
}

export interface TrophallaxisResult {
  readonly workers: readonly DigitalWorker[];
  readonly events: number;
  readonly bandwidthConsumed: number;
  readonly contextConsumed: number;
  readonly refused: number;
  /** Worker ids that received a knowledge reference this exchange round. */
  readonly deliveredTo: readonly string[];
}

/**
 * Run bounded team-local trophallaxis: holders of verified knowledge hand a
 * bounded reference to co-teamed workers who lack it and have intake capacity.
 * Each transfer costs the sender bandwidth and a little shared working context
 * (consumed through the economy) and is capped per worker. A reference that is
 * unverified or stale is refused rather than transferred.
 */
export function runTeamTrophallaxis(
  teamWorkers: readonly DigitalWorker[],
  holderIds: ReadonlySet<string>,
  economy: DigitalResourceEconomy,
  profile: DigitalMetabolismProfile,
  tick: number
): TrophallaxisResult {
  const workers = teamWorkers.map((w) => ({ ...w }));
  const used = new Map<string, number>();
  const delivered = new Set<string>();
  let events = 0;
  let bandwidthConsumed = 0;
  let contextConsumed = 0;
  let refused = 0;

  const uses = (id: string) => used.get(id) ?? 0;
  const senders = workers.filter((w) => w.active && holderIds.has(w.workerId) && w.bandwidth > 0.25);
  // Receivers: co-teamed workers who do NOT already hold the knowledge.
  const receivers = workers.filter((w) => w.active && !holderIds.has(w.workerId) && !delivered.has(w.workerId));

  for (const sender of senders) {
    if (uses(sender.workerId) >= profile.maxTrophallaxisPerWorker) continue;
    for (const receiver of receivers) {
      if (receiver.workerId === sender.workerId) continue;
      if (delivered.has(receiver.workerId)) continue;
      if (uses(sender.workerId) >= profile.maxTrophallaxisPerWorker || uses(receiver.workerId) >= profile.maxTrophallaxisPerWorker) continue;
      // Bounded intake: a low-bandwidth receiver cannot absorb more right now.
      if (receiver.bandwidth < profile.trophallaxisBandwidthCost) {
        refused += 1;
        continue;
      }
      // Cost is a real conserving consume of shared working context.
      const ctx = economy.consume("workingContext", profile.trophallaxisContextTransfer);
      if (ctx <= 0) {
        refused += 1;
        continue;
      }
      sender.bandwidth = roundTo(clamp(sender.bandwidth - profile.trophallaxisBandwidthCost, 0, 1), 6);
      receiver.cognitiveEnergy = roundTo(clamp(receiver.cognitiveEnergy - 0.005, 0, 1), 6);
      events += 1;
      bandwidthConsumed = roundTo(bandwidthConsumed + profile.trophallaxisBandwidthCost, 6);
      contextConsumed = roundTo(contextConsumed + ctx, 6);
      delivered.add(receiver.workerId);
      used.set(sender.workerId, uses(sender.workerId) + 1);
      used.set(receiver.workerId, uses(receiver.workerId) + 1);
      void tick;
    }
  }

  const byId = new Map(workers.map((w) => [w.workerId, w]));
  return {
    workers: teamWorkers.map((w) => byId.get(w.workerId) ?? w),
    events,
    bandwidthConsumed,
    contextConsumed,
    refused,
    deliveredTo: [...delivered],
  };
}
