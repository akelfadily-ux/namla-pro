/**
 * digitalObjective — Tamara's strategic software objective and its demand
 * metabolism (Build Law §24, Digital Superorganism Operations V2).
 *
 * Tamara publishes ONE DigitalTechnologyObjective and constrains it (budgets,
 * caps, acceptance criteria). She may not name ants, assign tasks, select quorum
 * winners, bypass claims/reviews/tests/budgets, mint permits, or bypass human
 * confirmation — the reused Tamara authority record types every such power as the
 * literal `false`/`0`, so `tamaraDirectAntAssignments` stays 0 forever.
 *
 * The objective is then metabolized into bounded digital DEMANDS. Every demand
 * has a CAUSE — an objective requirement, an identified risk, a failed
 * verification, a review finding, a missing artifact, or an unmet acceptance
 * criterion — so there is no unexplained work demand.
 *
 * No fs, no child_process, no network, no wall clock.
 */

import { createTamaraAuthorityRecord } from "../federation/tamaraObjective";

export type DigitalRiskLevel = "low" | "moderate" | "high";
export type DigitalPriority = "low" | "normal" | "high" | "critical";

export interface DigitalTechnologyObjective {
  readonly objectiveId: string;
  readonly title: string;
  readonly desiredProduct: string;
  readonly functionalRequirements: readonly string[];
  readonly qualityRequirements: readonly string[];
  readonly securityRequirements: readonly string[];
  readonly constraints: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly technologyPreferences: readonly string[];
  readonly riskLevel: DigitalRiskLevel;
  readonly priority: DigitalPriority;
  readonly workspacePolicy: "in-memory-fake" | "dedicated-objective-workspace";
  readonly maximumTicks: number;
  readonly maximumRealProviderAnts: number;
  readonly maximumProviderCalls: number;
  readonly tokenBudget: number;
  readonly computeBudget: number;
  readonly monetaryBudget: number;
  readonly toolAccessPolicy: "allowlisted-scoped-revocable";
  readonly humanApprovalRequirements: readonly string[];
  readonly safeMetadata: Readonly<Record<string, string | number | boolean>>;
}

/** The 13 demand categories a software objective metabolizes into. */
export const DEMAND_CATEGORIES = [
  "raw-information",
  "research",
  "architecture",
  "planning",
  "frontend",
  "backend",
  "data",
  "testing",
  "security",
  "documentation",
  "integration",
  "review",
  "repair",
] as const;
export type DemandCategory = (typeof DEMAND_CATEGORIES)[number];

/** Why a demand exists. No unexplained work demand — every demand has a cause. */
export type DemandOriginKind =
  | "objective-requirement"
  | "identified-risk"
  | "failed-verification"
  | "review-finding"
  | "missing-artifact"
  | "unmet-acceptance-criterion";

export interface DigitalDemand {
  readonly demandId: string;
  readonly category: DemandCategory;
  readonly originKind: DemandOriginKind;
  readonly originRef: string; // the requirement/criterion/failure that caused it
  readonly priority: DigitalPriority;
  readonly contextEstimate: number;
  readonly computeEstimate: number;
  readonly satisfied: boolean;
}

export interface ObjectivePublication {
  readonly objective: DigitalTechnologyObjective;
  readonly tamaraObjectivesReceived: number;
  readonly tamaraDirectAntAssignments: 0;
  readonly tamaraMayPickWinner: false;
}

/**
 * Tamara publishes the objective. The authority record proves she holds no
 * worker authority; this function returns only the objective + counters and
 * never touches ant selection.
 */
export function publishObjective(objective: DigitalTechnologyObjective): ObjectivePublication {
  const authority = createTamaraAuthorityRecord();
  // Defense-in-depth: the record's forbidden powers are literal false/0.
  void authority.directAntAssignmentAuthority;
  void authority.quorumSelectionAuthority;
  return {
    objective,
    tamaraObjectivesReceived: 1,
    tamaraDirectAntAssignments: 0,
    tamaraMayPickWinner: false,
  };
}

/**
 * Metabolize the objective into initial bounded demands. Each demand is tied to
 * a concrete objective element (requirement / criterion), so its cause is
 * explicit. Later demands (repair/review) are created from real failures and
 * review findings during the run, not here.
 */
export function deriveInitialDemands(objective: DigitalTechnologyObjective): DigitalDemand[] {
  const demands: DigitalDemand[] = [];
  let seq = 0;
  const add = (category: DemandCategory, originKind: DemandOriginKind, originRef: string, priority: DigitalPriority, ctx: number, cmp: number) => {
    demands.push({
      demandId: `demand-${objective.objectiveId}-${seq++}`,
      category,
      originKind,
      originRef,
      priority,
      contextEstimate: ctx,
      computeEstimate: cmp,
      satisfied: false,
    });
  };

  // Discovery + planning demands come from the objective itself.
  add("raw-information", "objective-requirement", `${objective.objectiveId}:desiredProduct`, "high", 1.5, 0.5);
  add("research", "objective-requirement", `${objective.objectiveId}:desiredProduct`, "normal", 1, 0.6);
  add("architecture", "objective-requirement", `${objective.objectiveId}:desiredProduct`, "high", 1.2, 0.8);
  add("planning", "objective-requirement", `${objective.objectiveId}:desiredProduct`, "high", 1, 0.6);

  // Functional requirements -> frontend/backend/data build demands.
  objective.functionalRequirements.forEach((req, i) => {
    const category: DemandCategory = /list|add|complete|delete|ui|view/i.test(req) ? "frontend" : /persist|store|database|data/i.test(req) ? "data" : "backend";
    add(category, "objective-requirement", `func:${i}`, "high", 1.1, 0.9);
  });

  // Quality requirements -> testing + documentation + review.
  objective.qualityRequirements.forEach((q, i) => {
    const category: DemandCategory = /test/i.test(q) ? "testing" : /doc|readme/i.test(q) ? "documentation" : "review";
    add(category, "objective-requirement", `qual:${i}`, "normal", 0.9, 0.7);
  });

  // Security requirements -> security demands.
  objective.securityRequirements.forEach((s, i) => add("security", "objective-requirement", `sec:${i}`, "high", 0.9, 0.6));

  // Acceptance criteria -> integration + a testing demand each.
  objective.acceptanceCriteria.forEach((c, i) => add("integration", "unmet-acceptance-criterion", `accept:${i}`, "high", 1, 0.8));

  return demands;
}

/** Create a follow-on demand caused by a real failure or review finding. */
export function createCausalDemand(objectiveId: string, seq: number, category: DemandCategory, originKind: DemandOriginKind, originRef: string, priority: DigitalPriority): DigitalDemand {
  return {
    demandId: `demand-${objectiveId}-x${seq}`,
    category,
    originKind,
    originRef,
    priority,
    contextEstimate: 0.9,
    computeEstimate: 0.7,
    satisfied: false,
  };
}
