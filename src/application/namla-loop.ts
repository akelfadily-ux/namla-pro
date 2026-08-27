import { StateRepository } from "../domain/contracts";
import { TaskRecord, TaskStatus } from "../domain/types";
import { GateEngine, GateContext } from "./gate-engine";
import { Supervisor } from "./supervisor";

export interface TaskExecutor {
  execute(
    task: TaskRecord,
  ): Promise<{
    artifacts: any[];
    workspacePath: string;
  }>;
}

export class NamlaLoop {
  constructor(
    private readonly state: StateRepository,
    private readonly executor: TaskExecutor,
    private readonly gates: GateEngine,
    private readonly supervisor: Supervisor,
  ) {}

  async executeTask(taskId: string): Promise<void> {
    let task = await this.state.getTask(taskId);

    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    task = await this.state.transitionTask(
      task.id,
      TaskStatus.Assigned,
      TaskStatus.Running,
    );

    try {
      const execution = await this.executor.execute(task);

      task = await this.state.transitionTask(
        task.id,
        TaskStatus.Running,
        TaskStatus.Testing,
      );

      const gateContext: GateContext = {
        task,
        artifacts: execution.artifacts,
        workspacePath: execution.workspacePath,
      };

      const gateResults = await this.gates.evaluate(gateContext);

      if (!GateEngine.passed(gateResults)) {
        await this.handleFailure(task, "Automated gate rejected task");
        return;
      }

      task = await this.state.transitionTask(
        task.id,
        TaskStatus.Testing,
        TaskStatus.Review,
      );

      const decision = await this.supervisor.review({
        task,
        artifacts: execution.artifacts,
        gateEvidence: gateResults,
      });

      if (!decision.approved) {
        await this.handleFailure(task, decision.reason);
        return;
      }

      await this.state.transitionTask(
        task.id,
        TaskStatus.Review,
        TaskStatus.Approved,
      );
    } catch (error) {
      const latest = await this.state.getTask(taskId);

      if (
        latest &&
        latest.status !== TaskStatus.Failed &&
        latest.status !== TaskStatus.Cancelled &&
        latest.status !== TaskStatus.Approved
      ) {
        await this.handleFailure(
          latest,
          error instanceof Error
            ? error.message
            : "Unknown execution failure",
        );
      }

      throw error;
    }
  }

  private async handleFailure(
    task: TaskRecord,
    reason: string,
  ): Promise<void> {
    const shouldRetry = task.attempt + 1 < task.maxAttempts;

    if (shouldRetry) {
      await this.state.transitionTask(
        task.id,
        task.status,
        TaskStatus.Retrying,
        {
          attempt: task.attempt + 1,
          updatedAt: new Date(),
        },
      );
      return;
    }

    await this.state.transitionTask(
      task.id,
      task.status,
      TaskStatus.Failed,
      {
        updatedAt: new Date(),
      },
    );
  }
}
