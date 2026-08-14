// Colony Genesis G1-G7 demo: a functioning decentralized colony core.
// Builds directly on demoColonyGenesisG0.ts's population and topology, then
// runs the bounded G1-G3 tick loop (NAMLA_BUILD_LAW.md Section 13), G4
// reserve activation and G5 recruitment/local quorum (Section 14), and G6
// brood lifecycle / G7 cognitive budget (Section 15).
/**
 * demoColonyGenesis: proves the G1-G7 behavior core mechanically.
 *
 * What it proves: 300 persistent identities survive a deterministic 400-tick
 * run unchanged, every ant (reserve included, as of G4) chooses its own task
 * from local observation only, zero central or Queen task assignments ever
 * occur, chamber-local encounters and movement happen, all ten pheromone
 * types are deposited/read/reinforced/decayed, thresholds specialize through
 * the ants' own outcomes, reserve ants measurably activate, bounded
 * chamber-local recruitment occurs, ants locally sense quorum and commit on
 * their own, brood exist and mature through real lifecycle transitions,
 * brood-created nursing demand is answered by the SAME G1-G3
 * response-threshold system (never a Queen assignment), workers age and
 * some genuinely enter senescence/recovery, ants submit local cognition
 * claims and a bounded resolver admits at most 30 per tick (never more, by
 * construction), and rejected claims still proceed with the deterministic
 * work already chosen.
 *
 * What it does NOT do: population renewal never actually admits a brood
 * into a new persistent identity in THIS 300-population run, because the
 * population cap is already saturated at genesis — see
 * `demoColonyScale.ts`'s dedicated renewal check for proof the admission
 * mechanism itself works when there is room. No real LLM call, no
 * filesystem write, no network call, no process execution, no global
 * quorum/cognitive-budget winner or tally.
 */

import { ReceiptLog } from "../core/receiptLog";
import { SafetyGuard } from "../core/safetyGuard";
import { looksLikeSecret } from "../policies/secretProtectionPolicy";

import { COLONY_PHEROMONE_TYPES, SKILL_TENDENCIES, TASK_CATEGORIES } from "../colony/colonyTypes";
import { CHAMBER_IDS } from "../colony/nestGraph";
import { createColonyGenesis } from "../colony/colonyGenesis";
import { checkColonyGenesisInvariants } from "../colony/colonyInvariants";
import { createInitialTickState, runColonyTicks } from "../colony/colonyTickRunner";
import { buildColonyRunReport } from "../colony/colonyRunReport";

const COLONY_ID = "namla-colony-genesis-1";
const COLONY_SEED = 20260719;
const TICKS_TO_RUN = 400;

/** Evaluated only, never written to a receipt — ReceiptLog would (correctly) refuse some of these. */
const DANGEROUS_SAMPLES: readonly string[] = [
  "rm -rf the project folder",
  "git push origin main",
  "npm install a new package",
  "sudo shell access",
  "delete every generated file",
  "overwrite the existing file by force",
];

/** Every string the G1-G7 runtime actually uses as vocabulary. */
function colonyVocabulary(): readonly string[] {
  return [
    ...CHAMBER_IDS,
    ...TASK_CATEGORIES,
    ...COLONY_PHEROMONE_TYPES,
    ...SKILL_TENDENCIES,
    "queen",
    "minor-worker",
    "major-worker",
    "soldier",
    "scout",
    "resting",
    "reserve",
    "egg",
    "larva",
    "pupa",
    "young-worker",
    "adult",
    "senescent",
    "retired",
    "deterministic-local",
    "llm-eligible",
    "llm-active",
    "disabled",
  ];
}

