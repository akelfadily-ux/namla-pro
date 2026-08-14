/**
 * demoColonyScale: proves the G1-G7 colony core stays bounded and
 * deterministic at 300, 1,000, and 10,000 persistent identities, using the
 * same reusable `AntAgent` model and the same tick loop at every scale — no
 * per-scale source, no per-ant class, no O(N^2) interaction anywhere.
 *
 * "Persistent identities" is a completely different quantity from
 * "simultaneous model calls": every scale here still submits deterministic-
 * local decisions the same way, and the cognitive budget stays capped at 30
 * regardless of whether the colony holds 300 or 10,000 identities. 10,000
 * identities do not mean 10,000 active models — G7 has never called one.
 *
 * Larger scales run fewer ticks purely to keep this demo's own runtime
 * bounded; nothing about the mechanisms themselves is tick-count-dependent,
 * and no wall-clock elapsed time is used as a golden assertion anywhere in
 * this file — only counts and structural facts are.
 *
 * Also proves, separately from the fixed-population scale runs (which never
 * have cap headroom, by design — see demoColonyGenesis.ts), that
 * `admitMaturedBroodIfRoom` genuinely creates a new persistent identity when
 * the population cap is NOT already saturated.
 */

import { createColonyGenesis } from "../colony/colonyGenesis";
import { createInitialTickState, runColonyTicks } from "../colony/colonyTickRunner";
import { buildColonyRunReport } from "../colony/colonyRunReport";
import { ENCOUNTER_MEMORY_CAPACITY } from "../colony/antAgent";
import { COLONY_PHEROMONE_TYPES } from "../colony/colonyTypes";
import { CHAMBER_IDS } from "../colony/nestGraph";
import { MAX_COGNITIVE_BUDGET } from "../colony/cognitiveBudgetSystem";

const COLONY_ID = "namla-colony-scale";

export interface ScalePopulationReport {
  readonly scaleLabel: string;
  readonly workerCount: number;
  readonly ticksExecuted: number;

  readonly persistentIdentityCount: number;
  readonly uniqueIdentityCount: number;
  readonly queenIdentityCount: number;
  readonly workerIdentityCount: number;

  readonly localTaskDecisions: number;
  readonly encounterCount: number;
  readonly maximumEncounterWindow: number;
  readonly pheromoneCellCount: number;
  readonly pheromoneReadCount: number;

  readonly centralTaskAssignments: number;
  readonly queenTaskAssignments: number;

  readonly peakCognitiveClaims: number;
  readonly peakCognitivelyActive: number;
  readonly maximumCognitiveBudget: number;

  readonly boundedMemoryConfirmed: boolean;
  readonly noAllToAllInteraction: boolean;
  readonly deterministicRerunMatches: boolean;

  readonly externalLlmCalls: number;
  readonly realNetworkCalls: number;
  readonly realFilesystemWrites: number;
  readonly processExecutions: number;

  readonly allExpectationsMet: boolean;
  readonly mismatchCaseIds: readonly string[];
}

