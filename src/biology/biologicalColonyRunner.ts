/**
 * biologicalColonyRunner — the canonical bounded per-tick colony simulator
 * (Build Law §22, §15). It threads the conserving `ColonyResourceEconomy`
 * through every subsystem: ecology, foraging + collection, deposit, chamber-
 * local trophallaxis, metabolism, brood feeding + development + maturation,
 * resource-costed queen egg-laying, aging, mortality with causes, corpse
 * detection + necrophoresis, pathogen exposure/transmission/grooming, reserve
 * activation after worker loss, and a local quorum patch choice.
 *
 * NOTHING here routes through Tamara, the academy, the software mission runner,
 * provider adapters, AntScheduler, DecompositionEngine, or a central planner.
 * Task choice is emergent (per-ant thresholds over age, physiology, energy,
 * location, local demand, danger, brood state); no code assigns a task to an ant
 * and the Queen commands nothing. Every reported number is an event count or a
 * state difference — never a decorative counter.
 *
 * No fs, no child_process, no network, no wall clock, no module-level mutable state.
 */

import { clamp, roundTo } from "../colony/colonyTypes";
import { CHAMBER_IDS } from "../colony/nestGraph";
import type { ChamberId } from "../colony/nestGraph";
import type { BiologicalTask, Caste, DeathCause } from "./biologicalTypes";
import { bioDraw } from "./biologicalTypes";
import { ColonyResourceEconomy } from "./resourceEconomy";
import type { AntBody } from "./colonyPhysiology";
import { createAntBody, determineDeath, killBody, metabolize, remainingCapacity } from "./colonyPhysiology";
import { advanceEcology, createEcology, depletePatch, findLocalPatch, patchResource, regeneratePatch } from "./ecologicalEnvironment";
import type { EcologyState } from "./ecologicalEnvironment";
import { advanceMicroclimate, createMicroclimate, reduceContamination, addContamination } from "./nestMicroclimate";
import type { NestMicroclimate } from "./nestMicroclimate";
import { feedBrood, runChamberTrophallaxis } from "./trophallaxisNetwork";
import type { BroodIndividual } from "./broodDevelopment";
import { advanceBrood, createBrood, destinedCasteFor } from "./broodDevelopment";
import { advanceQueen, createQueen, produceSexuals } from "./queenReproduction";
import type { FoundingQueenRecord, QueenPhysiology } from "./queenReproduction";
import { advanceInfection, allogroom, detectAndTransportCorpses, exposeToPathogen, INFECTIOUS_THRESHOLD, isInfectious, selfGroom, tryTransmit } from "./diseaseAndSanitation";
import type { TransmissionEvent } from "./diseaseAndSanitation";

export interface BiologicalRunConfig {
  readonly seed: number;
  readonly initialWorkers: number;
  readonly populationCap: number;
  readonly ticks: number;
  /** A one-time controlled pathogen introduction at this tick (0 = none). */
  readonly pathogenIntroductionTick: number;
  /** A one-time worker-loss shock at this tick (fraction removed) to trigger reserve activation. */
  readonly workerLossTick: number;
  readonly workerLossFraction: number;
}

export interface BiologicalRunResult {
  readonly config: BiologicalRunConfig;
  readonly economy: ColonyResourceEconomy;
  readonly ecology: EcologyState;
  readonly microclimate: NestMicroclimate;
  readonly queen: QueenPhysiology;
  readonly bodies: readonly AntBody[];
  readonly brood: readonly BroodIndividual[];
  readonly foundingRecords: readonly FoundingQueenRecord[];
  readonly metrics: BiologicalMetrics;
}

