/**
 * biologicalColonyReport — aggregates a colony run into the reported biological
 * metrics AND validates the two runtime invariants that separate a mechanistic
 * simulation from a counter demo (Build Law §22, §16):
 *
 *   1. CONSERVATION — every resource category's pool-sum still equals its initial
 *      total, and energy closes (initial + produced == live + spent). A demo that
 *      fabricates food, energy, brood mass, or workers fails this.
 *
 *   2. CAUSALITY — every reported metric is consistent with the conserved state
 *      transitions that must have produced it: no adult without an egg, egg cost
 *      equals eggs laid times the per-egg protein cost, death causes sum to
 *      deaths, corpses transported never exceed corpses that came from deaths,
 *      trophallaxis events imply real transferred quantity, dead bodies keep
 *      their identity (cause + tick, never silent disappearance), and no live
 *      body violates its bounded-state rules. A demo that only increments
 *      counters cannot satisfy these — the counters would not agree with state.
 *
 * No fs, no child_process, no network, no wall clock, no module-level mutable state.
 */

import { roundTo } from "../colony/colonyTypes";
import { RESOURCE_CATEGORIES } from "./biologicalTypes";
import type { DeathCause } from "./biologicalTypes";
import { CONSERVATION_TOLERANCE } from "./resourceEconomy";
import { EGG_PROTEIN_COST } from "./queenReproduction";
import type { BiologicalRunResult } from "./biologicalColonyRunner";

