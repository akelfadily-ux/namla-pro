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
    }
  }

  async createRun(input: CreateRunInput): Promise<RunSummary> {
    this.validateCreateRunInput(input);

    const runId = randomUUID();
    const initialTaskId = randomUUID();
    const now = new Date();

    const runRecord: RunRecord = {
      id: runId,
      status: RunStatus.Created,
      goal: input.goal,
      repositoryPath: input.repositoryPath,
      budgetLimits: {
        maxCostUsd: input.budget?.maxCostUsd,
        maxTokens: input.budget?.maxTokens,
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
      attempt: 0,
      maxAttempts: 3,
      depth: 0,
      requirements: [],
      dependencies: [],
      createdAt: now,
      updatedAt: now,
    };

    // Execute run, initial task, and event creation atomically inside UnitOfWork transaction
    await this.container.unitOfWork.transaction(async (txState) => {
      await txState.createRun(runRecord);
      await txState.createTask(initialTask);
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

  async processRun(runId: string, workerId = "worker-1"): Promise<void> {
    // Correct Order: Recover expired executions FIRST before clearing stale lease times
    await this.container.state.recoverExpiredTaskExecutions(runId);
    await this.container.state.recoverExpiredLeases(runId);
    const runnable = await this.container.scheduler.getRunnable(runId, workerId);

    for (const task of runnable) {
      const leasedTask = await this.container.state.claimTaskLease(task.id, workerId);
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
  }
}
