/**
 * Colony Genesis G1-G7 — the bounded per-tick behavior loop.
 *
 * `runColonyTick` advances one colony state by exactly one tick: every ant —
 * reserve included, as of G4 — reads its own chamber, chooses its own next
 * `WorkState`, learns from its own outcome, ages and metabolizes, may
 * submit a bounded cognition claim, and may move to one adjacent chamber.
 * There is no task list and no scheduler — the loop iterates ANTS, never
 * TASKS, and each ant answers for itself. `centralTaskAssignments` and
 * `queenTaskAssignments` stay literal-zero because no code path here ever
 * assigns anything to anyone; the Queen record is threaded through and only
 * ever updated by its own continuity/generation logic, never told what any
 * ant should do.
 *
 * G4: reserve ants are no longer skipped. They run through the exact same
 * local machinery as every other ant; their G0 threshold multiplier (1.45x)
 * is the entire reason they engage later, never a different code path.
 *
 * G5: after G2 encounters, `runChamberRecruitmentAndQuorum` gives ants a
 * bounded, chamber-local, one-tick recruitment channel and local quorum
 * sensing — never a global tally, never a declared winner.
 *
 * G6: brood exist as a small, separately bounded record set (never AntAgents
 * until admitted), raise local nursing stimulus that the EXISTING G1-G3
 * response-threshold system already lets ants respond to, and mature faster
 * when nursed. Admission into a real persistent identity is strictly gated
 * by the population cap — in the default 300-population demo the cap is
 * already saturated at genesis, so admission structurally cannot fire, by
 * design (NAMLA_BUILD_LAW.md Section 15's bounded population policy).
 * Worker aging/energy/health/retirement activates the fields G0 left
 * neutrally initialized; a retired ant keeps its identity forever and simply
 * stops choosing new tasks.
 *
 * G7: after an ant's task is already fully decided by the same G1-G3
 * machinery, it may submit a cognition claim computed from only its own
 * local state. `resolveCognitionClaims` — the one deliberately centralized
 * step, pre-authorized by the biological-model doc as bounded resource
 * admission rather than task assignment — admits at most
 * `MAX_COGNITIVE_BUDGET` claims this tick and labels only those ants
 * `"llm-eligible"`. No external model is ever called.
 *
 * `runColonyTicks` bounds the whole run with a hard-coded, tighten-only tick
 * cap. It runs only when a human-run script calls it; nothing continues after
 * the call returns, and there are no timers, watchers, or background loops.
 *
 * Authorized by NAMLA_BUILD_LAW.md Section 13 (Colony Genesis G1-G3),
 * Section 14 (Colony Genesis G4-G5), and Section 15 (Colony Genesis G6-G7).
 *
 * No fs, no wall clock, no ambient randomness, no module-level mutable state,
 * no external call of any kind.
 */

import type { AntAgent } from "./antAgent";
import type { ColonyGenesisState } from "./colonyGenesis";
import type { ColonyGenome } from "./colonyGenome";
import type { ColonyPheromoneType, TaskCategory } from "./colonyTypes";
import { TASK_CATEGORIES, clamp, createSeededRandom } from "./colonyTypes";
import type { ChamberId, ChamberPurpose, NestGraph } from "./nestGraph";
import { CHAMBER_IDS } from "./nestGraph";
import type { QueenContinuityRecord } from "./queenContinuitySystem";
import { maybeAdvanceGeneration } from "./queenContinuitySystem";
import { workerIdentityId } from "./antPopulation";

