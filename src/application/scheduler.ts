import { StateRepository } from "../domain/contracts";
import { TaskRecord, TaskStatus } from "../domain/types";
import { StateConflictError } from "../domain/errors";

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

    // Enforce maxConcurrency and maxAgents
    const allRunTasks = await this.state.listTasksForRun(runId);
    const activeTasks = allRunTasks.filter(
      (t) => t.status === TaskStatus.Assigned || t.status === TaskStatus.Running || t.status === TaskStatus.Testing || t.status === TaskStatus.Review,
    );

    const maxConcurrency = run.budgetLimits.maxConcurrency ?? 10;
    const availableSlots = Math.max(0, maxConcurrency - activeTasks.length);
    if (availableSlots <= 0) {
      return [];
    }

    const activeAnts = new Set(activeTasks.map((t) => t.assignedAntId).filter(Boolean));
    const maxAgents = run.budgetLimits.maxAgents ?? 10;

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

      // Max agents check
      if (task.assignedAntId && !activeAnts.has(task.assignedAntId) && activeAnts.size >= maxAgents) {
        continue;
      }

      // Rule 2: True DFS graph cycle detection, missing dep check & cascading failure handling
      let dependenciesMet = true;
      let dependencyFailed = false;
      let graphInvalid = false;

      // Color states for DFS: WHITE = 0 (unvisited), GRAY = 1 (visiting), BLACK = 2 (visited)
      const colors = new Map<string, number>();

      const checkGraphDFS = async (currentTaskId: string): Promise<boolean> => {
        colors.set(currentTaskId, 1); // GRAY
        const currentTask = await this.state.getTask(currentTaskId);

        if (!currentTask) {
          graphInvalid = true;
          return false;
        }

        if (currentTask.runId !== runId) {
          graphInvalid = true;
          return false;
        }

        if (currentTask.status === TaskStatus.Failed || currentTask.status === TaskStatus.Cancelled) {
          dependencyFailed = true;
          return false;
        }

        if (currentTask.status !== TaskStatus.Approved && currentTaskId !== task.id) {
          dependenciesMet = false;
        }

        for (const depId of currentTask.dependencies) {
          const color = colors.get(depId) ?? 0;
          if (color === 1) {
            // Back-edge detected: Cycle in dependency graph!
            graphInvalid = true;
            return false;
          }
          if (color === 0) {
            const ok = await checkGraphDFS(depId);
            if (!ok) return false;
          }
        }

        colors.set(currentTaskId, 2); // BLACK
        return true;
      };

      await checkGraphDFS(task.id);

      if (graphInvalid || dependencyFailed) {
        try {
          const nextState = graphInvalid ? TaskStatus.Blocked : TaskStatus.Failed;
          await this.state.transitionTask(task.id, task.status, nextState);
        } catch (err) {
          if (err instanceof StateConflictError) {
            // Tolerate concurrent state transition conflict
            continue;
          }
          // Propagate lifecycle, DB, or configuration errors
          throw err;
        }
        continue;
      }

      if (dependenciesMet) {
        runnable.push(task);
      }
    }

    return runnable.slice(0, availableSlots);
  }
}
