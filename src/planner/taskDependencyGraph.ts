/**
 * TaskDependencyGraph validates the dependency structure of a set of
 * ColonyTasks: every dependency must reference a task in the set, and the
 * graph must be acyclic. When valid, it returns a topological order (Kahn's
 * algorithm) suitable for routing tasks in dependency order. When a cycle
 * exists, it refuses — with a receipt — because a cyclic plan can never be
 * scheduled and silently dropping the cycle would hide a planning bug.
 */

import type { ColonyTask } from "../types/taskTypes";
import type { ActionReceipt } from "../types/receiptTypes";
import { ReceiptLog } from "../core/receiptLog";

export interface MissingDependency {
  taskId: string;
  missingDependencyId: string;
}

export interface GraphValidationResult {
  valid: boolean;
  /** Topological order of task ids; empty when the graph is invalid. */
  orderedTaskIds: string[];
  missingDependencies: MissingDependency[];
  /** Task ids caught in a cycle; empty when acyclic. */
  cycleTaskIds: string[];
  /** Refusal receipt, present only when the graph was rejected. */
  refusalReceipt?: ActionReceipt;
}

export class TaskDependencyGraph {
  constructor(private readonly receiptLog: ReceiptLog) {}

  validate(tasks: ColonyTask[], missionId?: string): GraphValidationResult {
    const taskIds = new Set(tasks.map((t) => t.taskId));

    // 1. Every dependency must point at a task that exists in this set.
    const missingDependencies: MissingDependency[] = [];
    for (const task of tasks) {
      for (const dependencyId of task.dependsOnTaskIds ?? []) {
        if (!taskIds.has(dependencyId)) {
          missingDependencies.push({ taskId: task.taskId, missingDependencyId: dependencyId });
        }
      }
    }

    if (missingDependencies.length > 0) {
      const refusalReceipt = this.receiptLog.create({
        summary: `Task graph refused: ${missingDependencies.length} missing dependenc(y/ies).`,
        status: "refused",
        links: { missionId },
        details: { missingDependencies },
      });
      return { valid: false, orderedTaskIds: [], missingDependencies, cycleTaskIds: [], refusalReceipt };
    }

    // 2. Kahn's algorithm: repeatedly take tasks with no unprocessed
    // dependencies. Anything left over at the end is part of a cycle.
    const remainingDependencyCount = new Map<string, number>();
    const dependents = new Map<string, string[]>();

    for (const task of tasks) {
      remainingDependencyCount.set(task.taskId, (task.dependsOnTaskIds ?? []).length);
      for (const dependencyId of task.dependsOnTaskIds ?? []) {
        const list = dependents.get(dependencyId) ?? [];
        list.push(task.taskId);
        dependents.set(dependencyId, list);
      }
    }

    const ready = tasks
      .filter((t) => (t.dependsOnTaskIds ?? []).length === 0)
      .map((t) => t.taskId);
    const orderedTaskIds: string[] = [];

    while (ready.length > 0) {
      const taskId = ready.shift() as string;
      orderedTaskIds.push(taskId);

      for (const dependentId of dependents.get(taskId) ?? []) {
        const remaining = (remainingDependencyCount.get(dependentId) ?? 0) - 1;
        remainingDependencyCount.set(dependentId, remaining);
        if (remaining === 0) ready.push(dependentId);
      }
    }

    if (orderedTaskIds.length < tasks.length) {
      const cycleTaskIds = tasks
        .map((t) => t.taskId)
        .filter((id) => !orderedTaskIds.includes(id));

      const refusalReceipt = this.receiptLog.create({
        summary: `Task graph refused: cycle detected involving ${cycleTaskIds.length} task(s).`,
        status: "refused",
        links: { missionId },
        details: { cycleTaskIds },
      });
      return { valid: false, orderedTaskIds: [], missingDependencies: [], cycleTaskIds, refusalReceipt };
    }

    return { valid: true, orderedTaskIds, missingDependencies: [], cycleTaskIds: [] };
  }
}
