/**
 * tamaraCommandCenterV3 — Tamara's safe operational projection of the sovereign
 * federation (Phase 5). Every field is an AGGREGATE derived from real runtime
 * state (state machine receipts, admission, metrics, health snapshots, learning
 * loop) — no decorative counters. Alerts fire only from actual conditions.
 *
 * Never exposed: credentials, raw prompts, private AntMind content, full
 * provider output, environment variables, unrestricted file content, hidden
 * reasoning. Tamara can pause, reject, or request evidence from this view —
 * she cannot select workers from it (there is no selection API here at all).
 *
 * No fs, no child_process, no network, no wall clock.
 */

import type { FederationRunResult } from "./tamaraNamlaFederationV3";
import type { LearningLoopResult } from "../academy/civilizationLearningLoop";
import type { CapabilityFabric } from "../civilization/capabilityFabric";
import { roundTo } from "../colony/colonyTypes";

export type TamaraAlertId =
  | "capability-gap"
  | "no-builder"
  | "no-independent-reviewer"
  | "empty-artifact-set"
  | "provider-degraded"
  | "mcp-degraded"
  | "verification-blocked"
  | "budget-near-limit"
  | "stale-workspace"
  | "unresolved-security-finding"
  | "repair-awaiting-human"
  | "objective-rejected";

export interface TamaraAlert {
  readonly id: TamaraAlertId;
  readonly detail: string;
}

export interface TamaraCommandCenterV3 {
  readonly objectiveId: string;
  readonly objectiveState: string;
  readonly transitionReceipts: number;
  readonly strategyProposals: number;
  readonly quorumReached: boolean;
  readonly minorityReports: number;
  readonly districtsActivated: number;
  readonly districtDemands: number;
  readonly voluntaryClaims: number;
  readonly acceptedTeamSize: number;
  readonly architectureCoverage: boolean;
  readonly implementationCoverage: boolean;
  readonly independentReviewCoverage: boolean;
  readonly capabilityRegistrySize: number;
  readonly capabilityFamiliesCovered: number;
  readonly activeCapabilityGrants: number;
  readonly cognitiveSlotsUsed: number;
  readonly providerAssignments: readonly { antId: string; provider: string; role: string }[];
  readonly providerCalls: number;
  readonly providerFailures: number;
  readonly providerHealth: Readonly<Record<string, { calls: number; failures: number; healthScore: number }>>;
  readonly mcpGrants: number;
  readonly mcpSessions: number;
  readonly mcpFailures: number;
  readonly workspaceFiles: number;
  readonly artifactsProposed: number;
  readonly artifactsApplied: number;
  readonly independentReviews: number;
  readonly councilDecisions: number;
  readonly verificationRuns: number;
  readonly verificationFailures: number;
  readonly incidents: number;
  readonly repairDemands: number;
  readonly repairsCompleted: number;
  readonly technicalDebt: number;
  readonly wasteRecycled: number;
  readonly knowledgeUpdates: number;
  readonly academyActivity: number;
  readonly skillPassportChanges: number;
  readonly resourceConsumptionValid: boolean;
  readonly stopConditions: readonly string[];
  readonly humanAuthorizationState: string;
  readonly finalEvidencePresent: boolean;
  readonly tamaraDecision: string;
  readonly alerts: readonly TamaraAlert[];
}

