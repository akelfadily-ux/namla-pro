// Tamara–Namla Real Academy Pilot V2 demo (Build Law §21). FAKE provider
// drivers only — no real Claude/Codex, no real process/network/fs write. A
// 5-ant voluntary cohort trains through bounded (fake) providers: a mix of
// simulated Claude and Codex, one quota failure, one malformed result, three
// valid results (one of which fails independent evaluation), remediation,
// bounded SkillPassport evidence updates, and ZERO certifications.
/**
 * demoRealAcademyPilotV2: proves the pilot gate + lifecycle mechanically with
 * the fake driver. Every metric is counted from exercised behavior.
 */

import { ReceiptLog } from "../core/receiptLog";
import { SafetyGuard } from "../core/safetyGuard";
import { FakeProviderProcessDriver } from "../cognitive/providerProcessDriver";
import type { FakeProcessScenario } from "../cognitive/providerProcessDriver";
import type { PermitScope, RealProviderId } from "../cognitive/realProviderExecutionPermit";
import { mintPilotPermitForAutomatedTest } from "../cognitive/multiProviderPilotPermit";
import type { PilotScope } from "../cognitive/multiProviderPilotPermit";
import { buildPilotCommandCenter, buildPilotPopulation, runAcademyPilot, selectVoluntaryCohort } from "../academy/realAcademyPilot";
import { createSkillPassport, type SkillPassport } from "../academy/skillPassport";

const SEED = 20260730;
const DOMAIN = "debugging" as const; // CLI alias "debugging-and-testing" maps here
const WORKSPACE = "workspaces/academy-pilot/pilot-demo";
const MAX_INPUT = 8000;
const MAX_OUTPUT = 8000;

const DANGEROUS_SAMPLES: readonly string[] = [
  "rm -rf the project folder",
  "git push origin main",
  "sudo shell access",
  "delete every generated file",
];

