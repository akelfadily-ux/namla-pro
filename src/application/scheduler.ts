import { StateRepository } from "../domain/contracts";
import { TaskRecord, TaskStatus } from "../domain/types";

export class Scheduler {
  constructor(private readonly state: StateRepository) {}

  async getRunnable(
    runId: string,
    workerId?: string,
  ): Promise<TaskRecord[]> {
    const candidates = await this.state.listRunnableTasks(runId);

    const runnable: TaskRecord[] = [];

    for (const task of candidates) {
      if (
        task.status !== TaskStatus.Created &&
        task.status !== TaskStatus.Retrying
      ) {
        continue;
      }

      // Rule 1: task dependencies must be APPROVED
      let dependenciesMet = true;
      for (const depId of task.dependencies) {
        const depTask = await this.state.getTask(depId);
        if (!depTask || depTask.status !== TaskStatus.Approved) {
          dependenciesMet = false;
          break;
        }
      }

      if (dependenciesMet) {
        runnable.push(task);
      }
    }

    return runnable;
  }
}
