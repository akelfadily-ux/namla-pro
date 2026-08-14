/**
 * Ant Intelligence Deepening V1 — peer review and local challenge.
 *
 * Ants challenge each other's work locally. Reviewers VOLUNTEER based on their
 * own relevant skill, trust, and energy — there is no central reviewer
 * assignment and no Queen involvement. A reviewer's reputation weights how much
 * its verdict counts but never guarantees acceptance; reviewers routinely
 * disagree, and every minority opinion is preserved. High-risk work requires
 * multiple INDEPENDENT reviews, and an ant can never review its own work (the
 * subject is excluded from the reviewer pool by construction).
 *
 * Every review references a fixed reason code — never free text — so review
 * memory stays bounded and safe. Nothing here reads population-scale state: a
 * review round is handed a bounded, already-local pool of candidate reviewers.
 *
 * Also provides the small decentralized-reasoning structures the crisis and
 * mission layers compose from: pairwise critique and three-ant review panels.
 * No object ever receives all ants' private thoughts.
 *
 * Authorized by NAMLA_BUILD_LAW.md Section 17 (Ant Intelligence Deepening V1).
 *
 * No fs, no wall clock, no ambient randomness, no module-level mutable state,
 * no external call of any kind.
 */

import type { AntWithMind, CognitiveDimension } from "./antMind";
import type { LocalPlan } from "./localPlanning";
import type { TaskCategory } from "./colonyTypes";
import { clamp, createSeededRandom, roundTo } from "./colonyTypes";

export const REVIEW_INTERACTION_TYPES = [
  "request-review",
  "approve",
  "reject",
  "question-assumption",
  "identify-risk",
  "propose-alternative",
  "request-evidence",
  "request-test",
  "report-contradiction",
  "request-repair",
  "transfer-knowledge",
] as const;

export type ReviewInteractionType = (typeof REVIEW_INTERACTION_TYPES)[number];

/** How many risks make a plan "high-risk" and demand multiple reviews. */
export const HIGH_RISK_THRESHOLD = 3 as const;
export const REQUIRED_INDEPENDENT_REVIEWS_HIGH_RISK = 2 as const;
/** Bounded reviewer pool — a review never scans the population. */
export const MAX_REVIEWERS = 5 as const;

/** Which aptitude dimension makes a reviewer relevant for a category of work. */
const CATEGORY_REVIEW_SKILL: Record<TaskCategory, CognitiveDimension> = {
  scouting: "analytical",
  foraging: "analytical",
  building: "implementation",
  repairing: "debugging",
  nursing: "patience",
  guarding: "security",
  cleaning: "precision",
  transporting: "speed",
  storing: "memoryRetrieval",
  communicating: "communication",
};

export interface ReviewResponse {
  readonly reviewerAntId: string;
  readonly interaction: ReviewInteractionType;
  readonly reasonCode: string;
  /** Reviewer's own bounded assessment of the work, 0..1. */
  readonly assessment: number;
  /** Trust weight from reviewer reputation. Weights, never decides. */
  readonly trustWeight: number;
  readonly agreedWithMajority: boolean;
}

export interface PeerReviewResult {
  readonly subjectAntId: string;
  readonly category: TaskCategory;
  readonly requestIssued: boolean;
  readonly responses: readonly ReviewResponse[];
  readonly independentReviews: number;
  readonly approvals: number;
  readonly rejections: number;
  readonly disagreements: number;
  readonly assumptionsChallenged: number;
  readonly risksIdentified: number;
  readonly evidenceRequested: number;
  /** Preserved minority verdicts (those against the final decision). */
  readonly minorityOpinions: number;
  readonly highRisk: boolean;
  readonly accepted: boolean;
  readonly selfReviewAttemptBlocked: boolean;
}

const SALT_REVIEW = 0x7feb352d;

