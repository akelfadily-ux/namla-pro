/**
 * @deprecated COMPATIBILITY MODULE (since the Pre-Capability Closure
 * pass). No canonical path constructs this class anymore: AntQueen now
 * delegates missions to ColonyEngine, whose ColonySimulation spine owns
 * routing. This file remains only because the Build Law forbids deleting
 * files; it is not an independent runtime and must not be presented as
 * one.
 *
 * Historical role: took tasks from MissionPlanner, routed them with
 * TaskRouter, checked each with SafetyGuard, and wrote receipts.
 */

import type { AntState } from "../types/antTypes";
import type { ColonyTask } from "../types/taskTypes";
import { SafetyGuard } from "./safetyGuard";
import { ReceiptLog } from "./receiptLog";
import { TaskRouter } from "./taskRouter";
import { PheromoneBus } from "./pheromoneBus";

export class ColonyOrchestrator {
  constructor(
    private readonly safetyGuard: SafetyGuard,
    private readonly receiptLog: ReceiptLog,
    private readonly pheromoneBus: PheromoneBus,
    private readonly taskRouter: TaskRouter
  ) {}

  processTasks(tasks: ColonyTask[], availableAnts: AntState[]): ColonyTask[] {
    return tasks.map((task) => {
      const decision = this.safetyGuard.evaluateText(task.description);

      if (!decision.allowed) {
        // Blocked task text often contains the very indicators the pheromone
        // and receipt layers refuse (secret, .env, token, ...), so refer to
        // the task by id here instead of echoing its title.
        this.pheromoneBus.emit({
          type: "BlockedActionPheromone",
          emittedByAntId: "colony-orchestrator",
          topic: "task-blocked",
          payload: { taskId: task.taskId, level: decision.level },
          missionId: task.missionId,
          taskId: task.taskId,
        });

        this.receiptLog.create({
          summary: `Task ${task.taskId} blocked by SafetyGuard (${decision.level}).`,
          status: "blocked",
          links: { missionId: task.missionId, taskId: task.taskId },
          details: { reasons: decision.reasons },
        });

        return { ...task, status: "rejected", updatedAt: new Date().toISOString() };
      }

      const routed = this.taskRouter.route(task, availableAnts);

      this.receiptLog.create({
        summary: `Task "${task.title}" routed with status ${routed.status}.`,
        status: routed.status === "assigned" ? "approved" : "blocked",
        links: { missionId: task.missionId, taskId: task.taskId, antId: routed.assignment?.antId },
      });

      if (routed.status === "assigned") {
        this.pheromoneBus.emit({
          type: "TrailPheromone",
          emittedByAntId: routed.assignment!.antId,
          topic: task.title,
          missionId: task.missionId,
          taskId: task.taskId,
        });
      }

      return routed;
    });
  }
}
