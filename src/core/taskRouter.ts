/**
 * @deprecated COMPATIBILITY MODULE (since the Pre-Capability Closure
 * pass). The canonical scheduler is AntScheduler (src/simulation/), used
 * by ColonySimulation under ColonyEngine. Only the deprecated
 * ColonyOrchestrator consumes this class. Kept because the Build Law
 * forbids deleting files; not part of the runtime spine.
 *
 * Historical role: first-match assignment of tasks to ants by role.
 */

import type { AntState } from "../types/antTypes";
import type { ColonyTask } from "../types/taskTypes";

export class TaskRouter {
  route(task: ColonyTask, availableAnts: AntState[]): ColonyTask {
    const candidate = availableAnts.find(
      (ant) => ant.identity.role === task.requiredRole && ant.energy !== "offline"
    );

    if (!candidate) {
      return { ...task, status: "blocked", updatedAt: new Date().toISOString() };
    }

    return {
      ...task,
      status: "assigned",
      updatedAt: new Date().toISOString(),
      assignment: {
        taskId: task.taskId,
        antId: candidate.identity.antId,
        assignedAt: new Date().toISOString(),
      },
    };
  }
}
