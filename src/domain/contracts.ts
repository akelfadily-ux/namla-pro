import {
  AntExecution,
  Artifact,
  BudgetLimits,
  BudgetUsage,
  OperationId,
  RunId,
  TaskId,
  TaskRecord,
  TaskStatus,
  TraceId,
} from "./types";

export interface EventRecord {
  type: string;

  runId: RunId;
  taskId?: TaskId;

  traceId: TraceId;

  timestamp: Date;

  payload: Record<string, unknown>;
}

import { AntId, OperationRecord, RunRecord, RunStatus, WorkerId } from "./types";

export type RunAccountingState = "ACTIVE" | "BLOCKED_UNKNOWN_BILLING" | "BLOCKED_PERSISTENCE_FAILURE";

export interface PostgresQueryClient {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[]; rowCount?: number }>;
}

export interface PostgresPoolClient extends PostgresQueryClient {
  release(): void;
}

export interface PostgresPool extends PostgresQueryClient {
  connect(): Promise<PostgresPoolClient>;
}

export interface StateRepository {
  createRun(run: RunRecord): Promise<void>;

  setRunRootTask(runId: RunId, rootTaskId: TaskId): Promise<void>;

  getRun(runId: RunId): Promise<RunRecord | null>;

  getAccountingState(runId: RunId): Promise<{ state: RunAccountingState; reason?: string }>;

  setAccountingState(runId: RunId, state: RunAccountingState, reason?: string): Promise<void>;

  recoverAccountingState(
    runId: RunId,
    mode: import("./types").AccountingRecoveryMode,
    reconciliationAuthority: { identity: string; permissions: readonly string[] },
    evidence: import("./types").AccountingRecoveryEvidence,
  ): Promise<{ recovered: boolean; previousState: RunAccountingState }>;

  transitionRun(
    runId: RunId,
    expectedStatus: RunStatus,
    nextStatus: RunStatus,
  ): Promise<RunRecord>;

  getTask(taskId: TaskId): Promise<TaskRecord | null>;

  createTask(task: TaskRecord): Promise<void>;

  transitionTask(
    taskId: TaskId,
    expectedStatus: TaskStatus,
    nextStatus: TaskStatus,
    patch?: Partial<TaskRecord>,
  ): Promise<TaskRecord>;

  transitionTaskFenced(
    taskId: TaskId,
    expectedStatus: TaskStatus,
    nextStatus: TaskStatus,
    workerId: WorkerId,
    leaseToken: string,
    patch?: Partial<TaskRecord>,
  ): Promise<TaskRecord>;

  listRunnableTasks(runId: RunId): Promise<TaskRecord[]>;

  listTasksForRun(runId: RunId): Promise<TaskRecord[]>;

  claimTaskLease(
    taskId: TaskId,
    workerId: WorkerId,
    leaseDurationMs?: number,
    limits?: { maxConcurrency?: number; maxAgents?: number },
  ): Promise<TaskRecord | null>;

  renewTaskLease(
    taskId: TaskId,
    workerId: WorkerId,
    leaseToken: string,
    leaseDurationMs?: number,
  ): Promise<boolean>;

  releaseTaskLease(
    taskId: TaskId,
    workerId: WorkerId,
    leaseToken: string,
  ): Promise<void>;

  recoverExpiredLeases(
    runId: RunId,
  ): Promise<number>;

  recoverExpiredTaskExecutions(
    runId: RunId,
  ): Promise<{ recoveredCount: number }>;

  saveAntExecution(execution: AntExecution): Promise<void>;

  updateAntExecution(execution: Partial<AntExecution> & { antId: AntId; runId: RunId; taskId: TaskId; attempt: number; status: import("./types").AntExecutionStatus | TaskStatus }): Promise<void>;

  saveArtifact(artifact: Artifact): Promise<void>;

  appendEvent(event: EventRecord): Promise<void>;

  getBudgetUsage(runId: RunId): Promise<BudgetUsage>;

  getBudgetLimits(runId: RunId): Promise<BudgetLimits>;

  reserveBudget(
    runId: RunId,
    estimatedCostUsd: number,
    estimatedTokens: number,
  ): Promise<{ reserved: boolean; reservationId?: string }>;

  reconcileBudget(
    reservationId: string,
    actualCostUsd: number,
    actualTokens: number,
  ): Promise<void>;

  releaseBudgetReservation(
    reservationId: string,
    reason?: string,
  ): Promise<void>;

  getOperationRecord(
    operationId: OperationId,
  ): Promise<OperationRecord | null>;

  claimOperation(
    operation: Partial<OperationRecord> & { id: OperationId; toolName: string; inputHash: string; runId: RunId; taskId: TaskId; antId: AntId },
    authority: { workerId: WorkerId; leaseToken: string },
    leaseDurationMs?: number,
  ): Promise<{ status: "CLAIMED" | "COMPLETED" | "RUNNING_OTHER_LEASE" | "INPUT_HASH_MISMATCH" | "TASK_AUTHORITY_LOST"; record?: OperationRecord; claimToken?: string }>;

  completeOperation<T>(
    operationId: OperationId,
    workerId: WorkerId,
    claimToken: string,
    value: T,
  ): Promise<boolean>;

  failOperation(
    operationId: OperationId,
    workerId: WorkerId,
    claimToken: string,
    error: string,
  ): Promise<boolean>;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export interface ModelResponse<T> {
  value: T;
  usage: ModelUsage;
  provider: string;
  model: string;
}

export interface ModelAdapter {
  readonly provider: string;

  generate<T>(
    request: ModelRequest<T>,
  ): Promise<ModelResponse<T>>;
}

export interface ModelRequest<T> {
  model?: string;

  system: string;

  input: string;

  temperature?: number;

  validate(value: unknown): T;
}

export interface ToolExecutionContext {
  runId: RunId;
  taskId: TaskId;

  antId: string;

  traceId: TraceId;

  operationId: OperationId;

  permissions: readonly string[];

  authority?: {
    workerId: WorkerId;
    leaseToken: string;
  };
}

export interface ToolAdapter<I = unknown, O = unknown> {
  readonly name: string;

  validateInput(input: unknown): I;

  getPermissionRequests?(
    input: I,
    context: ToolExecutionContext,
  ): readonly (import("./types").PermissionRequest & { gitOperation?: import("./types").GitOperation })[];

  execute(
    input: I,
    context: ToolExecutionContext,
    signal: AbortSignal,
  ): Promise<O>;
}

export interface AntAllocator {
  allocate(role: import("./types").AntRole, runId: RunId, taskId?: TaskId): AntId;
}

export interface EventPublisher {
  publish(event: EventRecord): Promise<void>;
}
