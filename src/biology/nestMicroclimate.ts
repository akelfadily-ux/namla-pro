/**
 * nestMicroclimate — per-chamber conditions inside the nest (Build Law §22, §5).
 * Each chamber has temperature, humidity, occupancy, ventilation, contamination,
 * food stock, waste level, and brood density. These conditions really influence
 * brood development, worker energy use, disease risk, chamber selection, brood
 * transport, congestion, and mortality — read by the runner and its subsystems.
 *
 * Workers may move brood locally in response to conditions; the Queen never
 * commands brood movement (there is no such call anywhere).
 *
 * No fs, no child_process, no network, no wall clock, no module-level mutable state.
 */

import { clamp, roundTo } from "../colony/colonyTypes";
import { CHAMBER_IDS } from "../colony/nestGraph";
import type { ChamberId } from "../colony/nestGraph";

export interface ChamberClimate {
  readonly chamberId: ChamberId;
  readonly temperature: number;
  readonly humidity: number;
  readonly occupancy: number;
  readonly ventilation: number;
  readonly contamination: number;
  readonly wasteLevel: number;
  readonly broodDensity: number;
}

export type NestMicroclimate = Record<ChamberId, ChamberClimate>;

export function createMicroclimate(): NestMicroclimate {
  const climate = {} as NestMicroclimate;
  for (const chamberId of CHAMBER_IDS) {
    // Brood chambers run warmer and more humid — the developmental optimum.
    const isBrood = chamberId === "brood-chamber" || chamberId === "nursery";
    climate[chamberId] = {
      chamberId,
      temperature: isBrood ? 0.62 : 0.5,
      humidity: isBrood ? 0.7 : 0.55,
      occupancy: 0,
      ventilation: chamberId === "entrance" || chamberId === "defense-gate" ? 0.8 : 0.4,
      contamination: 0,
      wasteLevel: chamberId === "waste-chamber" ? 0.3 : 0,
      broodDensity: 0,
    };
  }
  return climate;
}

/** How good a chamber is for brood: near the developmental optimum (warm, humid, clean). */
export function broodSuitability(c: ChamberClimate): number {
  const tempFit = 1 - Math.abs(c.temperature - 0.62) * 2;
  const humFit = 1 - Math.abs(c.humidity - 0.7) * 2;
  return clamp(tempFit * 0.5 + humFit * 0.3 - c.contamination * 0.4, 0, 1);
}

export interface MicroclimateUpdate {
  readonly occupancyByChamber: Record<string, number>;
  readonly broodDensityByChamber: Record<string, number>;
  readonly externalTemperature: number;
  readonly externalHumidity: number;
}

/**
 * Advance the microclimate: occupancy/brood density from the actual population,
 * temperature/humidity relax toward the external climate modulated by
 * ventilation and occupancy (bodies warm a chamber), contamination decays with
 * ventilation. Deterministic, no randomness.
 */
export function advanceMicroclimate(climate: NestMicroclimate, update: MicroclimateUpdate): NestMicroclimate {
  const next = {} as NestMicroclimate;
  for (const chamberId of CHAMBER_IDS) {
    const c = climate[chamberId];
    const occ = update.occupancyByChamber[chamberId] ?? 0;
    const brood = update.broodDensityByChamber[chamberId] ?? 0;
    const bodyWarmth = Math.min(0.15, occ * 0.004);
    // Deep chambers (brood/nursery/queen) are insulated underground: the outside
    // climate reaches them heavily damped and toward a moderated target, so they
    // hold near the developmental optimum instead of tracking the surface. This
    // is passive thermoregulation, not a command.
    const isDeep = chamberId === "brood-chamber" || chamberId === "nursery" || chamberId === "queen-chamber";
    const externalTempTarget = isDeep ? 0.55 + (update.externalTemperature - 0.55) * 0.2 : update.externalTemperature;
    const externalHumTarget = isDeep ? 0.68 + (update.externalHumidity - 0.68) * 0.2 : update.externalHumidity;
    const relax = isDeep ? 0.05 : 0.1 + c.ventilation * 0.2;
    const humRelax = isDeep ? 0.05 : 0.08 + c.ventilation * 0.15;
    const temperature = clamp(c.temperature + (externalTempTarget - c.temperature) * relax + bodyWarmth, 0, 1);
    const humidity = clamp(c.humidity + (externalHumTarget - c.humidity) * humRelax, 0, 1);
    const contamination = clamp(c.contamination * (1 - c.ventilation * 0.1), 0, 1);
    next[chamberId] = { ...c, temperature: roundTo(temperature, 4), humidity: roundTo(humidity, 4), occupancy: occ, broodDensity: brood, contamination: roundTo(contamination, 4) };
  }
  return next;
}

export function addContamination(climate: NestMicroclimate, chamberId: ChamberId, amount: number): NestMicroclimate {
  const c = climate[chamberId];
  return { ...climate, [chamberId]: { ...c, contamination: clamp(c.contamination + amount, 0, 1) } };
}

export function reduceContamination(climate: NestMicroclimate, chamberId: ChamberId, amount: number): { climate: NestMicroclimate; reduced: number } {
  const c = climate[chamberId];
  const reduced = Math.min(c.contamination, amount);
  return { climate: { ...climate, [chamberId]: { ...c, contamination: roundTo(c.contamination - reduced, 4) } }, reduced: roundTo(reduced, 4) };
}