import type { PheromoneField } from "./pheromoneField";
import { createEmptyPheromoneField, decayPheromoneField, depositPheromone, readPheromone, readPheromonesAtChamber } from "./pheromoneField";
import type { TaskStimulusField } from "./taskStimulusField";
import {
  createInitialTaskStimulusField,
  readChamberTaskStimulus,
  regenerateTaskStimulus,
  relieveTaskStimulus,
} from "./taskStimulusField";
import { encounterSuccessRate, runChamberEncounters } from "./encounterNetwork";
import { applyForgetting, applyLearning } from "./responseThresholdSystem";
import { chooseWorkState, isTaskCategory } from "./localTaskChoice";
import { decideMovement } from "./antMovement";
import { maybeFormNewAssessment, runChamberRecruitmentAndQuorum } from "./recruitmentQuorumSystem";
import { advanceWorkerLifecycle, isWithdrawnFromActiveDuty } from "./workerLifecycleSystem";
import type { BroodRecord } from "./broodLifecycleSystem";
import { advanceBroodPopulation, buildBroodOriginAntAgent } from "./broodLifecycleSystem";
import type { CognitionClaim } from "./cognitiveBudgetSystem";
import { MAX_COGNITIVE_BUDGET, computeCognitionClaim, resolveCognitionClaims } from "./cognitiveBudgetSystem";

export interface ColonyTickState {
  readonly tick: number;
  readonly colonySeed: number;
  readonly genome: ColonyGenome;
  readonly nestGraph: NestGraph;
  readonly queen: QueenContinuityRecord;
  readonly workers: readonly AntAgent[];
  readonly taskStimulusField: TaskStimulusField;
  readonly pheromoneField: PheromoneField;

  // --- G6: brood + population bookkeeping ---
  readonly liveBrood: readonly BroodRecord[];
  readonly nextBroodIndex: number;
  readonly broodCreatedThisGeneration: number;
  readonly nextWorkerIndex: number;
  /** Hard ceiling on total persistent identities. Genesis size by default. */
  readonly populationCap: number;
}

export interface TickMetrics {
  readonly localTaskDecisions: number;
  readonly encounters: number;
  readonly movementCount: number;
  readonly pheromonesDeposited: number;
  readonly pheromonesRead: number;
  readonly pheromonesReinforced: number;
  readonly pheromonesDecayed: number;
  readonly taskSwitchCount: number;
  readonly specializationChanges: number;
  readonly recruitmentEvents: number;
  readonly quorumLocalCommitments: number;

  // --- G6 ---
  readonly broodRecordsCreated: number;
  readonly broodLifecycleTransitions: number;
  readonly nursingStimulusEvents: number;
  readonly nursingLocalResponses: number;
  readonly populationRenewals: number;
  readonly generationTransitions: number;
  readonly workerRetirements: number;
  readonly workerSenescenceEntries: number;
  readonly workerRecoveryEntries: number;

  // --- G7 ---
  readonly cognitionClaims: number;
  readonly cognitionClaimsAccepted: number;
  readonly cognitionClaimsRejected: number;
  /** NOT summed across ticks by addMetrics — see its max-combine special case. */
  readonly peakCognitivelyActiveThisTick: number;
  /** NOT summed across ticks by addMetrics — see its max-combine special case. */
  readonly peakCognitionClaimsThisTick: number;
}

function zeroMetrics(): TickMetrics {
  return {
    localTaskDecisions: 0,
    encounters: 0,
    movementCount: 0,
    pheromonesDeposited: 0,
    pheromonesRead: 0,
    pheromonesReinforced: 0,
    pheromonesDecayed: 0,
    taskSwitchCount: 0,
    specializationChanges: 0,
    recruitmentEvents: 0,
    quorumLocalCommitments: 0,
    broodRecordsCreated: 0,
    broodLifecycleTransitions: 0,
    nursingStimulusEvents: 0,
    nursingLocalResponses: 0,
    populationRenewals: 0,
    generationTransitions: 0,
    workerRetirements: 0,
    workerSenescenceEntries: 0,
    workerRecoveryEntries: 0,
    cognitionClaims: 0,
    cognitionClaimsAccepted: 0,
    cognitionClaimsRejected: 0,
    peakCognitivelyActiveThisTick: 0,
    peakCognitionClaimsThisTick: 0,
  };
}

