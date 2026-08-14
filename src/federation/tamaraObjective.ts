/**
 * Tamara–Namla Federation V1 — the strategic objective contract (Build Law §20).
 *
 * Tamara is the SOVEREIGN STRATEGIC layer: she publishes objectives, sets
 * budgets and constraints, inspects safe summaries, and accepts or rejects
 * final results. She is NOT a worker, NOT a scheduler, and NOT a planner:
 * the authority record below types every forbidden power as the literal
 * `false`/`0`, the same discipline the Queen record uses — a Tamara that
 * assigns an ant, picks a quorum winner, reads private minds, bypasses the
 * work market/review/safety, or mints provider permits is unrepresentable,
 * and `tamaraHoldsNoWorkerAuthority` re-checks it at runtime against casts.
 *
 * No fs, no child_process, no network, no wall clock in decision paths.
 */

import type { CognitiveProviderName } from "../colonyMission/cognitiveWorkTypes";
import type { WorkCategory } from "../colonyMission/workDemand";

export type TamaraPriority = "low" | "normal" | "high" | "critical";
export type TamaraRiskLevel = "low" | "moderate" | "high";

export interface TamaraObjective {
  readonly objectiveId: string;
  readonly title: string;
  readonly desiredOutcome: string;
  readonly constraints: readonly string[];
  readonly priority: TamaraPriority;
  readonly riskLevel: TamaraRiskLevel;
  /** Abstract budget units for the whole objective (cost awareness, not money). */
  readonly budgetUnits: number;
  /** Bounded tick limit — objectives never run unbounded. */
  readonly maxTicks: number;
  readonly requiredSkills: readonly WorkCategory[];
  readonly acceptanceCriteria: readonly string[];
  readonly humanApprovalRequired: boolean;
  /** Providers Tamara permits for this objective (real ones still need human authorization). */
  readonly allowedProviderPool: readonly CognitiveProviderName[];
  readonly maxCognitivelyActiveAnts: number;
  readonly maxRealProviderCalls: number;
  readonly workspacePolicy: "in-memory-fake" | "dedicated-mission-workspace";
  readonly safeMetadata: Readonly<Record<string, string | number | boolean>>;
}

/** Tamara's authority record: strategic powers present, worker powers unrepresentable. */
export interface TamaraAuthorityRecord {
  readonly mayPublishObjectives: true;
  readonly maySetBudgets: true;
  readonly mayDefineSafetyConstraints: true;
  readonly mayApproveDangerousBoundaries: true;
  readonly mayInspectSafeSummaries: true;
  readonly mayAcceptOrRejectResults: true;
  readonly mayPauseMissions: true;
  readonly mayReduceProviderBudgets: true;

  // --- forbidden powers, literal-typed so they cannot be widened ---
  readonly directAntAssignmentAuthority: false;
  readonly quorumSelectionAuthority: false;
  readonly privateMindAccess: false;
  readonly workMarketBypassAuthority: false;
  readonly reviewBypassAuthority: false;
  readonly safetyBypassAuthority: false;
  readonly permitMintingAuthority: false;
  readonly unlimitedProviderCallAuthority: false;

  /** Tasks Tamara has ever assigned directly to a specific ant. Literal 0 forever. */
  readonly tamaraDirectAntAssignments: 0;
}

export function createTamaraAuthorityRecord(): TamaraAuthorityRecord {
  return {
    mayPublishObjectives: true,
    maySetBudgets: true,
    mayDefineSafetyConstraints: true,
    mayApproveDangerousBoundaries: true,
    mayInspectSafeSummaries: true,
    mayAcceptOrRejectResults: true,
    mayPauseMissions: true,
    mayReduceProviderBudgets: true,

    directAntAssignmentAuthority: false,
    quorumSelectionAuthority: false,
    privateMindAccess: false,
    workMarketBypassAuthority: false,
    reviewBypassAuthority: false,
    safetyBypassAuthority: false,
    permitMintingAuthority: false,
    unlimitedProviderCallAuthority: false,

    tamaraDirectAntAssignments: 0,
  };
}

/** Runtime re-check against casts, mirroring `queenHoldsNoAuthority`. */
export function tamaraHoldsNoWorkerAuthority(record: TamaraAuthorityRecord): boolean {
  const r = record as unknown as Record<string, unknown>;
  const declared =
    r.directAntAssignmentAuthority === false &&
    r.quorumSelectionAuthority === false &&
    r.privateMindAccess === false &&
    r.workMarketBypassAuthority === false &&
    r.reviewBypassAuthority === false &&
    r.safetyBypassAuthority === false &&
    r.permitMintingAuthority === false &&
    r.unlimitedProviderCallAuthority === false &&
    r.tamaraDirectAntAssignments === 0;
  const forbiddenKeys = ["assignedAnts", "antAssignments", "quorumWinner", "antMinds", "permitFactory", "scheduler", "routingTable"];
  return declared && !forbiddenKeys.some((k) => Object.prototype.hasOwnProperty.call(r, k));
}

export type ObjectiveValidationCode =
  | "objective-valid"
  | "missing-id-or-title"
  | "no-acceptance-criteria"
  | "no-required-skills"
  | "non-positive-budget"
  | "tick-limit-out-of-bounds"
  | "cognitive-cap-exceeds-global-30"
  | "real-provider-calls-exceed-cap";

/** Hard ceiling on real provider calls any single objective may request. */
export const OBJECTIVE_MAX_REAL_PROVIDER_CALLS = 5 as const;
export const OBJECTIVE_MAX_TICKS = 1000 as const;

export function validateTamaraObjective(objective: TamaraObjective): ObjectiveValidationCode {
  if (!objective.objectiveId || !objective.title) return "missing-id-or-title";
  if (objective.acceptanceCriteria.length === 0) return "no-acceptance-criteria";
  if (objective.requiredSkills.length === 0) return "no-required-skills";
  if (objective.budgetUnits <= 0) return "non-positive-budget";
  if (objective.maxTicks <= 0 || objective.maxTicks > OBJECTIVE_MAX_TICKS) return "tick-limit-out-of-bounds";
  if (objective.maxCognitivelyActiveAnts > 30) return "cognitive-cap-exceeds-global-30";
  if (objective.maxRealProviderCalls > OBJECTIVE_MAX_REAL_PROVIDER_CALLS) return "real-provider-calls-exceed-cap";
  return "objective-valid";
}
