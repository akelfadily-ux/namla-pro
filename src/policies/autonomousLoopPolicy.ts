/**
 * AutonomousLoopPolicy bounds how long or how many steps an autonomous ant
 * loop could ever run for, once loops exist (Phase 6+). Phase 0 has no live
 * loops, but the guard rail is defined now so later phases inherit it rather
 * than inventing limits ad hoc.
 */

export const MAX_AUTONOMOUS_STEPS_PHASE_0 = 0;

export interface LoopBudget {
  maxSteps: number;
  maxDurationMs: number;
}

export const DEFAULT_LOOP_BUDGET: LoopBudget = {
  maxSteps: MAX_AUTONOMOUS_STEPS_PHASE_0,
  maxDurationMs: 0,
};

/**
 * Phase 6, narrowly scoped: a hard-capped budget for VIRTUAL-TICK simulation
 * only, used exclusively by src/simulation/. This is NOT a general execution
 * budget — a simulation step is an in-memory bookkeeping update that happens
 * only when a human-run script calls step()/run(); it executes no commands,
 * writes no files, and touches no network. The cap is a code constant:
 * not environment-configurable, not ant-changeable, not changeable by any
 * runtime input. Callers may only tighten it, never exceed it. Everything
 * outside the simulation module keeps DEFAULT_LOOP_BUDGET (zero).
 * Authorized by the Phase 6 amendment in NAMLA_BUILD_LAW.md.
 */
export const SIMULATION_MAX_VIRTUAL_STEPS = 100 as const;

export const SIMULATION_LOOP_BUDGET: LoopBudget = {
  maxSteps: SIMULATION_MAX_VIRTUAL_STEPS,
  // Virtual time has no wall-clock duration; only the step cap governs.
  maxDurationMs: Number.POSITIVE_INFINITY,
};

export function isLoopBudgetExhausted(stepsTaken: number, elapsedMs: number, budget: LoopBudget = DEFAULT_LOOP_BUDGET): boolean {
  return stepsTaken >= budget.maxSteps || elapsedMs >= budget.maxDurationMs;
}
