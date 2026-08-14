/**
 * Colony Genesis G6 — brood lifecycle, genome inheritance, and population
 * renewal.
 *
 * Source: general myrmecology (docs/ant-colony-biological-model.md, section
 * 5). Brood presence drives nursing behavior in nearby workers; the Queen
 * does not direct nurses — she has no other channel of influence than
 * producing brood, which raises local nursing demand that nearby ants
 * respond to on their own, through the ALREADY-AUTHORIZED G1-G3
 * response-threshold system. Nothing here adds a new decision mechanism for
 * nursing — it only (a) lets brood raise the existing chamber-local
 * "nursing" task-stimulus cell, and (b) counts the existing "nursing"
 * task-category attempts that already happen through localTaskChoice.ts.
 *
 * Brood are NOT AntAgents. They are a small, separately bounded record type
 * (capacity `MAX_LIVE_BROOD`, independent of population size) so brood
 * simulation can never grow unboundedly. A brood record only ever becomes a
 * real persistent AntAgent identity through `admitMaturedBroodIfRoom`, which
 * is strictly gated by the colony's population cap — when the cap is
 * already reached (as it always is in the default 300-population demo,
 * since genesis already uses the full budget), matured brood stay queued at
 * the "young-worker" stage rather than creating unlimited agents. This is a
 * literal implementation of NAMLA_BUILD_LAW.md Section 15's bounded
 * population policy, not a shortcut.
 *
 * Genome inheritance: a brood record's genome profile is derived the same
 * way a genesis worker's is (colony genome + a deterministic seeded index),
 * then a small, bounded, seeded perturbation is applied — "controlled
 * variation," a digital adaptation (no single named biological source; real
 * ant colonies do not tune per-trait mutation magnitudes) standing in for
 * genetic recombination across a generation.
 *
 * Authorized by NAMLA_BUILD_LAW.md Section 15 (Colony Genesis G6-G7).
 *
 * No fs, no wall clock, no ambient randomness, no module-level mutable state.
 */

import type { AntAgent } from "./antAgent";
import { createAntAgent } from "./antAgent";
import type { AntGenomeProfile, ColonyGenome } from "./colonyGenome";
import { deriveAntGenomeProfile } from "./colonyGenome";
import type { Caste, TaskCategory } from "./colonyTypes";
import { TASK_CATEGORIES, clamp, createSeededRandom, roundTo } from "./colonyTypes";
import type { ChamberId } from "./nestGraph";
import type { TaskStimulusField } from "./taskStimulusField";
import { raiseTaskStimulus } from "./taskStimulusField";

export type BroodStage = "egg" | "larva" | "pupa" | "young-worker";

const STAGE_ORDER: readonly BroodStage[] = ["egg", "larva", "pupa", "young-worker"];

export interface BroodRecord {
  readonly broodId: string;
  readonly parentGeneration: number;
  readonly genomeProfile: AntGenomeProfile;
  readonly caste: Caste;
  readonly stage: BroodStage;
  readonly birthTick: number;
  readonly maturationProgress: number;
  readonly chamberId: ChamberId;
  readonly health: number;
  readonly viability: number;
}

/** Bounded independent of population size — never an unbounded brood list. */
export const MAX_LIVE_BROOD = 10 as const;

const BROOD_CHAMBERS: readonly ChamberId[] = ["brood-chamber", "nursery"];

const SPAWN_CHANCE = 0.035;
const AMBIENT_MATURATION_STEP = 0.012;
const NURSED_MATURATION_STEP = 0.09;
const MUTATION_MAGNITUDE = 0.12;
/** Per-chamber nursing-stimulus contribution per live brood record present. */
const NURSING_DEMAND_PER_BROOD = 0.05;

const SALT_SPAWN_GATE = 0x2f8b3a19;
const SALT_SPAWN_CHAMBER = 0x1a2b3c4d;
const SALT_SPAWN_CASTE = 0x6d2b79f5;
const SALT_MUTATION = 0x85ebca77;
const SALT_VIABILITY = 0x27d4eb47;

function drawFor(colonySeed: number, salt: number, index: number): number {
  const h = (Math.imul(colonySeed ^ salt, 2654435761) ^ Math.imul(index + 1, 40503)) >>> 0;
  return createSeededRandom(h)();
}

const CASTE_BANDS: ReadonlyArray<{ readonly caste: Caste; readonly cumulative: number }> = [
  { caste: "scout", cumulative: 0.15 },
  { caste: "soldier", cumulative: 0.33 },
  { caste: "major-worker", cumulative: 0.58 },
  { caste: "minor-worker", cumulative: 1 },
];

function pickBroodCaste(colonySeed: number, broodIndex: number): Caste {
  const draw = drawFor(colonySeed, SALT_SPAWN_CASTE, broodIndex);
  for (const band of CASTE_BANDS) if (draw < band.cumulative) return band.caste;
  return "minor-worker";
}

