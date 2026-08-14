/**
 * Software work demand categories and voluntary claim resolution.
 *
 * Eligibility and claim scoring reuse each ant's OWN existing
 * `skillTendencies` (Colony Genesis G0, `AntGenomeProfile.skillTendencies`)
 * — the exact "digital adaptation... skill tendencies (research, coding,
 * testing, security, …) layered over biological task categories" the
 * project's own biological-model doc already names. No new per-ant state is
 * added; the work market reads what every ant already carries.
 *
 * "Claim contention resolved deterministically" is the SAME bounded
 * resource-admission discipline Colony Genesis G5 (quorum) and G7
 * (cognitive budget) already use: ants voluntarily submit, one small
 * function ranks by score then antId and picks a winner — it never decides
 * FOR an ant what to claim, only which of several voluntary claims on the
 * SAME task wins when more than one ant wants it.
 */

import type { AntAgent } from "../colony/antAgent";
import type { SkillTendency } from "../colony/colonyTypes";

export const WORK_CATEGORIES = [
  "research",
  "architecture",
  "planning",
  "frontend",
  "backend",
  "coding",
  "testing",
  "debugging",
  "security",
  "documentation",
  "integration",
  "review",
  "repair",
] as const;

export type WorkCategory = (typeof WORK_CATEGORIES)[number];

/** Maps each software work category onto the nearest existing G0 skill tendency. */
export const WORK_CATEGORY_SKILL: Readonly<Record<WorkCategory, SkillTendency>> = {
  research: "research",
  architecture: "planning",
  planning: "planning",
  frontend: "coding",
  backend: "coding",
  coding: "coding",
  testing: "testing",
  debugging: "debugging",
  security: "security",
  documentation: "documentation",
  integration: "orchestration",
  review: "testing",
  repair: "debugging",
};

/** An ant must clear this skill-tendency floor to be "eligible" and submit a voluntary claim. */
export const ELIGIBILITY_THRESHOLD = 0.5;

export interface WorkTask {
  readonly taskId: string;
  readonly missionId: string;
  readonly category: WorkCategory;
  readonly description: string;
  readonly acceptanceCriteria: readonly string[];
}

export interface VoluntaryClaim {
  readonly antId: string;
  readonly taskId: string;
  readonly claimScore: number;
}

/** True when this ant's own skill tendency for the task's category clears the eligibility floor. */
export function isEligible(ant: AntAgent, task: WorkTask): boolean {
  const skill = WORK_CATEGORY_SKILL[task.category];
  return ant.skillTendencies[skill] >= ELIGIBILITY_THRESHOLD;
}

/** An ant's own claim score for a task — from only its own already-local state. */
export function computeClaimScore(ant: AntAgent, task: WorkTask): number {
  const skill = WORK_CATEGORY_SKILL[task.category];
  return Math.round((ant.skillTendencies[skill] * 0.7 + ant.reliability * 0.3) * 1000) / 1000;
}

export interface ClaimResolution {
  readonly voluntaryClaims: readonly VoluntaryClaim[];
  readonly acceptedClaim: VoluntaryClaim | null;
}

/**
 * Every eligible ant that wants the task submits a voluntary claim; the
 * winner is the highest score, antId ascending as a stable tiebreak. Never
 * assigns a task to an ant that did not itself submit a claim.
 */
export function resolveTaskClaims(eligibleAnts: readonly AntAgent[], task: WorkTask): ClaimResolution {
  const voluntaryClaims: VoluntaryClaim[] = eligibleAnts
    .filter((ant) => isEligible(ant, task))
    .map((ant) => ({ antId: ant.antId, taskId: task.taskId, claimScore: computeClaimScore(ant, task) }));

  if (voluntaryClaims.length === 0) return { voluntaryClaims, acceptedClaim: null };

  const sorted = [...voluntaryClaims].sort((a, b) => b.claimScore - a.claimScore || a.antId.localeCompare(b.antId));
  return { voluntaryClaims, acceptedClaim: sorted[0] };
}