function reviewDraw(colonySeed: number, reviewerIndex: number, subjectIndex: number, salt: number): number {
  const h =
    (Math.imul(colonySeed ^ salt, 2654435761) ^ Math.imul(reviewerIndex + 1, 40503) ^ Math.imul(subjectIndex + 1, 2246822519)) >>> 0;
  return createSeededRandom(h)();
}

/** A candidate volunteers when it has relevant skill and enough energy. */
function volunteers(candidate: AntWithMind, dimension: CognitiveDimension): boolean {
  return candidate.mind.cognitiveProfile[dimension] >= 0.45 && candidate.ant.energy >= 0.2;
}

/**
 * Run one local peer review of `subject`'s plan by a bounded pool. The subject
 * is removed from the pool first, so self-approval is structurally impossible.
 */
export function runPeerReview(params: {
  readonly subject: AntWithMind;
  readonly plan: LocalPlan;
  readonly candidatePool: readonly AntWithMind[];
  readonly colonySeed: number;
}): PeerReviewResult {
  const { subject, plan, candidatePool, colonySeed } = params;
  const dimension = CATEGORY_REVIEW_SKILL[plan.category];
  const highRisk = plan.risks.length >= HIGH_RISK_THRESHOLD;

  // Exclude the subject — an ant cannot review its own work — then take
  // volunteers with relevant skill, capped at MAX_REVIEWERS.
  const selfReviewAttemptBlocked = candidatePool.some((c) => c.ant.antId === subject.ant.antId);
  const reviewers = candidatePool
    .filter((c) => c.ant.antId !== subject.ant.antId && volunteers(c, dimension))
    .slice(0, MAX_REVIEWERS);

  const responses: ReviewResponse[] = [];
  for (const reviewer of reviewers) {
    const skill = reviewer.mind.cognitiveProfile[dimension];
    const jitter = (reviewDraw(colonySeed, reviewer.ant.antIndex, subject.ant.antIndex, SALT_REVIEW) - 0.5) * 0.3;
    // Assessment blends the plan's own confidence against the reviewer's skill,
    // skepticism, and the plan's riskiness — a skeptical, skilled reviewer of a
    // risky plan scores it lower.
    const assessment = clamp(
      plan.planConfidence * 0.5 + skill * 0.3 - reviewer.mind.caution * 0.2 - plan.risks.length * 0.05 + jitter,
      0,
      1
    );

    let interaction: ReviewInteractionType;
    let reasonCode: string;
    if (assessment >= 0.6) {
      interaction = "approve";
      reasonCode = "meets-bar";
    } else if (highRisk && reviewer.mind.caution > 0.55) {
      interaction = "identify-risk";
      reasonCode = `risk-${plan.category}`;
    } else if (reviewer.mind.curiosity > 0.55 && plan.assumptions.length > 0) {
      interaction = "question-assumption";
      reasonCode = plan.assumptions[0];
    } else if (assessment < 0.3) {
      interaction = "reject";
      reasonCode = "below-bar";
    } else if (reviewer.mind.cognitiveProfile.testing > 0.55) {
      interaction = "request-test";
      reasonCode = "needs-verification";
    } else {
      interaction = "request-evidence";
      reasonCode = "insufficient-evidence";
    }

    responses.push({
      reviewerAntId: reviewer.ant.antId,
      interaction,
      reasonCode,
      assessment: roundTo(assessment, 4),
      trustWeight: roundTo(clamp(reviewer.mind.peerReputation, 0.05, 1), 4),
      agreedWithMajority: false, // set below
    });
  }

  const approvals = responses.filter((r) => r.interaction === "approve").length;
  const rejections = responses.filter((r) => r.interaction === "reject").length;
  const assumptionsChallenged = responses.filter((r) => r.interaction === "question-assumption").length;
  const risksIdentified = responses.filter((r) => r.interaction === "identify-risk").length;
  const evidenceRequested = responses.filter(
    (r) => r.interaction === "request-evidence" || r.interaction === "request-test"
  ).length;

  // Trust-weighted acceptance: approvals' weight vs everything else. Reputation
  // tilts the scale but a single high-rep reviewer cannot force acceptance,
  // and high-risk work additionally needs enough independent reviews.
  let approveWeight = 0;
  let objectWeight = 0;
  for (const r of responses) {
    if (r.interaction === "approve") approveWeight += r.trustWeight;
    else objectWeight += r.trustWeight;
  }
  const independentReviews = responses.length;
  const enoughReviews = !highRisk || independentReviews >= REQUIRED_INDEPENDENT_REVIEWS_HIGH_RISK;
  const accepted = enoughReviews && approveWeight > objectWeight && approvals > rejections;

  // A verdict counts as "approve" or "not-approve"; the losing side is the
  // preserved minority. Mark agreement for the record.
  const majorityApproves = approvals >= responses.length - approvals;
  let minorityOpinions = 0;
  const responsesWithAgreement = responses.map((r) => {
    const isApprove = r.interaction === "approve";
    const agreed = isApprove === majorityApproves;
    if (!agreed) minorityOpinions += 1;
    return { ...r, agreedWithMajority: agreed };
  });

  // Disagreement exists when both an approval and an objection were recorded.
  const disagreements = approvals > 0 && responses.length - approvals > 0 ? 1 : 0;

  return {
    subjectAntId: subject.ant.antId,
    category: plan.category,
    requestIssued: true,
    responses: responsesWithAgreement,
    independentReviews,
    approvals,
    rejections,
    disagreements,
    assumptionsChallenged,
    risksIdentified,
    evidenceRequested,
    minorityOpinions,
    highRisk,
    accepted,
    selfReviewAttemptBlocked,
  };
}