/** Colony-genome inheritance plus a small, bounded, seeded mutation. */
function deriveMutatedGenomeProfile(genome: ColonyGenome, colonySeed: number, broodIndex: number, caste: Caste): AntGenomeProfile {
  const base = deriveAntGenomeProfile(genome, 100000 + broodIndex, caste);
  const thresholdBias = {} as Record<TaskCategory, number>;
  for (const category of TASK_CATEGORIES) {
    const jitter = (drawFor(colonySeed, SALT_MUTATION, broodIndex * 37 + TASK_CATEGORIES.indexOf(category)) - 0.5) * 2 * MUTATION_MAGNITUDE;
    thresholdBias[category] = roundTo(clamp(base.thresholdBias[category] + jitter, 0.3, 2.2), 4);
  }
  return { ...base, thresholdBias };
}

export interface BroodSpawnInput {
  readonly colonySeed: number;
  readonly tick: number;
  readonly genome: ColonyGenome;
  readonly liveBrood: readonly BroodRecord[];
  readonly broodCreatedThisGeneration: number;
  readonly broodCapacityPerGeneration: number;
  readonly parentGeneration: number;
  readonly nextBroodIndex: number;
}

export interface BroodSpawnResult {
  readonly spawned: BroodRecord | null;
  readonly nextBroodIndex: number;
}

/**
 * At most one new brood record per tick, gated by the small independent live
 * cap, the colony's per-generation brood budget, and a seeded probability —
 * bounded, deterministic, chamber-local placement only.
 */
export function maybeSpawnBrood(input: BroodSpawnInput): BroodSpawnResult {
  if (input.liveBrood.length >= MAX_LIVE_BROOD) return { spawned: null, nextBroodIndex: input.nextBroodIndex };
  if (input.broodCreatedThisGeneration >= input.broodCapacityPerGeneration) {
    return { spawned: null, nextBroodIndex: input.nextBroodIndex };
  }

  const gateDraw = drawFor(input.colonySeed, SALT_SPAWN_GATE, input.nextBroodIndex * 977 + input.tick);
  if (gateDraw >= SPAWN_CHANCE) return { spawned: null, nextBroodIndex: input.nextBroodIndex };

  const chamberDraw = drawFor(input.colonySeed, SALT_SPAWN_CHAMBER, input.nextBroodIndex);
  const chamberId = BROOD_CHAMBERS[Math.min(BROOD_CHAMBERS.length - 1, Math.floor(chamberDraw * BROOD_CHAMBERS.length))];

  const caste = pickBroodCaste(input.colonySeed, input.nextBroodIndex);
  const genomeProfile = deriveMutatedGenomeProfile(input.genome, input.colonySeed, input.nextBroodIndex, caste);
  const viabilityDraw = drawFor(input.colonySeed, SALT_VIABILITY, input.nextBroodIndex);

  const broodId = `namla-brood-${input.parentGeneration}-${String(input.nextBroodIndex).padStart(4, "0")}`;

  const spawned: BroodRecord = {
    broodId,
    parentGeneration: input.parentGeneration,
    genomeProfile,
    caste,
    stage: "egg",
    birthTick: input.tick,
    maturationProgress: 0,
    chamberId,
    health: 1,
    viability: roundTo(0.85 + viabilityDraw * 0.15, 4),
  };

  return { spawned, nextBroodIndex: input.nextBroodIndex + 1 };
}

export interface BroodMaturationResult {
  readonly brood: BroodRecord;
  readonly transitioned: boolean;
}

/**
 * Advance one brood record by one tick. `nursedThisTick` is true when the
 * brood's own chamber had at least one successful "nursing" task attempt
 * this tick — the real, already-authorized G1-G3 response-threshold outcome,
 * not a new decision path. Nursed brood mature faster; unnursed brood still
 * mature, slowly, so nursing accelerates rather than gates development.
 */
export function advanceBroodMaturation(brood: BroodRecord, nursedThisTick: boolean): BroodMaturationResult {
  if (brood.stage === "young-worker") return { brood, transitioned: false };

  const step = nursedThisTick ? NURSED_MATURATION_STEP : AMBIENT_MATURATION_STEP;
  const progress = brood.maturationProgress + step;

  if (progress < 1) {
    return { brood: { ...brood, maturationProgress: roundTo(progress, 4) }, transitioned: false };
  }

  const currentIndex = STAGE_ORDER.indexOf(brood.stage);
  const nextStage = STAGE_ORDER[Math.min(STAGE_ORDER.length - 1, currentIndex + 1)];
  return { brood: { ...brood, stage: nextStage, maturationProgress: 0 }, transitioned: true };
}

/** Raise this chamber's nursing stimulus cell — brood-created demand, not a signal any ant marked. */
export function applyBroodNursingDemand(field: TaskStimulusField, chamberId: ChamberId, amount: number): TaskStimulusField {
  return raiseTaskStimulus(field, chamberId, "nursing", amount);
}

export interface BroodAdmissionResult {
  readonly remainingBrood: readonly BroodRecord[];
  readonly admitted: readonly BroodRecord[];
}

/**
 * Promote young-worker-stage brood into real persistent identities, strictly
 * bounded by the population cap. Never exceeds the cap; never removes an
 * existing identity; admits in stable (creation) order for determinism.
 */
