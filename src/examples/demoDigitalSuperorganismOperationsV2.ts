/**
 * demoDigitalSuperorganismOperationsV2 — the deterministic proof that Tamara's
 * software objective becomes reviewed, tested, repaired software through a
 * conserving decentralized ant economy (Build Law §24).
 *
 * 300 persistent identities (1 queen + 299 workers), deterministic cognitive
 * workers, fake workspace + verification drivers, ZERO real provider / process /
 * network / filesystem action. The objective is a small full-stack
 * task-management app. Every asserted number DERIVES from runtime events and
 * ledger state — none is hard-coded — and `allExpectationsMet` + an empty
 * `mismatchCaseIds` are the demo's own self-check.
 *
 * No fs, no child_process, no network, no wall clock. Deterministic by seed.
 */

import { runDigitalOperations } from "../digital/digitalOperationsRunner";
import { buildDigitalOperationsReport } from "../digital/digitalOperationsReport";
import type { DigitalTechnologyObjective } from "../digital/digitalObjective";

const DEMO_SEED = 20260801;

function taskManagerObjective(): DigitalTechnologyObjective {
  return {
    objectiveId: "taskmgr-fullstack-v2",
    title: "Full-stack task manager",
    desiredProduct: "A small full-stack task-management application",
    functionalRequirements: ["task list view", "add task", "complete task", "delete task", "backend service abstraction", "local persistence abstraction"],
    qualityRequirements: ["unit tests for task operations", "README documentation", "build and typecheck evidence"],
    securityRequirements: ["validate task input", "store no secrets in the workspace"],
    constraints: ["typescript only", "no network calls in the app", "bounded workspace"],
    acceptanceCriteria: ["all task CRUD operations work", "tests pass", "typecheck is clean"],
    technologyPreferences: ["typescript", "react"],
    riskLevel: "moderate",
    priority: "high",
    workspacePolicy: "in-memory-fake",
    maximumTicks: 200,
    maximumRealProviderAnts: 5,
    maximumProviderCalls: 5,
    tokenBudget: 400,
    computeBudget: 300,
    monetaryBudget: 50,
    toolAccessPolicy: "allowlisted-scoped-revocable",
    humanApprovalRequirements: ["real-provider-activation", "real-disk-workspace", "real-verification-execution"],
    safeMetadata: { domain: "productivity", surface: "web" },
  };
}

