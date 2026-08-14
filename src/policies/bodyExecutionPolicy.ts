/**
 * BodyExecutionPolicy is the single flag that governs whether any BotBody or
 * RobotBody is allowed to move from "planned" to "executed". In Phase 0 this
 * is hard-coded to false and is not configurable at runtime — flipping it
 * requires a future phase change plus a code change, not a settings toggle.
 */

export const PHASE_0_EXECUTION_ENABLED = false as const;

export function assertExecutionAllowed(): void {
  if (!PHASE_0_EXECUTION_ENABLED) {
    throw new Error(
      "BodyExecutionPolicy: real execution is disabled in Namla Pro Phase 0. Only planning is allowed."
    );
  }
}
