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
} from "../../domain/types";
import { StateRepository, EventRecord } from "../../domain/contracts";
import { assertTaskTransition } from "../../domain/lifecycle";
import { StateConflictError } from "../../domain/errors";

export interface PostgresTaskRow {
  id: string;
  run_id: string;
  parent_task_id: string | null;
  title: string;
  description: string;
  role: string;
  status: string;
  attempt: number;
  max_attempts: number;
  depth: number;
  requirements: string[];
  dependencies: string[];
  assigned_ant_id: string | null;
  lease_owner: string | null;
  lease_expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface DatabaseClient {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
}

export class PostgresStateRepository implements StateRepository {
  constructor(private readonly db: DatabaseClient) {}

  async getTask(taskId: TaskId): Promise<TaskRecord | null> {
    const res = await this.db.query<PostgresTaskRow>(
      `SELECT * FROM tasks WHERE id = $1`,
      [taskId],
    );

    if (res.rows.length === 0) return null;
    return this.mapTaskRow(res.rows[0]);
  }

  async saveTask(task: TaskRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO tasks (
        id, run_id, parent_task_id, title, description, role, status,
        attempt, max_attempts, depth, requirements, dependencies, assigned_ant_id,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        status = EXCLUDED.status,
        attempt = EXCLUDED.attempt,
        assigned_ant_id = EXCLUDED.assigned_ant_id,
        updated_at = EXCLUDED.updated_at`,
      [
        task.id,
        task.runId,
        task.parentTaskId ?? null,
        task.title,
        task.description,
        task.role,
        task.status,
        task.attempt,
        task.maxAttempts,
        task.depth,
        JSON.stringify(task.requirements),
        JSON.stringify(task.dependencies),
        task.assignedAntId ?? null,
        task.createdAt,
        task.updatedAt,
      ],
    );
  }

  async transitionTask(
    taskId: TaskId,
    expectedStatus: TaskStatus,
    nextStatus: TaskStatus,
    patch?: Partial<TaskRecord>,
  ): Promise<TaskRecord> {
    assertTaskTransition(expectedStatus, nextStatus);

    const now = new Date();
    const updatedTitle = patch?.title;
    const updatedDesc = patch?.description;
    const updatedAttempt = patch?.attempt;
    const updatedAnt = patch?.assignedAntId;

    const res = await this.db.query<PostgresTaskRow>(
      `UPDATE tasks
       SET
         status = $1,
         updated_at = $2,
         title = COALESCE($3, title),
         description = COALESCE($4, description),
         attempt = COALESCE($5, attempt),
         assigned_ant_id = COALESCE($6, assigned_ant_id)
       WHERE id = $7 AND status = $8
       RETURNING *`,
      [
        nextStatus,
        now,
        updatedTitle ?? null,
        updatedDesc ?? null,
        updatedAttempt ?? null,
        updatedAnt ?? null,
        taskId,
        expectedStatus,
      ],
    );

    if (res.rows.length === 0) {
      throw new StateConflictError(
        `State conflict when transitioning task ${taskId} from ${expectedStatus} to ${nextStatus}`,
      );
    }

    return this.mapTaskRow(res.rows[0]);
  }

  async listRunnableTasks(runId: RunId): Promise<TaskRecord[]> {
    const res = await this.db.query<PostgresTaskRow>(
      `SELECT * FROM tasks
       WHERE run_id = $1
         AND status IN ($2, $3)
         AND (lease_expires_at IS NULL OR lease_expires_at < NOW())`,
      [runId, TaskStatus.Created, TaskStatus.Retrying],
    );

    return res.rows.map((r) => this.mapTaskRow(r));
  }

  async claimTaskLease(
    taskId: TaskId,
    workerId: string,
    leaseDurationMs = 120_000,
  ): Promise<boolean> {
    const expiresAt = new Date(Date.now() + leaseDurationMs);
    const res = await this.db.query(
      `UPDATE tasks
       SET
         lease_owner = $1,
         lease_expires_at = $2
       WHERE id = $3 AND (lease_expires_at IS NULL OR lease_expires_at < NOW())`,
      [workerId, expiresAt, taskId],
    );

    return res.rows.length > 0;
  }

  async saveAntExecution(execution: AntExecution): Promise<void> {
    await this.db.query(
      `INSERT INTO ant_executions (
        id, ant_id, run_id, task_id, role, provider, model, attempt, status, started_at, finished_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        `${execution.antId}-${execution.taskId}-${execution.attempt}`,
        execution.antId,
        execution.runId,
        execution.taskId,
        execution.role,
        execution.provider ?? null,
        execution.model ?? null,
        execution.attempt,
        execution.status,
        execution.startedAt,
        execution.finishedAt ?? null,
      ],
    );
  }

