import {
  AntExecution,
  AntId,
  Artifact,
  BudgetLimits,
  BudgetUsage,
  OperationId,
  OperationRecord,
  OperationStatus,
  RunId,
  RunRecord,
  RunStatus,
  TaskId,
  TaskRecord,
  TaskStatus,
  WorkerId,
} from "../../domain/types";
import { StateRepository, EventRecord } from "../../domain/contracts";
import { randomUUID } from "crypto";
import { assertRunTransition, assertTaskTransition } from "../../domain/lifecycle";
import { StateConflictError } from "../../domain/errors";

export interface PostgresRunRow {
  id: string;
  status: string;
  goal: string;
  repository_path: string | null;
  budget_limits: string | object;
  created_at: Date;
  updated_at: Date;
}

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
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[]; rowCount?: number }>;
}

export class PostgresStateRepository implements StateRepository {
  constructor(private readonly db: DatabaseClient) {}

  async createRun(run: RunRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO runs (id, status, goal, repository_path, budget_limits, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        run.id,
        run.status,
        run.goal,
        run.repositoryPath ?? null,
        JSON.stringify(run.budgetLimits),
        run.createdAt,
        run.updatedAt,
      ],
    );
  }

  async getRun(runId: RunId): Promise<RunRecord | null> {
    const res = await this.db.query<PostgresRunRow>(
      `SELECT * FROM runs WHERE id = $1`,
      [runId],
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      status: r.status as RunStatus,
      goal: r.goal,
      repositoryPath: r.repository_path ?? undefined,
      budgetLimits: typeof r.budget_limits === "string" ? JSON.parse(r.budget_limits) : r.budget_limits || {},
      createdAt: new Date(r.created_at),
      updatedAt: new Date(r.updated_at),
    };
  }

  async transitionRun(
    runId: RunId,
    expectedStatus: RunStatus,
    nextStatus: RunStatus,
  ): Promise<RunRecord> {
    assertRunTransition(expectedStatus, nextStatus);

    const now = new Date();
    const res = await this.db.query<PostgresRunRow>(
      `UPDATE runs
       SET status = $1, updated_at = $2
       WHERE id = $3 AND status = $4
       RETURNING *`,
      [nextStatus, now, runId, expectedStatus],
    );

    if (res.rows.length === 0) {
      throw new StateConflictError(
        `State conflict when transitioning run ${runId} from ${expectedStatus} to ${nextStatus}`,
      );
    }

    const r = res.rows[0];
    return {
      id: r.id,
      status: r.status as RunStatus,
      goal: r.goal,
      repositoryPath: r.repository_path ?? undefined,
      budgetLimits: typeof r.budget_limits === "string" ? JSON.parse(r.budget_limits) : r.budget_limits || {},
      createdAt: new Date(r.created_at),
      updatedAt: new Date(r.updated_at),
    };
  }

  async getTask(taskId: TaskId): Promise<TaskRecord | null> {
    const res = await this.db.query<PostgresTaskRow>(
      `SELECT * FROM tasks WHERE id = $1`,
      [taskId],
    );

    if (res.rows.length === 0) return null;
    return this.mapTaskRow(res.rows[0]);
  }

  async createTask(task: TaskRecord): Promise<void> {
    const res = await this.db.query(
      `INSERT INTO tasks (
        id, run_id, parent_task_id, title, description, role, status,
        attempt, max_attempts, depth, requirements, dependencies, assigned_ant_id, lease_owner, lease_expires_at,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      ON CONFLICT (id) DO NOTHING`,
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
        task.leaseOwner ?? null,
        task.leaseExpiresAt ?? null,
        task.createdAt,
        task.updatedAt,
      ],
    );

    if (res.rows && res.rows.length === 0 && (res as any).rowCount === 0) {
      throw new StateConflictError(`Task with id ${task.id} already exists`);
    }
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

  async transitionTaskFenced(
    taskId: TaskId,
    expectedStatus: TaskStatus,
    nextStatus: TaskStatus,
    workerId: WorkerId,
    leaseToken: string,
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
       WHERE id = $7 AND status = $8 AND lease_owner = $9 AND lease_token = $10 AND lease_expires_at > NOW()
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
        workerId,
        leaseToken,
      ],
    );

    if (res.rows.length === 0) {
      throw new StateConflictError(
        `Fenced transition failed for task ${taskId}: worker ${workerId} with lease token ${leaseToken} does not hold active ownership`,
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
    workerId: WorkerId,
    leaseDurationMs = 120_000,
  ): Promise<TaskRecord | null> {
    const leaseToken = randomUUID();
    const expiresAt = new Date(Date.now() + leaseDurationMs);
    const res = await this.db.query<PostgresTaskRow>(
      `UPDATE tasks
       SET
         lease_owner = $1,
         lease_token = $2,
         lease_expires_at = $3
       WHERE id = $4
         AND status IN ('CREATED', 'RETRYING')
         AND (lease_expires_at IS NULL OR lease_expires_at < NOW())
       RETURNING *`,
      [workerId, leaseToken, expiresAt, taskId],
    );

    if (res.rows.length === 0) return null;
    return this.mapTaskRow(res.rows[0]);
  }

  async renewTaskLease(
    taskId: TaskId,
    workerId: WorkerId,
    leaseToken: string,
    leaseDurationMs = 120_000,
  ): Promise<boolean> {
    const expiresAt = new Date(Date.now() + leaseDurationMs);
    const res = await this.db.query(
      `UPDATE tasks
       SET lease_expires_at = $1
       WHERE id = $2 AND lease_owner = $3 AND lease_token = $4 AND lease_expires_at > NOW()`,
      [expiresAt, taskId, workerId, leaseToken],
    );

    return (res.rows && res.rows.length > 0) || Boolean((res as any).rowCount);
  }

  async releaseTaskLease(
    taskId: TaskId,
    workerId: WorkerId,
    leaseToken: string,
  ): Promise<void> {
    await this.db.query(
      `UPDATE tasks
       SET lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL
       WHERE id = $1 AND lease_owner = $2 AND lease_token = $3`,
      [taskId, workerId, leaseToken],
    );
  }

  async recoverExpiredLeases(
    runId: RunId,
  ): Promise<number> {
    const res = await this.db.query(
      `UPDATE tasks
       SET lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL
       WHERE run_id = $1 AND lease_expires_at IS NOT NULL AND lease_expires_at < NOW()`,
      [runId],
    );

    return (res.rows ? res.rows.length : 0) || (res as any).rowCount || 0;
  }

  async recoverExpiredTaskExecutions(
    runId: RunId,
  ): Promise<{ recoveredCount: number }> {
    // Atomic CTE query capturing OLD task state prior to clearing fencing tokens and updating status
    const res = await this.db.query<any>(
      `WITH expired_candidates AS (
         SELECT id, run_id, status, lease_owner, lease_token, attempt, max_attempts
         FROM tasks
         WHERE run_id = $1
           AND status IN ('ASSIGNED', 'RUNNING', 'TESTING', 'REVIEW')
           AND lease_expires_at IS NOT NULL
           AND lease_expires_at < NOW()
       ),
       updated_retries AS (
         UPDATE tasks t
         SET status = 'RETRYING', lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, attempt = t.attempt + 1, updated_at = NOW()
         FROM expired_candidates ec
         WHERE t.id = ec.id AND ec.attempt + 1 < ec.max_attempts
         RETURNING t.id, ec.status as old_status, ec.lease_owner as old_worker, ec.lease_token as old_token, ec.attempt as old_attempt, t.attempt as new_attempt
       ),
       updated_failures AS (
         UPDATE tasks t
         SET status = 'FAILED', lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, updated_at = NOW()
         FROM expired_candidates ec
         WHERE t.id = ec.id AND ec.attempt + 1 >= ec.max_attempts
         RETURNING t.id, ec.status as old_status, ec.lease_owner as old_worker, ec.lease_token as old_token, ec.attempt as old_attempt
       )
       SELECT id, old_status, old_worker, old_token, old_attempt, new_attempt, 'RETRYING' as new_status FROM updated_retries
       UNION ALL
       SELECT id, old_status, old_worker, old_token, old_attempt, old_attempt as new_attempt, 'FAILED' as new_status FROM updated_failures`,
      [runId],
    );

    const rows = res.rows || [];
    let recoveredCount = 0;

    for (const r of rows) {
      if (r.new_status === "RETRYING") recoveredCount++;

      await this.appendEvent({
        type: r.new_status === "RETRYING" ? "task.recovered" : "task.failed",
        runId,
        taskId: r.id,
        traceId: `trace-${runId}`,
        timestamp: new Date(),
        payload: {
          fromStatus: r.old_status,
          toStatus: r.new_status,
          oldWorkerId: r.old_worker,
          oldLeaseToken: r.old_token,
          reason: "LEASE_EXPIRED",
          previousAttempt: r.old_attempt,
          nextAttempt: r.new_attempt,
        },
      });
    }

    return { recoveredCount };
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
        COALESCE(SUM(actual_cost_usd), 0) as cost_usd,
        COALESCE(SUM(actual_tokens), 0) as tokens,
        COUNT(CASE WHEN kind = 'MODEL' THEN 1 END) as model_calls,
        COUNT(CASE WHEN kind = 'TOOL' THEN 1 END) as tool_calls,
        MIN(created_at) as started_at
       FROM budget_reservations
       WHERE run_id = $1 AND status = 'RECONCILED'`,
      [runId],
    );

    const r = res.rows[0] || {};
    return {
      costUsd: Number(r.cost_usd || 0),
      inputTokens: Math.floor(Number(r.tokens || 0) / 2),
      outputTokens: Math.ceil(Number(r.tokens || 0) / 2),
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

  async reserveBudget(
    runId: RunId,
    estimatedCostUsd: number,
    estimatedTokens: number,
  ): Promise<{ reserved: boolean; reservationId?: string }> {
    const executeReservation = async (client: DatabaseClient) => {
      // Acquire FOR UPDATE lock on the run row inside explicit transaction block
      await client.query(`SELECT id FROM runs WHERE id = $1 FOR UPDATE`, [runId]);

      const limitsRes = await client.query(`SELECT budget_limits FROM runs WHERE id = $1`, [runId]);
      const limits: BudgetLimits = limitsRes.rows.length > 0
        ? (typeof limitsRes.rows[0].budget_limits === "string" ? JSON.parse(limitsRes.rows[0].budget_limits) : limitsRes.rows[0].budget_limits || {})
        : {};

      const usageRes = await client.query(
        `SELECT
          COALESCE(SUM(actual_cost_usd), 0) as cost_usd,
          COALESCE(SUM(actual_tokens), 0) as tokens
         FROM budget_reservations
         WHERE run_id = $1 AND status = 'RECONCILED'`,
        [runId],
      );
      const usageRow = usageRes.rows[0] || {};
      const currentCost = Number(usageRow.cost_usd || 0);
      const currentTokens = Number(usageRow.tokens || 0);

      // Sum active unexpired reservations in budget_reservations table
      const activeRes = await client.query(
        `SELECT COALESCE(SUM(reserved_cost_usd), 0) as reserved_cost, COALESCE(SUM(reserved_tokens), 0) as reserved_tokens
         FROM budget_reservations
         WHERE run_id = $1 AND status = 'RESERVED'`,
        [runId],
      );

      const pendingCost = Number(activeRes.rows[0]?.reserved_cost || 0);
      const pendingTokens = Number(activeRes.rows[0]?.reserved_tokens || 0);

      const totalCost = currentCost + pendingCost + estimatedCostUsd;
      const totalTokens = currentTokens + pendingTokens + estimatedTokens;

      if (limits.maxCostUsd !== undefined && totalCost > limits.maxCostUsd) {
        return { reserved: false };
      }

      if (limits.maxTokens !== undefined && totalTokens > limits.maxTokens) {
        return { reserved: false };
      }

      const reservationId = randomUUID();
      const now = new Date();

      // Persist budget reservation record
      await client.query(
        `INSERT INTO budget_reservations (
          id, run_id, kind, reserved_cost_usd, reserved_tokens, status, created_at
        ) VALUES ($1, $2, 'MODEL', $3, $4, 'RESERVED', $5)`,
        [reservationId, runId, estimatedCostUsd, estimatedTokens, now],
      );

      return { reserved: true, reservationId };
    };

    // If db supports transaction execution via client checkout, wrap inside BEGIN...COMMIT
    if ((this.db as any).pool && typeof (this.db as any).pool.connect === "function") {
      const client = await (this.db as any).pool.connect();
      try {
        await client.query("BEGIN");
        const result = await executeReservation(client);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        if (typeof client.release === "function") client.release();
      }
    }

    return executeReservation(this.db);
  }

  async reconcileBudget(
    reservationId: string,
    actualCostUsd: number,
    actualTokens: number,
  ): Promise<void> {
    const res = await this.db.query(
      `UPDATE budget_reservations
       SET status = 'RECONCILED', actual_cost_usd = $1, actual_tokens = $2, reconciled_at = NOW()
       WHERE id = $3 AND status = 'RESERVED'`,
      [actualCostUsd, actualTokens, reservationId],
    );

    if (res.rows && res.rows.length === 0 && (res as any).rowCount === 0) {
      throw new Error(`ACCOUNTING STATE CONFLICT: Budget reservation ${reservationId} is not in RESERVED state`);
    }
  }

  async releaseBudgetReservation(
    reservationId: string,
    reason = "RELEASED",
  ): Promise<void> {
    const res = await this.db.query(
      `UPDATE budget_reservations
       SET status = 'RELEASED', actual_cost_usd = 0, actual_tokens = 0, reconciled_at = NOW()
       WHERE id = $1 AND status = 'RESERVED'`,
      [reservationId],
    );

    if (res.rows && res.rows.length === 0 && (res as any).rowCount === 0) {
      throw new Error(`ACCOUNTING STATE CONFLICT: Budget reservation ${reservationId} cannot be released from non-RESERVED state`);
    }
  }

  async getOperationRecord(
    operationId: OperationId,
  ): Promise<OperationRecord | null> {
    const res = await this.db.query(
      `SELECT * FROM operations WHERE operation_id = $1 OR id = $1`,
      [operationId],
    );

    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.operation_id || r.id,
      runId: r.run_id,
      taskId: r.task_id,
      antId: r.ant_id,
      toolName: r.tool_name || r.operation_type,
      inputHash: r.input_hash || "",
      status: r.status as OperationStatus,
      owner: r.owner || r.lease_owner,
      claimToken: r.claim_token,
      leaseExpiresAt: r.lease_expires_at ? new Date(r.lease_expires_at) : undefined,
      result: typeof r.result === "string" ? JSON.parse(r.result) : r.result,
      error: r.error,
      createdAt: new Date(r.created_at || Date.now()),
      completedAt: r.completed_at ? new Date(r.completed_at) : undefined,
    };
  }

  async claimOperation(
    op: Partial<OperationRecord> & { id: OperationId; toolName: string; inputHash: string; runId: RunId; taskId: TaskId; antId: AntId },
    authority: { workerId: WorkerId; leaseToken: string },
    leaseDurationMs = 60_000,
  ): Promise<{ status: "CLAIMED" | "COMPLETED" | "RUNNING_OTHER_LEASE" | "INPUT_HASH_MISMATCH" | "TASK_AUTHORITY_LOST"; record?: OperationRecord; claimToken?: string }> {
    const claimToken = randomUUID();
    const expiresAt = new Date(Date.now() + leaseDurationMs);
    const now = new Date();

    const authWorker = authority.workerId;
    const authTokens = authority.leaseToken;

    // Strict atomic SQL claim requiring active, non-null, unexpired task lease ownership
    const res = await this.db.query<any>(
      `INSERT INTO operations (
        operation_id, id, run_id, task_id, ant_id, operation_type, tool_name, input_hash, status, lease_owner, owner, claim_token, lease_expires_at, created_at
      )
      SELECT $1, $1, $2, $3, $4, $5, $5, $6, 'RUNNING', $7, $7, $8, $9, $10
      FROM tasks
      WHERE tasks.id = $3
        AND tasks.run_id = $2
        AND tasks.lease_owner = $7
        AND tasks.lease_token = $11
        AND tasks.lease_expires_at IS NOT NULL
        AND tasks.lease_expires_at > NOW()
      ON CONFLICT (operation_id) DO UPDATE SET
        status = 'RUNNING',
        lease_owner = EXCLUDED.lease_owner,
        owner = EXCLUDED.owner,
        claim_token = EXCLUDED.claim_token,
        lease_expires_at = EXCLUDED.lease_expires_at
      WHERE operations.status != 'COMPLETED'
        AND (operations.lease_expires_at IS NULL OR operations.lease_expires_at < NOW())
        AND operations.run_id = EXCLUDED.run_id
        AND operations.task_id = EXCLUDED.task_id
        AND operations.tool_name = EXCLUDED.tool_name
        AND operations.input_hash = EXCLUDED.input_hash
      RETURNING *`,
      [op.id, op.runId, op.taskId, op.antId, op.toolName, op.inputHash, authWorker, claimToken, expiresAt, now, authTokens],
    );

    if (res.rows && res.rows.length === 0) {
      // First verify if task authority is active. If task authority is lost/expired, return TASK_AUTHORITY_LOST regardless of existing operations
      const task = await this.getTask(op.taskId);
      const isLeaseActive = task?.leaseExpiresAt ? new Date(task.leaseExpiresAt) > now : false;
      if (
        !task ||
        !task.leaseOwner ||
        task.leaseOwner !== authWorker ||
        (authTokens !== null && task.leaseToken !== authTokens) ||
        !isLeaseActive
      ) {
        return { status: "TASK_AUTHORITY_LOST" };
      }

      const existingOp = await this.getOperationRecord(op.id);
      if (!existingOp) {
        return { status: "TASK_AUTHORITY_LOST" };
      }
      if (existingOp.inputHash && existingOp.inputHash !== op.inputHash) {
        return { status: "INPUT_HASH_MISMATCH", record: existingOp };
      }
      if (existingOp.status === OperationStatus.Completed) {
        return { status: "COMPLETED", record: existingOp };
      }
      return { status: "RUNNING_OTHER_LEASE", record: existingOp };
    }

    if (res.rows && res.rows.length > 0) {
      const r = res.rows[0];
      const record: OperationRecord = {
        id: r.operation_id || r.id,
        runId: r.run_id,
        taskId: r.task_id,
        antId: r.ant_id,
        toolName: r.tool_name || r.operation_type,
        inputHash: r.input_hash || "",
        status: r.status as OperationStatus,
        owner: r.owner || r.lease_owner,
        claimToken: r.claim_token,
        leaseExpiresAt: r.lease_expires_at ? new Date(r.lease_expires_at) : undefined,
        result: typeof r.result === "string" ? JSON.parse(r.result) : r.result,
        error: r.error,
        createdAt: new Date(r.created_at || Date.now()),
        completedAt: r.completed_at ? new Date(r.completed_at) : undefined,
      };
      return { status: "CLAIMED", record, claimToken };
    }

    const record = await this.getOperationRecord(op.id);
    if (!record) {
      throw new Error(`STATE INVARIANT FAILURE: Operation ${op.id} claim produced no record and cannot be retrieved`);
    }

    if (record.inputHash && record.inputHash !== op.inputHash) {
      return { status: "INPUT_HASH_MISMATCH", record };
    }
    if (record.status === OperationStatus.Completed) {
      return { status: "COMPLETED", record };
    }
    return { status: "RUNNING_OTHER_LEASE", record };
  }

  async completeOperation<T>(
    operationId: OperationId,
    workerId: WorkerId,
    claimToken: string,
    value: T,
  ): Promise<boolean> {
    const res = await this.db.query(
      `UPDATE operations
       SET status = 'COMPLETED', result = $1, completed_at = NOW(), lease_owner = NULL, owner = NULL, lease_expires_at = NULL
       WHERE (operation_id = $2 OR id = $2) AND (owner = $3 OR lease_owner = $3) AND claim_token = $4 AND status = 'RUNNING'`,
      [JSON.stringify(value), operationId, workerId, claimToken],
    );
    return (res.rows && res.rows.length > 0) || Boolean(res.rowCount);
  }

  async failOperation(
    operationId: OperationId,
    workerId: WorkerId,
    claimToken: string,
    error: string,
  ): Promise<boolean> {
    const res = await this.db.query(
      `UPDATE operations
       SET status = 'FAILED', error = $1, completed_at = NOW(), lease_owner = NULL, owner = NULL, lease_expires_at = NULL
       WHERE (operation_id = $2 OR id = $2) AND (owner = $3 OR lease_owner = $3) AND claim_token = $4 AND status = 'RUNNING'`,
      [error, operationId, workerId, claimToken],
    );
    return (res.rows && res.rows.length > 0) || Boolean(res.rowCount);
  }

  private mapTaskRow(r: PostgresTaskRow & { lease_token?: string }): TaskRecord {
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
      leaseOwner: r.lease_owner ?? undefined,
      leaseToken: r.lease_token ?? undefined,
      leaseExpiresAt: r.lease_expires_at ? new Date(r.lease_expires_at) : undefined,
      createdAt: new Date(r.created_at),
      updatedAt: new Date(r.updated_at),
    };
  }
}
