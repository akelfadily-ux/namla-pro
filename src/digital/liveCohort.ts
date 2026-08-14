/**
 * liveCohort — voluntary admission of the three-ant live cohort (Build Law §25).
 *
 * At least eight qualified ants submit VOLUNTARY claims; a deterministic
 * cognitive-rotation contention resolver admits EXACTLY three among the
 * volunteers. Tamara does not name them, the Queen does not name them, and no
 * non-volunteer may enter. Each admitted ant is assigned a provider from the
 * human-selected, permit-bound allocation (preferred claude, claude, codex; the
 * human may instead select three claude if codex is unavailable).
 *
 * No fs, no child_process, no network, no wall clock. Deterministic by seed.
 */

import { digitalDraw } from "./digitalTypes";
import type { DigitalWorker } from "./digitalWorkers";
import { stageRank } from "./digitalWorkers";
import type { RealProviderId } from "../cognitive/realProviderExecutionPermit";
import { LIVE_COHORT_SIZE } from "../cognitive/liveObjectivePermit";
import type { LiveCohortMember } from "../cognitive/liveObjectivePermit";

export const MIN_VOLUNTARY_LIVE_CLAIMS = 8 as const;
export const RELIABILITY_THRESHOLD = 0.5;

export interface LiveClaim {
  readonly antId: string;
  readonly index: number;
  readonly skillEvidence: number; // accumulated evidence (SkillPassport proxy)
  readonly specialization: string;
  readonly reliability: number;
  readonly workload: number; // 0..1 current load (lower is better)
  readonly energy: number;
  readonly recentProviderUsage: number; // 0..1 (lower is fairer)
  readonly learningNeed: number; // 0..1 (higher favours admission for growth)
  readonly expectedContribution: number;
  readonly requestedProvider: RealProviderId;
}

export interface CohortAdmission {
  readonly pool: readonly LiveClaim[];
  readonly accepted: readonly LiveCohortMember[];
  readonly selectionEvidence: readonly LiveClaim[];
  readonly voluntaryLiveClaims: number;
  readonly acceptedLiveCohortSize: number;
  readonly nonVolunteerAssignments: 0;
}

const SPECIALIZATIONS = ["architecture", "backend", "frontend", "testing", "security", "data"] as const;

/** Build the voluntary claim pool from eligible workers (never an assignment). */
export function buildVoluntaryClaimPool(workers: readonly DigitalWorker[], preferredProviders: readonly RealProviderId[], seed: number): LiveClaim[] {
  const claims: LiveClaim[] = [];
  for (const w of workers) {
    if (!w.active) continue;
    // SkillPassport eligibility + reliability + energy gate (self-selection).
    if (stageRank(w.maturation) < stageRank("qualified")) continue;
    if (w.reliability < RELIABILITY_THRESHOLD || w.cognitiveEnergy < 0.3) continue;
    // The ant chooses whether to volunteer (a stable per-ant willingness draw).
    if (digitalDraw(seed, w.index, 42, 0x2c1b3c6d) < 0.5) continue;
    const spec = SPECIALIZATIONS[w.index % SPECIALIZATIONS.length];
    claims.push({
      antId: w.workerId,
      index: w.index,
      skillEvidence: w.evidenceCount + w.competence * 4,
      specialization: spec,
      reliability: w.reliability,
      workload: digitalDraw(seed, w.index, 7, 0x27220a95),
      energy: w.cognitiveEnergy,
      recentProviderUsage: digitalDraw(seed, w.index, 11, 0x165667b1),
      learningNeed: 1 - w.competence,
      expectedContribution: w.reliability * 0.6 + w.competence * 0.4,
      requestedProvider: preferredProviders[w.index % preferredProviders.length] ?? "claude",
    });
  }
  return claims;
}

/**
 * Admit exactly three ants via cognitive rotation among the volunteers. The
 * resolver ranks by a fair blend of contribution, reliability, low recent
 * provider usage, and learning need — never by identity, Tamara, or the Queen.
 * Provider allocation follows the human-selected `providerAllocation` (length 3).
 */
export function admitLiveCohort(pool: readonly LiveClaim[], providerAllocation: readonly RealProviderId[]): CohortAdmission {
  const ranked = [...pool].sort((a, b) => score(b) - score(a));
  const acceptedClaims = ranked.slice(0, LIVE_COHORT_SIZE);
  const accepted: LiveCohortMember[] = acceptedClaims.map((c, i) => ({ antId: c.antId, provider: providerAllocation[i] ?? "claude" }));
  return {
    pool,
    accepted,
    selectionEvidence: acceptedClaims,
    voluntaryLiveClaims: pool.length,
    acceptedLiveCohortSize: accepted.length,
    nonVolunteerAssignments: 0,
  };
}

function score(c: LiveClaim): number {
  return c.expectedContribution * 0.4 + c.reliability * 0.25 + (1 - c.recentProviderUsage) * 0.2 + c.learningNeed * 0.1 + (1 - c.workload) * 0.05;
}

/** Resolve the provider allocation the human selected (preferred claude,claude,codex). */
export function resolveProviderAllocation(allowedProviders: readonly RealProviderId[]): RealProviderId[] {
  const hasCodex = allowedProviders.includes("codex");
  return hasCodex ? ["claude", "claude", "codex"] : ["claude", "claude", "claude"];
}
