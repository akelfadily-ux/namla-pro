/**
 * AntScheduler: deterministic round-robin scheduling over registered ant
 * states, with a hard step budget.
 *
 * Determinism: ants are consulted in registration order; each role keeps
 * its own rotating cursor, so two builders alternate builder tasks in a
 * fixed, reproducible order. There are no timers, no async, no concurrency
 * — one scheduling decision happens per explicit call, and each decision
 * consumes one unit of the step budget (including decisions that find no
 * ant, so a starved simulation still terminates).
 *
 * The budget ceiling is SIMULATION_MAX_VIRTUAL_STEPS, a code constant from
 * AutonomousLoopPolicy. Callers may request a smaller budget (the demo uses
 * this to show a receipted halt); requests above the ceiling are clamped
 * down. Nothing at runtime — environment, ant, or input text — can raise it.
 */

import type { AntRole, AntState } from "../types/antTypes";
import { isLoopBudgetExhausted, SIMULATION_LOOP_BUDGET } from "../policies/autonomousLoopPolicy";

/**
 * @deprecated Since Architecture Hardening 2 Step 4B the scheduler consumes
 * the canonical AntState from src/types/antTypes.ts directly. This alias
 * remains only so older imports keep compiling; it is the same type, not a
 * second model.
 */
export type SimulationAntState = AntState;

export class AntScheduler {
  private readonly ants: AntState[] = [];
  private readonly roleCursors = new Map<AntRole, number>();
  private stepsTaken = 0;
  private readonly maxSteps: number;

  constructor(requestedMaxSteps?: number) {
    const requested = requestedMaxSteps ?? SIMULATION_LOOP_BUDGET.maxSteps;
    // Tighten-only: the hard cap wins over any larger request.
    this.maxSteps = Math.min(Math.max(1, Math.floor(requested)), SIMULATION_LOOP_BUDGET.maxSteps);
  }

  register(ant: AntState): void {
    this.ants.push(ant);
  }

  get registeredAnts(): AntState[] {
    return [...this.ants];
  }

  get stepsUsed(): number {
    return this.stepsTaken;
  }

  get budgetExhausted(): boolean {
    return isLoopBudgetExhausted(this.stepsTaken, 0, {
      maxSteps: this.maxSteps,
      maxDurationMs: Number.POSITIVE_INFINITY,
    });
  }

  /**
   * One scheduling decision: the next active ant of the given role, in
   * round-robin order. Consumes one budget step whether or not an ant is
   * found. Returns undefined when no active ant of the role exists.
   * Callers must check budgetExhausted before calling.
   */
  nextAntForRole(role: AntRole): AntState | undefined {
    this.stepsTaken += 1;

    const candidates = this.ants.filter(
      (ant) => ant.identity.role === role && ant.energy !== "offline" && ant.energy !== "resting"
    );
    if (candidates.length === 0) return undefined;

    const cursor = this.roleCursors.get(role) ?? 0;
    const chosen = candidates[cursor % candidates.length];
    this.roleCursors.set(role, cursor + 1);
    return chosen;
  }
}
