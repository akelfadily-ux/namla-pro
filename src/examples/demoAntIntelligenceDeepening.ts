// Ant Intelligence Deepening V1 demo: diverse autonomous ant minds that plan,
// self-evaluate, review each other, form teams, learn, mentor, and recover from
// crises — all deterministic, all bounded, no real model, built ALONGSIDE the
// committed G1-G7 colony core (NAMLA_BUILD_LAW.md Section 17).
/**
 * demoAntIntelligenceDeepening: proves the intelligence layer mechanically.
 *
 * It runs the deterministic mission suite + crisis suite + mentorship phase
 * over an evolved 300-identity colony, then a bounded 300/1,000/10,000 scale
 * validation of the mind model. Every metric is COUNTED from behavior actually
 * run — none is hard-coded — and the whole run is deterministic (a second
 * independent run must produce the same digest).
 *
 * No real LLM call, no network, no filesystem write, no process execution, no
 * Queen command, no central assignment, no global planner.
 */

import { ReceiptLog } from "../core/receiptLog";
import { SafetyGuard } from "../core/safetyGuard";
import { looksLikeSecret } from "../policies/secretProtectionPolicy";

import { COGNITIVE_DIMENSIONS } from "../colony/antMind";
import { REVIEW_INTERACTION_TYPES } from "../colony/peerReviewSystem";
import { TEAM_KINDS } from "../colony/antTeams";
import { KNOWLEDGE_KINDS } from "../colony/colonyKnowledgeSystem";
import { CRISIS_KINDS } from "../colony/colonyCrisisSuite";
import { runAntIntelligenceDeepening, runIntelligenceScale } from "../colony/antIntelligenceRuntime";

const SEED = 20260721;

/** Evaluated only, never written to a receipt — ReceiptLog would refuse some. */
const DANGEROUS_SAMPLES: readonly string[] = [
  "rm -rf the project folder",
  "git push origin main",
  "npm install a new package",
  "sudo shell access",
  "delete every generated file",
  "overwrite the existing file by force",
];

/** Every string the intelligence layer uses as vocabulary must stay safe. */
function intelligenceVocabulary(): readonly string[] {
  return [...COGNITIVE_DIMENSIONS, ...REVIEW_INTERACTION_TYPES, ...TEAM_KINDS, ...KNOWLEDGE_KINDS, ...CRISIS_KINDS];
}