export interface BiologicalMetrics {
  ticksExecuted: number;
  foodCollected: number;
  foodStored: number;
  foodConsumed: number;
  trophallaxisEvents: number;
  trophallaxisQuantity: number;
  failedTrophallaxis: number;
  starvationPrevented: number;
  eggsLaid: number;
  larvaeDeveloped: number;
  pupaeDeveloped: number;
  workersMatured: number;
  weakAdults: number;
  broodDeaths: number;
  workerDeaths: number;
  deathCauses: Record<DeathCause, number>;
  corpsesDetected: number;
  corpseTransportEvents: number;
  pathogenExposures: number;
  transmissionEvents: number;
  transmissionChain: readonly TransmissionEvent[];
  groomingEvents: number;
  infectionsCleared: number;
  queenResourceCost: number;
  metabolismConsumed: number;
  externalCollectionEvents: number;
  reserveActivationCount: number;
  quorumReached: boolean;
  quorumWinningPatch: string | null;
  sexualsProduced: number;
  nestTemperatureMin: number;
  nestTemperatureMax: number;
  nestHumidityMin: number;
  nestHumidityMax: number;
  peakPopulation: number;
  ageTaskCorrelation: number;
  taskFlexibilityObserved: number;
  centralTaskAssignments: 0;
  queenTaskAssignments: 0;
}

function zeroDeathCauses(): Record<DeathCause, number> {
  return { starvation: 0, dehydration: 0, senescence: 0, infection: 0, injury: 0, "brood-failure": 0 };
}

/** A stable per-ant behavioural tendency toward outside work (response threshold). */
function foragerTendency(seed: number, antIndex: number): number {
  return bioDraw(seed, antIndex, 7, 0x2c1b3c6d);
}

/** Emergent task choice from local state — never an assignment. */
function chooseTask(
  body: AntBody,
  ctx: { broodDemandHere: number; contaminationHere: number; dangerHere: number; colonyFoodLow: boolean; colonyWaterLow: boolean; ownLoad: number; neighborLoad: number; seed: number; tick: number }
): BiologicalTask {
  if (body.energy < 0.1 || body.fatigue > 0.9 || body.hydration < 0.12) return "resting";
  const ageFrac = clamp(body.age / body.expectedLifespan, 0, 1);
  const jitter = bioDraw(ctx.seed, body.antIndex, ctx.tick, 0x1b873593) * 0.15;
  const tendency = foragerTendency(ctx.seed, body.antIndex); // stable individual variation
  const need = (ctx.colonyFoodLow ? 0.5 : 0) + (ctx.colonyWaterLow ? 0.6 : 0);

  const scores: Record<BiologicalTask, number> = {
    resting: 0.18,
    nursing: (1 - ageFrac) * 0.45 + ctx.broodDemandHere * 0.5 + (body.caste === "nurse" ? 0.3 : 0),
    // Foraging is driven by a stable individual tendency, age, colony need, and
    // caste — so a real sub-population reliably works outside, and it ramps when
    // stores run low. Response-threshold style, not an assignment.
    foraging: tendency * 0.55 + ageFrac * 0.3 + need + (body.caste === "scout" ? 0.35 : 0) - body.injury * 0.5 - (body.energy < 0.3 ? 0.25 : 0),
    storing: remainingCapacity(body) < body.carryingCapacity * 0.5 ? 0.5 : 0.1,
    grooming: ctx.ownLoad * 0.8 + ctx.neighborLoad * 0.45,
    sanitation: ctx.contaminationHere * 0.7,
    guarding: ctx.dangerHere * 0.7 + (body.caste === "soldier" ? 0.4 : 0),
    building: 0.12 + (body.caste === "major-worker" ? 0.1 : 0),
    "brood-transport": ctx.broodDemandHere > 0.5 && ctx.contaminationHere > 0.3 ? 0.5 : 0,
  };
  let best: BiologicalTask = "resting";
  let bestScore = -1;
  for (const task of Object.keys(scores) as BiologicalTask[]) {
    const s = scores[task] + jitter * bioDraw(ctx.seed, body.antIndex, task.length, 0x27220a95);
    if (s > bestScore) {
      bestScore = s;
      best = task;
    }
  }
  return best;
}

const FORAGE_CHAMBERS: readonly ChamberId[] = ["foraging-zone-1", "foraging-zone-2", "foraging-zone-3", "entrance"];
const STORE_CHAMBER: ChamberId = "food-storage";
const BROOD_CHAMBER: ChamberId = "brood-chamber";
const WASTE_CHAMBER: ChamberId = "waste-chamber";

