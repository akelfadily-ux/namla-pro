/**
 * civilizationLiveReport — the safe command-center projection + conservation and
 * safety validation for a live civilization run (Build Law §28). Summaries only:
 * no raw private AntMind, no provider credentials, no raw environment, no
 * unrestricted provider/MCP output.
 *
 * No fs, no child_process, no network, no wall clock.
 */

import { roundTo } from "../colony/colonyTypes";
import { DISTRICTS } from "./settlementTypes";
import type { CivLiveResult } from "./civilizationLiveRunner";
import { CIV_MAX_COHORT, CIV_MAX_PROVIDER_CALLS } from "../cognitive/civilizationLivePermit";
import type { CivilizationLivePermit } from "../cognitive/civilizationLivePermit";

export interface CivLiveSafetyCheck {
  readonly id: string;
  readonly passed: boolean;
  readonly detail: string;
  /** Pipeline stage the check guards (safe scalar). */
  readonly stage: string;
  /** Violation category (safe scalar). */
  readonly category: string;
}

export interface CivLiveCommandCenter {
  readonly liveRunId: string;
  readonly runStatus: string;
  readonly nationalObjective: string;
  readonly districtDemand: number;
  readonly liveCohort: readonly { antId: string; district: string; provider: string; role: string }[];
  readonly providerCalls: number;
  readonly providerFailures: number;
  readonly mcpGrants: number;
  readonly mcpSessions: number;
  readonly mcpFailures: number;
  readonly councils: number;
  readonly quorumReached: boolean;
  readonly minorityReports: number;
  readonly artifacts: number;
  readonly reviews: number;
  readonly verificationRuns: number;
  readonly incidents: number;
  readonly repairs: number;
  readonly technicalDebt: number;
  readonly knowledgeAccepted: number;
  readonly academyEvidence: number;
  readonly mcpCost: number;
  readonly workspaceFiles: number;
  readonly finalOutcome: string;
  readonly humanAuthorizationState: string;
}

export interface CivLiveReport {
  readonly digitalResourceConservationValid: boolean;
  readonly unexplainedResourceCreation: number;
  readonly safetyChecks: readonly CivLiveSafetyCheck[];
  readonly safetyViolations: number;
  /** Safe violation visibility — ids/stages/categories only, never prompts/creds/output. */
  readonly safetyViolationCodes: readonly string[];
  readonly safetyViolationStages: readonly string[];
  readonly safetyViolationCategories: readonly string[];
  readonly commandCenter: CivLiveCommandCenter;
}

