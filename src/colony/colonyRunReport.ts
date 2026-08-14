/**
 * Colony Genesis G1-G7 — the run report.
 *
 * Aggregates one `runColonyTicks` result into the exact set of mechanically
 * checkable facts NAMLA_BUILD_LAW.md Sections 13-15 and the demo need:
 * population identity across the run, the decentralization counters (still
 * literal zero), the pheromone/encounter/movement/learning activity counts,
 * reserve activation, recruitment/quorum activity, brood lifecycle and
 * nursing activity, generation transitions, and the cognitive-budget
 * ceiling.
 *
 * `reserveActivationCount` is read from the immutable `startsInReserve`
 * field (not `activationMode`, which G7 now legitimately mutates per tick).
 * `peakCognitiveEligibility` (an existing G1-G3 field, kept for backward
 * compatibility) is a FINAL-state snapshot, sound because
 * `resolveCognitionClaims` structurally caps every tick's admission at
 * `MAX_COGNITIVE_BUDGET` — the final tick's admitted count can never exceed
 * it either. `observedPeakCognitivelyActiveAnts` is the stronger claim: the
 * true maximum across every tick of the run, not just the last one.
 *
 * Authorized by NAMLA_BUILD_LAW.md Section 13 (Colony Genesis G1-G3),
 * Section 14 (Colony Genesis G4-G5), and Section 15 (Colony Genesis G6-G7).
 *
 * No fs, no wall clock, no ambient randomness, no module-level mutable state.
 */

import type { ColonyGenesisState } from "./colonyGenesis";
import type { ColonyRunResult } from "./colonyTickRunner";
import { COGNITIVELY_ACTIVE_MODES, COLONY_PHEROMONE_TYPES } from "./colonyTypes";
import { PHEROMONE_DECISION_SITES } from "./pheromoneField";
import { MAX_COGNITIVE_BUDGET } from "./cognitiveBudgetSystem";

export interface ColonyRunReport {
  readonly totalPersistentAnts: number;
  readonly queenIdentities: 1;
  readonly workerIdentities: number;
  readonly uniqueAntIds: number;
  readonly ticksExecuted: number;

  readonly localTaskDecisions: number;
  readonly centralTaskAssignments: 0;
  readonly queenTaskAssignments: 0;
  readonly encounters: number;
  readonly movementCount: number;
  readonly pheromonesDeposited: number;
  readonly pheromonesRead: number;
  readonly pheromonesReinforced: number;
  readonly pheromonesDecayed: number;
  readonly taskSwitchCount: number;
  readonly specializationChanges: number;

  readonly reserveActivationCount: number;
  readonly recruitmentEvents: number;
  readonly quorumLocalCommitments: number;

  // --- G6: brood lifecycle, nursing, population renewal, generations ---
  readonly broodRecordsCreated: number;
  readonly broodLifecycleTransitions: number;
  readonly nursingStimulusEvents: number;
  readonly nursingLocalResponses: number;
  readonly queenDirectNursingAssignments: 0;
  readonly populationRenewals: number;
  readonly generationTransitions: number;
  readonly workerRetirements: number;
  readonly workerSenescenceEntries: number;
  readonly workerRecoveryEntries: number;

  // --- G7: cognitive budget ---
  readonly cognitionClaims: number;
  readonly cognitionClaimsAccepted: number;
  readonly cognitionClaimsRejected: number;
  readonly peakCognitionClaims: number;
  readonly observedPeakCognitivelyActiveAnts: number;
  readonly maximumCognitiveBudget: 30;
  readonly cognitiveBudgetViolations: number;
  readonly deterministicFallbackActions: number;

  readonly populationIdentityPreserved: boolean;

  readonly externalLlmCalls: 0;
  readonly realFilesystemWrites: 0;
  readonly networkCalls: 0;
  readonly processExecutions: 0;

  readonly peakCognitiveEligibility: number;
  readonly peakCognitiveEligibilityAtMost30: boolean;

  readonly pheromoneTypesWithDecisionSite: number;
  readonly allPheromoneTypesHaveDecisionSite: boolean;
}

