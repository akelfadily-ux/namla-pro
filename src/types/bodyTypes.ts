/**
 * Bot/robot body abstraction types. A "body" is how an ant would eventually
 * act in the world (desktop automation, a robot, an IoT device). In Phase 0,
 * every body only ever returns a PlannedAction. Nothing is executed.
 */

export type PlannedActionKind =
  | "file-read"
  | "file-write"
  | "file-delete"
  | "command-execute"
  | "network-call"
  | "ui-interaction"
  | "device-actuation";

export interface PlannedAction {
  actionId: string;
  kind: PlannedActionKind;
  description: string;
  targetPath?: string;
  targetCommand?: string;
  requestedByAntId: string;
  plannedAt: string;
  requiresHumanApproval: boolean;
  executed: false; // Phase 0 invariant: planned actions are never executed
}

export interface BotBody {
  bodyId: string;
  bodyKind: "bot";
  description: string;
  plan(action: Omit<PlannedAction, "actionId" | "plannedAt" | "executed">): PlannedAction;
}

export interface RobotBody {
  bodyId: string;
  bodyKind: "robot";
  description: string;
  plan(action: Omit<PlannedAction, "actionId" | "plannedAt" | "executed">): PlannedAction;
}

export interface ToolAdapter {
  adapterId: string;
  toolName: string;
  describeCapability(): string;
  plan(request: Record<string, unknown>): PlannedAction;
}

export interface CommandAdapter extends ToolAdapter {
  /** Phase 0: always refuses. Returns a PlannedAction, never runs anything. */
  refuseExecution(reason: string): PlannedAction;
}

export interface FileAdapter extends ToolAdapter {
  /** Phase 0: never mutates the filesystem. Returns a PlannedAction only. */
  planFileAction(targetPath: string, intent: string): PlannedAction;
}
