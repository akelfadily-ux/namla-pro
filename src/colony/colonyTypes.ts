/**
 * Colony Genesis V1 — shared vocabulary for the biological colony model.
 *
 * Namla is a NATION of many small agents, not one agent. These types are the
 * shared substrate: work states, task categories, skill tendencies, pheromone
 * kinds, activation modes, and lifecycle states, plus a deterministic seeded
 * random source so a whole colony run is reproducible tick-for-tick.
 *
 * Pure data + arithmetic: no fs, no process/env, no timers, no network, no
 * randomness beyond the explicit seeded generator.
 */

/** Actionable task categories an ant can engage in. */
export const TASK_CATEGORIES = [
  "scouting",
  "foraging",
  "building",
  "repairing",
  "nursing",
  "guarding",
  "cleaning",
  "transporting",
  "storing",
  "communicating",
] as const;

export type TaskCategory = (typeof TASK_CATEGORIES)[number];

/** A work state is a task category or one of the two non-working states. */
export type WorkState = TaskCategory | "resting" | "reserve";

/** Digital skill tendencies layered on top of the biological task model. */
export const SKILL_TENDENCIES = [
  "research",
  "planning",
  "coding",
  "testing",
  "debugging",
  "security",
  "documentation",
  "memory-management",
  "orchestration",
] as const;

export type SkillTendency = (typeof SKILL_TENDENCIES)[number];

/**
 * How much cognitive machinery an ant is currently allowed to use. Only the
 * first three consume the colony's bounded cognitive budget; the rest are
 * cheap or inert. Colony Genesis V1 never actually calls an external model —
 * `llm-eligible` / `llm-active` mark where real workers would attach later.
 */
export type ActivationMode =
  | "deterministic-local"
  | "llm-eligible"
  | "llm-active"
  | "resting"
  | "reserve"
  | "disabled";

/** Activation modes that consume the bounded cognitive budget. */
export const COGNITIVELY_ACTIVE_MODES: readonly ActivationMode[] = [
  "deterministic-local",
  "llm-eligible",
  "llm-active",
];

export type LifecycleState = "egg" | "larva" | "pupa" | "adult" | "senescent" | "retired";

/** Morphological caste. Caste biases genome, never dictates the current task. */
export type Caste = "queen" | "minor-worker" | "major-worker" | "soldier" | "scout";

/** Typed colony pheromones. All are read by real decisions, not write-only. */
export const COLONY_PHEROMONE_TYPES = [
  "task-demand",
  "opportunity",
  "danger",
  "failure",
  "success",
  "recruitment",
  "resource",
  "congestion",
  "repair-needed",
  "knowledge-found",
] as const;

export type ColonyPheromoneType = (typeof COLONY_PHEROMONE_TYPES)[number];

/**
 * Deterministic seeded generator (mulberry32). Used everywhere a stochastic
 * biological process is modeled, so an entire colony run reproduces exactly.
 */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Clamp helper used across the colony arithmetic. */
export function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/** Round to a fixed number of decimals so digests stay stable. */
export function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}
