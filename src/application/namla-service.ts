import { randomUUID } from "crypto";
import { Container } from "../bootstrap/container";
import { TaskRecord, TaskStatus, AntRole, RunRecord, RunStatus } from "../domain/types";
import { ConfigurationError } from "../domain/errors";

export interface CreateRunInput {
  goal: string;
  repositoryPath?: string;
  budget?: {
    maxCostUsd?: number;
    maxTokens?: number;
    maxConcurrency?: number;
    maxAgents?: number;
    maxDepth?: number;
  };
}

export interface RunSummary {
  id: string;
  status: string;
}

export class NamlaService {
  constructor(private readonly container: Container) {}

  validateCreateRunInput(input: CreateRunInput): void {
    if (!input.goal || typeof input.goal !== "string" || input.goal.trim().length === 0) {
      throw new ConfigurationError("CreateRunInput.goal must be a non-empty string");
    }
    if (input.budget) {
      if (input.budget.maxCostUsd !== undefined && (typeof input.budget.maxCostUsd !== "number" || input.budget.maxCostUsd < 0)) {
        throw new ConfigurationError("CreateRunInput.budget.maxCostUsd must be a non-negative number");
      }
      if (input.budget.maxTokens !== undefined && (typeof input.budget.maxTokens !== "number" || input.budget.maxTokens < 0)) {
        throw new ConfigurationError("CreateRunInput.budget.maxTokens must be a non-negative number");
      }
      if (input.budget.maxConcurrency !== undefined && (typeof input.budget.maxConcurrency !== "number" || input.budget.maxConcurrency < 1)) {
        throw new ConfigurationError("CreateRunInput.budget.maxConcurrency must be a positive number >= 1");
      }
      if (input.budget.maxAgents !== undefined && (typeof input.budget.maxAgents !== "number" || input.budget.maxAgents < 1)) {
        throw new ConfigurationError("CreateRunInput.budget.maxAgents must be a positive number >= 1");
      }
      if (input.budget.maxDepth !== undefined && (typeof input.budget.maxDepth !== "number" || input.budget.maxDepth < 0)) {
        throw new ConfigurationError("CreateRunInput.budget.maxDepth must be a non-negative number");
      }
    }
  }

  async createRun(input: CreateRunInput): Promise<RunSummary> {
    this.validateCreateRunInput(input);

    const runId = randomUUID();
    const initialTaskId = randomUUID();
    const now = new Date();

    const runRecord: RunRecord = {
      id: runId,
      rootTaskId: initialTaskId,
      status: RunStatus.Created,
      goal: input.goal,
      repositoryPath: input.repositoryPath,
      budgetLimits: {
        maxCostUsd: input.budget?.maxCostUsd,
        maxTokens: input.budget?.maxTokens,
        maxConcurrency: input.budget?.maxConcurrency,
        maxAgents: input.budget?.maxAgents,
        maxDepth: input.budget?.maxDepth,
      },
      createdAt: now,
      updatedAt: now,
    };

    const initialTask: TaskRecord = {
      id: initialTaskId,
      runId,
      title: `Plan: ${input.goal}`,
      description: input.goal,
      status: TaskStatus.Created,
      role: AntRole.Planner,
      assignedAntId: `ant-planner-${initialTaskId.slice(0, 8)}`,
      attempt: 0,
      maxAttempts: 3,
      depth: 0,
      requirements: [],
      dependencies: [],
      createdAt: now,
      updatedAt: now,
    };

    // Execute task creation first, then run record with rootTaskId to satisfy FK constraints
    await this.container.unitOfWork.transaction(async (txState) => {
      // 1. Create run without rootTaskId first
      await txState.createRun({ ...runRecord, rootTaskId: undefined });
      // 2. Create initial task
      await txState.createTask(initialTask);
      // 3. Update run with rootTaskId
      if (typeof (txState as any).db?.query === "function") {
        await (txState as any).db.query("UPDATE runs SET root_task_id = $1 WHERE id = $2", [initialTaskId, runId]);
      }
      await txState.appendEvent({
        type: "run.created",
        runId,
        taskId: initialTaskId,
        traceId: `trace-${runId}`,
        timestamp: now,
        payload: { goal: input.goal, budget: input.budget },
      });
    });

    return {
      id: runId,
      status: RunStatus.Created,
    };
  }

