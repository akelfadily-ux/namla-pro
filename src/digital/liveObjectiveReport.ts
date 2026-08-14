/**
 * liveObjectiveReport — safe command-center projection + safety-invariant checks
 * for the three-ant live objective (Build Law §25). Exposes summaries only: no
 * raw private AntMind, no provider credentials, no raw environment, no
 * unrestricted provider output.
 *
 * No fs, no child_process, no network, no wall clock.
 */

import type { CohortAdmission } from "./liveCohort";
import type { LiveObjectiveRunResult } from "./liveObjectiveRunner";
import type { LiveObjectivePermit } from "../cognitive/liveObjectivePermit";
import { LIVE_COHORT_SIZE, LIVE_MAX_INITIAL_CALLS, LIVE_MAX_PROVIDER_CALLS, LIVE_MAX_REPAIR_CALLS, callBudgetUsed } from "../cognitive/liveObjectivePermit";

export interface LiveSafetyCheck {
  readonly id: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface LiveCommandCenter {
  readonly liveObjectiveId: string;
  readonly liveStatus: string;
  readonly voluntaryClaimPool: number;
  readonly acceptedCohort: number;
  readonly providerAssignments: readonly { antId: string; provider: string }[];
  readonly providerCalls: number;
  readonly providerFailures: number;
  readonly normalizedResults: number;
  readonly pendingReviews: number;
  readonly approvedArtifacts: number;
  readonly rejectedArtifacts: number;
  readonly workspaceFiles: number;
  readonly verificationCommands: readonly string[];
  readonly verificationRuns: number;
  readonly verificationFailures: number;
  readonly repairConfirmations: number;
  readonly repairRounds: number;
  readonly technicalDebt: number;
  readonly waste: number;
  readonly finalOutcome: string;
  readonly humanAuthorizationState: string;
}

export interface LiveObjectiveReport {
  readonly commandCenter: LiveCommandCenter;
  readonly safetyChecks: readonly LiveSafetyCheck[];
  readonly safetyViolations: number;
}

export function buildLiveObjectiveReport(run: LiveObjectiveRunResult, admission: CohortAdmission, permit: LiveObjectivePermit): LiveObjectiveReport {
  const m = run.metrics;
  const used = callBudgetUsed(permit);
  const acceptedAntIds = new Set(admission.accepted.map((a) => a.antId));
  const poolAntIds = new Set(admission.pool.map((c) => c.antId));
  const approved = run.artifacts.filter((a) => a.approved).length;

  const checks: LiveSafetyCheck[] = [];
  const add = (id: string, passed: boolean, detail: string) => checks.push({ id, passed, detail });

  add("cohort-size-exactly-3", admission.acceptedLiveCohortSize === LIVE_COHORT_SIZE && permit.cohort.length === LIVE_COHORT_SIZE, `accepted=${admission.acceptedLiveCohortSize}`);
  add("provider-call-cap-5", permit.maxProviderCalls <= LIVE_MAX_PROVIDER_CALLS, `cap=${permit.maxProviderCalls}`);
  add("initial-calls-<=3", used.initial <= LIVE_MAX_INITIAL_CALLS && m.providerCallsStarted <= LIVE_MAX_INITIAL_CALLS, `initial=${used.initial}`);
  add("repair-calls-<=2", used.repair <= LIVE_MAX_REPAIR_CALLS && m.repairCalls <= LIVE_MAX_REPAIR_CALLS, `repair=${used.repair}`);
  add("cohort-subset-of-volunteers", [...acceptedAntIds].every((a) => poolAntIds.has(a)), `accepted⊆pool`);
  add("no-tamara-queen-central-selection", admission.nonVolunteerAssignments === 0, "nonVolunteer=0");
  add("no-self-review-accepted", m.selfReviewsAccepted === 0, `selfReviews=${m.selfReviewsAccepted}`);
  add("workspace-root-fixed", run.workspace.workspaceRoot.startsWith("workspaces/digital-live-objective/"), run.workspace.workspaceRoot);
  add("no-source-tree-writes", m.sourceTreeWrites === 0 && m.workspaceBoundaryViolations === 0, `srcWrites=${m.sourceTreeWrites}`);
  add("no-real-provider-process", m.realProviderProcessExecutions === 0 && m.realClaudeCalls === 0 && m.realCodexCalls === 0, "real provider 0");
  // An unobserved network is NOT a passing check: `null` must not satisfy an
  // assertion that claims zero real network activity was proven.
  add("no-real-network", m.realNetworkCalls === 0, m.realNetworkCalls === null ? "net=unknown (not observed)" : `net=${m.realNetworkCalls}`);
  add("no-real-fs-writes", m.realFilesystemWrites === 0, `fsWrites=${m.realFilesystemWrites}`);
  add("provider-budget-not-exceeded", m.providerBudgetViolations === 0, `violations=${m.providerBudgetViolations}`);
  add("every-applied-artifact-reviewed", run.artifacts.filter((a) => a.approved).every((a) => a.reviewedBy.length >= (a.highRisk ? 2 : 1)), `approved=${approved}`);

  const safetyViolations = checks.filter((c) => !c.passed).length;

  const commandCenter: LiveCommandCenter = {
    liveObjectiveId: permit.objectiveId,
    liveStatus: m.finalObjectivePassed ? "delivered" : run.ok ? "incomplete" : "aborted",
    voluntaryClaimPool: admission.voluntaryLiveClaims,
    acceptedCohort: admission.acceptedLiveCohortSize,
    providerAssignments: permit.cohort.map((c) => ({ antId: c.antId, provider: c.provider })),
    providerCalls: m.providerCallsStarted,
    providerFailures: m.providerCallsFailed,
    normalizedResults: m.normalizedProviderResults,
    pendingReviews: run.artifacts.filter((a) => !a.approved).length,
    approvedArtifacts: approved,
    rejectedArtifacts: run.artifacts.length - approved,
    workspaceFiles: run.workspace.fileCount,
    verificationCommands: permit.allowedVerificationCommands,
    verificationRuns: m.verificationRuns,
    verificationFailures: m.verificationFailures,
    repairConfirmations: m.repairCalls,
    repairRounds: m.repairRounds,
    technicalDebt: m.technicalDebtTracked,
    waste: m.errorWasteCreated,
    finalOutcome: m.finalObjectivePassed ? "passed" : "not-passed",
    humanAuthorizationState: permit.humanConfirmed ? "human-confirmed" : "automated-test",
  };

  return { commandCenter, safetyChecks: checks, safetyViolations };
}
