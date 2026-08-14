/**
 * colonyPhysiology — the mechanistic worker body and its per-tick rules
 * (Build Law §22, §2/§9/§12). An `AntBody` is real bounded state; every value
 * changes only through explicit rules, and every energy change is routed
 * through the `ColonyResourceEconomy` so it is conserved.
 *
 * Hard rules enforced here: an ant cannot work without spending energy, cannot
 * carry more than its morphological capacity, cannot metabolize crop it does
 * not hold, and once dead/retired makes no decision. Caste morphology affects
 * capacity, movement cost, metabolic rate, lifespan, and injury risk.
 *
 * No fs, no child_process, no network, no wall clock, no module-level mutable state.
 */

import { clamp, roundTo } from "../colony/colonyTypes";
import type { BiologicalTask, Caste, DeathCause, LifeStage, ResourceCategory } from "./biologicalTypes";
import { bioDraw } from "./biologicalTypes";
import type { ColonyResourceEconomy } from "./resourceEconomy";
import type { ChamberId } from "../colony/nestGraph";

export interface AntBody {
  readonly antId: string;
  readonly antIndex: number;
  readonly caste: Caste;
  readonly bornTick: number;

  // physiology (all mechanistic)
  readonly bodyMass: number;
  readonly cropCarb: number; // transferable crop content, mirrored into economy antCrops
  readonly cropProtein: number;
  readonly cropWater: number;
  readonly energy: number; // internal energy, mirrors economy live share
  readonly hydration: number;
  readonly health: number;
  readonly pathogenLoad: number;
  readonly immuneActivation: number;
  readonly injury: number;
  readonly fatigue: number;
  readonly age: number;
  readonly expectedLifespan: number;

  // morphology-derived
  readonly carryingCapacity: number;
  readonly movementCost: number;
  readonly metabolicRate: number;
  readonly thermalTolerance: number;
  readonly humidityTolerance: number;

  readonly fertile: boolean;
  readonly lifeStage: LifeStage;
  readonly chamberId: ChamberId;
  readonly currentTask: BiologicalTask;
  readonly alive: boolean;
  readonly deathCause: DeathCause | null;
  readonly deathTick: number | null;
  /** Cumulative outside-work ticks — used to correlate age with task, not to assign it. */
  readonly foragingTicks: number;
}

/** Caste morphology parameters. Real physiological differences, not a job label. */
interface MorphologySpec {
  readonly capacity: number;
  readonly movementCost: number;
  readonly metabolicRate: number;
  readonly lifespan: number;
  readonly injuryResistance: number;
}

const MORPHOLOGY: Record<Caste, MorphologySpec> = {
  "minor-worker": { capacity: 0.6, movementCost: 0.02, metabolicRate: 0.9, lifespan: 900, injuryResistance: 0.5 },
  "major-worker": { capacity: 1.2, movementCost: 0.035, metabolicRate: 1.1, lifespan: 1100, injuryResistance: 0.75 },
  soldier: { capacity: 1.0, movementCost: 0.04, metabolicRate: 1.15, lifespan: 1000, injuryResistance: 0.9 },
  scout: { capacity: 0.5, movementCost: 0.018, metabolicRate: 0.95, lifespan: 850, injuryResistance: 0.45 },
  nurse: { capacity: 0.55, movementCost: 0.02, metabolicRate: 0.85, lifespan: 1000, injuryResistance: 0.5 },
  reproductive: { capacity: 0.4, movementCost: 0.05, metabolicRate: 1.3, lifespan: 4000, injuryResistance: 0.6 },
};

export function morphologyOf(caste: Caste): MorphologySpec {
  return MORPHOLOGY[caste];
}

export interface CreateBodyInput {
  readonly antId: string;
  readonly antIndex: number;
  readonly caste: Caste;
  readonly bornTick: number;
  readonly chamberId: ChamberId;
  readonly colonySeed: number;
  readonly lifeStage?: LifeStage;
}

export function createAntBody(input: CreateBodyInput): AntBody {
  const m = MORPHOLOGY[input.caste];
  const v = bioDraw(input.colonySeed, input.antIndex, 0, 0x51ed270b); // individual variation
  const lifespan = Math.round(m.lifespan * (0.8 + v * 0.4));
  return {
    antId: input.antId,
    antIndex: input.antIndex,
    caste: input.caste,
    bornTick: input.bornTick,
    bodyMass: roundTo(1 + (m.capacity - 0.6) * 0.5, 4),
    cropCarb: 0,
    cropProtein: 0,
    cropWater: 0,
    energy: roundTo(0.6 + v * 0.2, 4),
    hydration: 0.8,
    health: 1,
    pathogenLoad: 0,
    immuneActivation: 0,
    injury: 0,
    fatigue: 0,
    age: 0,
    expectedLifespan: lifespan,
    carryingCapacity: m.capacity,
    movementCost: m.movementCost,
    metabolicRate: m.metabolicRate,
    thermalTolerance: roundTo(0.5 + v * 0.3, 4),
    humidityTolerance: roundTo(0.5 + bioDraw(input.colonySeed, input.antIndex, 1, 0x9e3779b9) * 0.3, 4),
    fertile: input.caste === "reproductive",
    lifeStage: input.lifeStage ?? "adult",
    chamberId: input.chamberId,
    currentTask: "resting",
    alive: true,
    deathCause: null,
    deathTick: null,
    foragingTicks: 0,
  };
}

