/**
 * digitalOperationsReport — aggregates a Digital Operations V2 run into reported
 * metrics, validates conservation + causality, and projects the safe command
 * center (Build Law §24). Every reported number is a ledger difference or an
 * event count; the causal invariants would fail for a counter-only demo.
 *
 * No fs, no child_process, no network, no wall clock.
 */

import { roundTo } from "../colony/colonyTypes";
import type { DigitalOperationsResult } from "./digitalOperationsRunner";

export interface OpsCausalCheck {
  readonly id: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface CommandCenterProjection {
  readonly objectiveStatus: string;
  readonly activeDemands: number;
  readonly voluntaryClaims: number;
  readonly acceptedWorkers: number;
  readonly cognitiveSlotsPeak: number;
  readonly providerCalls: number;
  readonly proposals: number;
  readonly quorumReached: boolean;
  readonly artifactsProposed: number;
  readonly reviews: number;
  readonly verificationRuns: number;
  readonly failures: number;
  readonly repairRounds: number;
  readonly technicalDebt: number;
  readonly wasteRecycled: number;
  readonly securityQuarantines: number;
  readonly workspaceFiles: number;
  readonly academyEvidence: number;
  readonly finalAcceptance: boolean;
}

export interface DigitalOperationsReport {
  // conservation
  readonly digitalResourceConservationValid: boolean;
  readonly unexplainedResourceCreation: number;
  readonly resourceChecks: readonly { resource: string; closed: boolean }[];

  // ledger-sourced flows
  readonly workingContextConsumed: number;
  readonly computeConsumed: number;
  readonly tokenBudgetConsumed: number;
  readonly monetaryBudgetConsumed: number;
  readonly errorWasteCreated: number;
  readonly technicalDebtTracked: number;

  // workspace
  readonly workspaceBoundaryViolations: number;
  readonly realFilesystemWrites: number;
  readonly workspaceFiles: number;

  // causality
  readonly causalChecks: readonly OpsCausalCheck[];
  readonly causalityViolations: number;