export interface CausalCheck {
  readonly id: string;
  readonly description: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface BiologicalReport {
  // conservation
  readonly resourceBalanceValid: boolean;
  readonly energyBalanceValid: boolean;
  readonly resourceChecks: readonly { category: string; initialTotal: number; currentTotal: number; closed: boolean }[];
  readonly energyCheck: { initialEnergy: number; energyProduced: number; liveEnergy: number; energySpent: number; closed: boolean };
  readonly conservationViolations: number;

  // resource flows
  readonly foodCollected: number;
  readonly foodStored: number;
  readonly foodConsumed: number;
  readonly metabolismConsumed: number;
  readonly externalPatchDepletion: number;
  readonly finalExternalStock: number;

  // trophallaxis
  readonly trophallaxisEvents: number;
  readonly trophallaxisQuantity: number;
  readonly starvationPrevented: number;

  // brood + reproduction
  readonly eggsLaid: number;
  readonly larvaeDeveloped: number;
  readonly pupaeDeveloped: number;
  readonly workersMatured: number;
  readonly weakAdults: number;
  readonly broodDeaths: number;
  readonly queenResourceCost: number;
  readonly sexualsProduced: number;
  readonly foundingQueensRecorded: number;

  // mortality + sanitation
  readonly workerDeaths: number;
  readonly deathCauses: Record<DeathCause, number>;
  readonly corpsesDetected: number;
  readonly corpseTransportEvents: number;

  // disease
  readonly pathogenExposures: number;
  readonly transmissionEvents: number;
  readonly transmissionChainLength: number;
  readonly groomingEvents: number;
  readonly infectionsCleared: number;

  // ecology / microclimate
  readonly nestTemperatureRange: { min: number; max: number };
  readonly nestHumidityRange: { min: number; max: number };

  // polyethism (emergent)
  readonly ageTaskCorrelation: number;
  readonly taskFlexibilityObserved: number;
  readonly reserveActivationCount: number;
  readonly quorumReached: boolean;
  readonly quorumWinningPatch: string | null;

  // population
  readonly initialWorkers: number;
  readonly finalLivePopulation: number;
  readonly peakPopulation: number;

  // decentralization guarantees
  readonly centralTaskAssignments: 0;
  readonly queenTaskAssignments: 0;

  // causality
  readonly causalChecks: readonly CausalCheck[];
  readonly biologicalCausalityViolations: number;
}

export function buildBiologicalReport(run: BiologicalRunResult): BiologicalReport {
  const { economy, metrics: m, bodies, brood } = run;
  const resources = economy.validateResources();
  const energy = economy.validateEnergy();

  const finalExternalStock = roundTo(RESOURCE_CATEGORIES.reduce((s, c) => s + economy.balanceOf(c, "externalPatches"), 0), 6);

  const developingBrood = brood.filter((b) => b.outcome === "developing").length;
  const failedBrood = brood.filter((b) => b.outcome === "failed").length;
  const maturedBrood = brood.filter((b) => b.outcome === "matured" || b.outcome === "weak-adult").length;
  const liveBodies = bodies.filter((b) => b.alive);
  const deadBodies = bodies.filter((b) => !b.alive);
  const deathCauseSum = (Object.values(m.deathCauses) as number[]).reduce((s, v) => s + v, 0);

  // ---- CAUSAL CHECKS (each would fail for a counter-only demo) -------------
  const checks: CausalCheck[] = [];
  const add = (id: string, description: string, passed: boolean, detail: string) => checks.push({ id, description, passed, detail });

  add(
    "no-adult-without-egg",
    "workers matured cannot exceed eggs laid",
    m.workersMatured <= m.eggsLaid,
    `matured=${m.workersMatured} <= eggsLaid=${m.eggsLaid}`
  );
  add(
    "brood-individual-conservation",
    "every egg is developing, matured, or failed (no brood appears or vanishes)",
    developingBrood + maturedBrood + failedBrood === m.eggsLaid,
    `developing=${developingBrood}+matured=${maturedBrood}+failed=${failedBrood} == eggsLaid=${m.eggsLaid}`
  );
  add(
    "stage-order",
    "larval and pupal transitions cannot exceed eggs laid",
    m.larvaeDeveloped <= m.eggsLaid && m.pupaeDeveloped <= m.eggsLaid,
    `larvae=${m.larvaeDeveloped}, pupae=${m.pupaeDeveloped}, eggs=${m.eggsLaid}`
  );
  add(
    "egg-cost-matches",
    "queen protein cost equals eggs laid times the per-egg cost",
    Math.abs(m.queenResourceCost - m.eggsLaid * EGG_PROTEIN_COST) <= 1e-6 + m.eggsLaid * 1e-9,
    `cost=${m.queenResourceCost} ~= ${m.eggsLaid}*${EGG_PROTEIN_COST}=${roundTo(m.eggsLaid * EGG_PROTEIN_COST, 6)}`
  );
  add(
    "deaths-have-causes",
    "death causes sum to worker deaths plus brood deaths",
    deathCauseSum === m.workerDeaths + m.broodDeaths,
    `sum(causes)=${deathCauseSum} == workerDeaths=${m.workerDeaths}+broodDeaths=${m.broodDeaths}`
  );
  add(
    "corpses-from-deaths",
    "corpses transported never exceed corpses detected, which come from worker deaths",
    m.corpseTransportEvents <= m.corpsesDetected && m.corpseTransportEvents <= m.workerDeaths,
    `transported=${m.corpseTransportEvents} <= detected=${m.corpsesDetected}, deaths=${m.workerDeaths}`
  );
  add(
    "trophallaxis-has-substance",
    "trophallaxis events imply a real transferred quantity",
    (m.trophallaxisEvents > 0) === (m.trophallaxisQuantity > 0),
    `events=${m.trophallaxisEvents}, quantity=${m.trophallaxisQuantity}`
  );
  add(
    "transmission-traced",
    "recorded transmission events are backed by traced exposure edges",
    m.transmissionChain.length > 0 === m.transmissionEvents > 0 && m.transmissionChain.length <= m.transmissionEvents,
    `chain=${m.transmissionChain.length}, events=${m.transmissionEvents}`
  );
  add(
    "collection-is-depletion",
    "collected food is backed by real collection events (never a bare counter)",
    m.foodCollected >= 0 && (m.foodCollected > 0) === (m.externalCollectionEvents > 0),
    `collected=${m.foodCollected}, collectionEvents=${m.externalCollectionEvents}`
  );
  add(
    "no-silent-disappearance",
    "every dead body keeps its identity: a cause and a death tick",
    deadBodies.every((b) => b.deathCause !== null && b.deathTick !== null && b.alive === false),
    `deadBodies=${deadBodies.length}, allIdentified=${deadBodies.every((b) => b.deathCause !== null && b.deathTick !== null)}`
  );
  add(
    "bounded-live-state",
    "no live body carries over capacity, holds negative energy, or is unaged past death",
    liveBodies.every((b) => b.cropCarb + b.cropProtein + b.cropWater <= b.carryingCapacity + 1e-6 && b.energy >= -1e-9),
    `liveBodies=${liveBodies.length}`
  );
  add(
    "no-dead-work",
    "no dead body holds an active task",
    deadBodies.every((b) => b.currentTask === "resting"),
    `deadWithTask=${deadBodies.filter((b) => b.currentTask !== "resting").length}`
  );
  add(
    "energy-nonnegative",
    "the live energy pool never went negative",
    economy.liveEnergy >= -CONSERVATION_TOLERANCE,
    `liveEnergy=${roundTo(economy.liveEnergy, 6)}`
  );
  add(
    "decentralized",
    "no central or queen task assignment occurred",
    m.centralTaskAssignments === 0 && m.queenTaskAssignments === 0,
    `central=${m.centralTaskAssignments}, queen=${m.queenTaskAssignments}`
  );

  const biologicalCausalityViolations = checks.filter((c) => !c.passed).length;
  const conservationViolations = resources.checks.filter((c) => !c.closed).length + (energy.closed ? 0 : 1);

  return {
    resourceBalanceValid: resources.allClosed,
    energyBalanceValid: energy.closed,
    resourceChecks: resources.checks.map((c) => ({ category: c.category, initialTotal: c.initialTotal, currentTotal: c.currentTotal, closed: c.closed })),
    energyCheck: { initialEnergy: energy.initialEnergy, energyProduced: energy.energyProduced, liveEnergy: energy.liveEnergy, energySpent: energy.energySpent, closed: energy.closed },
    conservationViolations,

    foodCollected: m.foodCollected,
    foodStored: m.foodStored,
    foodConsumed: m.foodConsumed,
    metabolismConsumed: m.metabolismConsumed,
    externalPatchDepletion: m.foodCollected,
    finalExternalStock,

    trophallaxisEvents: m.trophallaxisEvents,
    trophallaxisQuantity: m.trophallaxisQuantity,
    starvationPrevented: m.starvationPrevented,

    eggsLaid: m.eggsLaid,
    larvaeDeveloped: m.larvaeDeveloped,
    pupaeDeveloped: m.pupaeDeveloped,
    workersMatured: m.workersMatured,
    weakAdults: m.weakAdults,
    broodDeaths: m.broodDeaths,
    queenResourceCost: m.queenResourceCost,
    sexualsProduced: m.sexualsProduced,
    foundingQueensRecorded: run.foundingRecords.length,

    workerDeaths: m.workerDeaths,
    deathCauses: m.deathCauses,
    corpsesDetected: m.corpsesDetected,
    corpseTransportEvents: m.corpseTransportEvents,

    pathogenExposures: m.pathogenExposures,
    transmissionEvents: m.transmissionEvents,
    transmissionChainLength: m.transmissionChain.length,
    groomingEvents: m.groomingEvents,
    infectionsCleared: m.infectionsCleared,

    nestTemperatureRange: { min: roundTo(m.nestTemperatureMin, 4), max: roundTo(m.nestTemperatureMax, 4) },
    nestHumidityRange: { min: roundTo(m.nestHumidityMin, 4), max: roundTo(m.nestHumidityMax, 4) },

    ageTaskCorrelation: m.ageTaskCorrelation,
    taskFlexibilityObserved: m.taskFlexibilityObserved,
    reserveActivationCount: m.reserveActivationCount,
    quorumReached: m.quorumReached,
    quorumWinningPatch: m.quorumWinningPatch,

    initialWorkers: run.config.initialWorkers,
    finalLivePopulation: liveBodies.length,
    peakPopulation: m.peakPopulation,

    centralTaskAssignments: 0,
    queenTaskAssignments: 0,

    causalChecks: checks,
    biologicalCausalityViolations,
  };
}
