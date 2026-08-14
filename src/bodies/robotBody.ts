/**
 * RobotBody is the abstraction for a future physical or IoT body (Phase 9).
 * Phase 0 RobotBody only ever plans actions — there is no device, sensor, or
 * actuator behind it yet.
 */

import type { PlannedAction, RobotBody as RobotBodyShape } from "../types/bodyTypes";
import { buildPlannedAction } from "./toolAdapter";

export class RobotBody implements RobotBodyShape {
  readonly bodyId: string;
  readonly bodyKind = "robot" as const;
  readonly description = "A placeholder for a future physical or IoT body. Plans only, never actuates anything.";

  constructor(bodyId = "robot-body-default") {
    this.bodyId = bodyId;
  }

  plan(action: Omit<PlannedAction, "actionId" | "plannedAt" | "executed">): PlannedAction {
    return buildPlannedAction(action);
  }
}
