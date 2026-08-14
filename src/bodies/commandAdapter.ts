/**
 * CommandAdapter is how an ant would eventually run a shell command. In
 * Phase 0 it always refuses execution and returns a PlannedAction describing
 * what it refused to do and why. There is no execution code path at all in
 * Phase 0; BodyExecutionPolicy declares the single switch a future phase
 * must route real execution through.
 */

import type { CommandAdapter as CommandAdapterShape, PlannedAction } from "../types/bodyTypes";
import { buildPlannedAction } from "./toolAdapter";
import { describeCommandRisk } from "../policies/commandSafetyPolicy";

export class CommandAdapter implements CommandAdapterShape {
  readonly adapterId: string;
  readonly toolName = "command-adapter";

  constructor(adapterId = "command-adapter-default") {
    this.adapterId = adapterId;
  }

  describeCapability(): string {
    return "Would run a shell command in a future phase. In Phase 0, execution is always refused, per BodyExecutionPolicy.PHASE_0_EXECUTION_ENABLED.";
  }

  plan(request: Record<string, unknown>): PlannedAction {
    const command = typeof request.command === "string" ? request.command : "unknown-command";
    const requestedByAntId = typeof request.requestedByAntId === "string" ? request.requestedByAntId : "unknown-ant";

    return this.refuseExecution(describeCommandRisk(command), requestedByAntId);
  }

  refuseExecution(reason: string, requestedByAntId = "command-adapter"): PlannedAction {
    return buildPlannedAction({
      kind: "command-execute",
      description: `Refused: ${reason}`,
      requestedByAntId,
      requiresHumanApproval: true,
    });
  }
}