function runOnePopulationScale(scaleLabel: string, workerCount: number, ticks: number, seed: number): ScalePopulationReport {
  const genesis = createColonyGenesis({ colonyId: COLONY_ID, seed, workerCount });
  const initial = createInitialTickState(genesis);
  const runResult = runColonyTicks(initial, ticks);
  const report = buildColonyRunReport(genesis, runResult);

  // Determinism: build and run the identical (seed, workerCount, ticks)
  // configuration a second time, independently, and compare the full report.
  const genesisAgain = createColonyGenesis({ colonyId: COLONY_ID, seed, workerCount });
  const initialAgain = createInitialTickState(genesisAgain);
  const runResultAgain = runColonyTicks(initialAgain, ticks);
  const reportAgain = buildColonyRunReport(genesisAgain, runResultAgain);
  const deterministicRerunMatches = JSON.stringify(report) === JSON.stringify(reportAgain);

  // Bounded memory: every ant's own bounded local lists stay within their
  // fixed caps regardless of population size — checked on the real final
  // state, not assumed from the type.
  const boundedMemoryConfirmed = runResult.finalState.workers.every(
    (ant) =>
      ant.recentEncounterMemory.length <= ENCOUNTER_MEMORY_CAPACITY && ant.privateCandidateAssessments.length <= 8
  );

  // No all-to-all interaction: each ant records at most 2 bounded encounters
  // per tick by construction (encounterNetwork.ts), so total encounters can
  // never exceed 2 * population * ticks — linear in population, never
  // quadratic. Checked as a real inequality against the actual count, not
  // asserted.
  const encounterUpperBound = 2 * workerCount * report.ticksExecuted;
  const noAllToAllInteraction = report.encounters <= encounterUpperBound;

  const pheromoneCellCount = CHAMBER_IDS.length * COLONY_PHEROMONE_TYPES.length;

  const mismatchCaseIds: string[] = [];
  const assertions: ReadonlyArray<readonly [string, boolean]> = [
    ["persistent-identity-count-matches", report.totalPersistentAnts === workerCount + 1],
    ["unique-identity-count-matches", report.uniqueAntIds === workerCount + 1],
    ["central-task-assignments-zero", report.centralTaskAssignments === 0],
    ["queen-task-assignments-zero", report.queenTaskAssignments === 0],
    ["peak-cognitively-active-at-most-30", report.observedPeakCognitivelyActiveAnts <= MAX_COGNITIVE_BUDGET],
    ["cognitive-budget-violations-zero", report.cognitiveBudgetViolations === 0],
    ["bounded-memory-confirmed", boundedMemoryConfirmed],
    ["no-all-to-all-interaction", noAllToAllInteraction],
    ["deterministic-rerun-matches", deterministicRerunMatches],
    ["external-llm-calls-zero", report.externalLlmCalls === 0],
    ["network-calls-zero", report.networkCalls === 0],
    ["real-filesystem-writes-zero", report.realFilesystemWrites === 0],
    ["process-executions-zero", report.processExecutions === 0],
    ["population-identity-preserved", report.populationIdentityPreserved === true],
  ];
  for (const [code, passed] of assertions) if (!passed) mismatchCaseIds.push(code);

  return {
    scaleLabel,
    workerCount,
    ticksExecuted: report.ticksExecuted,

    persistentIdentityCount: report.totalPersistentAnts,
    uniqueIdentityCount: report.uniqueAntIds,
    queenIdentityCount: report.queenIdentities,
    workerIdentityCount: report.workerIdentities,

    localTaskDecisions: report.localTaskDecisions,
    encounterCount: report.encounters,
    maximumEncounterWindow: ENCOUNTER_MEMORY_CAPACITY,
    pheromoneCellCount,
    pheromoneReadCount: report.pheromonesRead,

    centralTaskAssignments: report.centralTaskAssignments,
    queenTaskAssignments: report.queenTaskAssignments,

    peakCognitiveClaims: report.peakCognitionClaims,
    peakCognitivelyActive: report.observedPeakCognitivelyActiveAnts,
    maximumCognitiveBudget: report.maximumCognitiveBudget,

    boundedMemoryConfirmed,
    noAllToAllInteraction,
    deterministicRerunMatches,

    externalLlmCalls: report.externalLlmCalls,
    realNetworkCalls: report.networkCalls,
    realFilesystemWrites: report.realFilesystemWrites,
    processExecutions: report.processExecutions,

    allExpectationsMet: mismatchCaseIds.length === 0,
    mismatchCaseIds,
  };
}

export interface PopulationRenewalProofResult {
  readonly startingWorkerCount: number;
  readonly populationCap: number;
  readonly finalWorkerCount: number;
  readonly populationRenewalsObserved: number;
  readonly renewalMechanismProven: boolean;
}

/**
 * Everywhere else in this codebase the population cap is always already
 * saturated at genesis (by design — see NAMLA_BUILD_LAW.md Section 15's
 * bounded population policy), so `admitMaturedBroodIfRoom` never actually
 * admits anyone in demoColonyGenesis or the fixed-scale runs above. This
 * runs one small colony with deliberate cap headroom to prove the admission
 * mechanism itself is real, not dead code — the ONE place in this file
 * population size is allowed to grow past its genesis count.
 */
function proveRenewalMechanism(): PopulationRenewalProofResult {
  const startingWorkerCount = 20;
  const populationCap = 40;
  const genesis = createColonyGenesis({ colonyId: COLONY_ID, seed: 777, workerCount: startingWorkerCount });
  const initial = createInitialTickState(genesis, { populationCap });
  const runResult = runColonyTicks(initial, 700);

  const finalWorkerCount = runResult.finalState.workers.length;
  const populationRenewalsObserved = runResult.totals.populationRenewals;

  return {
    startingWorkerCount,
    populationCap,
    finalWorkerCount,
    populationRenewalsObserved,
    renewalMechanismProven: populationRenewalsObserved > 0 && finalWorkerCount > startingWorkerCount,
  };
}

export function runDemoColonyScale() {
  const scales = [
    runOnePopulationScale("300", 299, 400, 20260719),
    runOnePopulationScale("1000", 999, 100, 20260720),
    runOnePopulationScale("10000", 9999, 20, 20260721),
  ];

  const renewalProof = proveRenewalMechanism();

  const allExpectationsMet = scales.every((s) => s.allExpectationsMet) && renewalProof.renewalMechanismProven;

  return {
    scales,
    renewalProof,
    allExpectationsMet,
    externalLlmCalls: 0,
    realNetworkCalls: 0,
    realFilesystemWrites: 0,
    processExecutions: 0,
  };
}

if (require.main === module) {
  console.log(JSON.stringify(runDemoColonyScale(), null, 2));
}