export function buildColonyRunReport(genesis: ColonyGenesisState, runResult: ColonyRunResult): ColonyRunReport {
  const { finalState, ticksExecuted, totals } = runResult;
  const finalWorkers = finalState.workers;

  const genesisIds = new Set<string>([genesis.queen.queenId, ...genesis.workers.map((ant) => ant.antId)]);
  const finalIds = new Set<string>([finalState.queen.queenId, ...finalWorkers.map((ant) => ant.antId)]);

  let sameMembers = genesisIds.size === finalIds.size;
  if (sameMembers) {
    for (const id of genesisIds) {
      if (!finalIds.has(id)) {
        sameMembers = false;
        break;
      }
    }
  }
  const populationIdentityPreserved = sameMembers && finalIds.size === genesis.allPersistentIdentityIds.length;

  const cognitivelyActiveCount = finalWorkers.filter((ant) =>
    (COGNITIVELY_ACTIVE_MODES as readonly string[]).includes(ant.activationMode)
  ).length;

  const decisionSiteCount = Object.keys(PHEROMONE_DECISION_SITES).length;

  // G7 makes activationMode mutable (an admitted ant's mode becomes
  // "llm-eligible" for the tick it wins a cognitive-budget slot), so "started
  // in reserve" is read from the immutable startsInReserve field, not from
  // activationMode.
  const reserveActivationCount = finalWorkers.filter(
    (ant) => ant.startsInReserve && ant.currentBehaviorState !== "reserve"
  ).length;

  return {
    totalPersistentAnts: finalIds.size,
    queenIdentities: 1,
    workerIdentities: finalWorkers.length,
    uniqueAntIds: finalIds.size,
    ticksExecuted,

    localTaskDecisions: totals.localTaskDecisions,
    centralTaskAssignments: 0,
    queenTaskAssignments: 0,
    encounters: totals.encounters,
    movementCount: totals.movementCount,
    pheromonesDeposited: totals.pheromonesDeposited,
    pheromonesRead: totals.pheromonesRead,
    pheromonesReinforced: totals.pheromonesReinforced,
    pheromonesDecayed: totals.pheromonesDecayed,
    taskSwitchCount: totals.taskSwitchCount,
    specializationChanges: totals.specializationChanges,

    reserveActivationCount,
    recruitmentEvents: totals.recruitmentEvents,
    quorumLocalCommitments: totals.quorumLocalCommitments,

    broodRecordsCreated: totals.broodRecordsCreated,
    broodLifecycleTransitions: totals.broodLifecycleTransitions,
    nursingStimulusEvents: totals.nursingStimulusEvents,
    nursingLocalResponses: totals.nursingLocalResponses,
    queenDirectNursingAssignments: 0,
    populationRenewals: totals.populationRenewals,
    generationTransitions: totals.generationTransitions,
    workerRetirements: totals.workerRetirements,
    workerSenescenceEntries: totals.workerSenescenceEntries,
    workerRecoveryEntries: totals.workerRecoveryEntries,

    cognitionClaims: totals.cognitionClaims,
    cognitionClaimsAccepted: totals.cognitionClaimsAccepted,
    cognitionClaimsRejected: totals.cognitionClaimsRejected,
    peakCognitionClaims: totals.peakCognitionClaimsThisTick,
    observedPeakCognitivelyActiveAnts: totals.peakCognitivelyActiveThisTick,
    maximumCognitiveBudget: MAX_COGNITIVE_BUDGET,
    cognitiveBudgetViolations: totals.peakCognitivelyActiveThisTick > MAX_COGNITIVE_BUDGET ? 1 : 0,
    deterministicFallbackActions: totals.cognitionClaimsRejected,

    populationIdentityPreserved,

    externalLlmCalls: 0,
    realFilesystemWrites: 0,
    networkCalls: 0,
    processExecutions: 0,

    peakCognitiveEligibility: cognitivelyActiveCount,
    peakCognitiveEligibilityAtMost30: cognitivelyActiveCount <= 30,

    pheromoneTypesWithDecisionSite: decisionSiteCount,
    allPheromoneTypesHaveDecisionSite: decisionSiteCount === COLONY_PHEROMONE_TYPES.length,
  };
}
