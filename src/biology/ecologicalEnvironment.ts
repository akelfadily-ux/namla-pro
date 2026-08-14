/**
 * ecologicalEnvironment — the bounded spatial world outside the nest
 * (Build Law §22, §4/§13). Food and water patches hold REAL resource stock
 * (registered in the economy's `externalPatches` pool), deplete when collected,
 * and regenerate slowly. A day/night cycle and a bounded seasonal state drive
 * temperature and humidity; predator pressure and pathogen exposure create risk.
 *
 * Foraging is spatial: a forager walks external zones by distance (no
 * teleportation), searches locally (no global knowledge of every patch),
 * collects only existing stock up to its carrying capacity, faces risk, and
 * must physically return. Collection is a conserving economy transfer
 * (externalPatches -> antCrops) mirrored onto the patch and the body.
 *
 * No fs, no child_process, no network, no wall clock, no module-level mutable state.
 */

import { clamp, roundTo } from "../colony/colonyTypes";
import { bioDraw } from "./biologicalTypes";
import type { ResourceCategory } from "./biologicalTypes";

export type PatchKind = "carbohydrate" | "protein" | "water";

export interface ResourcePatch {
  readonly patchId: string;
  readonly kind: PatchKind;
  readonly distance: number; // zones from the entrance
  readonly quality: number; // 0..1, affects collection rate
  readonly stock: number; // remaining resource (mirrors economy externalPatches share)
  readonly capacity: number; // max stock (regeneration ceiling)
  readonly dangerLevel: number; // 0..1 predator/hazard pressure here
  readonly pathogenExposure: number; // 0..1 contamination risk here
}

export interface EcologyState {
  readonly patches: readonly ResourcePatch[];
  readonly tick: number;
  readonly temperature: number; // 0..1 normalized
  readonly humidity: number;
  readonly isDay: boolean;
  readonly season: "growth" | "peak" | "scarcity";
  readonly predatorPressure: number;
}

const DAY_LENGTH = 20; // ticks per half-cycle
const SEASON_LENGTH = 500;

export function createEcology(seed: number): EcologyState {
  const patches: ResourcePatch[] = [];
  const kinds: PatchKind[] = ["carbohydrate", "carbohydrate", "protein", "water", "water"];
  for (let i = 0; i < kinds.length; i += 1) {
    const v = bioDraw(seed, i, 0, 0x27d4eb2f);
    const cap = 8 + v * 8;
    patches.push({
      patchId: `patch-${kinds[i]}-${i}`,
      kind: kinds[i],
      distance: 1 + Math.floor(v * 3),
      quality: roundTo(0.5 + v * 0.5, 4),
      stock: roundTo(cap, 6),
      capacity: roundTo(cap, 6),
      dangerLevel: roundTo(kinds[i] === "water" ? 0.05 + v * 0.1 : 0.1 + v * 0.25, 4),
      pathogenExposure: roundTo(kinds[i] === "protein" ? 0.15 + v * 0.2 : 0.05 + v * 0.1, 4),
    });
  }
  return { patches, tick: 0, temperature: 0.5, humidity: 0.6, isDay: true, season: "growth", predatorPressure: 0.1 };
}

/** The category a patch kind contributes to the economy. */
export function patchResource(kind: PatchKind): ResourceCategory {
  return kind === "water" ? "water" : kind === "protein" ? "protein" : "carbohydrate";
}

/**
 * Advance climate/day-night/season and compute DESIRED regeneration per patch
 * (bounded, slower in scarcity). Stock is NOT changed here — the runner funds
 * regeneration from the economy's `lost` pool (decomposed dead matter / spoilage
 * cycling back into the environment), so nothing is created from nothing.
 */
export function advanceEcology(state: EcologyState, seed: number): { readonly state: EcologyState; readonly desiredRegenByPatch: Record<string, number> } {
  const tick = state.tick + 1;
  const isDay = Math.floor(tick / DAY_LENGTH) % 2 === 0;
  const seasonIndex = Math.floor(tick / SEASON_LENGTH) % 3;
  const season = (["growth", "peak", "scarcity"] as const)[seasonIndex];
  const dayFactor = isDay ? 1 : 0;
  const temperature = clamp(0.4 + dayFactor * 0.2 + (season === "peak" ? 0.15 : season === "scarcity" ? -0.1 : 0) + Math.sin(tick / 30) * 0.05, 0, 1);
  const humidity = clamp(0.6 - dayFactor * 0.1 + (season === "scarcity" ? -0.15 : 0.05), 0, 1);
  const predatorPressure = clamp(0.1 + (isDay ? 0.1 : 0.02) + (season === "peak" ? 0.1 : 0), 0, 1);

  const regenRate = season === "scarcity" ? 0.01 : season === "peak" ? 0.05 : 0.03;
  const desiredRegenByPatch: Record<string, number> = {};
  for (const p of state.patches) {
    const headroom = p.capacity - p.stock;
    desiredRegenByPatch[p.patchId] = Math.max(0, Math.min(headroom, p.capacity * regenRate * (isDay ? 1 : 0.3)));
  }
  return { state: { ...state, tick, temperature, humidity, isDay, season, predatorPressure }, desiredRegenByPatch };
}

/** Add funded regeneration to a patch's stock (caller has transferred lost -> externalPatches). */
export function regeneratePatch(state: EcologyState, patchId: string, funded: number): EcologyState {
  if (funded <= 0) return state;
  return { ...state, patches: state.patches.map((p) => (p.patchId === patchId ? { ...p, stock: roundTo(Math.min(p.capacity, p.stock + funded), 6) } : p)) };
}

/** Deplete a patch's stock by `amount` (the caller mirrors the economy transfer). */
export function depletePatch(state: EcologyState, patchId: string, amount: number): EcologyState {
  return { ...state, patches: state.patches.map((p) => (p.patchId === patchId ? { ...p, stock: roundTo(Math.max(0, p.stock - amount), 6) } : p)) };
}

/** Total remaining external stock — for the patch-depletion metric. */
export function totalExternalStock(state: EcologyState): number {
  return roundTo(state.patches.reduce((s, p) => s + p.stock, 0), 6);
}

/** A forager's local search: the nearest patch of its target kind with stock. */
export function findLocalPatch(state: EcologyState, kind: PatchKind, seed: number, antIndex: number, tick: number): ResourcePatch | null {
  const candidates = state.patches.filter((p) => p.kind === kind && p.stock > 0.01).sort((a, b) => a.distance - b.distance);
  if (candidates.length === 0) return null;
  // Local, imperfect knowledge: usually the nearest, sometimes a further one.
  const jitter = bioDraw(seed, antIndex, tick, 0xc2b2ae35);
  return jitter < 0.75 ? candidates[0] : candidates[Math.min(candidates.length - 1, 1)];
}
