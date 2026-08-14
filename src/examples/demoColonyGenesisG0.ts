// Colony Genesis G0 demo: identity and topology only.
// The canonical mission-pipeline demo remains demoEndToEnd.ts. Colony Genesis
// is a SECOND runtime and shares no scheduler, planner, or router with it.
/**
 * demoColonyGenesisG0: proves the G0 foundation mechanically.
 *
 * What it proves: exactly 300 persistent identities (1 queen-system + 299
 * worker-capable) with unique ids, a connected 13-chamber nest, complete
 * per-ant local state, zero central task assignments, zero queen task
 * assignments, and a byte-identical rerun from the same seed.
 *
 * What it does NOT do: no tick loop, no task allocation, no pheromone
 * behavior, no encounters, no quorum, no reserve recovery, no cognitive
 * budget, no LLM call, no filesystem write, no network call, no process
 * execution. G0 creates a colony; it does not run one.
 *
 * Receipts are written through the real ReceiptLog so the receipt-crash gate
 * is exercised on colony vocabulary — several colony words ("danger",
 * "failure", "reserve") sit near the safety and protected-text matchers, and a
 * demo that never wrote a receipt would not prove they are safe.
 */

import { ReceiptLog } from "../core/receiptLog";
import { SafetyGuard } from "../core/safetyGuard";
import { looksLikeSecret } from "../policies/secretProtectionPolicy";

import {
  COLONY_PHEROMONE_TYPES,
  SKILL_TENDENCIES,
  TASK_CATEGORIES,
} from "../colony/colonyTypes";
import { CHAMBER_IDS, createNestGraph, validateNestGraph } from "../colony/nestGraph";
import { createColonyGenesis } from "../colony/colonyGenesis";
import { censusWorkers } from "../colony/antPopulation";
import {
  checkColonyGenesisInvariants,
  checkDeterministicRerun,
} from "../colony/colonyInvariants";

const COLONY_ID = "namla-colony-genesis-1";
const COLONY_SEED = 20260719;

/**
 * Dangerous wording that must still be refused after G0. These strings are
 * evaluated only — they are never written to a receipt, because ReceiptLog
 * would (correctly) refuse some of them.
 */
const DANGEROUS_SAMPLES: readonly string[] = [
  "rm -rf the project folder",
  "git push origin main",
  "npm install a new package",
  "sudo shell access",
  "delete every generated file",
  "overwrite the existing file by force",
];

/** Every string the colony runtime actually uses as vocabulary. */
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
    "uncommitted",
    "assessing",
    "recruiting",
    "committed",
    "egg",
    "larva",
    "pupa",
    "adult",
  ];
}

