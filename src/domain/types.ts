export type RunId = string;
export type TaskId = string;
export type AntId = string;
export type ArtifactId = string;
export type OperationId = string;
export type TraceId = string;

export enum OperationStatus {
  Pending = "PENDING",
  Running = "RUNNING",
  Completed = "COMPLETED",
  Failed = "FAILED",
  Unknown = "UNKNOWN",
}

export interface OperationRecord {
  id: OperationId;
  runId: RunId;
  taskId: TaskId;
  antId: AntId;
  toolName: string;
  inputHash: string;
  status: OperationStatus;
  owner?: WorkerId;
  claimToken?: string;
  leaseExpiresAt?: Date;
  result?: unknown;
  error?: string;
  createdAt: Date;
  completedAt?: Date;
}

export enum RunStatus {
  Created = "CREATED",
  Planning = "PLANNING",
  Running = "RUNNING",
  Paused = "PAUSED",
  Completed = "COMPLETED",
  Failed = "FAILED",
  Cancelled = "CANCELLED",
}

export enum TaskStatus {
  Created = "CREATED",
  Assigned = "ASSIGNED",
  Running = "RUNNING",
  Testing = "TESTING",
  Review = "REVIEW",
  Retrying = "RETRYING",
  Approved = "APPROVED",
  Blocked = "BLOCKED",
  Failed = "FAILED",
  Cancelled = "CANCELLED",
}

export enum AntRole {
  Planner = "PLANNER",
  Engineer = "ENGINEER",
  Tester = "TESTER",
  Reviewer = "REVIEWER",
  Supervisor = "SUPERVISOR",
  Security = "SECURITY",
  DevOps = "DEVOPS",
  Documentation = "DOCUMENTATION",
}

export interface BudgetLimits {
  maxCostUsd?: number;
  maxTokens?: number;
  maxModelCalls?: number;
  maxToolCalls?: number;
  maxRuntimeMs?: number;
  maxIterations?: number;
  maxAgents?: number;
  maxDepth?: number;
}

export interface BudgetUsage {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  modelCalls: number;
  toolCalls: number;
  startedAt: Date;
}

export interface RunRecord {
  id: RunId;
  status: RunStatus;
  goal: string;
  repositoryPath?: string;
  budgetLimits: BudgetLimits;
  createdAt: Date;
  updatedAt: Date;
}

export type WorkerId = string;

export interface TaskRecord {
  id: TaskId;
  runId: RunId;

  parentTaskId?: TaskId;

  title: string;
  description: string;

  status: TaskStatus;

  role: AntRole;

  attempt: number;
  maxAttempts: number;

  depth: number;

  requirements: string[];

  dependencies: TaskId[];

  assignedAntId?: AntId;
  leaseOwner?: WorkerId;
  leaseToken?: string;
  leaseExpiresAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export interface AntExecution {
  antId: AntId;
  runId: RunId;
  taskId: TaskId;

  role: AntRole;

  provider?: string;
  model?: string;

  attempt: number;

  startedAt: Date;
  finishedAt?: Date;

  status: TaskStatus;
}

export interface Artifact {
  id: ArtifactId;

  runId: RunId;
  taskId?: TaskId;
  antId?: AntId;

  type: string;
  name: string;

  contentType?: string;

  path?: string;
  uri?: string;

  metadata: Record<string, unknown>;

  createdAt: Date;
}
