/**
 * Task types. A ColonyTask is one unit of work assigned to an ant, created
 * from a mission by the MissionPlanner and routed by the TaskRouter.
 */

import type { AntRole } from "./antTypes";

export type TaskPriority = "low" | "normal" | "high" | "urgent";

/**
 * Phase 3: what shape of output a task is expected to produce.
 * "code-proposal" tasks produce CodeProposal data objects (never writes).
 */
export type TaskOutputKind = "analysis" | "code-proposal" | "report";

export type TaskStatus =
  | "proposed"
  | "queued"
  | "assigned"
  | "in-progress"
  | "blocked"
  | "completed"
  | "rejected";

export interface TaskAssignment {
  taskId: string;
  antId: string;
  assignedAt: string;
}

export interface ColonyTask {
  taskId: string;
  missionId: string;
  title: string;
  description: string;
  requiredRole: AntRole;
  priority: TaskPriority;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  parentTaskId?: string;
  /** Phase 2: tasks that must complete before this one may start. */
  dependsOnTaskIds?: string[];
  /** Phase 3: expected output shape; "code-proposal" means CodeProposal data. */
  expectedOutputKind?: TaskOutputKind;
  assignment?: TaskAssignment;
}