export function buildCivLiveReport(result: CivLiveResult, permit: CivilizationLivePermit): CivLiveReport {
  const { economy, metrics: m, mcp, admission } = result;
  const conservation = economy.validate();
  const acceptedIds = new Set(admission.accepted.map((a) => a.antId));
  const poolIds = new Set(admission.pool.map((c) => c.antId));

  const checks: CivLiveSafetyCheck[] = [];
  const add = (id: string, passed: boolean, detail: string, stage: string, category: string) => checks.push({ id, passed, detail, stage, category });

  add("live-cohort-<=5", m.acceptedLiveCohortSize <= CIV_MAX_COHORT && m.acceptedLiveCohortSize >= 1, `cohort=${m.acceptedLiveCohortSize}`, "admission", "boundedness");
  add("provider-call-cap-8", permit.maxProviderCalls <= CIV_MAX_PROVIDER_CALLS, `cap=${permit.maxProviderCalls}`, "provider", "boundedness");
  add("cohort-subset-of-volunteers", [...acceptedIds].every((a) => poolIds.has(a)) && m.nonVolunteerAssignments === 0, "accepted⊆pool", "admission", "decentralization");
  add("no-central-assignment", m.centralTaskAssignments === 0 && m.queenTaskAssignments === 0 && m.tamaraDirectAntAssignments === 0 && m.globalPlannerDecisions === 0, "all 0", "admission", "decentralization");
  add("no-self-review", m.selfReviewsAccepted === 0, `selfReviews=${m.selfReviewsAccepted}`, "review", "causality");
  add("bounded-cognitive", m.peakCognitiveAnts <= 30, `peak=${m.peakCognitiveAnts}`, "cognition", "boundedness");
  add("mcp-calls-receipted", mcp.sessionReceipts.length >= m.mcpToolCalls, `receipts=${mcp.sessionReceipts.length}`, "mcp", "causality");
  // Real-action checks are MODE-AWARE: an automated (fake-driver) run must show
  // ZERO real action; a human-confirmed live run legitimately executes real
  // bounded action — there the violation is exceeding the permit's caps, not the
  // existence of real work. (The first real run was mislabeled with 2 violations
  // by the automated-mode checks; this is the fix.)
  if (permit.humanConfirmed) {
    add("real-provider-within-cap", m.realProviderProcessExecutions <= permit.maxProviderCalls, `real=${m.realProviderProcessExecutions} cap=${permit.maxProviderCalls}`, "provider", "boundedness");
    add("real-mcp-within-cap", m.realMcpExecutions <= permit.maxMcpCalls, `real=${m.realMcpExecutions} cap=${permit.maxMcpCalls}`, "mcp", "boundedness");
    add("real-fs-within-cap", m.realNetworkCalls === 0 && m.realFilesystemWrites <= permit.workspaceFileCap * 2, `net=0 fs=${m.realFilesystemWrites}`, "network-fs", "boundedness");
  } else {
    add("no-real-provider-process", m.realProviderProcessExecutions === 0 && m.realProviderCalls === 0, "provider real 0", "provider", "real-action");
    add("no-real-mcp", m.realMcpExecutions === 0, `mcp real=${m.realMcpExecutions}`, "mcp", "real-action");
    add("no-real-network-fs", m.realNetworkCalls === 0 && m.realFilesystemWrites === 0, "net/fs 0", "network-fs", "real-action");
  }
  add("no-provider-budget-violation", m.providerBudgetViolations === 0, `violations=${m.providerBudgetViolations}`, "budget", "boundedness");
  add("conservation-closed", conservation.allClosed, `unexplained=${conservation.unexplainedResourceCreation}`, "conservation", "conservation");
  add("incident-from-failure", m.incidentsCreated === 0 || m.providerFailures + m.mcpToolFailures + m.verificationFailures + m.securityFindings + m.normalizationFailures + m.verificationBlockedRuns > 0, `incidents=${m.incidentsCreated}`, "incident", "causality");
  add("verification-not-vacuous", m.verificationRuns === 0 || m.artifactsCreated > 0, `runs=${m.verificationRuns} artifacts=${m.artifactsCreated}`, "verification", "causality");

  const failed = checks.filter((c) => !c.passed);
  const safetyViolations = failed.length;

  const districtDemand = DISTRICTS.reduce((s, id) => s + result.districts[id].openDemands, 0);
  const commandCenter: CivLiveCommandCenter = {
    liveRunId: permit.civilizationRunId,
    runStatus: m.finalObjectivePassed ? "delivered" : result.ok ? "incomplete" : "aborted",
    nationalObjective: permit.objectiveId,
    districtDemand,
    liveCohort: admission.accepted.map((a) => ({ antId: a.antId, district: a.districtId, provider: a.provider, role: a.role })),
    providerCalls: m.providerCalls,
    providerFailures: m.providerFailures,
    mcpGrants: m.mcpToolGrants,
    mcpSessions: mcp.sessionReceipts.length,
    mcpFailures: m.mcpToolFailures,
    councils: m.councilsActivated,
    quorumReached: m.quorumReached,
    minorityReports: m.minorityReports,
    artifacts: m.artifactsCreated,
    reviews: m.independentReviews,
    verificationRuns: m.verificationRuns,
    incidents: m.incidentsCreated,
    repairs: m.repairsCompleted,
    technicalDebt: m.technicalDebtTracked,
    knowledgeAccepted: m.knowledgeAccepted,
    academyEvidence: m.academyEvidenceUpdates,
    mcpCost: roundTo(mcp.costCharged, 6),
    workspaceFiles: result.workspaceFileCount,
    finalOutcome: m.finalObjectivePassed ? "passed" : "not-passed",
    humanAuthorizationState: permit.humanConfirmed ? "human-confirmed" : "automated-test",
  };

  return {
    digitalResourceConservationValid: conservation.allClosed,
    unexplainedResourceCreation: conservation.unexplainedResourceCreation,
    safetyChecks: checks,
    safetyViolations,
    safetyViolationCodes: failed.map((c) => c.id),
    safetyViolationStages: [...new Set(failed.map((c) => c.stage))],
    safetyViolationCategories: [...new Set(failed.map((c) => c.category))],
    commandCenter,
  };
}
