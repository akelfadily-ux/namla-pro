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
import { StateRepository, EventRecord, PostgresPool, PostgresQueryClient, RunAccountingState } from "../../domain/contracts";
import { randomUUID } from "crypto";
import { assertRunTransition, assertTaskTransition } from "../../domain/lifecycle";
import { StateConflictError, ConfigurationError } from "../../domain/errors";
import { isTrustedRecoveryAuthority } from "../../bootstrap/trustedRecoveryBootstrap";

export interface PostgresRunRow {
  id: string;
  root_task_id: string | null;
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
  next_eligible_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export type DatabaseClient = PostgresQueryClient;

export class PostgresStateRepository implements StateRepository {
  private readonly pool?: PostgresPool;

  constructor(
    private readonly db: DatabaseClient,
    pool?: PostgresPool,
  ) {
    if (pool) {
      this.pool = pool;
    } else if (typeof (db as any).connect === "function") {
      this.pool = db as unknown as PostgresPool;
    }
  }

  async createRun(run: RunRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO runs (id, root_task_id, status, goal, repository_path, budget_limits, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        run.id,
        run.rootTaskId ?? null,
        run.status,
        run.goal,
        run.repositoryPath ?? null,
        JSON.stringify(run.budgetLimits),
        run.createdAt,
        run.updatedAt,
      ],
    );
    await this.setAccountingState(run.id, "ACTIVE");
  }

  async setRunRootTask(runId: RunId, rootTaskId: TaskId): Promise<void> {
    await this.db.query(
      `UPDATE runs SET root_task_id = $1, updated_at = NOW() WHERE id = $2`,
      [rootTaskId, runId],
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
      rootTaskId: r.root_task_id ?? undefined,
      status: r.status as RunStatus,
      goal: r.goal,
      repositoryPath: r.repository_path ?? undefined,
      budgetLimits: typeof r.budget_limits === "string" ? JSON.parse(r.budget_limits) : r.budget_limits || {},
      createdAt: new Date(r.created_at),
      updatedAt: new Date(r.updated_at),
    };
  }

  async getAccountingState(runId: RunId): Promise<{ state: RunAccountingState; reason?: string }> {
    const res = await this.db.query(
      `SELECT state, reason FROM run_accounting_state WHERE run_id = $1`,
      [runId],
    );
    if (res.rows.length === 0) return { state: "ACTIVE" };
    return {
      state: res.rows[0].state as RunAccountingState,
      reason: res.rows[0].reason ?? undefined,
    };
  }

  async setAccountingState(runId: RunId, state: RunAccountingState, reason?: string): Promise<void> {
    await this.db.query(
      `INSERT INTO run_accounting_state (run_id, state, reason, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (run_id) DO UPDATE SET
         state = EXCLUDED.state,
         reason = EXCLUDED.reason,
         updated_at = NOW()`,
      [runId, state, reason ?? null],
    );
  }

