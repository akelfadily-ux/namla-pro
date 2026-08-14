/**
 * Ant Intelligence Deepening V1 — bounded local planning.
 *
 * An ant that voluntarily claims a piece of work may form a PRIVATE, bounded
 * `LocalPlan`. Nothing hands it the plan: the ant derives it from its own
 * mind, its own specialization, and the local goal it interpreted. No global
 * planner exists, the Queen cannot see or change it, and another ant learns of
 * it only through an explicit bounded review request (peerReviewSystem.ts).
 *
 * "Bounded" is enforced, not hoped: substeps, assumptions, and risks each have
 * hard caps (`MAX_PLAN_SUBSTEPS` etc.), and `planWithinBounds` re-checks them.
 * A plan may be REVISED after failure or peer feedback — revision is a real
 * state transition that tightens the plan (adds a mitigation, drops the
 * riskiest substep, raises the verification bar), capped by `MAX_PLAN_REVISIONS`.
 *
 * Authorized by NAMLA_BUILD_LAW.md Section 17 (Ant Intelligence Deepening V1).
 *
 * No fs, no wall clock, no ambient randomness, no module-level mutable state,
 * no external call of any kind.
 */

import type { AntMind } from "./antMind";
import type { TaskCategory } from "./colonyTypes";
import { clamp, createSeededRandom, roundTo } from "./colonyTypes";

export const MAX_PLAN_SUBSTEPS = 6 as const;
export const MAX_PLAN_ASSUMPTIONS = 4 as const;
export const MAX_PLAN_RISKS = 4 as const;
export const MAX_PLAN_REVISIONS = 3 as const;

export type PlanStatus = "draft" | "revised" | "abandoned" | "completed";

export interface LocalPlan {
  readonly ownerAntId: string;
  readonly category: TaskCategory;
  readonly goalCode: string;
  readonly assumptions: readonly string[];
  readonly substeps: readonly string[];
  readonly expectedArtifactCode: string;
  readonly risks: readonly string[];
  readonly verificationMethodCode: string;
  readonly stopConditionCode: string;
  readonly helpNeededConditionCode: string;
  readonly revisionCount: number;
  readonly status: PlanStatus;
  /** The ant's own confidence in the plan, bounded. */
  readonly planConfidence: number;
}

const SALT_PLAN = 0x4cf5ad43;

function planDraw(colonySeed: number, antIndex: number, tick: number, salt: number): number {
  const h = (Math.imul(colonySeed ^ salt, 2654435761) ^ Math.imul(antIndex + 1, 40503) ^ Math.imul(tick + 1, 2246822519)) >>> 0;
  return createSeededRandom(h)();
}

/**
 * The number of substeps an ant plans scales with its analytical/architectural
 * profile and persistence — a more methodical ant plans more steps, a more
 * impulsive one fewer. Always within [1, MAX_PLAN_SUBSTEPS].
 */
function plannedSubstepCount(mind: AntMind): number {
  const depth = mind.cognitiveProfile.analytical * 0.5 + mind.cognitiveProfile.architectural * 0.3 + mind.persistence * 0.2;
  return clamp(Math.round(1 + depth * (MAX_PLAN_SUBSTEPS - 1)), 1, MAX_PLAN_SUBSTEPS);
}

export interface CreatePlanInput {
  readonly mind: AntMind;
  readonly antIndex: number;
  readonly category: TaskCategory;
  readonly goalCode: string;
  readonly colonySeed: number;
  readonly tick: number;
}

/**
 * Create one bounded local plan. A cautious, skeptical ant records more risks
 * and a stricter verification method; a curious ant records more assumptions
 * to test. All lists are capped.
 */
