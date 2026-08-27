import { Container } from "../bootstrap/container";
import { TaskRecord, TaskStatus, AntRole } from "../domain/types";

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

  async createRun(input: CreateRunInput): Promise<RunSummary> {
    const runId = `run-${Date.now()}`;
    const initialTaskId = `task-plan-${Date.now()}`;
    const now = new Date();

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

    await this.container.state.saveTask(initialTask);

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
      status: "CREATED",
    };
  }

  async processRun(runId: string, workerId = "worker-1"): Promise<void> {
    const runnable = await this.container.scheduler.getRunnable(runId, workerId);

    for (const task of runnable) {
      const claimed = await this.container.state.transitionTask(
        task.id,
        TaskStatus.Created,
        TaskStatus.Assigned,
        { assignedAntId: workerId },
      );

      await this.container.namlaLoop.executeTask(claimed.id);
    }
  }
}