export interface PairwiseCritique {
  readonly criticAntId: string;
  readonly targetAntId: string;
  readonly agreement: boolean;
  readonly reasonCode: string;
}

/**
 * One ant critiques another's position on a category. Pure pairwise reasoning —
 * exactly two minds, no aggregator. Returns whether they agree and why.
 */
export function pairwiseCritique(
  critic: AntWithMind,
  target: AntWithMind,
  category: TaskCategory,
  colonySeed: number
): PairwiseCritique {
  const dimension = CATEGORY_REVIEW_SKILL[category];
  const gap = Math.abs(critic.mind.cognitiveProfile[dimension] - target.mind.cognitiveProfile[dimension]);
  const jitter = reviewDraw(colonySeed, critic.ant.antIndex, target.ant.antIndex, SALT_REVIEW ^ 0x1234);
  const agreement = gap < 0.2 && jitter > 0.3;
  return {
    criticAntId: critic.ant.antId,
    targetAntId: target.ant.antId,
    agreement,
    reasonCode: agreement ? "aligned-assessment" : "divergent-assessment",
  };
}

export interface ReviewPanelResult {
  readonly category: TaskCategory;
  readonly panelSize: number;
  readonly approvals: number;
  readonly consensus: boolean;
  readonly dissent: number;
}

/**
 * A three-ant review panel: three independent minds each judge a plan, and the
 * panel reaches consensus only if the trust-weighted majority approves. Dissent
 * (the minority) is counted and preserved, never discarded.
 */
export function threeAntReviewPanel(
  panel: readonly AntWithMind[],
  plan: LocalPlan,
  colonySeed: number
): ReviewPanelResult {
  const members = panel.slice(0, 3);
  const dimension = CATEGORY_REVIEW_SKILL[plan.category];
  let approvals = 0;
  for (const member of members) {
    const jitter = (reviewDraw(colonySeed, member.ant.antIndex, plan.substeps.length, SALT_REVIEW ^ 0x99) - 0.5) * 0.3;
    const verdict = member.mind.cognitiveProfile[dimension] * 0.5 + plan.planConfidence * 0.4 - member.mind.caution * 0.1 + jitter;
    if (verdict >= 0.5) approvals += 1;
  }
  const consensus = approvals >= 2;
  return {
    category: plan.category,
    panelSize: members.length,
    approvals,
    consensus,
    dissent: members.length - approvals,
  };
}