export function createLocalPlan(input: CreatePlanInput): LocalPlan {
  const { mind, antIndex, category, goalCode, colonySeed, tick } = input;

  const substepCount = plannedSubstepCount(mind);
  const substeps: string[] = [];
  for (let i = 0; i < substepCount; i += 1) substeps.push(`${category}-step-${i + 1}`);

  const riskCount = clamp(Math.round(mind.caution * MAX_PLAN_RISKS), 1, MAX_PLAN_RISKS);
  const risks: string[] = [];
  for (let i = 0; i < riskCount; i += 1) risks.push(`risk-${category}-${i + 1}`);

  const assumptionCount = clamp(Math.round(mind.curiosity * MAX_PLAN_ASSUMPTIONS), 1, MAX_PLAN_ASSUMPTIONS);
  const assumptions: string[] = [];
  for (let i = 0; i < assumptionCount; i += 1) assumptions.push(`assume-${category}-${i + 1}`);

  const verificationMethodCode = mind.cognitiveProfile.testing > 0.55 ? "independent-test" : "self-check";
  const jitter = (planDraw(colonySeed, antIndex, tick, SALT_PLAN) - 0.5) * 0.1;

  return {
    ownerAntId: mind.antId,
    category,
    goalCode,
    assumptions,
    substeps,
    expectedArtifactCode: `artifact-${category}`,
    risks,
    verificationMethodCode,
    stopConditionCode: "stop-on-verified-or-budget",
    helpNeededConditionCode: mind.confidence < 0.45 ? "help-if-uncertain" : "help-if-blocked",
    revisionCount: 0,
    status: "draft",
    planConfidence: roundTo(clamp(mind.confidence + jitter, 0.05, 0.95), 4),
  };
}

export type RevisionTrigger = "failure" | "peer-risk" | "peer-assumption-challenge" | "contradiction";

/**
 * Revise a plan in response to a real trigger. Revision TIGHTENS the plan:
 * drops the last (riskiest-appended) substep if there is room to, records a
 * mitigation risk, escalates verification, and lowers plan confidence.
 * Returns the same plan unchanged (no revision spent) once the cap is hit.
 */
export function reviseLocalPlan(plan: LocalPlan, trigger: RevisionTrigger): LocalPlan {
  if (plan.revisionCount >= MAX_PLAN_REVISIONS) return plan;
  if (plan.status === "completed" || plan.status === "abandoned") return plan;

  const risks = [...plan.risks];
  const mitigation = `mitigation-${trigger}-${plan.revisionCount + 1}`;
  if (!risks.includes(mitigation)) {
    risks.push(mitigation);
    while (risks.length > MAX_PLAN_RISKS) risks.shift();
  }

  // A failure-triggered revision drops a substep (simplify); a peer-assumption
  // challenge adds a verification substep instead — different, real responses.
  let substeps = [...plan.substeps];
  if (trigger === "failure" && substeps.length > 1) {
    substeps = substeps.slice(0, -1);
  } else if (trigger === "peer-assumption-challenge" && substeps.length < MAX_PLAN_SUBSTEPS) {
    substeps = [...substeps, `verify-assumption-${plan.revisionCount + 1}`];
  }

  const verificationMethodCode =
    trigger === "peer-risk" || trigger === "contradiction" ? "independent-test" : plan.verificationMethodCode;

  return {
    ...plan,
    risks,
    substeps,
    verificationMethodCode,
    revisionCount: plan.revisionCount + 1,
    status: "revised",
    planConfidence: roundTo(clamp(plan.planConfidence - 0.08, 0.05, 0.95), 4),
  };
}

export function completePlan(plan: LocalPlan): LocalPlan {
  return { ...plan, status: "completed" };
}

export function abandonPlan(plan: LocalPlan): LocalPlan {
  return { ...plan, status: "abandoned" };
}

/** Every plan list is within its hard cap. Checked, never assumed. */
export function planWithinBounds(plan: LocalPlan): boolean {
  return (
    plan.substeps.length <= MAX_PLAN_SUBSTEPS &&
    plan.substeps.length >= 1 &&
    plan.assumptions.length <= MAX_PLAN_ASSUMPTIONS &&
    plan.risks.length <= MAX_PLAN_RISKS &&
    plan.revisionCount <= MAX_PLAN_REVISIONS
  );
}