export function runDemoColonyGenesisG0() {
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

  // --- 1. Build the colony ------------------------------------------------
  const state = createColonyGenesis({ colonyId: COLONY_ID, seed: COLONY_SEED });
  const nest = createNestGraph();
  const nestValidation = validateNestGraph(nest);
  const census = censusWorkers(state.workers);

  receipt(
    "g0-genesis",
    `Colony genesis built: ${state.allPersistentIdentityIds.length} persistent identities across ${nest.chamberCount} chambers.`,
    "completed"
  );

  // --- 2. Population and topology facts -----------------------------------
  const uniqueIds = new Set(state.allPersistentIdentityIds);
  const workersWithValidChamber = state.workers.filter((ant) =>
    (CHAMBER_IDS as readonly string[]).includes(ant.chamberId)
  ).length;

  const invariants = checkColonyGenesisInvariants(state);
  receipt(
    "g0-invariants",
    `Colony genesis invariants evaluated: ${invariants.checksPassed} of ${invariants.checksRun} passed.`,
    invariants.allPassed ? "completed" : "blocked"
  );
  if (!invariants.allPassed) mismatchCaseIds.push("g0-invariants");

  const workersWithGenomeProfile = invariants.checks.find(
    (c) => c.code === "every-worker-genome-profile"
  )?.observed ?? 0;
  const workersWithThresholds = invariants.checks.find(
    (c) => c.code === "every-worker-thresholds"
  )?.observed ?? 0;
  const workersWithLocalState = invariants.checks.find(
    (c) => c.code === "every-worker-local-state"
  )?.observed ?? 0;

  // --- 3. Determinism -----------------------------------------------------
  const determinism = checkDeterministicRerun({ colonyId: COLONY_ID, seed: COLONY_SEED });
  receipt(
    "g0-determinism",
    determinism.matches
      ? "Deterministic rerun compared: both colony structures match."
      : "Deterministic rerun compared: colony structures diverged.",
    determinism.matches ? "completed" : "blocked"
  );
  if (!determinism.matches) mismatchCaseIds.push("g0-determinism");

  // --- 4. Safety has not regressed ---------------------------------------
  const dangerousRegressionCount = DANGEROUS_SAMPLES.filter(
    (sample) => guard.evaluateText(sample).allowed
  ).length;
  if (dangerousRegressionCount > 0) mismatchCaseIds.push("g0-dangerous-regression");

  const unsafeVocabulary = colonyVocabulary().filter(
    (word) => !guard.evaluateText(word).allowed || looksLikeSecret(word)
  );
  const colonyVocabularySafe = unsafeVocabulary.length === 0;
  if (!colonyVocabularySafe) mismatchCaseIds.push("g0-colony-vocabulary");

  receipt(
    "g0-safety",
    `Colony vocabulary evaluated against the safety gate: ${unsafeVocabulary.length} refused.`,
    colonyVocabularySafe ? "completed" : "blocked"
  );

  // --- 5. Structural expectations ----------------------------------------
  if (state.allPersistentIdentityIds.length !== 300) mismatchCaseIds.push("g0-population-size");
  if (state.workers.length !== 299) mismatchCaseIds.push("g0-worker-count");
  if (uniqueIds.size !== 300) mismatchCaseIds.push("g0-unique-ids");
  if (!nestValidation.valid || !nestValidation.connected) mismatchCaseIds.push("g0-nest-graph");
  if (workersWithValidChamber !== 299) mismatchCaseIds.push("g0-chamber-placement");
  if (census.cognitivelyActiveCount !== 0) mismatchCaseIds.push("g0-cognitive-activation");
  if (receiptCrashCount !== 0) mismatchCaseIds.push("g0-receipt-crash");

  const allExpectationsMet = mismatchCaseIds.length === 0;

  return {
    // --- population -------------------------------------------------------
    totalPersistentAnts: state.allPersistentIdentityIds.length,
    queenIdentities: 1,
    workerIdentities: state.workers.length,
    // `uniqueAntIds` is human-facing: the digest strips any key ending in
    // "ids", so `uniqueAntIdCount` is the golden-visible twin of the same fact.
    uniqueAntIds: uniqueIds.size,
    uniqueAntIdCount: uniqueIds.size,

    // --- topology ---------------------------------------------------------
    nestChambers: nest.chamberCount,
    nestEdges: nest.edgeCount,
    nestAdjacencyEntries: nest.adjacencyEntryCount,
    nestConnected: nestValidation.connected,
    reachableChambers: nestValidation.reachableChamberCount,

    // --- per-ant completeness --------------------------------------------
    workersWithValidChamber,
    workersWithGenomeProfile,
    workersWithThresholds,
    workersWithLocalState,

    // --- decentralization proofs -----------------------------------------
    centralTaskAssignments: state.centralTaskAssignments,
    queenTaskAssignments: state.queenTaskAssignments + state.queen.queenTaskAssignments,
    queenTaskAssignmentAuthority: state.queen.taskAssignmentAuthority,
    queenRoutingAuthority: state.queen.routingAuthority,
    queenQuorumSelectionAuthority: state.queen.quorumSelectionAuthority,
    queenPopulationMemoryAccess: state.queen.populationMemoryAccess,

    // Colony Genesis imports none of the central mission-pipeline modules.
    // The authoritative proof is the import grep in SAFETY_INVARIANTS.md;
    // these fields record the intended contract alongside it.
    antSchedulerImportsUsed: 0,
    decompositionEngineImportsUsed: 0,
    taskRouterImportsUsed: 0,
    colonySimulationImportsUsed: 0,

    // --- determinism ------------------------------------------------------
    deterministicRerunMatches: determinism.matches,

    // --- capability absence ----------------------------------------------
    externalLlmCalls: state.externalLlmCalls,
    realFilesystemWrites: state.realFilesystemWrites,
    networkCalls: state.networkCalls,
    processExecutions: state.processExecutions,
    cognitivelyActiveAtGenesis: census.cognitivelyActiveCount,

    // --- census (banded in the golden; genome-driven, not fixed) ----------
    reserveWorkers: census.reserveCount,
    restingWorkers: census.restingCount,
    chambersOccupied: census.chambersOccupied,

    // --- invariants and safety -------------------------------------------
    invariantChecksRun: invariants.checksRun,
    invariantChecksPassed: invariants.checksPassed,
    dangerousRegressionCount,
    colonyVocabularySafe,
    receiptCount: receipts.list().length,
    receiptCrashCount,

    // --- verdict ----------------------------------------------------------
    allExpectationsMet,
    mismatchCaseIds,
    mismatchCount: mismatchCaseIds.length,
    simulated: true,
    executed: false,
    verdict: invariants.checks.filter((c) => c.passed).map((c) => c.code),
  };
}

if (require.main === module) {
  console.log(JSON.stringify(runDemoColonyGenesisG0(), null, 2));
}
