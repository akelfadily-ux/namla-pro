/**
 * Colony Genesis G6 — worker aging, energy, health, recovery, and withdrawal.
 *
 * Activates the age / energy / health / lifecycleState / recoveryTicksRemaining
 * fields G0 declared and left neutrally initialized. Build Law Section 12:
 * "Energy, health, age, and lifecycle-state dynamics remain unauthorized and
 * untouched by this amendment" — this module is what Section 15 activates.
 *
 * Every function reads and writes only the single ant passed in. No
 * population scan, no central decision, no identity is ever removed — a
 * retired ant keeps its persistent identity forever; it simply stops
 * choosing new tasks. "No identity may silently disappear."
 *
 * Authorized by NAMLA_BUILD_LAW.md Section 15 (Colony Genesis G6-G7).
 *
 * No fs, no wall clock, no ambient randomness, no module-level mutable state.
 */

import type { AntAgent } from "./antAgent";
import type { ColonyGenome } from "./colonyGenome";
import type { LifecycleState } from "./colonyTypes";
import { clamp, roundTo } from "./colonyTypes";

const HEALTH_DRIFT_RATE = 0.01;
const LOW_ENERGY_THRESHOLD = 0.15;
const HEALTHY_ENERGY_THRESHOLD = 0.6;

/** Health at/below this while senescent opens a bounded recovery window. */
const RECOVERY_HEALTH_THRESHOLD = 0.3;
const RECOVERY_TICKS = 20 as const;

/**
 * Age thresholds sit near the tick hard cap deliberately: age alone should
 * not uniformly retire the whole colony inside one ordinary run. Health is
 * the dominant, selective trigger — only ants whose own workload/luck
 * genuinely drains them reach senescence or retirement early, exactly like
 * real variance in colony longevity rather than a synchronized clock.
 */
const SENESCENT_AGE = 850 as const;
const RETIRED_AGE = 980 as const;
const SENESCENT_HEALTH = 0.3;
const RETIRED_HEALTH = 0.1;

export interface WorkerLifecycleResult {
  readonly ant: AntAgent;
  readonly justEnteredSenescence: boolean;
  readonly justEnteredRecovery: boolean;
  readonly justRetired: boolean;
}

/**
 * Advance one ant's age/energy/health/lifecycle by exactly one tick. `worked`
 * is true when the ant attempted a task category this tick (already decided
 * by localTaskChoice before this runs) — this function never chooses a task,
 * it only accounts for the metabolic consequence of the choice already made.
 */
export function advanceWorkerLifecycle(ant: AntAgent, worked: boolean, genome: ColonyGenome): WorkerLifecycleResult {
  if (ant.lifecycleState === "retired") {
    // A closed record: no further aging, no further metabolism.
    return { ant, justEnteredSenescence: false, justEnteredRecovery: false, justRetired: false };
  }

  const age = ant.age + 1;
  const isRecovering = ant.lifecycleState === "senescent" && ant.recoveryTicksRemaining > 0;

  // A recovering ant does not work regardless of what it chose, so it never
  // pays the work energy cost this tick — recovery IS the accommodation.
  const actuallyWorked = worked && !isRecovering;

  let energy = actuallyWorked ? ant.energy - genome.workEnergyCost : ant.energy + genome.restEnergyGain;
  energy = clamp(energy, 0, 1);

  let health = ant.health;
  if (energy < LOW_ENERGY_THRESHOLD) health = clamp(health - HEALTH_DRIFT_RATE, 0, 1);
  else if (energy > HEALTHY_ENERGY_THRESHOLD) health = clamp(health + HEALTH_DRIFT_RATE * 0.5, 0, 1);

  let recoveryTicksRemaining = Math.max(0, ant.recoveryTicksRemaining - 1);
  let lifecycleState: LifecycleState = ant.lifecycleState;
  let justEnteredSenescence = false;
  let justEnteredRecovery = false;
  let justRetired = false;

  if (lifecycleState === "adult" && (age >= SENESCENT_AGE || health <= SENESCENT_HEALTH)) {
    lifecycleState = "senescent";
    justEnteredSenescence = true;
  }

  if (lifecycleState === "senescent" && health <= RECOVERY_HEALTH_THRESHOLD && recoveryTicksRemaining === 0) {
    recoveryTicksRemaining = RECOVERY_TICKS;
    justEnteredRecovery = true;
  }

  if (lifecycleState === "senescent" && (age >= RETIRED_AGE || health <= RETIRED_HEALTH)) {
    lifecycleState = "retired";
    justRetired = true;
  }

  return {
    ant: {
      ...ant,
      age,
      energy: roundTo(energy, 4),
      health: roundTo(health, 4),
      lifecycleState,
      recoveryTicksRemaining,
    },
    justEnteredSenescence,
    justEnteredRecovery,
    justRetired,
  };
}

/** True when this ant should be skipped for task choice/movement/cognition this tick. */
export function isWithdrawnFromActiveDuty(ant: AntAgent): boolean {
  return ant.lifecycleState === "retired" || (ant.lifecycleState === "senescent" && ant.recoveryTicksRemaining > 0);
}
