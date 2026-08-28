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

    // Transactional order: Persist Run FIRST before child tasks & events
    await this.container.state.createRun(runRecord);
    await this.container.state.createTask(initialTask);

    await this.container.state.appendEvent({
      type: "run.created",
      runId,
      taskId: initialTaskId,
      traceId: `trace-${runId}`,
      timestamp: now,
      payload: { goal: input.goal, budget: input.budget },
    });

    return {
      id: runId,
      status: RunStatus.Created,
    };
  }

  async processRun(runId: string, workerId = "worker-1"): Promise<void> {
    await this.container.state.recoverExpiredLeases(runId);
    await this.container.state.recoverExpiredTaskExecutions(runId);
    const runnable = await this.container.scheduler.getRunnable(runId, workerId);

    for (const task of runnable) {
      const leasedTask = await this.container.state.claimTaskLease(task.id, workerId);
      if (!leasedTask) continue;

      const expectedStatus = leasedTask.status === TaskStatus.Retrying ? TaskStatus.Retrying : TaskStatus.Created;

      const claimed = await this.container.state.transitionTask(
        leasedTask.id,
        expectedStatus,
        TaskStatus.Assigned,
      );

      try {
        await this.container.namlaLoop.executeTask(claimed.id);
      } finally {
        await this.container.state.releaseTaskLease(claimed.id, workerId);
      }
    }
  }
}