export function runDemoAntIntelligenceDeepening() {
  const receipts = new ReceiptLog();
  const guard = new SafetyGuard();
  const mismatchCaseIds: string[] = [];
  let receiptCrashCount = 0;

  const receipt = (caseId: string, summary: string, status: "approved" | "completed" | "blocked") => {
    try {
      receipts.create({ summary, status, details: { caseId } });
    } catch {
      receiptCrashCount += 1;
    }
  };

  // --- 1. Run the deterministic intelligence suite ------------------------
  const r = runAntIntelligenceDeepening({ seed: SEED });
  receipt(
    "aid-run",
    `Intelligence suite executed: ${r.selfEvaluations} self-evaluations, ${r.peerReviewsCompleted} reviews, ` +
      `${r.temporaryTeamsFormed} teams, ${r.knowledgeProposals} knowledge proposals, ${r.crisesRecovered} crises recovered.`,
    "completed"
  );

  // --- 2. Deterministic rerun (independent second run) --------------------
  const rAgain = runAntIntelligenceDeepening({ seed: SEED });
  const deterministicRerunMatches = r.deterministicDigest === rAgain.deterministicDigest;
  if (!deterministicRerunMatches) mismatchCaseIds.push("aid-deterministic-rerun");

  // --- 3. Scale validation: 300 / 1,000 / 10,000 --------------------------
  const scales = [
    runIntelligenceScale("300", 299, 60, SEED),
    runIntelligenceScale("1000", 999, 30, SEED + 1),
    runIntelligenceScale("10000", 9999, 12, SEED + 2),
  ];
  const scaleDiversityPreserved = scales.every((s) => s.diversityPreserved);
  const scaleBounded = scales.every((s) => s.allMindsWithinBounds && s.maxWorkingMemory <= 8);
  const scaleDeterministic = scales.every((s) => s.deterministicRerunMatches);
  const scaleNoCentral = scales.every((s) => s.centralTaskAssignments === 0 && s.queenTaskAssignments === 0);
  if (!scaleDiversityPreserved) mismatchCaseIds.push("aid-scale-diversity");
  if (!scaleBounded) mismatchCaseIds.push("aid-scale-bounded");
  if (!scaleDeterministic) mismatchCaseIds.push("aid-scale-deterministic");
  if (!scaleNoCentral) mismatchCaseIds.push("aid-scale-no-central");

  // --- 4. Safety has not regressed ----------------------------------------
  const dangerousRegressionCount = DANGEROUS_SAMPLES.filter((s) => guard.evaluateText(s).allowed).length;
  if (dangerousRegressionCount > 0) mismatchCaseIds.push("aid-dangerous-regression");
  const unsafeVocabulary = intelligenceVocabulary().filter((w) => !guard.evaluateText(w).allowed || looksLikeSecret(w));
  const intelligenceVocabularySafe = unsafeVocabulary.length === 0;
  if (!intelligenceVocabularySafe) mismatchCaseIds.push("aid-vocabulary");
  receipt("aid-safety", `Intelligence vocabulary evaluated against the safety gate: ${unsafeVocabulary.length} refused.`, intelligenceVocabularySafe ? "completed" : "blocked");

  // --- 5. Required behavioral assertions ----------------------------------
  const assertions: ReadonlyArray<readonly [string, boolean]> = [
    ["total-persistent-ants-300", r.totalPersistentAnts === 300],
    ["unique-ant-ids-300", r.uniqueAntIds === 300],
    ["individual-cognitive-profiles-299", r.individualCognitiveProfiles === 299],
    ["distinct-profile-digests-min", r.distinctProfileDigests >= 150],
    ["local-plans-created-positive", r.localPlansCreated > 0],
    ["local-plans-revised-positive", r.localPlansRevised > 0],
    ["self-evaluations-positive", r.selfEvaluations > 0],
    ["confidence-adjustments-positive", r.confidenceAdjustments > 0],
    ["calibration-improved", r.calibrationImproved === true],
    ["peer-review-requests-positive", r.peerReviewRequests > 0],
    ["peer-reviews-completed-positive", r.peerReviewsCompleted > 0],
    ["disagreements-recorded-positive", r.disagreementsRecorded > 0],
    ["assumptions-challenged-positive", r.assumptionsChallenged > 0],
    ["temporary-teams-formed-positive", r.temporaryTeamsFormed > 0],
    ["teams-dissolved-positive", r.teamsDissolved > 0],
    ["knowledge-proposals-positive", r.knowledgeProposals > 0],
    ["accepted-knowledge-positive", r.acceptedKnowledge > 0],
    ["rejected-knowledge-positive", r.rejectedKnowledge > 0],
    ["contradictions-detected-positive", r.contradictionsDetected > 0],
    ["knowledge-reused-positive", r.knowledgeReused > 0],
    ["mentorship-events-positive", r.mentorshipEvents > 0],
    ["young-workers-improved-positive", r.youngWorkersImproved > 0],
    ["crisis-scenarios-run-min-10", r.crisisScenariosRun >= 10],
    ["crises-recovered-positive", r.crisesRecovered > 0],
    ["unreliable-claims-contained-positive", r.unreliableClaimsContained > 0],
    ["specialization-diversity-maintained", r.specializationDiversityMaintained === true],
    ["global-planner-decisions-zero", r.globalPlannerDecisions === 0],
    ["central-task-assignments-zero", r.centralTaskAssignments === 0],
    ["queen-task-assignments-zero", r.queenTaskAssignments === 0],
    ["peak-cognitively-active-at-most-30", r.peakCognitivelyActiveAnts <= 30],
    ["external-llm-calls-zero", r.externalLlmCalls === 0],
    ["real-network-calls-zero", r.realNetworkCalls === 0],
    ["real-filesystem-writes-zero", r.realFilesystemWrites === 0],
    ["process-executions-zero", r.processExecutions === 0],
    ["all-minds-within-bounds", r.allMindsWithinBounds === true],
    ["plans-within-bounds", r.plansWithinBounds === true],
    ["deterministic-rerun-matches", deterministicRerunMatches],
  ];
  for (const [code, passed] of assertions) if (!passed) mismatchCaseIds.push(code);
  if (receiptCrashCount !== 0) mismatchCaseIds.push("aid-receipt-crash");

  const allExpectationsMet = mismatchCaseIds.length === 0;

  return {
    // population
    totalPersistentAnts: r.totalPersistentAnts,
    queenIdentities: r.queenIdentities,
    workerIdentities: r.workerIdentities,
    uniqueAntIds: r.uniqueAntIds,

    // cognition + diversity
    individualCognitiveProfiles: r.individualCognitiveProfiles,
    distinctProfileDigests: r.distinctProfileDigests,
    profileDiversityIndex: r.profileDiversityIndex,

    // planning
    localPlansCreated: r.localPlansCreated,
    localPlansRevised: r.localPlansRevised,
    plansWithinBounds: r.plansWithinBounds,

    // self-eval + calibration
    selfEvaluations: r.selfEvaluations,
    confidenceAdjustments: r.confidenceAdjustments,
    calibrationErrorBefore: r.calibrationErrorBefore,
    calibrationErrorAfter: r.calibrationErrorAfter,
    calibrationImproved: r.calibrationImproved,

    // peer review
    peerReviewRequests: r.peerReviewRequests,
    peerReviewsCompleted: r.peerReviewsCompleted,
    disagreementsRecorded: r.disagreementsRecorded,
    assumptionsChallenged: r.assumptionsChallenged,
    minorityOpinionsPreserved: r.minorityOpinionsPreserved,
    selfReviewsBlocked: r.selfReviewsBlocked,

    // teams
    temporaryTeamsFormed: r.temporaryTeamsFormed,
    teamsDissolved: r.teamsDissolved,
    teamDisagreements: r.teamDisagreements,
    successfulCooperations: r.successfulCooperations,
    failedCooperations: r.failedCooperations,
    averageTeamSize: r.averageTeamSize,

    // knowledge
    knowledgeProposals: r.knowledgeProposals,
    acceptedKnowledge: r.acceptedKnowledge,
    rejectedKnowledge: r.rejectedKnowledge,
    contradictionsDetected: r.contradictionsDetected,
    knowledgeReused: r.knowledgeReused,
    staleKnowledgeRetired: r.staleKnowledgeRetired,

    // mentorship
    mentorshipEvents: r.mentorshipEvents,
    youngWorkersImproved: r.youngWorkersImproved,
    failedMentorships: r.failedMentorships,
    skillTransfers: r.skillTransfers,
    youngWorkersReadyForIndependentTask: r.youngWorkersReadyForIndependentTask,

    // crisis
    crisisScenariosRun: r.crisisScenariosRun,
    crisesRecovered: r.crisesRecovered,
    unreliableClaimsContained: r.unreliableClaimsContained,

    // specialization
    strategiesPromoted: r.strategiesPromoted,
    strategiesRetired: r.strategiesRetired,
    distinctPrimarySpecializations: r.distinctPrimarySpecializations,
    maxSpecializationShare: r.maxSpecializationShare,
    specializationEntropy: r.specializationEntropy,
    crossTrainedAnts: r.crossTrainedAnts,
    specializationDiversityMaintained: r.specializationDiversityMaintained,

    // decentralization
    globalPlannerDecisions: r.globalPlannerDecisions,
    centralTaskAssignments: r.centralTaskAssignments,
    queenTaskAssignments: r.queenTaskAssignments,

    // cognitive budget
    peakCognitivelyActiveAnts: r.peakCognitivelyActiveAnts,
    allMindsWithinBounds: r.allMindsWithinBounds,

    // capability absence
    externalLlmCalls: r.externalLlmCalls,
    realNetworkCalls: r.realNetworkCalls,
    realFilesystemWrites: r.realFilesystemWrites,
    processExecutions: r.processExecutions,

    // scale
    scales,
    scaleDiversityPreserved,
    scaleBounded,
    scaleDeterministic,

    // command center (safe aggregates only)
    commandCenter: r.commandCenter,

    // determinism + safety
    deterministicRerunMatches,
    dangerousRegressionCount,
    intelligenceVocabularySafe,
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
  console.log(JSON.stringify(runDemoAntIntelligenceDeepening(), null, 2));
}
