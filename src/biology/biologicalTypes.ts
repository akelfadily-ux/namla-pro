/**
 * Ant Superorganism Biology V1 — shared biological types (Build Law §22).
 *
 * This is a MECHANISTIC colony simulator: every quantity below is a real
 * conserved resource or a real body/environment state that changes only through
 * explicit state transitions. Nothing is a decorative counter — the resource
 * economy (`resourceEconomy.ts`) is a strict double-entry ledger, and the
 * report validates that every metric is event-sourced and every resource
 * balance closes within tolerance.
 *
 * No fs, no child_process, no network, no wall clock.
 */

/** The conserved resource categories. Every unit is tracked from source to sink. */
export const RESOURCE_CATEGORIES = [
  "carbohydrate",
  "protein",
  "water",
  "broodFood",
  "buildingMaterial",
] as const;
export type ResourceCategory = (typeof RESOURCE_CATEGORIES)[number];

/**
 * The mutually-exclusive POOLS a unit of resource can occupy. The sum across all
 * pools for a category is invariant (= its initial total), because every
 * mutation is a conserving transfer between two pools.
 */
export const RESOURCE_POOLS = [
  "externalPatches", // still in the environment
  "antCrops", // carried in worker crops
  "nestStores", // deposited in chambers
  "broodMass", // embodied in developing brood
  "queenReserve", // held by the queen
  "waste", // waste chamber
  "consumed", // metabolized away (tracked, never re-created)
  "lost", // spoilage / death loss (tracked)
] as const;
export type ResourcePool = (typeof RESOURCE_POOLS)[number];

export type LifeStage = "egg" | "larva" | "pupa" | "callow" | "adult" | "sexual-female" | "male";

export type Caste = "minor-worker" | "major-worker" | "soldier" | "scout" | "nurse" | "reproductive";

export type DeathCause =
  | "starvation"
  | "dehydration"
  | "senescence"
  | "infection"
  | "injury"
  | "brood-failure";

/** The behavioral state a body settles into — emergent, never assigned. */
export type BiologicalTask =
  | "resting"
  | "nursing"
  | "foraging"
  | "storing"
  | "building"
  | "grooming"
  | "sanitation"
  | "guarding"
  | "brood-transport";

// --- trait provenance registry (§1) ----------------------------------------

export type TraitProvenance =
  | "observed-biological-mechanism"
  | "hybrid-from-multiple-species"
  | "digital-adaptation"
  | "experimental-hypothesis"
  | "postponed";

export type FidelityStatus = "fully-mechanistic" | "partially-mechanistic" | "placeholder" | "missing";

export interface BiologicalTrait {
  readonly traitId: string;
  readonly biologicalSourceProfile: string;
  readonly mechanism: string;
  readonly provenance: TraitProvenance;
  readonly implementationModule: string;
  readonly runtimeReadSites: readonly string[];
  readonly runtimeWriteSites: readonly string[];
  readonly fidelity: FidelityStatus;
  /** A trait is NOT "implemented" if it is only a field or counter. */
  readonly verificationStatus: "event-sourced" | "field-only";
}

export function zeroedResourceRecord(): Record<ResourceCategory, number> {
  const r = {} as Record<ResourceCategory, number>;
  for (const c of RESOURCE_CATEGORIES) r[c] = 0;
  return r;
}

/** Deterministic per-entity draw. Mirrors the house colony seed-mix. */
export function bioDraw(seed: number, a: number, b: number, salt: number): number {
  const h = (Math.imul(seed ^ salt, 2654435761) ^ Math.imul(a + 1, 40503) ^ Math.imul(b + 1, 2246822519)) >>> 0;
  // xorshift-ish finalize to a unit float, no ambient randomness.
  let t = h;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