export function admitMaturedBroodIfRoom(
  liveBrood: readonly BroodRecord[],
  currentPersistentCount: number,
  populationCap: number
): BroodAdmissionResult {
  const room = populationCap - currentPersistentCount;
  if (room <= 0) return { remainingBrood: liveBrood, admitted: [] };

  const readyForAdmission: BroodRecord[] = [];
  const notReady: BroodRecord[] = [];
  for (const brood of liveBrood) {
    if (brood.stage === "young-worker" && readyForAdmission.length < room) readyForAdmission.push(brood);
    else notReady.push(brood);
  }

  return { remainingBrood: notReady, admitted: readyForAdmission };
}

/** Build the real AntAgent for one admitted brood record. */
export function buildBroodOriginAntAgent(
  brood: BroodRecord,
  antIndex: number,
  antId: string,
  generation: number,
  genome: ColonyGenome
): AntAgent {
  return createAntAgent({
    antId,
    antIndex,
    generation,
    caste: brood.caste,
    genome,
    chamberId: brood.chamberId,
    startsInReserve: false,
    genomeProfileOverride: brood.genomeProfile,
  });
}

export interface AdvanceBroodPopulationInput {
  readonly liveBrood: readonly BroodRecord[];
  readonly nextBroodIndex: number;
  readonly broodCreatedThisGeneration: number;
  readonly colonySeed: number;
  readonly tick: number;
  readonly genome: ColonyGenome;
  readonly parentGeneration: number;
  readonly broodCapacityPerGeneration: number;
  /** Chambers where a "nursing" task attempt succeeded this tick (from the tick loop). */
  readonly nursingSucceededChambers: ReadonlySet<ChamberId>;
  readonly currentPersistentCount: number;
  readonly populationCap: number;
  readonly taskStimulusField: TaskStimulusField;
}

export interface AdvanceBroodPopulationResult {
  readonly liveBrood: readonly BroodRecord[];
  readonly nextBroodIndex: number;
  readonly broodCreatedThisGeneration: number;
  readonly admitted: readonly BroodRecord[];
  readonly broodRecordsCreated: number;
  readonly broodLifecycleTransitions: number;
  readonly nursingStimulusEvents: number;
  readonly taskStimulusField: TaskStimulusField;
}

/**
 * One tick of the whole brood subsystem: spawn (at most one, bounded and
 * gated), advance maturation for every live record, admit whatever reached
 * "young-worker" and fits under the population cap, then let remaining live
 * brood raise their own chamber's nursing stimulus. The single entry point
 * `colonyTickRunner.ts` calls once per tick.
 */
export function advanceBroodPopulation(input: AdvanceBroodPopulationInput): AdvanceBroodPopulationResult {
  let liveBrood = input.liveBrood;
  let nextBroodIndex = input.nextBroodIndex;
  let broodCreatedThisGeneration = input.broodCreatedThisGeneration;
  let broodRecordsCreated = 0;

  const spawnResult = maybeSpawnBrood({
    colonySeed: input.colonySeed,
    tick: input.tick,
    genome: input.genome,
    liveBrood,
    broodCreatedThisGeneration,
    broodCapacityPerGeneration: input.broodCapacityPerGeneration,
    parentGeneration: input.parentGeneration,
    nextBroodIndex,
  });
  nextBroodIndex = spawnResult.nextBroodIndex;
  if (spawnResult.spawned) {
    liveBrood = [...liveBrood, spawnResult.spawned];
    broodCreatedThisGeneration += 1;
    broodRecordsCreated = 1;
  }

  let broodLifecycleTransitions = 0;
  const maturedBrood: BroodRecord[] = [];
  for (const brood of liveBrood) {
    const nursed = input.nursingSucceededChambers.has(brood.chamberId);
    const result = advanceBroodMaturation(brood, nursed);
    if (result.transitioned) broodLifecycleTransitions += 1;
    maturedBrood.push(result.brood);
  }
  liveBrood = maturedBrood;

  const admissionResult = admitMaturedBroodIfRoom(liveBrood, input.currentPersistentCount, input.populationCap);
  liveBrood = admissionResult.remainingBrood;

  let taskStimulusField = input.taskStimulusField;
  let nursingStimulusEvents = 0;
  const chambersWithBrood = new Set<ChamberId>();
  for (const brood of liveBrood) chambersWithBrood.add(brood.chamberId);
  for (const chamberId of chambersWithBrood) {
    const liveCount = liveBrood.filter((b) => b.chamberId === chamberId).length;
    taskStimulusField = applyBroodNursingDemand(taskStimulusField, chamberId, Math.min(1, liveCount * NURSING_DEMAND_PER_BROOD));
    nursingStimulusEvents += 1;
  }

  return {
    liveBrood,
    nextBroodIndex,
    broodCreatedThisGeneration,
    admitted: admissionResult.admitted,
    broodRecordsCreated,
    broodLifecycleTransitions,
    nursingStimulusEvents,
    taskStimulusField,
  };
}
