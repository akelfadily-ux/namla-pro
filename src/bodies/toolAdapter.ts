/**
 * Base helper for building ToolAdapter-shaped objects. Concrete adapters
 * (CommandAdapter, FileAdapter) build on this shared PlannedAction factory.
 */

import type { PlannedAction, PlannedActionKind } from "../types/bodyTypes";

let actionCounter = 0;

function nextActionId(): string {
  actionCounter += 1;
  return `action-${actionCounter}`;
}

export function buildPlannedAction(params: {
  kind: PlannedActionKind;
  description: string;
  requestedByAntId: string;
  targetPath?: string;
  targetCommand?: string;
  requiresHumanApproval?: boolean;
}): PlannedAction {
  return {
    actionId: nextActionId(),
    kind: params.kind,
    description: params.description,
    targetPath: params.targetPath,
    targetCommand: params.targetCommand,
    requestedByAntId: params.requestedByAntId,
    plannedAt: new Date().toISOString(),
    requiresHumanApproval: params.requiresHumanApproval ?? true,
    executed: false,
  };
}
