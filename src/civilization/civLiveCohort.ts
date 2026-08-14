/**
 * civLiveCohort — voluntary admission of the live civilization cohort (Build Law
 * §28). At least 15 qualified ants voluntarily claim live work; a deterministic
 * cognitive-rotation resolver admits between 1 and 5 among the volunteers. Tamara
 * does not name them, the Queen does not name them, councils do not directly
 * assign them (a council may approve a CAPABILITY category, never an ant). Each
 * admitted member gets a temporary role, a district, and a permit-bound provider.
 *
 * No fs, no child_process, no network, no wall clock. Deterministic by seed.
 */

import { roundTo } from "../colony/colonyTypes";
import { DISTRICTS, civDraw } from "./settlementTypes";
import type { DistrictId } from "./settlementTypes";
import type { DigitalWorker } from "../digital/digitalWorkers";
import { stageRank } from "../digital/digitalWorkers";
import type { RealProviderId } from "../cognitive/realProviderExecutionPermit";
import type { CivCohortMember } from "../cognitive/civilizationLivePermit";
import { CIV_MAX_COHORT } from "../cognitive/civilizationLivePermit";

export const MIN_VOLUNTARY_LIVE_CLAIMS = 15 as const;

/** Temporary provider roles a live civilization mission needs. */
export const LIVE_ROLES = ["architecture", "coding", "testing", "security-review", "documentation", "research", "integration", "repair", "debugging"] as const;
export type LiveRole = (typeof LIVE_ROLES)[number];

/**
 * Capability families a SOFTWARE-BUILDING cohort must cover (the first real run
 * failed with a security-review/architecture/security-review trio: no build
 * capability, therefore zero artifacts). Coverage is a VALIDITY CONSTRAINT on
 * admission — selection still happens only among voluntary claimants, ranked by
 * the same fair score. Nobody is assigned.
 */
export type CapabilityFamily = "architecture" | "implementation" | "independent-review";
export const CAPABILITY_FAMILY_ROLES: Readonly<Record<CapabilityFamily, readonly LiveRole[]>> = {
  architecture: ["architecture", "research"],
  implementation: ["coding", "integration", "repair", "debugging"],
  "independent-review": ["testing", "security-review", "documentation"],
};
export const IMPLEMENTATION_ROLES: readonly LiveRole[] = CAPABILITY_FAMILY_ROLES.implementation;

export function capabilityFamilyOfRole(role: LiveRole): CapabilityFamily {
  if (CAPABILITY_FAMILY_ROLES.architecture.includes(role)) return "architecture";
  if (CAPABILITY_FAMILY_ROLES.implementation.includes(role)) return "implementation";
  return "independent-review";
}

/**
 * The repair claimant for build/verification failures MUST be implementation- or
 * debugging-capable (never a security-only ant repairing missing implementation).
 * Shared by the runner and the CLI so the minted repair permit always lines up.
 * Returns null when the cohort has no implementation-capable member.
 */
export function selectRepairMember<T extends { readonly role: string }>(accepted: readonly T[]): T | null {
  return accepted.find((a) => IMPLEMENTATION_ROLES.includes(a.role as LiveRole)) ?? null;
}

export interface CivLiveClaim {
  readonly antId: string;
  readonly index: number;
  readonly districtId: DistrictId;
  readonly role: LiveRole;
  readonly skillEvidence: number;
  readonly specialization: string;
  readonly reliability: number;
  readonly energy: number;
  readonly workload: number;
  readonly providerExperience: number;
  readonly mcpCompetence: number;
  readonly expectedContribution: number;
  readonly learningValue: number;
  readonly risk: number;
  readonly providerPreference: RealProviderId;
}

export interface CivCohortAdmission {
  readonly pool: readonly CivLiveClaim[];
  readonly accepted: readonly CivCohortMember[];
  readonly selectionEvidence: readonly CivLiveClaim[];
  readonly voluntaryLiveClaims: number;
  readonly acceptedLiveCohortSize: number;
  readonly nonVolunteerAssignments: 0;
  readonly councilWorkerAssignments: 0;
  /** Capability-coverage validity (software-building objectives). */
  readonly architectureCoverage: boolean;
  readonly implementationCoverage: boolean;
  readonly independentReviewCoverage: boolean;
  /** True when coverage is incomplete — the run must refuse with `cohort-capability-gap`. */
  readonly capabilityGap: boolean;
  readonly missingCapabilities: readonly CapabilityFamily[];
}

