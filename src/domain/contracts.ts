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

export interface StateRepository {
  getTask(taskId: TaskId): Promise<TaskRecord | null>;

  saveTask(task: TaskRecord): Promise<void>;

  transitionTask(
    taskId: TaskId,
    expectedStatus: TaskStatus,
    nextStatus: TaskStatus,
    patch?: Partial<TaskRecord>,
  ): Promise<TaskRecord>;

  listRunnableTasks(runId: RunId): Promise<TaskRecord[]>;

  saveAntExecution(execution: AntExecution): Promise<void>;

  saveArtifact(artifact: Artifact): Promise<void>;

  appendEvent(event: EventRecord): Promise<void>;

  getBudgetUsage(runId: RunId): Promise<BudgetUsage>;

  getBudgetLimits(runId: RunId): Promise<BudgetLimits>;

  getOperationResult<T>(
    operationId: OperationId,
  ): Promise<T | null>;

  saveOperationResult<T>(
    operationId: OperationId,
    value: T,
  ): Promise<void>;
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
}

export interface ToolAdapter<I = unknown, O = unknown> {
  readonly name: string;

  validateInput(input: unknown): I;

  execute(
    input: I,
    context: ToolExecutionContext,
    signal: AbortSignal,
  ): Promise<O>;
}

export interface EventPublisher {
  publish(event: EventRecord): Promise<void>;
}
