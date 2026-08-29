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
  maxConcurrency?: number;
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
  rootTaskId?: TaskId;
  status: RunStatus;
  goal: string;
  repositoryPath?: string;
  budgetLimits: BudgetLimits;
  createdAt: Date;
  updatedAt: Date;
}

export type WorkerId = string;

export interface WorkerExecutionIdentity {
  workerId: WorkerId;
  capabilities: readonly string[];
}

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
  nextEligibleAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export enum AccountingRecoveryMode {
  PROVIDER_RECONCILED = "PROVIDER_RECONCILED",
  HUMAN_RECONCILED = "HUMAN_RECONCILED",
  CONSERVATIVE_MAX_WRITE_OFF = "CONSERVATIVE_MAX_WRITE_OFF",
}

export interface ProviderReconciliationEvidence {
  type: "PROVIDER_INVOICE" | "PROVIDER_USAGE_API";
  providerName: string;
  invoiceOrUsageRef: string;
  actualCostUsd: number;
  actualTokens: number;
}

export interface HumanReconciliationEvidence {
  type: "HUMAN_ADMIN_AUDIT";
  adminIdentity: string;
  approvalTicket: string;
  reconciledCostUsd: number;
  reconciledTokens: number;
}

export interface ConservativeWriteOffEvidence {
  type: "CONSERVATIVE_MAX_WRITE_OFF_AUDIT";
  reason: string;
  maxReservedCostUsd: number;
  maxReservedTokens: number;
}

export type AccountingRecoveryEvidence =
  | ProviderReconciliationEvidence
  | HumanReconciliationEvidence
  | ConservativeWriteOffEvidence;

export enum AntExecutionStatus {
  Started = "STARTED",
  Succeeded = "SUCCEEDED",
  Failed = "FAILED",
  Cancelled = "CANCELLED",
  AuthorityLost = "AUTHORITY_LOST",
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

  status: AntExecutionStatus | TaskStatus;
}

export type GitOperation =
  | { kind: "status" }
  | { kind: "log"; count?: number }
  | { kind: "diff"; target?: string }
  | { kind: "commit"; message: string }
  | { kind: "branch"; name: string }
  | { kind: "checkout"; branch: string; create?: boolean }
  | { kind: "forbidden"; action: "pull" | "merge" | "rebase" | "cherry-pick" | "am" };

export interface PermissionRequest {
  capability: string;
  resource?: string;
  gitOperation?: GitOperation;
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