/** Build the voluntary claim pool — only self-selecting qualified volunteers. */
export function buildLiveClaimPool(workers: readonly DigitalWorker[], preferredProviders: readonly RealProviderId[], seed: number): CivLiveClaim[] {
  const claims: CivLiveClaim[] = [];
  for (const w of workers) {
    if (!w.active) continue;
    if (stageRank(w.maturation) < stageRank("qualified")) continue;
    if (w.reliability < 0.45 || w.cognitiveEnergy < 0.3) continue;
    if (civDraw(seed, w.index, 42, 0x2c1b3c6d) < 0.5) continue; // the ant chooses to volunteer
    const districtId = DISTRICTS[w.index % DISTRICTS.length];
    const role = LIVE_ROLES[w.index % LIVE_ROLES.length];
    claims.push({
      antId: w.workerId,
      index: w.index,
      districtId,
      role,
      skillEvidence: roundTo(w.evidenceCount + w.competence * 4, 4),
      specialization: role,
      reliability: w.reliability,
      energy: w.cognitiveEnergy,
      workload: roundTo(civDraw(seed, w.index, 7, 0x27220a95), 4),
      providerExperience: roundTo(civDraw(seed, w.index, 9, 0x165667b1), 4),
      mcpCompetence: roundTo(0.4 + w.competence * 0.4, 4),
      expectedContribution: roundTo(w.reliability * 0.6 + w.competence * 0.4, 4),
      learningValue: roundTo(1 - w.competence, 4),
      risk: roundTo(civDraw(seed, w.index, 11, 0x85ebca6b) * 0.4, 4),
      providerPreference: preferredProviders[w.index % preferredProviders.length] ?? "claude",
    });
  }
  return claims;
}

/**
 * Admit between 1 and `maxCohort` (≤5) ants via cognitive rotation among the
 * volunteers, ranked by a fair blend of contribution, reliability, low recent
 * provider usage, MCP competence, and learning value — never by identity. For a
 * software-building objective the cohort must COVER architecture, implementation,
 * and independent review: the top-scored VOLUNTEER of each family fills the first
 * three slots, remaining slots go to the best remaining volunteers. When a family
 * has no volunteer at all, admission is rejected (`capabilityGap: true`, empty
 * cohort) so the run refuses with `cohort-capability-gap` BEFORE any confirmation.
 * The `providerAllocation` (human-selected) binds each admitted ant to a provider.
 */
export function admitLiveCohort(pool: readonly CivLiveClaim[], maxCohort: number, providerAllocation: readonly RealProviderId[]): CivCohortAdmission {
  const size = Math.min(Math.max(1, Math.floor(maxCohort)), CIV_MAX_COHORT, pool.length);
  const ranked = [...pool].sort((a, b) => score(b) - score(a));

  const families: readonly CapabilityFamily[] = ["architecture", "implementation", "independent-review"];
  const bestOfFamily = new Map<CapabilityFamily, CivLiveClaim>();
  for (const family of families) {
    const best = ranked.find((c) => CAPABILITY_FAMILY_ROLES[family].includes(c.role));
    if (best) bestOfFamily.set(family, best);
  }
  const missingCapabilities = families.filter((f) => !bestOfFamily.has(f));
  const base = { pool, voluntaryLiveClaims: pool.length, nonVolunteerAssignments: 0 as const, councilWorkerAssignments: 0 as const };

  if (missingCapabilities.length > 0 || size < families.length) {
    // Coverage impossible — refuse admission entirely (validity constraint, not assignment).
    return { ...base, accepted: [], selectionEvidence: [], acceptedLiveCohortSize: 0, architectureCoverage: bestOfFamily.has("architecture"), implementationCoverage: bestOfFamily.has("implementation"), independentReviewCoverage: bestOfFamily.has("independent-review"), capabilityGap: true, missingCapabilities: missingCapabilities.length > 0 ? missingCapabilities : families.slice(size) };
  }

  // Slots 1-3: the top VOLUNTEER of each required family; remaining slots by rank.
  const acceptedClaims: CivLiveClaim[] = families.map((f) => bestOfFamily.get(f) as CivLiveClaim);
  const chosen = new Set(acceptedClaims.map((c) => c.antId));
  for (const c of ranked) {
    if (acceptedClaims.length >= size) break;
    if (!chosen.has(c.antId)) {
      acceptedClaims.push(c);
      chosen.add(c.antId);
    }
  }
  const accepted: CivCohortMember[] = acceptedClaims.map((c, i) => ({ antId: c.antId, districtId: c.districtId, provider: providerAllocation[i] ?? c.providerPreference, role: c.role }));
  return {
    ...base,
    accepted,
    selectionEvidence: acceptedClaims,
    acceptedLiveCohortSize: accepted.length,
    architectureCoverage: true,
    implementationCoverage: true,
    independentReviewCoverage: true,
    capabilityGap: false,
    missingCapabilities: [],
  };
}

function score(c: CivLiveClaim): number {
  return c.expectedContribution * 0.35 + c.reliability * 0.25 + (1 - c.providerExperience) * 0.15 + c.mcpCompetence * 0.15 + c.learningValue * 0.1;
}