function evaluate(m: ReturnType<typeof runDigitalOperations>["metrics"], r: ReturnType<typeof buildDigitalOperationsReport>) {
  const specs: Array<[string, boolean]> = [
    ["totalPersistentAnts==300", m.totalPersistentAnts === 300],
    ["queenIdentities==1", m.queenIdentities === 1],
    ["workerIdentities==299", m.workerIdentities === 299],
    ["tamaraObjectivesReceived==1", m.tamaraObjectivesReceived === 1],
    ["rawInformationCollected>0", m.rawInformationCollected > 0],
    ["verifiedKnowledgeCreated>0", m.verifiedKnowledgeCreated > 0],
    ["scoutProposalCount>=3", m.scoutProposalCount >= 3],
    ["quorumReached", m.quorumReached === true],
    ["rejectedProposalCount>=2", m.rejectedProposalCount >= 2],
    ["voluntaryTaskClaims>0", m.voluntaryTaskClaims > 0],
    ["acceptedTaskClaims>0", m.acceptedTaskClaims > 0],
    ["nonVolunteerAssignments==0", m.nonVolunteerAssignments === 0],
    ["activeWorkingHands>0", m.activeWorkingHands > 0],
    ["peakCognitiveWorkers<=5", m.peakCognitiveWorkers <= 5],
    ["toolAccessGrants>0", m.toolAccessGrants > 0],
    ["workingContextConsumed>0", r.workingContextConsumed > 0],
    ["computeConsumed>0", r.computeConsumed > 0],
    ["tokenBudgetConsumed>0", r.tokenBudgetConsumed > 0],
    ["artifactProposals>0", m.artifactProposals > 0],
    ["artifactsReviewed>0", m.artifactsReviewed > 0],
    ["filesApplied>0", m.filesApplied > 0],
    ["verificationRuns>=2", m.verificationRuns >= 2],
    ["injectedDefects==1", m.injectedDefects === 1],
    ["verificationFailures>=1", m.verificationFailures >= 1],
    ["errorWasteCreated>0", r.errorWasteCreated > 0],
    ["technicalDebtTracked>0", r.technicalDebtTracked > 0],
    ["repairRounds>=1", m.repairRounds >= 1],
    ["wasteRecycled>0", m.wasteRecycled > 0],
    ["knowledgeReused>0", m.knowledgeReused > 0],
    ["academyEvidenceUpdates>0", m.academyEvidenceUpdates > 0],
    ["finalVerificationPassed", m.finalVerificationPassed === true],
    ["finalObjectivePassed", m.finalObjectivePassed === true],
    ["workspaceBoundaryViolations==0", r.workspaceBoundaryViolations === 0],
    ["securityQuarantines>0", m.securityQuarantines > 0],
    ["centralTaskAssignments==0", m.centralTaskAssignments === 0],
    ["queenTaskAssignments==0", m.queenTaskAssignments === 0],
    ["tamaraDirectAntAssignments==0", m.tamaraDirectAntAssignments === 0],
    ["globalPlannerDecisions==0", m.globalPlannerDecisions === 0],
    ["deterministicProviderCalls>0", m.deterministicProviderCalls > 0],
    ["realClaudeCalls==0", m.realClaudeCalls === 0],
    ["realCodexCalls==0", m.realCodexCalls === 0],
    ["realProviderProcessExecutions==0", m.realProviderProcessExecutions === 0],
    ["realNetworkCalls==0", m.realNetworkCalls === 0],
    ["realFilesystemWrites==0", r.realFilesystemWrites === 0],
    ["digitalResourceConservationValid", r.digitalResourceConservationValid === true],
    ["unexplainedResourceCreation==0", r.unexplainedResourceCreation === 0],
    ["causalityViolations==0", r.causalityViolations === 0],
    ["dangerousRegressionCount==0", m.dangerousRegressionCount === 0],
    ["receiptCrashCount==0", m.receiptCrashCount === 0],
  ];
  const mismatchCaseIds = specs.filter(([, ok]) => !ok).map(([id]) => id);
  return { expectationsChecked: specs.length, mismatchCaseIds, allExpectationsMet: mismatchCaseIds.length === 0 };
}

function scaleCheck(identities: number) {
  const run = runDigitalOperations({ seed: DEMO_SEED, persistentIdentities: identities, teamSize: 12, objective: { ...taskManagerObjective(), objectiveId: `taskmgr-scale-${identities}` } });
  const r = buildDigitalOperationsReport(run);
  return {
    identities,
    conserved: r.digitalResourceConservationValid,
    causalityClean: r.causalityViolations === 0,
    boundedCognitive: run.metrics.peakCognitiveWorkers <= 5,
    objectivePassed: run.metrics.finalObjectivePassed,
    workspaceBoundaryViolations: r.workspaceBoundaryViolations,
  };
}

export function runDemoDigitalSuperorganismOperationsV2() {
  const run = runDigitalOperations({ seed: DEMO_SEED, persistentIdentities: 300, teamSize: 12, objective: taskManagerObjective() });
  const report = buildDigitalOperationsReport(run);
  const expectations = evaluate(run.metrics, report);
  const scaleChecks = [scaleCheck(300), scaleCheck(1000), scaleCheck(10000)];

  return {
    moduleName: "demoDigitalSuperorganismOperationsV2",
    ...run.metrics,
    workingContextConsumed: report.workingContextConsumed,
    computeConsumed: report.computeConsumed,
    tokenBudgetConsumed: report.tokenBudgetConsumed,
    monetaryBudgetConsumed: report.monetaryBudgetConsumed,
    errorWasteCreated: report.errorWasteCreated,
    technicalDebtTracked: report.technicalDebtTracked,
    digitalResourceConservationValid: report.digitalResourceConservationValid,
    unexplainedResourceCreation: report.unexplainedResourceCreation,
    causalityViolations: report.causalityViolations,
    workspaceBoundaryViolations: report.workspaceBoundaryViolations,
    realFilesystemWrites: report.realFilesystemWrites,
    workspaceFiles: report.workspaceFiles,
    commandCenter: report.commandCenter,
    expectationsChecked: expectations.expectationsChecked,
    mismatchCaseIds: expectations.mismatchCaseIds,
    allExpectationsMet: expectations.allExpectationsMet,
    scaleChecks,
  };
}

if (require.main === module) {
  const result = runDemoDigitalSuperorganismOperationsV2();
  console.log(JSON.stringify(result, null, 2));
}
