import { StateRepository } from "../domain/contracts";
import { TaskRecord, TaskStatus } from "../domain/types";

export class Scheduler {
  constructor(private readonly state: StateRepository) {}

  async getRunnable(
    runId: string,
    workerId?: string,
  ): Promise<TaskRecord[]> {
    const run = await this.state.getRun(runId);
    if (!run || run.status === "CANCELLED" || run.status === "FAILED" || run.status === "COMPLETED" || run.status === "PAUSED") {
      return [];
    }

    const candidates = await this.state.listRunnableTasks(runId);

    const runnable: TaskRecord[] = [];

    for (const task of candidates) {
      if (
        task.status !== TaskStatus.Created &&
        task.status !== TaskStatus.Retrying
      ) {
        continue;
      }

      // Rule 1: Depth limit check
      const maxDepth = run.budgetLimits.maxDepth ?? 10;
      if (task.depth > maxDepth) {
        continue;
      }

      // Rule 2: Dependency check with cycle detection & cascading failure check
      let dependenciesMet = true;
      let dependencyFailed = false;

      const visited = new Set<string>();
      const queue = [...task.dependencies];

      while (queue.length > 0) {
        const depId = queue.shift()!;
        if (visited.has(depId)) {
          // Cycle detected
          dependenciesMet = false;
          break;
        }
        visited.add(depId);

        const depTask = await this.state.getTask(depId);
        if (!depTask) {
          dependenciesMet = false;
          break;
        }

        if (depTask.runId !== runId) {
          // Cross-run dependency isolation violation
          dependenciesMet = false;
          break;
        }

        if (depTask.status === TaskStatus.Failed || depTask.status === TaskStatus.Cancelled) {
          dependencyFailed = true;
          dependenciesMet = false;
          break;
        }

        if (depTask.status !== TaskStatus.Approved) {
          dependenciesMet = false;
        }
      }

      if (dependencyFailed) {
        // Cascade failure to blocked dependent task
        try {
          await this.state.transitionTask(task.id, task.status, TaskStatus.Failed);
        } catch {
          /* ignore transition error */
        }
        continue;
      }

      if (dependenciesMet) {
        runnable.push(task);
      }
    }

    return runnable;
  }
}