function addMetrics(a: TickMetrics, b: TickMetrics): TickMetrics {
  return {
    localTaskDecisions: a.localTaskDecisions + b.localTaskDecisions,
    encounters: a.encounters + b.encounters,
    movementCount: a.movementCount + b.movementCount,
    pheromonesDeposited: a.pheromonesDeposited + b.pheromonesDeposited,
    pheromonesRead: a.pheromonesRead + b.pheromonesRead,
    pheromonesReinforced: a.pheromonesReinforced + b.pheromonesReinforced,
    pheromonesDecayed: a.pheromonesDecayed + b.pheromonesDecayed,
    taskSwitchCount: a.taskSwitchCount + b.taskSwitchCount,
    specializationChanges: a.specializationChanges + b.specializationChanges,
    recruitmentEvents: a.recruitmentEvents + b.recruitmentEvents,
    quorumLocalCommitments: a.quorumLocalCommitments + b.quorumLocalCommitments,
    broodRecordsCreated: a.broodRecordsCreated + b.broodRecordsCreated,
    broodLifecycleTransitions: a.broodLifecycleTransitions + b.broodLifecycleTransitions,
    nursingStimulusEvents: a.nursingStimulusEvents + b.nursingStimulusEvents,
    nursingLocalResponses: a.nursingLocalResponses + b.nursingLocalResponses,
    populationRenewals: a.populationRenewals + b.populationRenewals,
    generationTransitions: a.generationTransitions + b.generationTransitions,
    workerRetirements: a.workerRetirements + b.workerRetirements,
    workerSenescenceEntries: a.workerSenescenceEntries + b.workerSenescenceEntries,
    workerRecoveryEntries: a.workerRecoveryEntries + b.workerRecoveryEntries,
    cognitionClaims: a.cognitionClaims + b.cognitionClaims,
    cognitionClaimsAccepted: a.cognitionClaimsAccepted + b.cognitionClaimsAccepted,
    cognitionClaimsRejected: a.cognitionClaimsRejected + b.cognitionClaimsRejected,
    // Peak, not total — a running max across ticks, never a sum.
    peakCognitivelyActiveThisTick: Math.max(a.peakCognitivelyActiveThisTick, b.peakCognitivelyActiveThisTick),
    peakCognitionClaimsThisTick: Math.max(a.peakCognitionClaimsThisTick, b.peakCognitionClaimsThisTick),
  };
}

function bumpDeposit(metrics: TickMetrics, wasReinforced: boolean): TickMetrics {
  return {
    ...metrics,
    pheromonesDeposited: metrics.pheromonesDeposited + 1,
    pheromonesReinforced: metrics.pheromonesReinforced + (wasReinforced ? 1 : 0),
  };
}

const SALT_ENGAGEMENT = 0x1b873593;
const SALT_SUCCESS = 0x27220a95;
const SALT_LEAVE = 0x85ebca6b;
const SALT_DEST = 0xc2b2ae35;
const SALT_DANGER = 0x9e3779b9;

function drawForAnt(colonySeed: number, antIndex: number, tick: number, salt: number): number {
  const h =
    (Math.imul(colonySeed ^ salt, 2654435761) ^ Math.imul(antIndex + 1, 40503) ^ Math.imul(tick + 1, 2246822519)) >>> 0;
  return createSeededRandom(h)();
}

function hashChamberId(chamberId: ChamberId): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < chamberId.length; i += 1) hash = Math.imul(hash ^ chamberId.charCodeAt(i), 16777619);
  return hash >>> 0;
}

function drawForChamber(colonySeed: number, chamberId: ChamberId, tick: number, salt: number): number {
  const h =
    (Math.imul(colonySeed ^ salt, 2654435761) ^ Math.imul(hashChamberId(chamberId), 40503) ^ Math.imul(tick + 1, 2246822519)) >>>
    0;
  return createSeededRandom(h)();
}

/** Extra pheromone deposited on top of generic "success", per category. */
const CATEGORY_SUCCESS_PHEROMONE: Partial<Record<TaskCategory, ColonyPheromoneType>> = {
  scouting: "opportunity",
  foraging: "resource",
  transporting: "resource",
  communicating: "knowledge-found",
  storing: "knowledge-found",
};

const DANGER_PRONE_PURPOSES: readonly ChamberPurpose[] = ["threshold", "external"];
const DANGER_EVENT_CHANCE = 0.04;

export interface CreateInitialTickStateOptions {
  /** Defaults to the genesis population size. Override only to exercise population renewal. */
  readonly populationCap?: number;
}

