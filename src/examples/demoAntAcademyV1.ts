// Tamara–Namla Federation V1 + Ant Academy V1 demo (Build Law §20).
// Deterministic workers only — no real Claude/Codex/network/process/fs write.
// Tamara publishes strategy; Namla self-organizes; ants train, are examined by
// independent evaluators, mentor, build a multi-domain project, get promoted on
// evidence (never self-certified), and some are certified.
/**
 * demoAntAcademyV1: proves the academy + federation mechanically. Every metric
 * is counted from executed runtime behavior — none hard-coded.
 */

import { ReceiptLog } from "../core/receiptLog";
import { SafetyGuard } from "../core/safetyGuard";
import { looksLikeSecret } from "../policies/secretProtectionPolicy";
import { ACADEMY_DOMAINS, PROFICIENCY_LEVELS } from "../academy/academyDomains";
import { RUBRIC_DIMENSIONS } from "../academy/academyEvaluator";
import { runAcademyScale, runAntAcademy } from "../academy/academyRuntime";
import { FederationBridge } from "../federation/federationBridge";
import type { TamaraObjective } from "../federation/tamaraObjective";

const SEED = 20260728;

const DANGEROUS_SAMPLES: readonly string[] = [
  "rm -rf the project folder",
  "git push origin main",
  "sudo shell access",
  "delete every generated file",
  "overwrite the existing file by force",
];

function academyVocabulary(): readonly string[] {
  return [...ACADEMY_DOMAINS, ...PROFICIENCY_LEVELS, ...RUBRIC_DIMENSIONS, "trainee", "certified", "remediation", "mentorship"];
}

function sampleObjective(): TamaraObjective {
  return {
    objectiveId: "obj-task-manager",
    title: "Build a small task-management service",
    desiredOutcome: "A reviewed, verified task-management service prototype.",
    constraints: ["No real provider execution", "Bounded workspace"],
    priority: "high",
    riskLevel: "moderate",
    budgetUnits: 100,
    maxTicks: 400,
    requiredSkills: ["backend", "testing", "documentation"],
    acceptanceCriteria: ["Exposes a handle() function", "Is reviewed", "Passes verification"],
    humanApprovalRequired: true,
    allowedProviderPool: ["fake"],
    maxCognitivelyActiveAnts: 5,
    maxRealProviderCalls: 0,
    workspacePolicy: "in-memory-fake",
    safeMetadata: { kind: "federation-demo" },
  };
}