export function runDemoColonyGenesis() {
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

  // --- 1. Build the G0 population and topology (unchanged foundation) -----
  const genesis = createColonyGenesis({ colonyId: COLONY_ID, seed: COLONY_SEED });
  const genesisInvariants = checkColonyGenesisInvariants(genesis);
  receipt(
    "g1g7-genesis-invariants",
    `Genesis invariants evaluated before the run: ${genesisInvariants.checksPassed} of ${genesisInvariants.checksRun} passed.`,
    genesisInvariants.allPassed ? "completed" : "blocked"
  );
  if (!genesisInvariants.allPassed) mismatchCaseIds.push("g1g7-genesis-invariants");

  // --- 2. Run the bounded, deterministic G1-G7 tick loop -------------------
  const initialTickState = createInitialTickState(genesis);
  const runResult = runColonyTicks(initialTickState, TICKS_TO_RUN);
  const report = buildColonyRunReport(genesis, runResult);

  receipt(
    "g1g7-run",
    `Colony run executed: ${report.ticksExecuted} ticks, ${report.localTaskDecisions} local task decisions, ` +
      `${report.encounters} encounters, ${report.movementCount} moves.`,
    "completed"
  );

  // --- 3. Safety has not regressed -----------------------------------------
  const dangerousRegressionCount = DANGEROUS_SAMPLES.filter((sample) => guard.evaluateText(sample).allowed).length;
  if (dangerousRegressionCount > 0) mismatchCaseIds.push("g1g7-dangerous-regression");

  const unsafeVocabulary = colonyVocabulary().filter(
    (word) => !guard.evaluateText(word).allowed || looksLikeSecret(word)
  );
  const colonyVocabularySafe = unsafeVocabulary.length === 0;
  if (!colonyVocabularySafe) mismatchCaseIds.push("g1g7-colony-vocabulary");

  receipt(
    "g1g7-safety",
    `Colony vocabulary evaluated against the safety gate: ${unsafeVocabulary.length} refused.`,
    colonyVocabularySafe ? "completed" : "blocked"
  );

  // --- 4. Required behavioral assertions -----------------------------------
  const assertions: ReadonlyArray<readonly [string, boolean]> = [
    ["total-persistent-ants-300", report.totalPersistentAnts === 300],
    ["unique-ant-ids-300", report.uniqueAntIds === 300],
    ["ticks-executed-400", report.ticksExecuted === TICKS_TO_RUN],
    ["local-task-decisions-positive", report.localTaskDecisions > 0],
    ["central-task-assignments-zero", report.centralTaskAssignments === 0],
    ["queen-task-assignments-zero", report.queenTaskAssignments === 0],
    ["encounters-positive", report.encounters > 0],
    ["movement-count-positive", report.movementCount > 0],
    ["pheromones-deposited-positive", report.pheromonesDeposited > 0],
    ["pheromones-read-positive", report.pheromonesRead > 0],
    ["pheromones-reinforced-positive", report.pheromonesReinforced > 0],
    ["pheromones-decayed-positive", report.pheromonesDecayed > 0],
    ["task-switch-count-positive", report.taskSwitchCount > 0],
    ["specialization-changes-positive", report.specializationChanges > 0],
    ["reserve-activation-count-positive", report.reserveActivationCount > 0],
    ["recruitment-events-positive", report.recruitmentEvents > 0],
    ["quorum-local-commitments-positive", report.quorumLocalCommitments > 0],
    ["population-identity-preserved", report.populationIdentityPreserved === true],
    ["external-llm-calls-zero", report.externalLlmCalls === 0],
    ["real-filesystem-writes-zero", report.realFilesystemWrites === 0],
    ["network-calls-zero", report.networkCalls === 0],
    ["process-executions-zero", report.processExecutions === 0],
    ["peak-cognitive-eligibility-at-most-30", report.peakCognitiveEligibilityAtMost30 === true],
    ["every-pheromone-type-has-decision-site", report.allPheromoneTypesHaveDecisionSite === true],

    // --- G6: brood lifecycle, nursing, generations ---
    ["brood-records-created-positive", report.broodRecordsCreated > 0],
    ["brood-lifecycle-transitions-positive", report.broodLifecycleTransitions > 0],
    ["nursing-stimulus-events-positive", report.nursingStimulusEvents > 0],
    ["nursing-local-responses-positive", report.nursingLocalResponses > 0],
    ["queen-direct-nursing-assignments-zero", report.queenDirectNursingAssignments === 0],
    [
      "worker-lifecycle-transition-occurs",
      report.workerSenescenceEntries + report.workerRecoveryEntries + report.workerRetirements > 0,
    ],

    // --- G7: cognitive budget ---
    ["cognition-claims-positive", report.cognitionClaims > 0],
    ["cognitively-active-never-exceeds-30", report.observedPeakCognitivelyActiveAnts <= 30],
    ["cognitive-budget-violations-zero", report.cognitiveBudgetViolations === 0],
    ["deterministic-fallback-actions-positive", report.deterministicFallbackActions > 0],
  ];
  for (const [code, passed] of assertions) if (!passed) mismatchCaseIds.push(code);

  if (receiptCrashCount !== 0) mismatchCaseIds.push("g1g7-receipt-crash");

  const allExpectationsMet = mismatchCaseIds.length === 0;

  return {
    ...report,

    genesisInvariantChecksRun: genesisInvariants.checksRun,
    genesisInvariantChecksPassed: genesisInvariants.checksPassed,
    genesisInvariantsPassed: genesisInvariants.allPassed,

    dangerousRegressionCount,
    colonyVocabularySafe,
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
  console.log(JSON.stringify(runDemoColonyGenesis(), null, 2));
}