export function runDemoRealAcademyPilotV2() {
  const receipts = new ReceiptLog();
  const guard = new SafetyGuard();
  const mismatchCaseIds: string[] = [];
  let receiptCrashCount = 0;

  // --- population + voluntary cohort of exactly 5 -------------------------
  const { mindful, totalPersistentAnts } = buildPilotPopulation(SEED);
  const selection = selectVoluntaryCohort(mindful, DOMAIN, 5, SEED);
  const cohort = selection.cohort.slice(0, 5);

  const passports = new Map<string, SkillPassport>();
  for (const m of mindful) passports.set(m.ant.antId, createSkillPassport(m.ant.antId, m.ant.reliability));

  // --- provider mix + per-slot scenarios ----------------------------------
  const providerForAnt: RealProviderId[] = ["claude", "codex", "claude", "codex", "claude"];
  // slot0 quota failure, slot1 malformed, slot2/3 valid, slot4 valid-but-weak
  // (completed process, low confidence → independent evaluation fails).
  const scenarios: FakeProcessScenario[] = ["quota-exceeded", "malformed-output", "success", "success", "weak-success"];

  // --- mint one pilot permit + one member permit per accepted ant ---------
  const pilotScope: PilotScope = {
    pilotId: "pilot-demo",
    objectiveId: "obj-debugging-pilot",
    academyDomain: DOMAIN,
    difficulty: "core",
    allowedProviders: ["claude", "codex"],
    workspaceId: WORKSPACE,
    maxCohortSize: 5,
    maxProviderCalls: 5,
    maxAggregateInputBytes: MAX_INPUT,
    maxAggregateOutputBytes: MAX_OUTPUT,
    perCallTimeoutMs: 60000,
    maxPilotSteps: 50,
  };
  const memberScopes: PermitScope[] = cohort.map((m, slot) => ({
    provider: providerForAnt[slot],
    missionId: pilotScope.pilotId,
    taskId: `pilot-task-${slot}`,
    antId: m.ant.antId,
    workspaceId: WORKSPACE,
    maxInputBytes: MAX_INPUT,
    maxOutputBytes: MAX_OUTPUT,
    timeoutMs: 60000,
  }));
  const mint = mintPilotPermitForAutomatedTest(pilotScope, memberScopes);
  if (!mint) {
    return { allExpectationsMet: false, mismatchCaseIds: ["pilot-mint-failed"], simulated: true, executed: false };
  }

  // --- run the pilot with fake drivers ------------------------------------
  const result = runAcademyPilot({
    pilotPermit: mint.pilotPermit,
    memberPermits: mint.memberPermits,
    cohort,
    evaluators: selection.evaluators,
    passports,
    providerForAnt,
    driverForSlot: (slot) => new FakeProviderProcessDriver(scenarios[slot]),
    requireHumanCliOrigin: false, // automated-test permits + fake driver
    workingDirectoryAbsolute: "/in-memory/academy-pilot",
    receiptLog: receipts,
    seed: SEED,
  });

  const commandCenter = buildPilotCommandCenter(result, selection.voluntaryTrainingClaims, "fake-authorized");
  try {
    receipts.create({ summary: `Pilot completed: ${result.acceptedCohortSize} ants, ${result.providerCallsCompleted} completed, ${result.evaluationsFailed} eval failures.`, status: "completed" });
  } catch {
    receiptCrashCount += 1;
  }

  const dangerousRegressionCount = DANGEROUS_SAMPLES.filter((s) => guard.evaluateText(s).allowed).length;
  const withinByteBudget = result.withinByteBudget;
  const pilotCompleted = result.pilotStatus === "completed";

  // --- required assertions ------------------------------------------------
  const A: ReadonlyArray<readonly [string, boolean]> = [
    ["total-300", totalPersistentAnts === 300],
    ["voluntary->=8", selection.voluntaryTrainingClaims >= 8],
    ["cohort-5", result.acceptedCohortSize === 5],
    ["nonvolunteer-0", result.nonVolunteerAssignments === 0],
    ["tamara-direct-0", result.tamaraDirectAntAssignments === 0],
    ["central-0", result.centralTaskAssignments === 0],
    ["queen-0", result.queenTaskAssignments === 0],
    ["global-planner-0", result.globalPlannerDecisions === 0],
    ["sim-claude->0", result.simulatedClaudeCalls > 0],
    ["sim-codex->0", result.simulatedCodexCalls > 0],
    ["real-claude-0", result.realClaudeCalls === 0],
    ["real-codex-0", result.realCodexCalls === 0],
    ["calls-started-5", result.providerCallsStarted === 5],
    ["calls-completed->0", result.providerCallsCompleted > 0],
    ["calls-failed->0", result.providerCallsFailed > 0],
    ["quota-1", result.quotaFailures === 1],
    ["malformed-1", result.malformedResults === 1],
    ["eval-completed->0", result.evaluationsCompleted > 0],
    ["eval-passed->0", result.evaluationsPassed > 0],
    ["eval-failed->0", result.evaluationsFailed > 0],
    ["remediation->0", result.remediationRequests > 0],
    ["passport-updates->0", result.passportEvidenceUpdates > 0],
    ["certifications-0", result.certificationsGranted === 0],
    ["within-byte-budget", withinByteBudget === true],
    ["workspace-violations-0", result.workspaceBoundaryViolations === 0],
    ["real-fs-0", result.realFilesystemWrites === 0],
    ["real-net-0", result.realNetworkCalls === 0],
    ["real-proc-0", result.realProviderProcessExecutions === 0],
    ["pilot-completed", pilotCompleted === true],
    ["partial-outcome", result.pilotOutcome === "partial"],
    ["dangerous-0", dangerousRegressionCount === 0],
    ["receipt-crash-0", receiptCrashCount === 0],
  ];
  for (const [code, ok] of A) if (!ok) mismatchCaseIds.push(code);

  const allExpectationsMet = mismatchCaseIds.length === 0;

  return {
    totalPersistentAnts,
    voluntaryTrainingClaims: selection.voluntaryTrainingClaims,
    acceptedCohortSize: result.acceptedCohortSize,
    nonVolunteerAssignments: result.nonVolunteerAssignments,
    tamaraDirectAntAssignments: result.tamaraDirectAntAssignments,
    centralTaskAssignments: result.centralTaskAssignments,
    queenTaskAssignments: result.queenTaskAssignments,
    globalPlannerDecisions: result.globalPlannerDecisions,

    simulatedClaudeCalls: result.simulatedClaudeCalls,
    simulatedCodexCalls: result.simulatedCodexCalls,
    realClaudeCalls: result.realClaudeCalls,
    realCodexCalls: result.realCodexCalls,
    providerCallsStarted: result.providerCallsStarted,
    providerCallsCompleted: result.providerCallsCompleted,
    providerCallsFailed: result.providerCallsFailed,
    quotaFailures: result.quotaFailures,
    malformedResults: result.malformedResults,
    aggregateTimeouts: result.aggregateTimeouts,
    deterministicFallbacks: result.deterministicFallbacks,

    evaluationsCompleted: result.evaluationsCompleted,
    evaluationsPassed: result.evaluationsPassed,
    evaluationsFailed: result.evaluationsFailed,
    remediationRequests: result.remediationRequests,
    passportEvidenceUpdates: result.passportEvidenceUpdates,
    certificationsGranted: result.certificationsGranted,

    aggregateInputBytes: result.aggregateInputBytes,
    aggregateOutputBytes: result.aggregateOutputBytes,
    providerBudgetRemaining: result.providerBudgetRemaining,
    withinByteBudget,
    workspaceBoundaryViolations: result.workspaceBoundaryViolations,
    realFilesystemWrites: result.realFilesystemWrites,
    realNetworkCalls: result.realNetworkCalls,
    realProviderProcessExecutions: result.realProviderProcessExecutions,

    pilotOutcome: result.pilotOutcome,
    pilotCompleted,
    providerComparison: result.providerComparison,
    commandCenter,

    dangerousRegressionCount,
    receiptCount: receipts.list().length,
    receiptCrashCount,

    allExpectationsMet,
    mismatchCaseIds,
    mismatchCount: mismatchCaseIds.length,
    simulated: true,
    executed: false,
  };
}

if (require.main === module) {
  console.log(JSON.stringify(runDemoRealAcademyPilotV2(), null, 2));
}
