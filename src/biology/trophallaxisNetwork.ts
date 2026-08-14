/**
 * trophallaxisNetwork — mechanistic mouth-to-mouth food sharing (Build Law §22,
 * §6). This is NOT generic messaging: only CO-LOCATED ants may exchange, the
 * donor must actually hold transferable crop, the recipient's capacity is
 * bounded, food types stay distinct, and the exact quantity is a conserving
 * economy op (both remain in the `antCrops` pool, so the transfer is a pure
 * redistribution — no global equalization).
 *
 * Adults receive crop-to-crop; brood receives via a separate feeding op
 * (`antCrops` -> `broodMass`). The network is local (per chamber) and bounded
 * (each ant participates in at most a few exchanges per tick).
 *
 * No fs, no child_process, no network, no wall clock, no module-level mutable state.
 */

import { roundTo } from "../colony/colonyTypes";
import type { AntBody } from "./colonyPhysiology";
import { cropLoad, remainingCapacity } from "./colonyPhysiology";
import type { ColonyResourceEconomy } from "./resourceEconomy";
import type { ResourceCategory } from "./biologicalTypes";

export const MAX_TROPHALLAXIS_PER_ANT = 2 as const;

export interface TrophallaxisResult {
  readonly bodies: readonly AntBody[];
  readonly events: number;
  readonly quantityTransferred: number;
  readonly donorDepletion: number;
  readonly recipientGain: number;
  readonly failedTransfers: number;
  readonly starvationPrevented: number;
}

/** The transferable amount from a donor: give when it has surplus carb. */
function donorSurplusCarb(donor: AntBody): number {
  return donor.cropCarb > 0.25 ? Math.min(0.1, donor.cropCarb - 0.2) : 0;
}

/**
 * Run bounded chamber-local trophallaxis among co-located adults: a well-fed
 * donor shares carbohydrate with a hungrier co-located recipient that has crop
 * capacity. Every transfer moves the SAME amount out of the donor's crop and
 * into the recipient's crop (both in the antCrops pool), so it conserves. A
 * transfer that would exceed the donor's crop or the recipient's capacity fails
 * and is counted.
 */
export function runChamberTrophallaxis(bodiesInChamber: readonly AntBody[], economy: ColonyResourceEconomy, seed: number, tick: number): TrophallaxisResult {
  const bodies = bodiesInChamber.map((b) => ({ ...b }));
  const exchangesUsed = new Map<string, number>();
  let events = 0;
  let quantityTransferred = 0;
  let donorDepletion = 0;
  let recipientGain = 0;
  let failedTransfers = 0;
  let starvationPrevented = 0;

  const used = (id: string) => exchangesUsed.get(id) ?? 0;

  // Deterministic pairing: donors (surplus) help the hungriest nearby recipients.
  const donors = bodies.filter((b) => b.alive && donorSurplusCarb(b) > 0);
  const recipients = bodies.filter((b) => b.alive && b.cropCarb < 0.2).sort((a, b) => a.cropCarb - b.cropCarb);

  for (const donor of donors) {
    if (used(donor.antId) >= MAX_TROPHALLAXIS_PER_ANT) continue;
    for (const recipient of recipients) {
      if (recipient.antId === donor.antId) continue;
      if (used(donor.antId) >= MAX_TROPHALLAXIS_PER_ANT || used(recipient.antId) >= MAX_TROPHALLAXIS_PER_ANT) continue;

      const surplus = donorSurplusCarb(donor);
      const capacity = remainingCapacity(recipient);
      const want = Math.min(surplus, capacity, 0.2 - recipient.cropCarb + 0.05);
      if (want <= 1e-6) {
        failedTransfers += 1;
        continue;
      }
      // Conserving redistribution within the antCrops pool (self-transfer of the
      // aggregate pool nets zero; the detail moves between two ants).
      const moved = roundTo(Math.min(want, donor.cropCarb), 6);
      if (moved <= 1e-6) {
        failedTransfers += 1;
        continue;
      }
      const wasStarving = recipient.cropCarb < 0.05 && recipient.energy < 0.1;
      donor.cropCarb = roundTo(donor.cropCarb - moved, 6);
      recipient.cropCarb = roundTo(recipient.cropCarb + moved, 6);
      // Small energy cost of the exchange, spent through the economy.
      economy.spendEnergy(0.0005);
      events += 1;
      quantityTransferred = roundTo(quantityTransferred + moved, 6);
      donorDepletion = roundTo(donorDepletion + moved, 6);
      recipientGain = roundTo(recipientGain + moved, 6);
      if (wasStarving && recipient.cropCarb >= 0.05) starvationPrevented += 1;
      exchangesUsed.set(donor.antId, used(donor.antId) + 1);
      exchangesUsed.set(recipient.antId, used(recipient.antId) + 1);
    }
  }

  // Apply the mutated crop values back by id.
  const byId = new Map(bodies.map((b) => [b.antId, b]));
  return {
    bodies: bodiesInChamber.map((b) => byId.get(b.antId) ?? b),
    events,
    quantityTransferred,
    donorDepletion,
    recipientGain,
    failedTransfers,
    starvationPrevented,
  };
}

/** Feed brood from an adult's crop: a conserving move antCrops -> broodMass. */
export function feedBrood(nurse: AntBody, economy: ColonyResourceEconomy, broodFoodWanted: number): { nurse: AntBody; fed: number } {
  const category: ResourceCategory = nurse.cropProtein > 0 ? "protein" : "carbohydrate";
  const fromCrop = category === "protein" ? nurse.cropProtein : nurse.cropCarb;
  const want = Math.min(broodFoodWanted, fromCrop, 0.05);
  if (want <= 1e-6) return { nurse, fed: 0 };
  const moved = economy.transfer(category, "antCrops", "broodMass", want);
  const next = category === "protein" ? { ...nurse, cropProtein: roundTo(nurse.cropProtein - moved, 6) } : { ...nurse, cropCarb: roundTo(nurse.cropCarb - moved, 6) };
  return { nurse: next, fed: roundTo(moved, 6) };
}

export function totalCropLoad(bodies: readonly AntBody[]): number {
  return roundTo(bodies.reduce((s, b) => s + cropLoad(b), 0), 6);
}