export function buildTamaraCommandCenterV3(input: { readonly federation: FederationRunResult; readonly learning: LearningLoopResult | null; readonly fabric: CapabilityFabric; readonly humanAuthorizationState: string }): TamaraCommandCenterV3 {
  const f = input.federation;
  const m = f.civResult?.metrics ?? null;
  const alerts: TamaraAlert[] = [];
  const add = (id: TamaraAlertId, detail: string) => alerts.push({ id, detail });

  if (f.civResult) {
    const cm = f.civResult.metrics;
    if (!cm.architectureCoverage || !cm.implementationCoverage || !cm.independentReviewCoverage) add("capability-gap", "cohort coverage incomplete");
    if (!cm.implementationCoverage) add("no-builder", "no implementation-capable volunteer admitted");
    if (!cm.independentReviewCoverage) add("no-independent-reviewer", "no review-capable volunteer admitted");
    if (cm.artifactsCreated === 0) add("empty-artifact-set", "zero artifacts survived review");
    if (cm.verificationBlockedRuns > 0) add("verification-blocked", `blocked ${cm.verificationBlockedRuns}x on empty workspace`);
    if (cm.providerFailures > cm.providerCalls / 2 && cm.providerCalls > 0) add("provider-degraded", `${cm.providerFailures}/${cm.providerCalls} provider calls failed`);
    if (cm.mcpToolFailures > cm.mcpToolCalls / 2 && cm.mcpToolCalls > 0) add("mcp-degraded", `${cm.mcpToolFailures}/${cm.mcpToolCalls} MCP calls failed`);
    if (cm.securityFindings > cm.repairsCompleted) add("unresolved-security-finding", `${cm.securityFindings} findings vs ${cm.repairsCompleted} repairs`);
    if (f.civResult.failureCategories.includes("no-build-artifacts") && cm.repairCalls === 0) add("repair-awaiting-human", "repair demand published; awaiting RUN ONE CIVILIZATION REPAIR ANT");
  }
  if (f.tamaraDecision === "rejected") add("objective-rejected", f.tamaraDecisionReason);
  const budgetUsed = m ? m.providerCalls / Math.max(1, f.civResult ? 8 : 8) : 0;
  if (budgetUsed >= 0.75) add("budget-near-limit", `provider-call budget ${roundTo(budgetUsed * 100, 0)}% used`);

  return {
    objectiveId: f.evidence?.objectiveId ?? "none",
    objectiveState: f.stateMachine.state,
    transitionReceipts: f.stateMachine.transitionReceipts.length,
    strategyProposals: f.proposals.length,
    quorumReached: f.decision?.quorumReached ?? false,
    minorityReports: f.decision?.minorityReports ?? 0,
    districtsActivated: f.districtsActivated,
    districtDemands: f.districtDemands,
    voluntaryClaims: f.civResult?.admission.voluntaryLiveClaims ?? 0,
    acceptedTeamSize: f.civResult?.admission.acceptedLiveCohortSize ?? 0,
    architectureCoverage: m?.architectureCoverage ?? false,
    implementationCoverage: m?.implementationCoverage ?? false,
    independentReviewCoverage: m?.independentReviewCoverage ?? false,
    capabilityRegistrySize: input.fabric.registrySize,
    capabilityFamiliesCovered: input.fabric.familiesCovered,
    activeCapabilityGrants: input.fabric.activeGrantCount,
    cognitiveSlotsUsed: m?.peakCognitiveAnts ?? 0,
    providerAssignments: f.civResult?.admission.accepted.map((a) => ({ antId: a.antId, provider: a.provider, role: a.role })) ?? [],
    providerCalls: m?.providerCalls ?? 0,
    providerFailures: m?.providerFailures ?? 0,
    providerHealth: Object.fromEntries(Object.entries(f.civResult?.providerHealth ?? {}).map(([k, v]) => [k, { calls: v.calls, failures: v.failures, healthScore: v.healthScore }])),
    mcpGrants: m?.mcpToolGrants ?? 0,
    mcpSessions: f.civResult?.mcp.sessionReceipts.length ?? 0,
    mcpFailures: m?.mcpToolFailures ?? 0,
    workspaceFiles: f.civResult?.workspaceFileCount ?? 0,
    artifactsProposed: (m?.artifactsCreated ?? 0) + (m?.normalizationFailures ?? 0),
    artifactsApplied: m?.artifactsCreated ?? 0,
    independentReviews: m?.independentReviews ?? 0,
    councilDecisions: (m?.councilsActivated ?? 0) + (f.strategyCouncil ? 1 : 0),
    verificationRuns: m?.verificationRuns ?? 0,
    verificationFailures: m?.verificationFailures ?? 0,
    incidents: m?.incidentsCreated ?? 0,
    repairDemands: f.civResult ? f.civResult.districts["debugging-repair"].openDemands : 0,
    repairsCompleted: m?.repairsCompleted ?? 0,
    technicalDebt: m?.technicalDebtTracked ?? 0,
    wasteRecycled: m?.wasteRecycled ?? 0,
    knowledgeUpdates: (m?.knowledgeAccepted ?? 0) + (input.learning?.lessonsAccepted ?? 0),
    academyActivity: (m?.academyEvidenceUpdates ?? 0) + (input.learning?.examsAdministered ?? 0),
    skillPassportChanges: input.learning?.skillPassportUpdates ?? 0,
    resourceConsumptionValid: f.civReport?.digitalResourceConservationValid ?? false,
    stopConditions: f.evidence ? [] : ["objective-not-executed"],
    humanAuthorizationState: input.humanAuthorizationState,
    finalEvidencePresent: f.evidence !== null,
    tamaraDecision: f.tamaraDecision,
    alerts,
  };
}
