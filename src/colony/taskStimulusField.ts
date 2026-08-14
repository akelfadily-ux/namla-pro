/**
 * Colony Genesis G1 — chamber-local task-stimulus field.
 *
 * Task stimulus is unmet work DEMAND, not a signal any ant marked — it exists
 * whether or not any ant ever visits the chamber. That is exactly why it is
 * not a pheromone (see docs/ant-colony-biological-model.md, section 6): a
 * pheromone is deposited and decays; stimulus accumulates from unmet demand
 * and is relieved only when an ant actually does the work.
 *
 * The field is a fixed `(chamber x TaskCategory)` scalar grid — memory is
 * independent of population size and run length, exactly like the pheromone
 * field. An ant may read only its OWN current chamber's row; stimulus never
 * diffuses to neighboring chambers, unlike pheromones.
 *
 * Authorized by NAMLA_BUILD_LAW.md Section 13 (Colony Genesis G1-G3).
 *
 * No fs, no wall clock, no ambient randomness, no module-level mutable state
 * — every draw comes from createSeededRandom keyed by (seed, chamber,
 * category, tick).
 */

import type { TaskCategory } from "./colonyTypes";
import { TASK_CATEGORIES, clamp, createSeededRandom, roundTo } from "./colonyTypes";
import type { ChamberId, ChamberPurpose, NestGraph } from "./nestGraph";
import { CHAMBER_IDS } from "./nestGraph";

export interface TaskStimulusField {
  readonly cells: Readonly<Record<ChamberId, Readonly<Record<TaskCategory, number>>>>;
}

/** Baseline categories a chamber's purpose plausibly generates more demand for. */
const PURPOSE_EMPHASIS: Readonly<Record<ChamberPurpose, readonly TaskCategory[]>> = {
  royal: ["nursing"],
  brood: ["nursing", "cleaning"],
  storage: ["storing", "transporting"],
  work: ["building", "repairing", "cleaning"],
  threshold: ["guarding", "scouting"],
  external: ["foraging", "scouting"],
};

const STIMULUS_SALT = 0x51f4d3c1;
const REGEN_SALT = 0xc2b2ae3d;

function seedFor(seed: number, chamberId: ChamberId, category: TaskCategory, salt: number): number {
  let hash = salt ^ seed;
  for (let i = 0; i < chamberId.length; i += 1) hash = Math.imul(hash ^ chamberId.charCodeAt(i), 16777619);
  for (let i = 0; i < category.length; i += 1) hash = Math.imul(hash ^ category.charCodeAt(i), 2654435761);
  return hash >>> 0;
}

function zeroedCategoryRecord(): Record<TaskCategory, number> {
  const record = {} as Record<TaskCategory, number>;
  for (const category of TASK_CATEGORIES) record[category] = 0;
  return record;
}

/**
 * Build the starting stimulus field. Chambers start with a modest baseline
 * demand (never zero everywhere) so the first tick already has something for
 * a response threshold to read, biased by chamber purpose but derived from
 * the seed so a rerun reproduces exactly.
 */
export function createInitialTaskStimulusField(
  nestGraph: NestGraph,
  seed: number
): TaskStimulusField {
  const cells = {} as Record<ChamberId, Record<TaskCategory, number>>;
  for (const chamber of nestGraph.chambers) {
    const row = zeroedCategoryRecord();
    const emphasis = PURPOSE_EMPHASIS[chamber.purpose] ?? [];
    for (const category of TASK_CATEGORIES) {
      const draw = createSeededRandom(seedFor(seed, chamber.chamberId, category, STIMULUS_SALT))();
      const base = 0.12 + draw * 0.2;
      const bonus = emphasis.includes(category) ? 0.18 : 0;
      row[category] = roundTo(clamp(base + bonus, 0, 1), 4);
    }
    cells[chamber.chamberId] = row;
  }
  return { cells };
}

export function readChamberTaskStimulus(
  field: TaskStimulusField,
  chamberId: ChamberId
): Readonly<Record<TaskCategory, number>> {
  return field.cells[chamberId];
}

export function readTaskStimulus(field: TaskStimulusField, chamberId: ChamberId, category: TaskCategory): number {
  return field.cells[chamberId][category];
}

/**
 * Ambient accumulation of unmet demand for one tick. Every chamber/category
 * cell rises by a small seeded increment, capped at 1 — "unmet work
 * accumulates locally", never population-wide.
 */
export function regenerateTaskStimulus(field: TaskStimulusField, seed: number, tick: number): TaskStimulusField {
  const cells = {} as Record<ChamberId, Record<TaskCategory, number>>;
  for (const chamberId of CHAMBER_IDS) {
    const row = { ...field.cells[chamberId] };
    for (const category of TASK_CATEGORIES) {
      const draw = createSeededRandom(seedFor(seed ^ tick, chamberId, category, REGEN_SALT))();
      const increment = 0.006 + draw * 0.01;
      row[category] = roundTo(clamp(row[category] + increment, 0, 1), 4);
    }
    cells[chamberId] = row;
  }
  return { cells };
}

/** An ant relieves stimulus at its own chamber by actually doing the work. */
export function relieveTaskStimulus(
  field: TaskStimulusField,
  chamberId: ChamberId,
  category: TaskCategory,
  amount: number
): TaskStimulusField {
  const row = { ...field.cells[chamberId] };
  row[category] = roundTo(clamp(row[category] - amount, 0, 1), 4);
  return { cells: { ...field.cells, [chamberId]: row } };
}

/**
 * G6: brood existing in a chamber raises that chamber's nursing demand —
 * demand that exists whether or not any ant marked it, exactly like any
 * other task stimulus (docs/ant-colony-biological-model.md, section 6). The
 * inverse of `relieveTaskStimulus`, named separately so a brood-demand call
 * site never reads as a double negative.
 */
export function raiseTaskStimulus(
  field: TaskStimulusField,
  chamberId: ChamberId,
  category: TaskCategory,
  amount: number
): TaskStimulusField {
  const row = { ...field.cells[chamberId] };
  row[category] = roundTo(clamp(row[category] + amount, 0, 1), 4);
  return { cells: { ...field.cells, [chamberId]: row } };
}
