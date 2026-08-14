/**
 * queenReproduction — mechanistic Queen physiology and resource-costed egg
 * laying (Build Law §22, §7/§14). The Queen is CONTINUITY, never command: she
 * lays eggs, but only when she has the nutrition and condition to, and every
 * egg costs real resources (protein moved from her reserve into brood mass).
 * Egg production depends on nutrition, Queen condition, colony conditions,
 * population cap, and season. There is unlimited-growth nowhere — the cap and
 * the resource cost bound it.
 *
 * A bounded late-colony reproductive phase produces sexuals (males, winged
 * queens) once the colony is mature and resource-rich; a bounded mating flight
 * records new founding-Queen entries under a hard colony-count cap. No egg
 * without cost; no infinite colonies.
 *
 * No fs, no child_process, no network, no wall clock, no module-level mutable state.
 */

import { clamp, roundTo } from "../colony/colonyTypes";
import type { ColonyResourceEconomy } from "./resourceEconomy";

export interface QueenPhysiology {
  readonly queenId: string;
  readonly nutrition: number;
  readonly energy: number;
  readonly health: number;
  readonly age: number;
  readonly fertility: number;
  readonly pathogenLoad: number;
  readonly eggProductionCapacity: number;
  readonly ticksSinceLastLay: number;
  readonly eggsLaidTotal: number;
}

export const EGG_LAY_INTERVAL = 6; // ticks between clutches
export const EGG_PROTEIN_COST = 0.02; // resource cost per egg

export function createQueen(queenId: string): QueenPhysiology {
  return {
    queenId,
    nutrition: 0.6,
    energy: 0.8,
    health: 1,
    age: 0,
    fertility: 0.9,
    pathogenLoad: 0,
    eggProductionCapacity: 4,
    ticksSinceLastLay: 0,
    eggsLaidTotal: 0,
  };
}

export interface QueenTickContext {
  readonly economy: ColonyResourceEconomy;
  readonly tick: number;
  readonly nutritionDelivered: number; // protein delivered to the queen this tick (already transferred)
  readonly populationHeadroom: number; // cap - currentPopulation (>=0)
  readonly seasonFactor: number; // 0..1, lower in scarcity
}

export interface QueenTickResult {
  readonly queen: QueenPhysiology;
  readonly eggsLaid: number;
  readonly proteinCost: number;
}

/**
 * Advance the Queen one tick: metabolize a little energy, age, and — when the
 * lay interval has elapsed and conditions allow — lay eggs, each costing real
 * protein moved from her reserve (`queenReserve`) into `broodMass`. Egg count is
 * bounded by capacity, fertility, nutrition, season, and population headroom.
 */
export function advanceQueen(queen: QueenPhysiology, ctx: QueenTickContext): QueenTickResult {
  // Queen metabolism (higher than a worker): spend energy through the economy.
  ctx.economy.spendEnergy(0.006);
  let energy = clamp(queen.energy - 0.006 + ctx.nutritionDelivered * 0.3, 0, 1);
  const nutrition = clamp(queen.nutrition * 0.98 + ctx.nutritionDelivered, 0, 1);
  const age = queen.age + 1;
  const fertility = clamp(queen.fertility - (age > 3000 ? 0.0002 : 0), 0, 1);
  const health = clamp(queen.health - queen.pathogenLoad * 0.005, 0, 1);

  let ticksSinceLastLay = queen.ticksSinceLastLay + 1;
  let eggsLaid = 0;
  let proteinCost = 0;

  const conditionsOk = nutrition > 0.3 && energy > 0.2 && health > 0.3 && ctx.populationHeadroom > 0;
  if (ticksSinceLastLay >= EGG_LAY_INTERVAL && conditionsOk) {
    const maxByCapacity = Math.round(queen.eggProductionCapacity * fertility * ctx.seasonFactor);
    const maxByHeadroom = Math.floor(ctx.populationHeadroom);
    const target = Math.max(0, Math.min(maxByCapacity, maxByHeadroom));
    for (let i = 0; i < target; i += 1) {
      // Each egg costs protein from the queen's reserve, moved into brood mass.
      const moved = ctx.economy.transfer("protein", "queenReserve", "broodMass", EGG_PROTEIN_COST);
      if (moved < EGG_PROTEIN_COST - 1e-9) break; // no egg without full cost
      eggsLaid += 1;
      proteinCost = roundTo(proteinCost + moved, 6);
    }
    if (eggsLaid > 0) {
      ticksSinceLastLay = 0;
      energy = clamp(energy - eggsLaid * 0.01, 0, 1);
    }
  }

  return {
    queen: {
      ...queen,
      nutrition: roundTo(nutrition, 6),
      energy: roundTo(energy, 6),
      health: roundTo(health, 6),
      age,
      fertility: roundTo(fertility, 6),
      ticksSinceLastLay,
      eggsLaidTotal: queen.eggsLaidTotal + eggsLaid,
    },
    eggsLaid,
    proteinCost,
  };
}

// --- bounded sexual reproduction + colony continuation (§14) ----------------

export const MAX_FOUNDING_QUEEN_RECORDS = 3 as const;

export interface FoundingQueenRecord {
  readonly foundingQueenId: string;
  readonly producedTick: number;
  readonly initialProteinReserve: number;
}

export interface SexualProductionResult {
  readonly producedMales: number;
  readonly producedWingedQueens: number;
  readonly proteinCost: number;
  readonly foundingRecords: readonly FoundingQueenRecord[];
}

/**
 * Late-colony reproductive phase: once the colony is mature and resource-rich,
 * produce a bounded number of sexuals at real protein cost, and record up to
 * `MAX_FOUNDING_QUEEN_RECORDS` new founding queens from a bounded mating flight.
 * Never creates infinite colonies — the record cap is hard.
 */
export function produceSexuals(
  economy: ColonyResourceEconomy,
  tick: number,
  colonyMature: boolean,
  availableProtein: number,
  existingFoundingRecords: number
): SexualProductionResult {
  if (!colonyMature || availableProtein < 0.5) {
    return { producedMales: 0, producedWingedQueens: 0, proteinCost: 0, foundingRecords: [] };
  }
  const perSexualCost = 0.05;
  const budget = Math.min(availableProtein * 0.2, 0.5);
  const count = Math.floor(budget / perSexualCost);
  let proteinCost = 0;
  let males = 0;
  let queens = 0;
  for (let i = 0; i < count; i += 1) {
    const moved = economy.transfer("protein", "nestStores", "consumed", perSexualCost);
    if (moved < perSexualCost - 1e-9) break;
    proteinCost = roundTo(proteinCost + moved, 6);
    if (i % 2 === 0) males += 1;
    else queens += 1;
  }
  const newRecords: FoundingQueenRecord[] = [];
  const canRecord = Math.max(0, MAX_FOUNDING_QUEEN_RECORDS - existingFoundingRecords);
  for (let i = 0; i < Math.min(queens, canRecord); i += 1) {
    newRecords.push({ foundingQueenId: `founding-queen-${tick}-${i}`, producedTick: tick, initialProteinReserve: 0.3 });
  }
  return { producedMales: males, producedWingedQueens: queens, proteinCost, foundingRecords: newRecords };
}