  async recoverAccountingState(
    runId: string,
    mode: import("../domain/types").AccountingRecoveryMode,
    reconciliationAuthority: string,
    evidenceRef: string,
  ): Promise<{ recovered: boolean }> {
    const res = await this.container.state.recoverAccountingState(runId, mode, reconciliationAuthority, evidenceRef);
    return { recovered: res.recovered };
  }

  async processRun(runId: string, workerId = "worker-1"): Promise<void> {
    const run = await this.container.state.getRun(runId);
    if (!run) {
      throw new ConfigurationError(`Run not found: ${runId}`);
    }

    if (run.status === RunStatus.Created) {
      await this.container.state.transitionRun(runId, RunStatus.Created, RunStatus.Planning);
      await this.container.state.appendEvent({
        type: "run.started",
        runId,
        traceId: `trace-${runId}`,
        timestamp: new Date(),
        payload: { goal: run.goal },
      });
    }

    const currentRun = await this.container.state.getRun(runId);
    if (currentRun?.status === RunStatus.Planning) {
      await this.container.state.transitionRun(runId, RunStatus.Planning, RunStatus.Running);
    }

    // Correct Order: Recover expired executions FIRST before clearing stale lease times
    await this.container.state.recoverExpiredTaskExecutions(runId);
    await this.container.state.recoverExpiredLeases(runId);
    const runnable = await this.container.scheduler.getRunnable(runId, workerId);

    for (const task of runnable) {
      // Re-verify maxConcurrency and maxAgents atomically at task claim boundary
      const allTasks = await this.container.state.listTasksForRun(runId);
      const activeTasks = allTasks.filter(
        (t) => t.status === TaskStatus.Assigned || t.status === TaskStatus.Running || t.status === TaskStatus.Testing || t.status === TaskStatus.Review,
      );
      const maxConcurrency = run.budgetLimits.maxConcurrency ?? 10;
      if (activeTasks.length >= maxConcurrency) {
        break; // Max concurrency limit reached
      }

      const leasedTask = await this.container.state.claimTaskLease(task.id, workerId, 120_000, {
        maxConcurrency: run.budgetLimits.maxConcurrency,
        maxAgents: run.budgetLimits.maxAgents,
      });
      if (!leasedTask) continue;

      if (!leasedTask.leaseToken) {
        throw new Error(`Invariant violation: claimed task ${leasedTask.id} has no fencing token`);
      }
      const leaseToken = leasedTask.leaseToken;

      const expectedStatus = leasedTask.status === TaskStatus.Retrying ? TaskStatus.Retrying : TaskStatus.Created;

      const claimed = await this.container.state.transitionTaskFenced(
        leasedTask.id,
        expectedStatus,
        TaskStatus.Assigned,
        workerId,
        leaseToken,
      );

      try {
        await this.container.namlaLoop.executeTask(claimed.id, {
          workerId,
          leaseToken,
        });
      } finally {
        await this.container.state.releaseTaskLease(claimed.id, workerId, leaseToken);
      }
    }

    // Authoritative full task graph completion evaluation
    const updatedRun = await this.container.state.getRun(runId);
    if (updatedRun && updatedRun.status === RunStatus.Running) {
      const allTasks = await this.container.state.listTasksForRun(runId);

      const accState = await this.container.state.getAccountingState(runId);
      const isAccountingBlocked = accState.state !== "ACTIVE";

      const hasFailedOrBlocked = allTasks.some(
        (t) => t.status === TaskStatus.Failed || t.status === TaskStatus.Blocked || t.status === TaskStatus.Cancelled,
      );

      const allApproved =
        allTasks.length > 0 &&
        allTasks.every((t) => t.status === TaskStatus.Approved);

      if (isAccountingBlocked || hasFailedOrBlocked) {
        await this.container.state.transitionRun(runId, RunStatus.Running, RunStatus.Failed);
        await this.container.state.appendEvent({
          type: "run.failed",
          runId,
          traceId: `trace-${runId}`,
          timestamp: new Date(),
          payload: {
            goal: updatedRun.goal,
            reason: isAccountingBlocked
              ? `Accounting hold: ${accState.reason}`
              : "One or more tasks in DAG failed/blocked",
          },
        });
      } else if (allApproved) {
        await this.container.state.transitionRun(runId, RunStatus.Running, RunStatus.Completed);
        await this.container.state.appendEvent({
          type: "run.completed",
          runId,
          traceId: `trace-${runId}`,
          timestamp: new Date(),
          payload: { goal: updatedRun.goal },
        });
      }
    }
  }
}
