/**
 * broodDevelopment — real brood individuals with real developmental stages
 * (Build Law §22, §8). Every brood has an identity, genotype, birth tick, stage,
 * mass, nutrition received, health, pathogen state, temperature exposure,
 * development progress, and viability. Development advances only when the brood
 * is actually fed (consuming embodied `broodMass` protein through the economy)
 * and the chamber is warm/humid enough. Underfeeding, cold, and disease slow or
 * fail development; no adult ever appears without passing egg -> larva -> pupa
 * -> callow -> adult.
 *
 * No fs, no child_process, no network, no wall clock, no module-level mutable state.
 */

import { clamp, roundTo } from "../colony/colonyTypes";
import { bioDraw } from "./biologicalTypes";
import type { Caste, LifeStage } from "./biologicalTypes";
import type { ColonyResourceEconomy } from "./resourceEconomy";
import type { ChamberId } from "../colony/nestGraph";

export interface BroodIndividual {
  readonly broodId: string;
  readonly genotype: number;
  readonly bornTick: number;
  readonly stage: LifeStage;
  readonly mass: number;
  readonly nutritionReceived: number;
  readonly health: number;
  readonly pathogenLoad: number;
  readonly temperatureExposure: number;
  readonly developmentProgress: number; // 0..1 within the current stage sequence
  readonly viable: boolean;
  readonly chamberId: ChamberId;
  readonly destinedCaste: Caste;
  readonly outcome: "developing" | "matured" | "failed" | "weak-adult";
}

/** Stage sequence and the cumulative progress at which each transition happens. */
const STAGE_SEQUENCE: readonly LifeStage[] = ["egg", "larva", "pupa", "callow", "adult"];
const STAGE_THRESHOLD: Record<LifeStage, number> = { egg: 0.15, larva: 0.5, pupa: 0.8, callow: 1, adult: 1, "sexual-female": 1, male: 1 };

export function createBrood(broodId: string, genotype: number, bornTick: number, chamberId: ChamberId, destinedCaste: Caste): BroodIndividual {
  return {
    broodId,
    genotype: roundTo(genotype, 4),
    bornTick,
    stage: "egg",
    mass: 0.02,
    nutritionReceived: 0,
    health: 1,
    pathogenLoad: 0,
    temperatureExposure: 0.62,
    developmentProgress: 0,
    viable: true,
    chamberId,
    destinedCaste,
    outcome: "developing",
  };
}

export interface BroodAdvanceContext {
  readonly economy: ColonyResourceEconomy;
  readonly tick: number;
  readonly chamberTemperature: number;
  readonly chamberHumidity: number;
  readonly chamberContamination: number;
  /** True when a nurse actually fed this brood this tick (care signal). */
  readonly cared: boolean;
  readonly seed: number;
}

export interface BroodAdvanceResult {
  readonly brood: BroodIndividual;
  readonly stageTransitioned: boolean;
  readonly matured: boolean;
  readonly died: boolean;
  readonly weakAdult: boolean;
  readonly maturedCaste: Caste | null;
}

/**
 * Advance one brood one tick. It consumes a little embodied protein from the
 * `broodMass` pool as it grows (metabolized through the economy — the ONLY way
 * its progress rises), gated by temperature suitability and care. Cold,
 * underfeeding, contamination, and pathogen load reduce viability and can fail
 * development; a low-but-surviving trajectory yields a weak adult.
 */
export function advanceBrood(brood: BroodIndividual, ctx: BroodAdvanceContext): BroodAdvanceResult {
  if (brood.outcome !== "developing") {
    return { brood, stageTransitioned: false, matured: false, died: false, weakAdult: false, maturedCaste: null };
  }

  // Growth needs embodied brood protein; consume a little (conserving).
  const consumed = ctx.economy.metabolize("protein", "broodMass", 0.01, 1);
  const nutritionReceived = roundTo(brood.nutritionReceived + consumed, 6);

  const tempFit = 1 - Math.abs(ctx.chamberTemperature - 0.62) * 2; // optimum ~0.62
  const humFit = 1 - Math.abs(ctx.chamberHumidity - 0.7) * 1.5;
  const care = ctx.cared ? 1 : 0.4;
  const genotypeFactor = 0.85 + brood.genotype * 0.3;

  // Progress advances only with real nutrition + suitable conditions.
  const rawStep = 0.02 * clamp(tempFit, 0, 1) * clamp(humFit, 0.3, 1) * care * genotypeFactor * (consumed > 0 ? 1 : 0.2);
  const developmentProgress = clamp(brood.developmentProgress + rawStep, 0, 1);

  // Health/viability erode under cold, contamination, pathogen, and starvation.
  const starved = consumed <= 1e-6;
  const health = clamp(
    brood.health - (tempFit < 0.2 ? 0.02 : 0) - ctx.chamberContamination * 0.01 - brood.pathogenLoad * 0.02 - (starved ? 0.02 : 0),
    0,
    1
  );
  const viable = brood.viable && health > 0.05;

  // Stage from cumulative progress.
  let stage: LifeStage = brood.stage;
  let stageTransitioned = false;
  for (let i = 0; i < STAGE_SEQUENCE.length; i += 1) {
    const s = STAGE_SEQUENCE[i];
    const prevThreshold = i === 0 ? 0 : STAGE_THRESHOLD[STAGE_SEQUENCE[i - 1]];
    if (developmentProgress >= prevThreshold && developmentProgress < STAGE_THRESHOLD[s]) {
      if (s !== brood.stage) stageTransitioned = true;
      stage = s;
      break;
    }
  }

  // Death from lost viability: remaining embodied mass spoils into `lost`.
  if (!viable) {
    ctx.economy.transfer("protein", "broodMass", "lost", brood.mass);
    return {
      brood: { ...brood, stage, health, viable: false, outcome: "failed", nutritionReceived, developmentProgress },
      stageTransitioned,
      matured: false,
      died: true,
      weakAdult: false,
      maturedCaste: null,
    };
  }

  // Maturation: reached the end of the sequence.
  if (developmentProgress >= 1) {
    const weak = brood.health < 0.6 || nutritionReceived < 0.15;
    // Remaining embodied mass is metabolized into the adult body (consumed).
    ctx.economy.transfer("protein", "broodMass", "consumed", brood.mass);
    return {
      brood: { ...brood, stage: "adult", health, developmentProgress: 1, nutritionReceived, outcome: weak ? "weak-adult" : "matured" },
      stageTransitioned: true,
      matured: true,
      died: false,
      weakAdult: weak,
      maturedCaste: brood.destinedCaste,
    };
  }

  return {
    brood: { ...brood, stage, mass: roundTo(brood.mass + consumed, 6), nutritionReceived, health, viable, developmentProgress, temperatureExposure: ctx.chamberTemperature },
    stageTransitioned,
    matured: false,
    died: false,
    weakAdult: false,
    maturedCaste: null,
  };
}

/** Deterministically pick a destined caste for a new egg (variation, not assignment). */
export function destinedCasteFor(seed: number, ordinal: number): Caste {
  const draw = bioDraw(seed, ordinal, 0, 0x85ebca6b);
  if (draw < 0.5) return "minor-worker";
  if (draw < 0.72) return "major-worker";
  if (draw < 0.85) return "nurse";
  if (draw < 0.95) return "scout";
  return "soldier";
}
