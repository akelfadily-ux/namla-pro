/**
 * demoRealCognitiveColony: proves the Real Cognitive Ants V1 pipeline
 * mechanically, using ONLY DeterministicCognitiveWorker — no real Claude or
 * Codex call, ever, in this demo or any automated test.
 *
 * What it proves: the full 300-identity colony (1 queen-system + 299
 * worker-capable ants) enters a mission; at least 3 scout ants independently
 * propose architectures and a bounded local quorum picks one without any
 * central planner or Queen involvement; ants voluntarily claim build work
 * from local demand; a bounded cognitive budget (<=5 concurrent, well under
 * the global 30) admits claimants who then call the fake provider; builder
 * ants produce structured artifacts that are reviewed before ever being
 * applied to the isolated mission workspace; one deterministic defect is
 * injected, detected by simulated verification, and repaired by a
 * recruited repair ant within the bounded repair-round cap; and every
 * central/Queen/real-provider/network counter stays at literal zero.
 */

import { ReceiptLog } from "../core/receiptLog";
import { SafetyGuard } from "../core/safetyGuard";
import { createColonyGenesis } from "../colony/colonyGenesis";
import { DeterministicCognitiveWorker } from "../colonyMission/deterministicCognitiveWorker";
import { CognitiveWorkerRegistry } from "../colonyMission/cognitiveWorkerRegistry";
import { MissionRunner } from "../colonyMission/missionRunner";
import type { WorkTask } from "../colonyMission/workDemand";

const COLONY_ID = "namla-real-cognitive-demo";
const COLONY_SEED = 20260722;
const MISSION_ID = "demo-task-manager";
const MAX_CONCURRENT_COGNITIVE_ANTS = 5;
const MAX_REPAIR_ROUNDS = 3;

const DANGEROUS_SAMPLES: readonly string[] = [
  "rm -rf the project folder",
  "git push origin main",
  "npm install a new package",
  "sudo shell access",
  "delete every generated file",
  "overwrite the existing file by force",
];

function buildScoutTask(): WorkTask {
  return {
    taskId: "architecture-plan",
    missionId: MISSION_ID,
    category: "architecture",
    description: "Design the overall architecture for a small task-management application.",
    acceptanceCriteria: ["Supports creating tasks", "Supports marking tasks complete", "Is testable"],
  };
}

function buildTasks(): readonly WorkTask[] {
  return [
    {
      taskId: "backend-core",
      missionId: MISSION_ID,
      category: "backend",
      description: "Implement the core task-management logic.",
      acceptanceCriteria: ["Exposes a handle() function", "Compiles cleanly"],
    },
    {
      taskId: "frontend-ui",
      missionId: MISSION_ID,
      category: "frontend",
      description: "Implement a minimal UI entry point.",
      acceptanceCriteria: ["Exposes a handle() function"],
    },
    {
      taskId: "test-suite",
      missionId: MISSION_ID,
      category: "testing",
      description: "Add a small test covering the core logic.",
      acceptanceCriteria: ["Exposes a handle() function"],
    },
    {
      taskId: "documentation",
      missionId: MISSION_ID,
      category: "documentation",
      description: "Document how the task manager works.",
      acceptanceCriteria: ["Exposes a handle() function"],
    },
  ];
}

export function runDemoRealCognitiveColony() {
  const receipts = new ReceiptLog();
  const guard = new SafetyGuard();
  const mismatchCaseIds: string[] = [];
  let receiptCrashCount = 0;

  const safeReceipt = (summary: string, status: "completed" | "blocked") => {
    try {
      receipts.create({ summary, status });
    } catch {
      receiptCrashCount += 1;
    }
  };

  const genesis = createColonyGenesis({ colonyId: COLONY_ID, seed: COLONY_SEED });

  const registry = new CognitiveWorkerRegistry();
  registry.register(new DeterministicCognitiveWorker());

  const runner = new MissionRunner({
    missionId: MISSION_ID,
    missionGoal: "Build a small task-management application inside an isolated test workspace.",
    genesis,
    providerName: "fake",
    cognitiveWorkerRegistry: registry,
    maxConcurrentCognitiveAnts: MAX_CONCURRENT_COGNITIVE_ANTS,
    scoutTask: buildScoutTask(),
    scoutCount: 3,
    buildTasks: buildTasks(),
    injectDefectAfterTaskId: "backend-core",
    maxRepairRounds: MAX_REPAIR_ROUNDS,
  });

  const { report, commandCenterState } = runner.run();

  safeReceipt(
    `Mission executed: ${report.scoutProposalCount} scout proposals, ${report.artifactProposals} artifacts, ` +
      `${report.repairRounds} repair round(s).`,
    "completed"
  );

  const dangerousRegressionCount = DANGEROUS_SAMPLES.filter((sample) => guard.evaluateText(sample).allowed).length;
  if (dangerousRegressionCount > 0) mismatchCaseIds.push("dangerous-regression");

  const assertions: ReadonlyArray<readonly [string, boolean]> = [
    ["total-persistent-ants-300", report.totalPersistentAnts === 300],
    ["queen-identities-1", report.queenIdentities === 1],
    ["worker-identities-299", report.workerIdentities === 299],
    ["scout-proposal-count-at-least-3", report.scoutProposalCount >= 3],
    ["quorum-reached", report.quorumReached === true],
    ["rejected-proposal-count-at-least-2", report.rejectedProposalCount >= 2],
    ["voluntary-task-claims-positive", report.voluntaryTaskClaims > 0],
    ["accepted-task-claims-positive", report.acceptedTaskClaims > 0],
    ["cognitive-claims-positive", report.cognitiveClaims > 0],
    ["peak-cognitive-ants-at-most-5", report.peakCognitiveAnts <= 5],
    ["central-task-assignments-zero", report.centralTaskAssignments === 0],
    ["queen-task-assignments-zero", report.queenTaskAssignments === 0],
    ["artifact-proposals-positive", report.artifactProposals > 0],
    ["artifacts-reviewed-positive", report.artifactsReviewed > 0],
    ["files-applied-positive", report.filesApplied > 0],
    ["verification-runs-positive", report.verificationRuns > 0],
    ["injected-defects-one", report.injectedDefects === 1],
    ["verification-failures-positive", report.verificationFailures > 0],
    ["repair-rounds-positive", report.repairRounds > 0],
    ["final-verification-passed", report.finalVerificationPassed === true],
    ["workspace-boundary-violations-zero", report.workspaceBoundaryViolations === 0],
    ["fake-provider-calls-positive", report.fakeProviderCalls > 0],
    ["real-claude-calls-zero", report.realClaudeCalls === 0],
    ["real-codex-calls-zero", report.realCodexCalls === 0],
    ["real-network-calls-zero", report.realNetworkCalls === 0],
    ["dangerous-regression-count-zero", dangerousRegressionCount === 0],
    ["receipt-crash-count-zero", receiptCrashCount === 0],
  ];
  for (const [code, passed] of assertions) if (!passed) mismatchCaseIds.push(code);

  const allExpectationsMet = mismatchCaseIds.length === 0;

  return {
    ...report,
    dangerousRegressionCount,
    receiptCrashCount,
    commandCenterFinalOutcome: commandCenterState.finalOutcome,
    allExpectationsMet,
    mismatchCaseIds,
    mismatchCount: mismatchCaseIds.length,
    simulated: true,
    executed: false,
  };
}

if (require.main === module) {
  console.log(JSON.stringify(runDemoRealCognitiveColony(), null, 2));
}
