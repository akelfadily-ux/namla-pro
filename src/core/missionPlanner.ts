/**
 * MissionPlanner turns a ColonyMission's goals into an initial set of
 * ColonyTasks. Phase 0 planning is intentionally simple: one task per goal,
 * routed to a plannerAnt/workerAnt-shaped role. Real decomposition logic
 * arrives in Phase 2.
 */

import type { ColonyMission } from "../types/missionTypes";
import type { ColonyTask } from "../types/taskTypes";

let taskCounter = 0;

function nextTaskId(): string {
  taskCounter += 1;
  return `task-${taskCounter}`;
}

export class MissionPlanner {
  planInitialTasks(mission: ColonyMission): ColonyTask[] {
    const now = new Date().toISOString();

    return mission.goals.map((goal) => ({
      taskId: nextTaskId(),
      missionId: mission.missionId,
      title: goal.description,
      description: `Investigate and plan for goal: ${goal.description}`,
      requiredRole: "planner",
      priority: "normal",
      status: "proposed",
      createdAt: now,
      updatedAt: now,
    }));
  }
}