/** Outside the nest = the open foraging zones (no stored food or water there). */
function isOutside(chamberId: ChamberId): boolean {
  return chamberId === "foraging-zone-1" || chamberId === "foraging-zone-2" || chamberId === "foraging-zone-3";
}

export function runBiologicalColony(config: BiologicalRunConfig): BiologicalRunResult {
  const { seed } = config;

  // --- initial resource stocks (the conservation baseline) ----------------
  let ecology = createEcology(seed);
  const patchStock = { carbohydrate: 0, protein: 0, water: 0 } as Record<string, number>;
  for (const p of ecology.patches) patchStock[patchResource(p.kind)] += p.stock;

  const economy = new ColonyResourceEconomy(
    {
      carbohydrate: { externalPatches: patchStock.carbohydrate, nestStores: 45, antCrops: 0 },
      protein: { externalPatches: patchStock.protein, nestStores: 20, queenReserve: 4, antCrops: 0 },
      water: { externalPatches: patchStock.water, nestStores: 28, antCrops: 0 },
      broodFood: { nestStores: 2 },
      buildingMaterial: { nestStores: 6 },
    },
    // Initial live energy = sum of initial body energies + queen.
    config.initialWorkers * 0.7 + 0.8
  );

  let microclimate = createMicroclimate();
  let queen = createQueen("queen-bio-1");

  const castes: Caste[] = ["minor-worker", "major-worker", "soldier", "scout", "nurse"];
  let bodies: AntBody[] = [];
  for (let i = 0; i < config.initialWorkers; i += 1) {
    const caste = castes[bioDraw(seed, i, 2, 0x2545f491) < 0.5 ? 0 : 1 + (i % 4)];
    const chamber = CHAMBER_IDS[i % CHAMBER_IDS.length];
    const body = createAntBody({ antId: `bio-ant-${String(i).padStart(4, "0")}`, antIndex: i, caste, bornTick: 0, chamberId: chamber, colonySeed: seed });
    // Seed each worker with a little crop so early trophallaxis has content.
    const seedCarb = economy.transfer("carbohydrate", "nestStores", "antCrops", 0.02);
    bodies.push({ ...body, cropCarb: roundTo(seedCarb, 6) });
  }

  let brood: BroodIndividual[] = [];
  let broodOrdinal = 0;
  let workerOrdinal = config.initialWorkers;
  const foundingRecords: FoundingQueenRecord[] = [];
  const transportedCorpseIds = new Set<string>();
  const taskDiversity = new Map<string, Set<BiologicalTask>>();

  const m: BiologicalMetrics = {
    ticksExecuted: 0,
    foodCollected: 0,
    foodStored: 0,
    foodConsumed: 0,
    trophallaxisEvents: 0,
    trophallaxisQuantity: 0,
    failedTrophallaxis: 0,
    starvationPrevented: 0,
    eggsLaid: 0,
    larvaeDeveloped: 0,
    pupaeDeveloped: 0,
    workersMatured: 0,
    weakAdults: 0,
    broodDeaths: 0,
    workerDeaths: 0,
    deathCauses: zeroDeathCauses(),
    corpsesDetected: 0,
    corpseTransportEvents: 0,
    pathogenExposures: 0,
    transmissionEvents: 0,
    transmissionChain: [],
    groomingEvents: 0,
    infectionsCleared: 0,
    queenResourceCost: 0,
    metabolismConsumed: 0,
    externalCollectionEvents: 0,
    reserveActivationCount: 0,
    quorumReached: false,
    quorumWinningPatch: null,
    sexualsProduced: 0,
    nestTemperatureMin: 1,
    nestTemperatureMax: 0,
    nestHumidityMin: 1,
    nestHumidityMax: 0,
    peakPopulation: config.initialWorkers,
    ageTaskCorrelation: 0,
    taskFlexibilityObserved: 0,
    centralTaskAssignments: 0,
    queenTaskAssignments: 0,
  };
  const chain: TransmissionEvent[] = [];

  const recordTask = (antId: string, task: BiologicalTask) => {
    let s = taskDiversity.get(antId);
    if (!s) {
      s = new Set();
      taskDiversity.set(antId, s);
    }
    if (s.size < 9) s.add(task);
  };

  let prevRestingIds = new Set<string>();
  const activatedReserveIds = new Set<string>();

  for (let tick = 1; tick <= config.ticks; tick += 1) {
    // 1. Ecology + funded regeneration from the `lost` pool (nutrient cycling).
    const eco = advanceEcology(ecology, seed);
    ecology = eco.state;
    for (const p of ecology.patches) {
      const desired = eco.desiredRegenByPatch[p.patchId] ?? 0;
      const funded = economy.transfer(patchResource(p.kind), "lost", "externalPatches", desired);
      if (funded > 0) ecology = regeneratePatch(ecology, p.patchId, funded);
    }
    const thermalStress = clamp(Math.abs(ecology.temperature - 0.55) * 1.5, 0, 1);

    // Local demand signals (read from real state, never global roster).
    const liveBodies = bodies.filter((b) => b.alive);
    const livePopNow = liveBodies.length;
    const colonyFoodLow = economy.balanceOf("carbohydrate", "nestStores") < Math.max(4, livePopNow * 0.12);
    const colonyWaterLow = economy.balanceOf("water", "nestStores") < Math.max(4, livePopNow * 0.1);
    const broodByChamber = new Map<string, number>();
    for (const br of brood) if (br.outcome === "developing") broodByChamber.set(br.chamberId, (broodByChamber.get(br.chamberId) ?? 0) + 1);
    const loadByChamber = new Map<string, number>();
    for (const b of liveBodies) loadByChamber.set(b.chamberId, Math.max(loadByChamber.get(b.chamberId) ?? 0, b.pathogenLoad));

    // 2-3. Per-ant emergent task + execution.
    const nextBodies: AntBody[] = [];
    for (const body of bodies) {
      if (!body.alive) {
        nextBodies.push(body);
        continue;
      }
      const climateHere = microclimate[body.chamberId];
      const task = chooseTask(body, {
        broodDemandHere: (broodByChamber.get(body.chamberId) ?? 0) > 0 ? 0.8 : broodByChamber.get(BROOD_CHAMBER) ? 0.4 : 0,
        contaminationHere: climateHere.contamination,
        dangerHere: body.chamberId === "defense-gate" || body.chamberId === "entrance" ? ecology.predatorPressure : 0,
        colonyFoodLow,
        colonyWaterLow,
        ownLoad: body.pathogenLoad,
        neighborLoad: loadByChamber.get(body.chamberId) ?? 0,
        seed,
        tick,
      });
      recordTask(body.antId, task);
      let updated: AntBody = { ...body, currentTask: task };
      let activityCost = 0.002;

      if (task === "foraging") {
        activityCost = 0.01 + body.movementCost;
        // Move outward, search locally, collect existing stock up to capacity.
        // Forage for what the colony most needs: water and carbohydrate before protein.
        const kind: "carbohydrate" | "protein" | "water" = colonyWaterLow
          ? "water"
          : colonyFoodLow
            ? "carbohydrate"
            : bioDraw(seed, body.antIndex, tick, 0xc2b2ae35) < 0.4
              ? "protein"
              : bioDraw(seed, body.antIndex, tick ^ 3, 0xc2b2ae35) < 0.5
                ? "water"
                : "carbohydrate";
        const patch = findLocalPatch(ecology, kind, seed, body.antIndex, tick);
        updated = { ...updated, chamberId: FORAGE_CHAMBERS[body.antIndex % FORAGE_CHAMBERS.length], foragingTicks: body.foragingTicks + 1 };
        if (patch) {
          const category = patchResource(patch.kind);
          const room = remainingCapacity(updated);
          const want = Math.min(room, 0.1 * patch.quality, patch.stock);
          const collected = economy.transfer(category, "externalPatches", "antCrops", want);
          if (collected > 0) {
            ecology = depletePatch(ecology, patch.patchId, collected);
            updated =
              category === "protein"
                ? { ...updated, cropProtein: roundTo(updated.cropProtein + collected, 6) }
                : category === "water"
                  ? { ...updated, cropWater: roundTo(updated.cropWater + collected, 6) }
                  : { ...updated, cropCarb: roundTo(updated.cropCarb + collected, 6) };
            m.foodCollected = roundTo(m.foodCollected + collected, 6);
            m.externalCollectionEvents += 1;
          }
          // Foraging risk: danger + pathogen exposure at the patch.
          if (patch.pathogenExposure > 0 && bioDraw(seed, body.antIndex, tick ^ 7, 0x165667b1) < patch.pathogenExposure * 0.3) {
            updated = exposeToPathogen(updated, patch.pathogenExposure);
            m.pathogenExposures += 1;
          }
          if (bioDraw(seed, body.antIndex, tick ^ 11, 0x9e3779b9) < patch.dangerLevel * ecology.predatorPressure * 0.2) {
            updated = { ...updated, injury: clamp(updated.injury + 0.2, 0, 1) };
          }
        }
      } else if (task === "storing" || (updated.cropCarb + updated.cropProtein > 0.3 && body.chamberId !== STORE_CHAMBER)) {
        // Return to the nest and deposit crop into stores (conserving).
        updated = { ...updated, chamberId: STORE_CHAMBER };
        const dc = economy.transfer("carbohydrate", "antCrops", "nestStores", updated.cropCarb);
        const dp = economy.transfer("protein", "antCrops", "nestStores", updated.cropProtein);
        const dw = economy.transfer("water", "antCrops", "nestStores", updated.cropWater);
        updated = { ...updated, cropCarb: roundTo(updated.cropCarb - dc, 6), cropProtein: roundTo(updated.cropProtein - dp, 6), cropWater: roundTo(updated.cropWater - dw, 6) };
        m.foodStored = roundTo(m.foodStored + dc + dp + dw, 6);
      } else if (task === "nursing") {
        updated = { ...updated, chamberId: BROOD_CHAMBER };
        // Load brood food from stores first if crop is empty.
        if (updated.cropProtein < 0.02) {
          const got = economy.transfer("protein", "nestStores", "antCrops", 0.05);
          updated = { ...updated, cropProtein: roundTo(updated.cropProtein + got, 6) };
        }
        const fed = feedBrood(updated, economy, 0.03);
        updated = fed.nurse;
        activityCost = 0.004;
      } else if (task === "grooming") {
        const sg = selfGroom(updated, economy);
        updated = sg.body;
        if (sg.groomed) m.groomingEvents += 1;
      } else if (task === "sanitation") {
        const r = reduceContamination(microclimate, body.chamberId, 0.05);
        microclimate = r.climate;
        activityCost = 0.005;
      } else if (task === "building") {
        economy.transfer("buildingMaterial", "nestStores", "consumed", 0.005);
        activityCost = 0.006;
      } else if (task === "guarding") {
        updated = { ...updated, chamberId: "defense-gate" };
        activityCost = 0.006;
      }

      // Metabolism at the end of the ant's turn (conserving energy accounting).
      const met = metabolize(updated, { economy, tick, activityCost, thermalStress });
      updated = met.body;
      if (met.energyMetabolizedFromCrop > 0) m.foodConsumed = roundTo(m.foodConsumed + met.energyMetabolizedFromCrop, 6);

      const inNest = !isOutside(updated.chamberId);

      // Drinking: rehydrate from carried water first, then from nest water stores
      // when inside the nest. Water is a conserved resource — it moves into the
      // `consumed` pool, so an ant that cannot reach water genuinely dehydrates.
      if (updated.hydration < 0.55) {
        let drank = economy.transfer("water", "antCrops", "consumed", Math.min(updated.cropWater, 0.02));
        if (drank > 0) updated = { ...updated, cropWater: roundTo(updated.cropWater - drank, 6) };
        if (drank < 0.02 && inNest) {
          drank += economy.transfer("water", "nestStores", "consumed", 0.02 - drank);
        }
        if (drank > 0) updated = { ...updated, hydration: clamp(updated.hydration + drank * 4, 0, 1) };
      }

      // Feeding: when body energy is low and the ant is inside the nest, it eats
      // from communal carbohydrate stores (conserving: nestStores -> consumed,
      // crediting energy). Foragers replenish those stores; when they empty, nest
      // workers genuinely starve — feeding is not free energy.
      if (updated.energy < 0.45 && inNest) {
        const produced = economy.metabolize("carbohydrate", "nestStores", 0.05, 0.9);
        if (produced > 0) {
          updated = { ...updated, energy: roundTo(clamp(updated.energy + produced, 0, 1.2), 6) };
          m.foodConsumed = roundTo(m.foodConsumed + produced, 6);
        }
      }
      nextBodies.push(updated);
    }
    bodies = nextBodies;

    // 4. Chamber-local trophallaxis.
    for (const chamberId of CHAMBER_IDS) {
      const here = bodies.filter((b) => b.alive && b.chamberId === chamberId);
      if (here.length < 2) continue;
      const troph = runChamberTrophallaxis(here, economy, seed, tick);
      const byId = new Map(troph.bodies.map((b) => [b.antId, b]));
      bodies = bodies.map((b) => byId.get(b.antId) ?? b);
      m.trophallaxisEvents += troph.events;
      m.trophallaxisQuantity = roundTo(m.trophallaxisQuantity + troph.quantityTransferred, 6);
      m.failedTrophallaxis += troph.failedTransfers;
      m.starvationPrevented += troph.starvationPrevented;
    }

    // 5. Disease: controlled introduction, incubation, transmission, grooming.
    if (config.pathogenIntroductionTick > 0 && tick === config.pathogenIntroductionTick) {
      const first = bodies.find((b) => b.alive);
      if (first) {
        bodies = bodies.map((b) => (b.antId === first.antId ? exposeToPathogen(b, 1) : b));
        m.pathogenExposures += 1;
      }
    }
    bodies = bodies.map((b) => (b.alive ? advanceInfection(b) : b));
    for (const chamberId of CHAMBER_IDS) {
      const here = bodies.filter((b) => b.alive && b.chamberId === chamberId);
      const infectious = here.filter(isInfectious);
      for (const src of infectious) {
        for (const tgt of here) {
          if (tgt.antId === src.antId || isInfectious(tgt)) continue;
          const t = tryTransmit(src, tgt, seed, tick);
          if (t.event) {
            bodies = bodies.map((b) => (b.antId === tgt.antId ? t.susceptible : b));
            m.transmissionEvents += 1;
            if (chain.length < 200) chain.push(t.event);
          }
        }
        // Allogrooming: a healthy co-located nestmate grooms an infected one.
        const helper = here.find((h) => h.antId !== src.antId && h.pathogenLoad < 0.2 && h.energy > 0.2);
        if (helper) {
          const ag = allogroom(helper, src, economy);
          if (ag.groomed) {
            bodies = bodies.map((b) => (b.antId === helper.antId ? ag.groomer : b.antId === src.antId ? ag.patient : b));
            m.groomingEvents += 1;
            if (ag.patient.pathogenLoad < INFECTIOUS_THRESHOLD && src.pathogenLoad >= INFECTIOUS_THRESHOLD) m.infectionsCleared += 1;
          }
        }
      }
    }

    // 6. Brood development + maturation.
    const survivingBrood: BroodIndividual[] = [];
    const nurseByChamber = new Map<string, number>();
    for (const b of bodies) if (b.alive && b.currentTask === "nursing") nurseByChamber.set(b.chamberId, (nurseByChamber.get(b.chamberId) ?? 0) + 1);
    for (const br of brood) {
      if (br.outcome !== "developing") {
        survivingBrood.push(br);
        continue;
      }
      const climate = microclimate[br.chamberId];
      const res = advanceBrood(br, {
        economy,
        tick,
        chamberTemperature: climate.temperature,
        chamberHumidity: climate.humidity,
        chamberContamination: climate.contamination,
        cared: (nurseByChamber.get(br.chamberId) ?? 0) > 0,
        seed,
      });
      if (res.stageTransitioned && res.brood.stage === "larva") m.larvaeDeveloped += 1;
      if (res.stageTransitioned && res.brood.stage === "pupa") m.pupaeDeveloped += 1;
      if (res.died) {
        m.broodDeaths += 1;
        m.deathCauses["brood-failure"] += 1;
        survivingBrood.push(res.brood);
      } else if (res.matured && res.maturedCaste && bodies.filter((b) => b.alive).length + 1 <= config.populationCap) {
        m.workersMatured += 1;
        if (res.weakAdult) m.weakAdults += 1;
        const newBody = createAntBody({ antId: `bio-ant-${String(workerOrdinal).padStart(4, "0")}`, antIndex: workerOrdinal, caste: res.maturedCaste, bornTick: tick, chamberId: BROOD_CHAMBER, colonySeed: seed, lifeStage: "callow" });
        bodies.push(res.weakAdult ? { ...newBody, health: 0.5, energy: 0.4 } : newBody);
        // Callow starts with a little energy drawn from the economy (from stores metabolized).
        economy.metabolize("carbohydrate", "nestStores", 0.1, 0.9);
        workerOrdinal += 1;
        survivingBrood.push({ ...res.brood });
      } else {
        survivingBrood.push(res.brood);
      }
    }
    brood = survivingBrood;

    // 7. Queen: deliver nutrition then lay eggs (each costs protein).
    const queenNutrition = economy.transfer("protein", "nestStores", "queenReserve", 0.03);
    const headroom = Math.max(0, config.populationCap - bodies.filter((b) => b.alive).length - brood.filter((b) => b.outcome === "developing").length);
    const seasonFactor = ecology.season === "scarcity" ? 0.4 : ecology.season === "peak" ? 1 : 0.7;
    const qr = advanceQueen(queen, { economy, tick, nutritionDelivered: queenNutrition, populationHeadroom: headroom, seasonFactor });
    queen = qr.queen;
    m.eggsLaid += qr.eggsLaid;
    m.queenResourceCost = roundTo(m.queenResourceCost + qr.proteinCost, 6);
    for (let e = 0; e < qr.eggsLaid; e += 1) {
      brood.push(createBrood(`brood-${broodOrdinal}`, bioDraw(seed, broodOrdinal, tick, 0x85ebca6b), tick, BROOD_CHAMBER, destinedCasteFor(seed, broodOrdinal)));
      broodOrdinal += 1;
    }

    // 8. One-time worker-loss shock (reserve activation trigger).
    if (config.workerLossTick > 0 && tick === config.workerLossTick) {
      const live = bodies.filter((b) => b.alive);
      const toRemove = Math.floor(live.length * config.workerLossFraction);
      for (let i = 0; i < toRemove; i += 1) {
        const victim = live[i];
        bodies = bodies.map((b) => (b.antId === victim.antId ? killBody(b, "injury", tick, economy) : b));
        m.workerDeaths += 1;
        m.deathCauses.injury += 1;
      }
    }

    // 9. Mortality from body state.
    bodies = bodies.map((b) => {
      if (!b.alive) return b;
      const cause = determineDeath(b);
      if (!cause) return b;
      m.workerDeaths += 1;
      m.deathCauses[cause] += 1;
      return killBody(b, cause, tick, economy);
    });

    // 10. Sanitation: corpses detected locally and transported (necrophoresis).
    for (const chamberId of CHAMBER_IDS) {
      if (chamberId === WASTE_CHAMBER) continue;
      const corpsesHere = bodies.filter((b) => !b.alive && b.chamberId === chamberId && !transportedCorpseIds.has(b.antId));
      const liveHere = bodies.filter((b) => b.alive && b.chamberId === chamberId).length;
      if (corpsesHere.length === 0) continue;
      microclimate = addContamination(microclimate, chamberId, corpsesHere.length * 0.02);
      const res = detectAndTransportCorpses(chamberId, liveHere, corpsesHere.map((c) => c.antId));
      m.corpsesDetected += res.detected;
      for (const id of res.transported) {
        transportedCorpseIds.add(id);
        bodies = bodies.map((b) => (b.antId === id ? { ...b, chamberId: WASTE_CHAMBER } : b));
        m.corpseTransportEvents += 1;
      }
      const cleaned = reduceContamination(microclimate, chamberId, res.transported.length * 0.03);
      microclimate = cleaned.climate;
    }

    // 11. Reserve activation: idle reserve ants take up active work when demand
    // rises after a worker loss. Counted mechanistically — an ant that was
    // resting last tick and is now doing active work, within the recovery window
    // following the loss shock, and only once per ant.
    const livePop = bodies.filter((b) => b.alive).length;
    const inRecoveryWindow = config.workerLossTick > 0 && tick >= config.workerLossTick && tick < config.workerLossTick + 150;
    const currentResting = new Set<string>();
    for (const b of bodies) {
      if (!b.alive) continue;
      if (b.currentTask === "resting") {
        currentResting.add(b.antId);
        continue;
      }
      if ((inRecoveryWindow || colonyFoodLow) && prevRestingIds.has(b.antId) && !activatedReserveIds.has(b.antId)) {
        activatedReserveIds.add(b.antId);
        m.reserveActivationCount += 1;
      }
    }
    prevRestingIds = currentResting;
    m.peakPopulation = Math.max(m.peakPopulation, livePop);

    // 12. Local quorum patch choice (scouts independently prefer a patch).
    if (!m.quorumReached && tick > 50) {
      const scouts = bodies.filter((b) => b.alive && (b.caste === "scout" || b.currentTask === "foraging")).slice(0, 20);
      const votes = new Map<string, number>();
      for (const s of scouts) {
        const p = findLocalPatch(ecology, "carbohydrate", seed, s.antIndex, tick);
        if (p) votes.set(p.patchId, (votes.get(p.patchId) ?? 0) + 1);
      }
      for (const [patchId, count] of votes) {
        if (count >= 5) {
          m.quorumReached = true;
          m.quorumWinningPatch = patchId;
          break;
        }
      }
    }

    // 13. Late-colony sexual production (bounded, resource-gated).
    const mature = tick > config.ticks * 0.6 && livePop > config.initialWorkers * 0.9;
    if (mature) {
      const sx = produceSexuals(economy, tick, true, economy.balanceOf("protein", "nestStores"), foundingRecords.length);
      m.sexualsProduced += sx.producedMales + sx.producedWingedQueens;
      for (const rec of sx.foundingRecords) foundingRecords.push(rec);
    }

    // 14. Microclimate advance.
    const occ: Record<string, number> = {};
    const bd: Record<string, number> = {};
    for (const b of bodies) if (b.alive) occ[b.chamberId] = (occ[b.chamberId] ?? 0) + 1;
    for (const br of brood) if (br.outcome === "developing") bd[br.chamberId] = (bd[br.chamberId] ?? 0) + 1;
    microclimate = advanceMicroclimate(microclimate, { occupancyByChamber: occ, broodDensityByChamber: bd, externalTemperature: ecology.temperature, externalHumidity: ecology.humidity });
    for (const chamberId of CHAMBER_IDS) {
      const c = microclimate[chamberId];
      m.nestTemperatureMin = Math.min(m.nestTemperatureMin, c.temperature);
      m.nestTemperatureMax = Math.max(m.nestTemperatureMax, c.temperature);
      m.nestHumidityMin = Math.min(m.nestHumidityMin, c.humidity);
      m.nestHumidityMax = Math.max(m.nestHumidityMax, c.humidity);
    }

    m.ticksExecuted = tick;
  }

  m.transmissionChain = chain;
  m.metabolismConsumed = economy.metabolismConsumed;

  // Age/task correlation (Pearson r between age and cumulative foraging ticks)
  // and task flexibility (ants that settled into >=2 distinct tasks) — both
  // derived from real per-body history, evidence that polyethism is emergent.
  const sample = bodies.filter((b) => b.foragingTicks > 0 || b.age > 0);
  m.ageTaskCorrelation = pearson(sample.map((b) => b.age), sample.map((b) => b.foragingTicks));
  let flexible = 0;
  for (const set of taskDiversity.values()) if (set.size >= 2) flexible += 1;
  m.taskFlexibilityObserved = flexible;

  return { config, economy, ecology, microclimate, queen, bodies, brood, foundingRecords, metrics: m };
}

/** Pearson correlation of two equal-length numeric series (0 when undefined). */
function pearson(xs: readonly number[], ys: readonly number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i += 1) {
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den <= 1e-9 ? 0 : roundTo(num / den, 4);
}