  async saveArtifact(artifact: Artifact): Promise<void> {
    await this.db.query(
      `INSERT INTO artifacts (
        id, run_id, task_id, ant_id, type, name, path, uri, metadata, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        artifact.id,
        artifact.runId,
        artifact.taskId ?? null,
        artifact.antId ?? null,
        artifact.type,
        artifact.name,
        artifact.path ?? null,
        artifact.uri ?? null,
        JSON.stringify(artifact.metadata),
        artifact.createdAt,
      ],
    );
  }

  async appendEvent(event: EventRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO events (
        run_id, task_id, trace_id, event_type, payload, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        event.runId,
        event.taskId ?? null,
        event.traceId,
        event.type,
        JSON.stringify(event.payload),
        event.timestamp,
      ],
    );
  }

  async getBudgetUsage(runId: RunId): Promise<BudgetUsage> {
    const res = await this.db.query(
      `SELECT
        COALESCE(SUM((payload->>'costUsd')::numeric), 0) as cost_usd,
        COALESCE(SUM((payload->>'inputTokens')::numeric), 0) as input_tokens,
        COALESCE(SUM((payload->>'outputTokens')::numeric), 0) as output_tokens,
        COUNT(CASE WHEN event_type = 'model.completed' THEN 1 END) as model_calls,
        COUNT(CASE WHEN event_type = 'tool.completed' THEN 1 END) as tool_calls,
        MIN(created_at) as started_at
       FROM events
       WHERE run_id = $1`,
      [runId],
    );

    const r = res.rows[0] || {};
    return {
      costUsd: Number(r.cost_usd || 0),
      inputTokens: Number(r.input_tokens || 0),
      outputTokens: Number(r.output_tokens || 0),
      modelCalls: Number(r.model_calls || 0),
      toolCalls: Number(r.tool_calls || 0),
      startedAt: r.started_at ? new Date(r.started_at) : new Date(),
    };
  }

  async getBudgetLimits(runId: RunId): Promise<BudgetLimits> {
    const res = await this.db.query(
      `SELECT budget_limits FROM runs WHERE id = $1`,
      [runId],
    );

    if (res.rows.length === 0) return {};
    return typeof res.rows[0].budget_limits === "string"
      ? JSON.parse(res.rows[0].budget_limits)
      : res.rows[0].budget_limits || {};
  }

  async getOperationResult<T>(
    operationId: OperationId,
  ): Promise<T | null> {
    const res = await this.db.query(
      `SELECT result FROM operations WHERE operation_id = $1 AND status = 'COMPLETED'`,
      [operationId],
    );

    if (res.rows.length === 0) return null;
    const raw = res.rows[0].result;
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  }

  async saveOperationResult<T>(
    operationId: OperationId,
    value: T,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO operations (
        operation_id, status, result, completed_at
      ) VALUES ($1, 'COMPLETED', $2, NOW())
      ON CONFLICT (operation_id) DO UPDATE SET
        status = EXCLUDED.status,
        result = EXCLUDED.result,
        completed_at = EXCLUDED.completed_at`,
      [operationId, JSON.stringify(value)],
    );
  }

  private mapTaskRow(r: PostgresTaskRow): TaskRecord {
    return {
      id: r.id,
      runId: r.run_id,
      parentTaskId: r.parent_task_id ?? undefined,
      title: r.title,
      description: r.description,
      role: r.role as any,
      status: r.status as TaskStatus,
      attempt: r.attempt,
      maxAttempts: r.max_attempts,
      depth: r.depth,
      requirements: typeof r.requirements === "string" ? JSON.parse(r.requirements) : r.requirements || [],
      dependencies: typeof r.dependencies === "string" ? JSON.parse(r.dependencies) : r.dependencies || [],
      assignedAntId: r.assigned_ant_id ?? undefined,
      createdAt: new Date(r.created_at),
      updatedAt: new Date(r.updated_at),
    };
  }
}