export function runDemoAntAcademyV1() {
  const receipts = new ReceiptLog();
  const guard = new SafetyGuard();
  const mismatchCaseIds: string[] = [];
  let receiptCrashCount = 0;
  const receipt = (summary: string, status: "completed" | "blocked") => {
    try {
      receipts.create({ summary, status });
    } catch {
      receiptCrashCount += 1;
    }
  };

  // --- 1. Academy end-to-end ----------------------------------------------
  const r = runAntAcademy({ seed: SEED });
  receipt(`Academy run: ${r.trainingMissions} training, ${r.examinationMissions} exams, ${r.promotions} promotions, ${r.certifications} certifications.`, "completed");

  // --- 2. Federation bridge (Tamara objective) ----------------------------
  const bridge = new FederationBridge(SEED + 5);
  const submission = bridge.submitObjective(sampleObjective());
  if (submission.summary) bridge.pauseMission(submission.summary.missionId);
  if (submission.summary) bridge.reduceProviderBudget(submission.summary.missionId, 0);
  if (submission.summary) bridge.concludeMission(submission.summary.missionId, true);
  const fed = bridge.metrics();

  // --- 3. Deterministic rerun ---------------------------------------------
  const rAgain = runAntAcademy({ seed: SEED });
  const deterministicRerunMatches = r.deterministicDigest === rAgain.deterministicDigest;
  if (!deterministicRerunMatches) mismatchCaseIds.push("deterministic-rerun");

  // --- 4. Scale (300 / 1,000 / 10,000) ------------------------------------
  const scales = [
    runAcademyScale("300", 299, 40, SEED),
    runAcademyScale("1000", 999, 20, SEED + 1),
    runAcademyScale("10000", 9999, 10, SEED + 2),
  ];
  const scaleBounded = scales.every((s) => s.allPassportsWithinBounds);
  const scaleDiversity = scales.every((s) => s.diversityPreserved);
  const scaleDeterministic = scales.every((s) => s.deterministicRerunMatches);
  const scaleNoCentral = scales.every((s) => s.centralTaskAssignments === 0 && s.tamaraDirectAntAssignments === 0);
  if (!scaleBounded) mismatchCaseIds.push("scale-bounded");
  if (!scaleDiversity) mismatchCaseIds.push("scale-diversity");
  if (!scaleDeterministic) mismatchCaseIds.push("scale-deterministic");
  if (!scaleNoCentral) mismatchCaseIds.push("scale-no-central");

  // --- 5. Safety ----------------------------------------------------------
  const dangerousRegressionCount = DANGEROUS_SAMPLES.filter((s) => guard.evaluateText(s).allowed).length;
  if (dangerousRegressionCount > 0) mismatchCaseIds.push("dangerous-regression");
  const unsafeVocab = academyVocabulary().filter((w) => !guard.evaluateText(w).allowed || looksLikeSecret(w));
  if (unsafeVocab.length > 0) mismatchCaseIds.push("vocabulary");

  // --- 6. Required assertions ---------------------------------------------
  const A: ReadonlyArray<readonly [string, boolean]> = [
    ["total-300", r.totalPersistentAnts === 300],
    ["queen-1", r.queenIdentities === 1],
    ["worker-299", r.workerIdentities === 299],
    ["domains->=12", r.academyDomains >= 12],
    ["training->0", r.trainingMissions > 0],
    ["exams->0", r.examinationMissions > 0],
    ["project->0", r.projectMissions > 0],
    ["voluntary->0", r.voluntaryClaims > 0],
    ["accepted->0", r.acceptedClaims > 0],
    ["nonvolunteer-0", r.nonVolunteerAssignments === 0],
    ["mentors->0", r.mentorsActivated > 0],
    ["mentorship->0", r.mentorshipEvents > 0],
    ["exam-pass->0", r.examinationPasses > 0],
    ["exam-fail->0", r.examinationFailures > 0],
    ["remediations->0", r.remediations > 0],
    ["promotions->0", r.promotions > 0],
    ["rejected-promotions->0", r.rejectedPromotions > 0],
    ["certifications->0", r.certifications > 0],
    ["self-cert-0", r.selfCertifications === 0],
    ["unsupported-promo-0", r.unsupportedPromotions === 0],
    ["passport-updates->0", r.skillPassportUpdates > 0],
    ["passports-bounded", r.allPassportsWithinBounds === true],
    ["teams->0", r.temporaryTeamsFormed > 0],
    ["reviews->0", r.reviewsCompleted > 0],
    ["verification->0", r.verificationRuns > 0],
    ["repair->0", r.repairRounds > 0],
    ["diversity", r.specializationDiversityMaintained === true],
    ["peak-<=30", r.peakCognitivelyActiveAnts <= 30],
    ["central-0", r.centralTaskAssignments === 0],
    ["queen-0", r.queenTaskAssignments === 0],
    ["tamara-direct-0", r.tamaraDirectAntAssignments === 0],
    ["global-planner-0", r.globalPlannerDecisions === 0],
    ["realclaude-0", r.realClaudeCalls === 0],
    ["realcodex-0", r.realCodexCalls === 0],
    ["realnet-0", r.realNetworkCalls === 0],
    ["realfs-0", r.realFilesystemWrites === 0],
    ["proc-0", r.processExecutions === 0],
    // federation
    ["fed-received->0", fed.tamaraObjectivesReceived > 0],
    ["fed-missions->0", fed.colonyMissionsCreated > 0],
    ["fed-tamara-direct-0", fed.tamaraDirectAntAssignments === 0],
    ["fed-nonvolunteer-0", fed.nonVolunteerAssignments === 0],
    ["fed-central-0", fed.centralTaskAssignments === 0],
  ];
  for (const [code, ok] of A) if (!ok) mismatchCaseIds.push(code);
  if (receiptCrashCount !== 0) mismatchCaseIds.push("receipt-crash");

  const allExpectationsMet = mismatchCaseIds.length === 0;

  return {
    totalPersistentAnts: r.totalPersistentAnts,
    queenIdentities: r.queenIdentities,
    workerIdentities: r.workerIdentities,
    academyDomains: r.academyDomains,
    trainingMissions: r.trainingMissions,
    examinationMissions: r.examinationMissions,
    projectMissions: r.projectMissions,
    voluntaryClaims: r.voluntaryClaims,
    acceptedClaims: r.acceptedClaims,
    nonVolunteerAssignments: r.nonVolunteerAssignments,
    mentorsActivated: r.mentorsActivated,
    mentorshipEvents: r.mentorshipEvents,
    menteeImprovement: r.menteeImprovement,
    examinationPasses: r.examinationPasses,
    examinationFailures: r.examinationFailures,
    remediations: r.remediations,
    promotions: r.promotions,
    rejectedPromotions: r.rejectedPromotions,
    certifications: r.certifications,
    selfCertifications: r.selfCertifications,
    unsupportedPromotions: r.unsupportedPromotions,
    skillPassportUpdates: r.skillPassportUpdates,
    allPassportsWithinBounds: r.allPassportsWithinBounds,
    temporaryTeamsFormed: r.temporaryTeamsFormed,
    teamsDissolved: r.teamsDissolved,
    reviewsCompleted: r.reviewsCompleted,
    verificationRuns: r.verificationRuns,
    repairRounds: r.repairRounds,
    knowledgeProposals: r.knowledgeProposals,
    acceptedKnowledge: r.acceptedKnowledge,
    distinctPrimarySpecializations: r.distinctPrimarySpecializations,
    specializationEntropy: r.specializationEntropy,
    specializationDiversityMaintained: r.specializationDiversityMaintained,
    peakCognitivelyActiveAnts: r.peakCognitivelyActiveAnts,
    centralTaskAssignments: r.centralTaskAssignments,
    queenTaskAssignments: r.queenTaskAssignments,
    tamaraDirectAntAssignments: r.tamaraDirectAntAssignments,
    globalPlannerDecisions: r.globalPlannerDecisions,
    realClaudeCalls: r.realClaudeCalls,
    realCodexCalls: r.realCodexCalls,
    realNetworkCalls: r.realNetworkCalls,
    realFilesystemWrites: r.realFilesystemWrites,
    processExecutions: r.processExecutions,

    // federation
    tamaraObjectivesReceived: fed.tamaraObjectivesReceived,
    colonyMissionsCreated: fed.colonyMissionsCreated,
    federationVoluntaryClaims: fed.voluntaryClaims,
    missionsPaused: fed.missionsPaused,
    budgetReductions: fed.budgetReductions,
    resultsAccepted: fed.resultsAccepted,

    // scale + command center
    scales,
    scaleBounded,
    scaleDiversity,
    scaleDeterministic,
    commandCenter: r.commandCenter,

    deterministicRerunMatches,
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
  console.log(JSON.stringify(runDemoAntAcademyV1(), null, 2));
}