  readonly commandCenter: CommandCenterProjection;
}

export function buildDigitalOperationsReport(run: DigitalOperationsResult): DigitalOperationsReport {
  const { economy, workspace, metrics: m, artifacts, reviews, demands, academyEvidence } = run;
  const conservation = economy.validate();
  const log = economy.transformationLog;
  const consumedOf = (r: Parameters<typeof economy.totals>[0]) => roundTo(economy.totals(r).consumed, 6);
  const createdOf = (r: Parameters<typeof economy.totals>[0]) => roundTo(economy.totals(r).created, 6);

  const demandIds = new Set(demands.map((d) => d.demandId));
  const checks: OpsCausalCheck[] = [];
  const add = (id: string, passed: boolean, detail: string) => checks.push({ id, passed, detail });

  add("no-task-without-demand", artifacts.every((a) => demandIds.has(a.demandId)), `artifacts=${artifacts.length}`);
  add("no-accepted-without-voluntary", m.acceptedTaskClaims <= m.voluntaryTaskClaims && m.nonVolunteerAssignments === 0, `accepted=${m.acceptedTaskClaims}, voluntary=${m.voluntaryTaskClaims}`);
  const buildReceipts = log.filter((r) => r.kind === "build" && r.outputs.some((o) => o.resource === "reusableComponents"));
  add(
    "no-artifact-without-resources",
    buildReceipts.every((r) => r.inputs.some((i) => i.resource === "verifiedKnowledge") && r.inputs.some((i) => i.resource === "computeCapacity") && r.inputs.some((i) => i.resource === "tokenBudget") && r.inputs.some((i) => i.resource === "workingContext")),
    `buildReceipts=${buildReceipts.length}`
  );
  add("no-applied-without-review", m.filesApplied <= m.artifactsReviewed, `applied=${m.filesApplied}, reviewed=${m.artifactsReviewed}`);
  add("no-success-without-test-evidence", !m.finalObjectivePassed || createdOf("testEvidence") > 0, `finalPassed=${m.finalObjectivePassed}, testEvidence=${createdOf("testEvidence")}`);
  add("no-repair-without-failure", m.repairRounds === 0 || m.verificationFailures > 0, `repairs=${m.repairRounds}, failures=${m.verificationFailures}`);
  const verifyReceipts = log.filter((r) => r.kind === "verify" && r.outputs.some((o) => o.resource === "verifiedKnowledge"));
  add("no-knowledge-without-source", verifyReceipts.every((r) => r.inputs.some((i) => i.resource === "rawInformation")), `verifyReceipts=${verifyReceipts.length}`);
  add("evidence-backed-by-work", m.academyEvidenceUpdates <= artifacts.length && academyEvidence.every((e) => e.strength <= 0.5), `evidence=${m.academyEvidenceUpdates}`);
  add("no-real-provider-calls", m.realClaudeCalls === 0 && m.realCodexCalls === 0 && m.realProviderProcessExecutions === 0 && m.realNetworkCalls === 0, "all real 0");
  add("no-self-review", reviews.every((rv) => artifacts.find((a) => a.proposalId === rv.proposalId)?.antId !== rv.reviewerAntId), `reviews=${reviews.length}`);
  add("bounded-cognitive", m.peakCognitiveWorkers <= 5, `peak=${m.peakCognitiveWorkers}`);
  add("workspace-bounded", workspace.workspaceBoundaryViolations === 0 && workspace.realFilesystemWrites === 0, `violations=${workspace.workspaceBoundaryViolations}`);
  add("decentralized", m.centralTaskAssignments === 0 && m.queenTaskAssignments === 0 && m.tamaraDirectAntAssignments === 0 && m.globalPlannerDecisions === 0, "all zero");
  add("conservation-closed", conservation.allClosed, `unexplained=${conservation.unexplainedResourceCreation}`);

  const causalityViolations = checks.filter((c) => !c.passed).length;

  const commandCenter: CommandCenterProjection = {
    objectiveStatus: m.finalObjectivePassed ? "delivered" : "incomplete",
    activeDemands: demands.length,
    voluntaryClaims: m.voluntaryTaskClaims,
    acceptedWorkers: m.acceptedTaskClaims,
    cognitiveSlotsPeak: m.peakCognitiveWorkers,
    providerCalls: m.deterministicProviderCalls,
    proposals: m.scoutProposalCount,
    quorumReached: m.quorumReached,
    artifactsProposed: m.artifactProposals,
    reviews: m.artifactsReviewed,
    verificationRuns: m.verificationRuns,
    failures: m.verificationFailures,
    repairRounds: m.repairRounds,
    technicalDebt: createdOf("technicalDebt"),
    wasteRecycled: m.wasteRecycled,
    securityQuarantines: m.securityQuarantines,
    workspaceFiles: workspace.fileCount,
    academyEvidence: m.academyEvidenceUpdates,
    finalAcceptance: m.finalObjectivePassed,
  };

  return {
    digitalResourceConservationValid: conservation.allClosed,
    unexplainedResourceCreation: conservation.unexplainedResourceCreation,
    resourceChecks: conservation.checks.map((c) => ({ resource: c.resource, closed: c.closed })),

    workingContextConsumed: consumedOf("workingContext"),
    computeConsumed: consumedOf("computeCapacity"),
    tokenBudgetConsumed: consumedOf("tokenBudget"),
    monetaryBudgetConsumed: consumedOf("monetaryBudget"),
    errorWasteCreated: createdOf("errorWaste"),
    technicalDebtTracked: createdOf("technicalDebt"),

    workspaceBoundaryViolations: workspace.workspaceBoundaryViolations,
    realFilesystemWrites: workspace.realFilesystemWrites,
    workspaceFiles: workspace.fileCount,

    causalChecks: checks,
    causalityViolations,
    commandCenter,
  };
}