/** Total crop mass an ant carries — must never exceed carryingCapacity. */
export function cropLoad(body: AntBody): number {
  return roundTo(body.cropCarb + body.cropProtein + body.cropWater, 6);
}

export function withinCapacity(body: AntBody): boolean {
  return cropLoad(body) <= body.carryingCapacity + 1e-9;
}

/** How much more of a resource an ant can pick up before hitting capacity. */
export function remainingCapacity(body: AntBody): number {
  return Math.max(0, body.carryingCapacity - cropLoad(body));
}

export interface MetabolismContext {
  readonly economy: ColonyResourceEconomy;
  readonly tick: number;
  /** Energy multiplier for the chosen task (foraging costs more than resting). */
  readonly activityCost: number;
  /** Ambient temperature stress 0..1 raises metabolic demand. */
  readonly thermalStress: number;
}

export interface MetabolismOutcome {
  readonly body: AntBody;
  readonly starving: boolean;
  readonly energyMetabolizedFromCrop: number;
}

/**
 * Advance one body one tick: pay basal + activity energy (spent through the
 * economy), metabolize crop carbohydrate into energy when reserves are low
 * (also through the economy — the ONLY way energy rises), lose hydration,
 * accrue/relieve fatigue, age, and drift health with senescence and injury.
 * Nothing here creates energy or food; every change is a conserving economy op.
 */
export function metabolize(body: AntBody, ctx: MetabolismContext): MetabolismOutcome {
  if (!body.alive) return { body, starving: false, energyMetabolizedFromCrop: 0 };

  const basal = 0.0022 * body.metabolicRate * (1 + ctx.thermalStress * 0.5);
  const activity = ctx.activityCost * body.metabolicRate;
  const demand = basal + activity;

  // Spend from body energy, mirrored through the economy so live energy falls.
  let energy = body.energy;
  const spend = Math.min(demand, energy);
  ctx.economy.spendEnergy(spend);
  energy -= spend;

  // Refuel from crop carbohydrate when low (bounded by what the crop holds).
  let cropCarb = body.cropCarb;
  let energyMetabolizedFromCrop = 0;
  if (energy < 0.4 && cropCarb > 0) {
    const want = Math.min(0.15, cropCarb);
    // Move crop carb (part of the antCrops pool) into consumed, crediting energy.
    const produced = ctx.economy.metabolize("carbohydrate", "antCrops", want, 0.9);
    cropCarb = roundTo(cropCarb - produced, 6);
    energy = roundTo(clamp(energy + produced * 0.9, 0, 1.2), 6);
    energyMetabolizedFromCrop = roundTo(produced, 6);
  }

  const hydration = clamp(body.hydration - 0.006 - ctx.thermalStress * 0.004, 0, 1);
  const fatigue = clamp(body.fatigue + (ctx.activityCost > 0.01 ? 0.02 : -0.03), 0, 1);
  const age = body.age + 1;

  // Senescence: health decays as the body approaches its lifespan; injury and
  // starvation/dehydration accelerate it; pathogen load harms health directly.
  const senescence = age > body.expectedLifespan * 0.7 ? 0.003 : 0;
  const starving = energy <= 0.02 && cropCarb <= 0;
  const dehydrated = hydration <= 0.02;
  const health = clamp(
    body.health - senescence - body.pathogenLoad * 0.01 - body.injury * 0.01 - (starving ? 0.02 : 0) - (dehydrated ? 0.02 : 0) + (body.health < 1 && !starving && !dehydrated ? 0.002 : 0),
    0,
    1
  );

  return {
    body: { ...body, energy: roundTo(clamp(energy, 0, 1.2), 6), cropCarb, hydration, fatigue, age, health: roundTo(health, 6) },
    starving,
    energyMetabolizedFromCrop,
  };
}

/** Determine death and its cause from body state. Returns null if still alive. */
export function determineDeath(body: AntBody): DeathCause | null {
  if (!body.alive) return null;
  if (body.hydration <= 0) return "dehydration";
  if (body.energy <= 0 && body.cropCarb <= 0 && body.health < 0.2) return "starvation";
  if (body.pathogenLoad >= 0.9 && body.health <= 0.05) return "infection";
  if (body.injury >= 1) return "injury";
  if (body.health <= 0) return body.age >= body.expectedLifespan * 0.7 ? "senescence" : "infection";
  if (body.age >= body.expectedLifespan) return "senescence";
  return null;
}

/**
 * Kill a body: it leaves the active population but its identity is preserved
 * (alive=false, death cause + tick recorded). Its remaining energy and crop
 * are moved to lost/consumed so conservation still closes.
 */
export function killBody(body: AntBody, cause: DeathCause, tick: number, economy: ColonyResourceEconomy): AntBody {
  // Remaining body energy leaves the live pool.
  economy.spendEnergy(body.energy);
  // Undistributed crop spoils into the lost pool (still conserved).
  const spoil = (category: ResourceCategory, amount: number) => economy.transfer(category, "antCrops", "lost", amount);
  spoil("carbohydrate", body.cropCarb);
  spoil("protein", body.cropProtein);
  spoil("water", body.cropWater);
  return {
    ...body,
    alive: false,
    deathCause: cause,
    deathTick: tick,
    energy: 0,
    cropCarb: 0,
    cropProtein: 0,
    cropWater: 0,
    currentTask: "resting",
  };
}
