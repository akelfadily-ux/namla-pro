/**
 * BotBody is the abstraction for a software-only body: an ant that could
 * eventually drive desktop automation (Phase 8). Phase 0 BotBody only ever
 * plans actions, using CommandAdapter and FileAdapter underneath.
 */

import type { BotBody as BotBodyShape, PlannedAction } from "../types/bodyTypes";
import { buildPlannedAction } from "./toolAdapter";

export class BotBody implements BotBodyShape {
  readonly bodyId: string;
  readonly bodyKind = "bot" as const;
  readonly description = "A software-only body for future desktop/tool automation. Plans only, never acts.";

  constructor(bodyId = "bot-body-default") {
    this.bodyId = bodyId;
  }

  plan(action: Omit<PlannedAction, "actionId" | "plannedAt" | "executed">): PlannedAction {
    return buildPlannedAction(action);
  }
}