  async recoverAccountingState(
    runId: RunId,
    mode: import("../../domain/types").AccountingRecoveryMode,
    reconciliationAuthority: { identity: string; permissions: readonly string[] },
    evidence: import("../../domain/types").AccountingRecoveryEvidence,
    _testHookBeforeCommit?: (client: DatabaseClient) => Promise<void>,
  ): Promise<{ recovered: boolean; previousState: RunAccountingState }> {
    if (!this.pool) {
      throw new ConfigurationError("PostgresStateRepository requires a transaction-capable pool for accounting recovery");
    }

    if (!mode || !reconciliationAuthority || !reconciliationAuthority.identity || !evidence) {
      throw new ConfigurationError("Accounting recovery requires explicit mode, reconciliationAuthority identity, and typed evidence");
    }

    // Must originate from trusted recovery authority boundary
    if (!isTrustedRecoveryAuthority(reconciliationAuthority)) {
      throw new ConfigurationError(`Unauthenticated recovery attempt denied: authority '${reconciliationAuthority.identity}' is not a trusted recovery authority`);
    }

    // Require explicit capability permission boundary
    const hasCapability = reconciliationAuthority.permissions.includes("*") || reconciliationAuthority.permissions.includes("accounting:recover");
    if (!hasCapability) {
      throw new ConfigurationError(`Authority '${reconciliationAuthority.identity}' lacks required capability 'accounting:recover'`);
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Lock and revalidate accounting state inside transaction block to eliminate TOCTOU race
      const stateRes = await client.query(
        `SELECT state, reason FROM run_accounting_state WHERE run_id = $1 FOR UPDATE`,
        [runId],
      );

      const currentState: RunAccountingState = stateRes.rows.length > 0 ? (stateRes.rows[0].state as RunAccountingState) : "ACTIVE";
      const currentReason = stateRes.rows.length > 0 ? stateRes.rows[0].reason : undefined;

      if (currentState === "ACTIVE") {
        await client.query("COMMIT");
        return { recovered: false, previousState: "ACTIVE" };
      }

      // Validate numeric evidence bounds
      const validateBounds = (cost: number, tokens: number) => {
        if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0 || cost > 1_000_000) {
          throw new ConfigurationError("Reconciliation evidence costUsd must be a finite number between 0 and 1,000,000");
        }
        if (typeof tokens !== "number" || !Number.isSafeInteger(tokens) || tokens < 0 || tokens > 1_000_000_000) {
          throw new ConfigurationError("Reconciliation evidence tokens must be a safe integer between 0 and 1,000,000,000");
        }
      };

      // Model 1: Specific reservation reconciliation if reservationId is supplied
      if (evidence.reservationId) {
        let cost = 0;
        let tokens = 0;
        if (mode === "PROVIDER_RECONCILED" && (evidence.type === "PROVIDER_INVOICE" || evidence.type === "PROVIDER_USAGE_API")) {
          cost = evidence.actualCostUsd;
          tokens = evidence.actualTokens;
        } else if (mode === "HUMAN_RECONCILED" && evidence.type === "HUMAN_ADMIN_AUDIT") {
          cost = evidence.reconciledCostUsd;
          tokens = evidence.reconciledTokens;
        }
        validateBounds(cost, tokens);

        await client.query(
          `UPDATE budget_reservations
           SET status = 'RECONCILED', actual_cost_usd = $1, actual_tokens = $2, reconciled_at = NOW()
           WHERE id = $3 AND run_id = $4 AND status = 'RESERVED'`,
          [cost, tokens, evidence.reservationId, runId],
        );
      } else {
        // Model 2: Aggregate Reconciliation Ledger Row.
        // Settle active RESERVED rows to RECONCILED with 0 cost/tokens to prevent double counting
        let aggregateCost = 0;
        let aggregateTokens = 0;

        if (mode === "PROVIDER_RECONCILED") {
          if (evidence.type !== "PROVIDER_INVOICE" && evidence.type !== "PROVIDER_USAGE_API") {
            throw new ConfigurationError("PROVIDER_RECONCILED mode requires PROVIDER_INVOICE or PROVIDER_USAGE_API evidence");
          }
          aggregateCost = evidence.actualCostUsd;
          aggregateTokens = evidence.actualTokens;
        } else if (mode === "HUMAN_RECONCILED") {
          if (evidence.type !== "HUMAN_ADMIN_AUDIT") {
            throw new ConfigurationError("HUMAN_RECONCILED mode requires HUMAN_ADMIN_AUDIT evidence");
          }
          aggregateCost = evidence.reconciledCostUsd;
          aggregateTokens = evidence.reconciledTokens;
        } else if (mode === "CONSERVATIVE_MAX_WRITE_OFF") {
          if (evidence.type !== "CONSERVATIVE_MAX_WRITE_OFF_AUDIT") {
            throw new ConfigurationError("CONSERVATIVE_MAX_WRITE_OFF mode requires CONSERVATIVE_MAX_WRITE_OFF_AUDIT evidence");
          }
          aggregateCost = evidence.maxReservedCostUsd;
          aggregateTokens = evidence.maxReservedTokens;
        }
        validateBounds(aggregateCost, aggregateTokens);

        // Mark existing RESERVED reservations for this run as RECONCILED with 0 actuals
        await client.query(
          `UPDATE budget_reservations
           SET status = 'RECONCILED', actual_cost_usd = 0, actual_tokens = 0, reconciled_at = NOW()
           WHERE run_id = $1 AND status = 'RESERVED'`,
          [runId],
        );

        // Insert dedicated Aggregate Reconciliation Ledger row
        const recLedgerId = randomUUID();
        await client.query(
          `INSERT INTO budget_reservations (
            id, run_id, kind, reserved_cost_usd, reserved_tokens, actual_cost_usd, actual_tokens, status, created_at, reconciled_at
          ) VALUES ($1, $2, 'RECONCILIATION', $3, $4, $3, $4, 'RECONCILED', NOW(), NOW())`,
          [recLedgerId, runId, aggregateCost, aggregateTokens],
        );
      }

      // Transition accounting safety state back to ACTIVE
      await client.query(
        `INSERT INTO run_accounting_state (run_id, state, reason, updated_at)
         VALUES ($1, 'ACTIVE', $2, NOW())
         ON CONFLICT (run_id) DO UPDATE SET
           state = 'ACTIVE',
           reason = EXCLUDED.reason,
           updated_at = NOW()`,
        [runId, `Recovered via ${mode} by ${reconciliationAuthority.identity}`],
      );

      // Audit recovery with complete evidence payload
      await client.query(
        `INSERT INTO events (
          run_id, task_id, trace_id, event_type, payload, created_at
        ) VALUES ($1, NULL, $2, 'accounting.recovered', $3, NOW())`,
        [
          runId,
          `trace-${runId}`,
          JSON.stringify({
            previousState: currentState,
            previousReason: currentReason,
            newState: "ACTIVE",
            mode,
            authorityIdentity: reconciliationAuthority.identity,
            evidence,
            recoveredAt: new Date(),
          }),
        ],
      );

      // Fault injection hook before commit
      if (_testHookBeforeCommit) {
        await _testHookBeforeCommit(client);
      }

      await client.query("COMMIT");
      return { recovered: true, previousState: currentState };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
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
    const nextEligibleAt = patch?.nextEligibleAt;

    const res = await this.db.query<PostgresTaskRow>(
      `UPDATE tasks
       SET
         status = $1,
         updated_at = $2,
         title = COALESCE($3, title),
         description = COALESCE($4, description),
         attempt = COALESCE($5, attempt),
         assigned_ant_id = COALESCE($6, assigned_ant_id),
         next_eligible_at = $7
       WHERE id = $8 AND status = $9
       RETURNING *`,
      [
        nextStatus,
        now,
        updatedTitle ?? null,
        updatedDesc ?? null,
        updatedAttempt ?? null,
        updatedAnt ?? null,
        nextEligibleAt ?? null,
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
    const nextEligibleAt = patch?.nextEligibleAt;

    const res = await this.db.query<PostgresTaskRow>(
      `UPDATE tasks
       SET
         status = $1,
         updated_at = $2,
         title = COALESCE($3, title),
         description = COALESCE($4, description),
         attempt = COALESCE($5, attempt),
         assigned_ant_id = COALESCE($6, assigned_ant_id),
         next_eligible_at = $7
       WHERE id = $8 AND status = $9 AND lease_owner = $10 AND lease_token = $11 AND lease_expires_at > NOW()
       RETURNING *`,
      [
        nextStatus,
        now,
        updatedTitle ?? null,
        updatedDesc ?? null,
        updatedAttempt ?? null,
        updatedAnt ?? null,
        nextEligibleAt ?? null,
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
         AND (lease_expires_at IS NULL OR lease_expires_at < NOW())
         AND (next_eligible_at IS NULL OR next_eligible_at <= NOW())`,
      [runId, TaskStatus.Created, TaskStatus.Retrying],
    );

    return res.rows.map((r) => this.mapTaskRow(r));
  }

  async listTasksForRun(runId: RunId): Promise<TaskRecord[]> {
    const res = await this.db.query<PostgresTaskRow>(
      `SELECT * FROM tasks WHERE run_id = $1`,
      [runId],
    );
    return res.rows.map((r) => this.mapTaskRow(r));
  }

  async claimTaskLease(
    taskId: TaskId,
    workerId: WorkerId,
    leaseDurationMs = 120_000,
    workerCapabilities?: readonly string[],
  ): Promise<TaskRecord | null> {
    const leaseToken = randomUUID();
    const expiresAt = new Date(Date.now() + leaseDurationMs);

    const executeClaim = async (client: DatabaseClient) => {
      // 1. Get task details and runId
      const taskRes = await client.query<PostgresTaskRow>(`SELECT * FROM tasks WHERE id = $1`, [taskId]);
      if (taskRes.rows.length === 0) return null;
      const targetTask = taskRes.rows[0];
      const runId = targetTask.run_id;

      // Rule 2: Require executable Tasks to have a valid Ant ID at claim time
      if (!targetTask.assigned_ant_id || targetTask.assigned_ant_id.trim().length === 0) {
        return null; // Refuse claim on unassigned task
      }

      // 1b. Enforce worker capability matching at database claim boundary
      const reqs: string[] = typeof targetTask.requirements === "string" ? JSON.parse(targetTask.requirements) : targetTask.requirements || [];
      if (reqs.length > 0) {
        if (!workerCapabilities) return null;
        const workerCapSet = new Set(workerCapabilities);
        const satisfiesAll = reqs.every((r) => workerCapSet.has(r));
        if (!satisfiesAll) {
          return null; // Worker lacks required capabilities for this task
        }
      }

      // 2. Lock the run row and derive authoritative persisted limits directly from locked DB row inside transaction
      const runRes = await client.query<PostgresRunRow>(`SELECT budget_limits, status FROM runs WHERE id = $1 FOR UPDATE`, [runId]);
      if (runRes.rows.length === 0) return null;

      const runRow = runRes.rows[0];
      // Rule 3: Authoritative Task claiming requires an explicitly executable RUNNING Run state
      if (runRow.status !== "RUNNING") return null;

      const runLimits: BudgetLimits = typeof runRow.budget_limits === "string" ? JSON.parse(runRow.budget_limits) : runRow.budget_limits || {};
      const maxConc = runLimits.maxConcurrency ?? 10;
      const maxA = runLimits.maxAgents ?? 10;

      // 3. Count ALL active unexpired task leases across ALL task statuses to eliminate lease-acquired-but-not-counted window
      const activeLeasesRes = await client.query<{ assigned_ant_id: string | null }>(
        `SELECT assigned_ant_id FROM tasks
         WHERE run_id = $1
           AND lease_expires_at IS NOT NULL
           AND lease_expires_at > NOW()`,
        [runId],
      );
      const activeLeaseRows = activeLeasesRes.rows || [];
      const activeLeaseCount = activeLeaseRows.length;
      if (activeLeaseCount >= maxConc) return null;

      // 4. Evaluate maxAgents: if candidate Ant is already active in unexpired lease set, allow; otherwise enforce activeAntsCount < maxAgents
      const candidateAntId = targetTask.assigned_ant_id;
      const activeAntSet = new Set(activeLeaseRows.map((r) => r.assigned_ant_id).filter(Boolean));
      const isAntActive = candidateAntId ? activeAntSet.has(candidateAntId) : false;

      if (!isAntActive && activeAntSet.size >= maxA) {
        return null;
      }

      // 5. Execute task lease claim update
      const updateRes = await client.query<PostgresTaskRow>(
        `UPDATE tasks
         SET lease_owner = $1, lease_token = $2, lease_expires_at = $3, updated_at = NOW()
         WHERE id = $4
           AND status IN ('CREATED', 'RETRYING')
           AND (lease_expires_at IS NULL OR lease_expires_at < NOW())
           AND (next_eligible_at IS NULL OR next_eligible_at <= NOW())
         RETURNING *`,
        [workerId, leaseToken, expiresAt, taskId],
      );

      if (updateRes.rows.length === 0) return null;
      return this.mapTaskRow(updateRes.rows[0]);
    };

    if (this.pool) {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const res = await executeClaim(client);
        await client.query("COMMIT");
        return res;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }

    return executeClaim(this.db);
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
         UPDATE tasks
         SET status = 'RETRYING', lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, attempt = tasks.attempt + 1, updated_at = NOW()
         FROM expired_candidates ec
         WHERE tasks.id = ec.id AND ec.attempt + 1 < ec.max_attempts
         RETURNING tasks.id, ec.status as old_status, ec.lease_owner as old_worker, ec.lease_token as old_token, ec.attempt as old_attempt, tasks.attempt as new_attempt
       ),
       updated_failures AS (
         UPDATE tasks
         SET status = 'FAILED', lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, updated_at = NOW()
         FROM expired_candidates ec
         WHERE tasks.id = ec.id AND ec.attempt + 1 >= ec.max_attempts
         RETURNING tasks.id, ec.status as old_status, ec.lease_owner as old_worker, ec.lease_token as old_token, ec.attempt as old_attempt
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
    const id = `${execution.antId}-${execution.taskId}-${execution.attempt}`;
    await this.db.query(
      `INSERT INTO ant_executions (
        id, ant_id, run_id, task_id, role, provider, model, attempt, status, started_at, finished_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        finished_at = COALESCE(EXCLUDED.finished_at, ant_executions.finished_at),
        provider = COALESCE(EXCLUDED.provider, ant_executions.provider),
        model = COALESCE(EXCLUDED.model, ant_executions.model)`,
      [
        id,
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

  async updateAntExecution(execution: Partial<AntExecution> & { antId: AntId; runId: RunId; taskId: TaskId; attempt: number }): Promise<void> {
    const id = `${execution.antId}-${execution.taskId}-${execution.attempt}`;
    await this.db.query(
      `UPDATE ant_executions
       SET
         status = COALESCE($1, status),
         finished_at = COALESCE($2, finished_at),
         provider = COALESCE($3, provider),
         model = COALESCE($4, model)
       WHERE id = $5`,
      [
        execution.status ?? null,
        execution.finishedAt ?? null,
        execution.provider ?? null,
        execution.model ?? null,
        id,
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

    if (this.pool) {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const result = await executeReservation(client);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }

    if (process.env.NODE_ENV === "test") {
      return executeReservation(this.db);
    }

    throw new ConfigurationError(
      "PostgresStateRepository requires a transaction-capable connection pool for reserveBudget",
    );
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
      SELECT $1, $1, $2, $3, $4, $5, $5, $6, 'RUNNING', $7, $7, $8, $9::timestamptz, $10::timestamptz
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

  async hasUnresolvedOperations(runId: RunId): Promise<boolean> {
    const res = await this.db.query(
      `SELECT 1 FROM operations
       WHERE run_id = $1 AND status IN ('RUNNING', 'PENDING')`,
      [runId],
    );
    return res.rows.length > 0;
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
      nextEligibleAt: r.next_eligible_at ? new Date(r.next_eligible_at) : undefined,
      createdAt: new Date(r.created_at),
      updatedAt: new Date(r.updated_at),
    };
  }
}