export function createInitialTickState(genesis: ColonyGenesisState, options?: CreateInitialTickStateOptions): ColonyTickState {
  return {
    tick: 0,
    colonySeed: genesis.seed,
    genome: genesis.genome,
    nestGraph: genesis.nestGraph,
    queen: genesis.queen,
    workers: genesis.workers,
    taskStimulusField: createInitialTaskStimulusField(genesis.nestGraph, genesis.seed),
    pheromoneField: createEmptyPheromoneField(genesis.nestGraph),

    liveBrood: [],
    nextBroodIndex: 0,
    broodCreatedThisGeneration: 0,
    nextWorkerIndex: genesis.workers.length + 1,
    populationCap: options?.populationCap ?? genesis.allPersistentIdentityIds.length,
  };
}

/** Advance one colony state by exactly one tick. Pure: returns new state, never mutates `state`. */
export function runColonyTick(state: ColonyTickState): { nextState: ColonyTickState; metrics: TickMetrics } {
  const { tick, colonySeed, genome, nestGraph, workers } = state;
  let queen = state.queen;
  let metrics = zeroMetrics();

  let stimulusField = regenerateTaskStimulus(state.taskStimulusField, colonySeed, tick);
  let pheromoneFieldWorking = state.pheromoneField;

  const chamberById = new Map(nestGraph.chambers.map((chamber) => [chamber.chamberId, chamber]));
  const succeededThisTick = new Set<string>();
  const nursingSucceededChambers = new Set<ChamberId>();
  const claims: CognitionClaim[] = [];
  const nextWorkers: AntAgent[] = new Array(workers.length);

  for (let idx = 0; idx < workers.length; idx += 1) {
    const ant = workers[idx];

    // G6: a withdrawn ant (retired, or senescent mid-recovery) makes no
    // decision this tick — it still ages/recovers, it just does not choose,
    // learn, claim, or move. Its identity persists unchanged otherwise.
    if (isWithdrawnFromActiveDuty(ant)) {
      const lifecycle = advanceWorkerLifecycle(ant, false, genome);
      if (lifecycle.justRetired) metrics = { ...metrics, workerRetirements: metrics.workerRetirements + 1 };
      if (lifecycle.justEnteredRecovery) {
        metrics = { ...metrics, workerRecoveryEntries: metrics.workerRecoveryEntries + 1 };
      }
      nextWorkers[idx] = lifecycle.ant;
      continue;
    }

    const rawStimulus = readChamberTaskStimulus(stimulusField, ant.chamberId);
    const pheromonesHere = readPheromonesAtChamber(pheromoneFieldWorking, ant.chamberId);
    metrics = { ...metrics, pheromonesRead: metrics.pheromonesRead + 1 };

    // G5: an uncommitted ant may spontaneously form a private candidate
    // assessment from only its own seeded stream and its own chamber's
    // already-read pheromones, independent of whatever task it chooses below.
    const antWithAssessment = maybeFormNewAssessment(ant, colonySeed, tick, pheromonesHere);

    const rate = encounterSuccessRate(antWithAssessment);
    const engagementDraw = drawForAnt(colonySeed, ant.antIndex, tick, SALT_ENGAGEMENT);
    const choice = chooseWorkState({
      ant: antWithAssessment,
      rawStimulus,
      pheromones: pheromonesHere,
      encounterSuccessRate: rate,
      engagementDraw,
    });

    metrics = { ...metrics, localTaskDecisions: metrics.localTaskDecisions + 1 };
    if (choice.switched) metrics = { ...metrics, taskSwitchCount: metrics.taskSwitchCount + 1 };

    let updatedAnt = antWithAssessment;
    let attemptedCategory: TaskCategory | null = null;

    if (isTaskCategory(choice.nextState)) {
      attemptedCategory = choice.nextState;
      const successDraw = drawForAnt(colonySeed, ant.antIndex, tick, SALT_SUCCESS);
      const successProbability = clamp(
        0.85 - ant.responseThresholds[attemptedCategory] * 0.5 + (ant.reliability - 0.5) * 0.3,
        0.1,
        0.95
      );
      const succeeded = successDraw < successProbability;

      const learning = applyLearning(updatedAnt, attemptedCategory, succeeded, genome);
      updatedAnt = { ...learning.ant, currentBehaviorState: attemptedCategory };
      if (learning.thresholdChanged) metrics = { ...metrics, specializationChanges: metrics.specializationChanges + 1 };

      if (attemptedCategory === "nursing") {
        metrics = { ...metrics, nursingLocalResponses: metrics.nursingLocalResponses + 1 };
        if (succeeded) nursingSucceededChambers.add(ant.chamberId);
      }

      if (succeeded) {
        succeededThisTick.add(ant.antId);
        stimulusField = relieveTaskStimulus(stimulusField, ant.chamberId, attemptedCategory, 0.12);

        const successDeposit = depositPheromone(pheromoneFieldWorking, ant.chamberId, "success", 0.2);
        pheromoneFieldWorking = successDeposit.field;
        metrics = bumpDeposit(metrics, successDeposit.wasReinforced);

        const extraType = CATEGORY_SUCCESS_PHEROMONE[attemptedCategory];
        if (extraType) {
          const extraDeposit = depositPheromone(pheromoneFieldWorking, ant.chamberId, extraType, 0.25);
          pheromoneFieldWorking = extraDeposit.field;
          metrics = bumpDeposit(metrics, extraDeposit.wasReinforced);
        }

        if (readPheromone(pheromoneFieldWorking, ant.chamberId, "success") > 0.6) {
          const recruitDeposit = depositPheromone(pheromoneFieldWorking, ant.chamberId, "recruitment", 0.15);
          pheromoneFieldWorking = recruitDeposit.field;
          metrics = bumpDeposit(metrics, recruitDeposit.wasReinforced);
        }
      } else {
        const failDeposit = depositPheromone(pheromoneFieldWorking, ant.chamberId, "failure", 0.2);
        pheromoneFieldWorking = failDeposit.field;
        metrics = bumpDeposit(metrics, failDeposit.wasReinforced);
      }
    } else {
      updatedAnt = { ...updatedAnt, currentBehaviorState: "resting" };
    }

    updatedAnt = applyForgetting(updatedAnt, attemptedCategory, genome);
    updatedAnt = {
      ...updatedAnt,
      localStimulusObservations: rawStimulus,
      localPheromoneObservations: pheromonesHere,
    };

    // G6: metabolic consequence of the choice already made above. Never
    // chooses a task itself — only ages, drains/recovers energy, and drifts
    // health/lifecycle from it.
    const lifecycle = advanceWorkerLifecycle(updatedAnt, attemptedCategory !== null, genome);
    updatedAnt = lifecycle.ant;
    if (lifecycle.justRetired) metrics = { ...metrics, workerRetirements: metrics.workerRetirements + 1 };
    if (lifecycle.justEnteredSenescence) {
      metrics = { ...metrics, workerSenescenceEntries: metrics.workerSenescenceEntries + 1 };
    }
    if (lifecycle.justEnteredRecovery) {
      metrics = { ...metrics, workerRecoveryEntries: metrics.workerRecoveryEntries + 1 };
    }

    // G7: a claim from only this ant's own already-local state. Submitted,
    // not yet resolved — resolution needs every claim this tick.
    const claim = computeCognitionClaim(updatedAnt, attemptedCategory, choice.probabilities, colonySeed, tick);
    if (claim) {
      claims.push(claim);
      metrics = { ...metrics, cognitionClaims: metrics.cognitionClaims + 1 };
    }

    const chamber = chamberById.get(updatedAnt.chamberId)!;
    const leaveDraw = drawForAnt(colonySeed, ant.antIndex, tick, SALT_LEAVE);
    const destinationDraw = drawForAnt(colonySeed, ant.antIndex, tick, SALT_DEST);
    const movement = decideMovement({
      ant: updatedAnt,
      chosenState: updatedAnt.currentBehaviorState,
      pheromones: pheromonesHere,
      adjacentChamberIds: chamber.adjacentChamberIds,
      leaveDraw,
      destinationDraw,
    });
    if (movement.moved) {
      updatedAnt = { ...updatedAnt, chamberId: movement.chamberId };
      metrics = { ...metrics, movementCount: metrics.movementCount + 1 };
    }

    nextWorkers[idx] = updatedAnt;
  }

  // Ambient environmental echoes: computed once per chamber, after every ant
  // has acted, from the post-relief stimulus level and post-movement
  // occupancy — never from population-wide state held by any ant.
  const chamberOccupancy = new Map<ChamberId, number>();
  for (const ant of nextWorkers) chamberOccupancy.set(ant.chamberId, (chamberOccupancy.get(ant.chamberId) ?? 0) + 1);

  for (const chamberId of CHAMBER_IDS) {
    const row = readChamberTaskStimulus(stimulusField, chamberId);
    const averageDemand = TASK_CATEGORIES.reduce((sum, category) => sum + row[category], 0) / TASK_CATEGORIES.length;

    const demandDeposit = depositPheromone(pheromoneFieldWorking, chamberId, "task-demand", averageDemand * 0.3);
    pheromoneFieldWorking = demandDeposit.field;
    metrics = bumpDeposit(metrics, demandDeposit.wasReinforced);

    const repairDeposit = depositPheromone(pheromoneFieldWorking, chamberId, "repair-needed", row.repairing * 0.4);
    pheromoneFieldWorking = repairDeposit.field;
    metrics = bumpDeposit(metrics, repairDeposit.wasReinforced);

    const occupancy = chamberOccupancy.get(chamberId) ?? 0;
    const congestionDeposit = depositPheromone(
      pheromoneFieldWorking,
      chamberId,
      "congestion",
      Math.min(1, occupancy / 25) * 0.5
    );
    pheromoneFieldWorking = congestionDeposit.field;
    metrics = bumpDeposit(metrics, congestionDeposit.wasReinforced);

    const purpose = chamberById.get(chamberId)!.purpose;
    if (DANGER_PRONE_PURPOSES.includes(purpose)) {
      const threatDraw = drawForChamber(colonySeed, chamberId, tick, SALT_DANGER);
      if (threatDraw < DANGER_EVENT_CHANCE) {
        const dangerDeposit = depositPheromone(pheromoneFieldWorking, chamberId, "danger", 0.6);
        pheromoneFieldWorking = dangerDeposit.field;
        metrics = bumpDeposit(metrics, dangerDeposit.wasReinforced);
      }
    }
  }

  const encounterResult = runChamberEncounters(nextWorkers, colonySeed, tick, succeededThisTick);
  metrics = { ...metrics, encounters: metrics.encounters + encounterResult.encounterCount };

  // G5: bounded, chamber-local recruitment + local quorum sensing, reusing
  // each ant's own real encounter contact from the pass just above.
  const recruitmentQuorumResult = runChamberRecruitmentAndQuorum(
    encounterResult.ants,
    colonySeed,
    tick,
    genome.quorumThreshold
  );
  metrics = {
    ...metrics,
    recruitmentEvents: metrics.recruitmentEvents + recruitmentQuorumResult.recruitmentEvents,
    quorumLocalCommitments: metrics.quorumLocalCommitments + recruitmentQuorumResult.quorumLocalCommitments,
  };

  // G7: resolve this tick's claims — the one deliberately centralized,
  // bounded resource-admission step. Never assigns a task; only labels
  // which already-self-chosen working ants may additionally be considered
  // for deeper cognition this tick. Every other ant's activationMode reverts
  // to its own genesis baseline, so the label never outlives the tick that
  // earned it.
  const admitted = resolveCognitionClaims(claims, MAX_COGNITIVE_BUDGET);
  let cognitivelyActiveThisTick = 0;
  const workersAfterCognition = recruitmentQuorumResult.ants.map((ant) => {
    if (admitted.has(ant.antId)) {
      cognitivelyActiveThisTick += 1;
      return ant.activationMode === "llm-eligible" ? ant : { ...ant, activationMode: "llm-eligible" as const };
    }
    const baseline = ant.startsInReserve ? ("reserve" as const) : ("resting" as const);
    return ant.activationMode === baseline ? ant : { ...ant, activationMode: baseline };
  });
  const cognitionClaimsAccepted = admitted.size;
  const cognitionClaimsRejected = claims.length - cognitionClaimsAccepted;
  metrics = {
    ...metrics,
    cognitionClaimsAccepted,
    cognitionClaimsRejected,
    peakCognitivelyActiveThisTick: cognitivelyActiveThisTick,
    peakCognitionClaimsThisTick: claims.length,
  };

  // G6: brood spawn, maturation, nursing-demand, and population-renewal
  // admission — strictly gated by the population cap (never fires past it).
  const broodResult = advanceBroodPopulation({
    liveBrood: state.liveBrood,
    nextBroodIndex: state.nextBroodIndex,
    broodCreatedThisGeneration: state.broodCreatedThisGeneration,
    colonySeed,
    tick,
    genome,
    parentGeneration: queen.generation,
    broodCapacityPerGeneration: queen.broodCapacityPerGeneration,
    nursingSucceededChambers,
    currentPersistentCount: workersAfterCognition.length + 1,
    populationCap: state.populationCap,
    taskStimulusField: stimulusField,
  });
  stimulusField = broodResult.taskStimulusField;
  metrics = {
    ...metrics,
    broodRecordsCreated: metrics.broodRecordsCreated + broodResult.broodRecordsCreated,
    broodLifecycleTransitions: metrics.broodLifecycleTransitions + broodResult.broodLifecycleTransitions,
    nursingStimulusEvents: metrics.nursingStimulusEvents + broodResult.nursingStimulusEvents,
    populationRenewals: metrics.populationRenewals + broodResult.admitted.length,
  };

  let nextWorkerIndex = state.nextWorkerIndex;
  const admittedAnts: AntAgent[] = [];
  for (const brood of broodResult.admitted) {
    const antId = workerIdentityId(nextWorkerIndex);
    admittedAnts.push(buildBroodOriginAntAgent(brood, nextWorkerIndex, antId, queen.generation, genome));
    nextWorkerIndex += 1;
  }

  const broodCreatedThisGeneration = broodResult.broodCreatedThisGeneration;
  const generationResult = maybeAdvanceGeneration(queen, broodCreatedThisGeneration);
  queen = generationResult.queen;
  const nextBroodCreatedThisGeneration = generationResult.advanced ? 0 : broodCreatedThisGeneration;
  if (generationResult.advanced) metrics = { ...metrics, generationTransitions: metrics.generationTransitions + 1 };

  const decayResult = decayPheromoneField(pheromoneFieldWorking, genome.pheromoneDecayRate);
  metrics = { ...metrics, pheromonesDecayed: metrics.pheromonesDecayed + decayResult.cellsDecayed };

  const nextState: ColonyTickState = {
    tick: tick + 1,
    colonySeed,
    genome,
    nestGraph,
    queen,
    workers: [...workersAfterCognition, ...admittedAnts],
    taskStimulusField: stimulusField,
    pheromoneField: decayResult.field,

    liveBrood: broodResult.liveBrood,
    nextBroodIndex: broodResult.nextBroodIndex,
    broodCreatedThisGeneration: nextBroodCreatedThisGeneration,
    nextWorkerIndex,
    populationCap: state.populationCap,
  };

  return { nextState, metrics };
}

/**
 * Hard-coded ceiling for this pass (NAMLA_BUILD_LAW.md Section 13). Not
 * environment-configurable, not ant-changeable — callers may only tighten it.
 */
export const COLONY_TICK_HARD_CAP = 1000 as const;

export interface ColonyRunResult {
  readonly finalState: ColonyTickState;
  readonly ticksExecuted: number;
  readonly totals: TickMetrics;
}

/** Run a bounded, fixed number of ticks. Runs only for the duration of this call — no timers, no continuation. */
export function runColonyTicks(initial: ColonyTickState, tickCount: number): ColonyRunResult {
  const boundedTickCount = Math.max(0, Math.min(tickCount, COLONY_TICK_HARD_CAP));
  let state = initial;
  let totals = zeroMetrics();

  for (let i = 0; i < boundedTickCount; i += 1) {
    const { nextState, metrics } = runColonyTick(state);
    state = nextState;
    totals = addMetrics(totals, metrics);
  }

  return { finalState: state, ticksExecuted: boundedTickCount, totals };
}
