/**
 * DecompositionEngine is Phase 2's mission planner. It turns a ColonyMission
 * into an ordered, dependency-linked set of ColonyTasks:
 *
 *   per goal:  investigate -> plan -> propose build -> verification plan -> audit
 *   mission:   [snapshot review first, when a ProjectSnapshot is given]
 *              ... all goal pipelines ...
 *              -> report mission outcome to the human
 *
 * Every generated task is gated through SafetyGuard (title + description)
 * before it enters the graph. Tasks blocked by safety are receipted and
 * excluded; tasks that depend on a blocked task are transitively blocked so
 * the remaining graph stays complete. The graph is then validated and
 * topologically ordered by TaskDependencyGraph.
 *
 * The engine plans; it cannot act. Every task it emits is a proposal for a
 * role that itself only proposes. No execution capability exists here or
 * downstream of here.
 */

import type { ColonyMission } from "../types/missionTypes";
import type { ColonyTask, TaskOutputKind, TaskPriority } from "../types/taskTypes";
import type { ActionReceipt } from "../types/receiptTypes";
import type { SafetyDecision } from "../types/safetyTypes";
import type { ProjectSnapshot } from "../inspector/inspectorTypes";
import { SafetyGuard } from "../core/safetyGuard";
import { ReceiptLog } from "../core/receiptLog";
import { TaskDependencyGraph } from "./taskDependencyGraph";
import { pickRole } from "./rolePicker";

let plannedTaskCounter = 0;

function nextPlannedTaskId(): string {
  plannedTaskCounter += 1;
  return `ptask-${plannedTaskCounter}`;
}

export interface SafetyBlockedTask {
  taskId: string;
  decision: SafetyDecision;
}

export interface DecompositionResult {
  /** Every generated task, including blocked ones (with their statuses). */
  tasks: ColonyTask[];
  /** Approved tasks in dependency order; the routing order. */
  orderedTaskIds: string[];
  /** Tasks rejected directly by SafetyGuard. */
  safetyBlocked: SafetyBlockedTask[];
  /** Tasks blocked because something they depend on was rejected. */
  dependencyBlockedTaskIds: string[];
  receipt: ActionReceipt;
}

export class DecompositionEngine {
  private readonly graph: TaskDependencyGraph;

  constructor(
    private readonly safetyGuard: SafetyGuard,
    private readonly receiptLog: ReceiptLog
  ) {
    this.graph = new TaskDependencyGraph(receiptLog);
  }

  decompose(mission: ColonyMission, snapshot?: ProjectSnapshot): DecompositionResult {
    const generated = this.generateTasks(mission, snapshot);

    // 1. Safety gate: every task's title + description, no exceptions.
    const safetyBlocked: SafetyBlockedTask[] = [];
    const approvedIds = new Set<string>();

    for (const task of generated) {
      const decision = this.safetyGuard.evaluateText(`${task.title}\n${task.description}`);
      if (decision.allowed) {
        approvedIds.add(task.taskId);
      } else {
        task.status = "rejected";
        safetyBlocked.push({ taskId: task.taskId, decision });
        this.receiptLog.create({
          summary: `Planned task ${task.taskId} blocked by SafetyGuard (${decision.level}).`,
          status: "blocked",
          links: { missionId: mission.missionId, taskId: task.taskId },
          details: { reasons: decision.reasons },
        });
      }
    }

    // 2. Transitive blocking: a task whose dependency was rejected can never
    // run, so block it too (fixpoint until stable). This keeps the graph we
    // hand to the validator free of dangling references.
    let changed = true;
    while (changed) {
      changed = false;
      for (const task of generated) {
        if (!approvedIds.has(task.taskId)) continue;
        const hasBlockedDependency = (task.dependsOnTaskIds ?? []).some((id) => !approvedIds.has(id));
        if (hasBlockedDependency) {
          approvedIds.delete(task.taskId);
          task.status = "blocked";
          changed = true;
        }
      }
    }

    const dependencyBlockedTaskIds = generated
      .filter((t) => t.status === "blocked")
      .map((t) => t.taskId);

    // 3. Order the surviving graph. Generated pipelines are acyclic by
    // construction, but validation is cheap and refusal is receipted, so
    // there is no reason to trust construction over checking.
    const approvedTasks = generated.filter((t) => approvedIds.has(t.taskId));
    const validation = this.graph.validate(approvedTasks, mission.missionId);

    if (!validation.valid) {
      for (const task of approvedTasks) task.status = "blocked";
      const receipt = this.receiptLog.create({
        summary: `Decomposition refused for mission ${mission.missionId}: task graph invalid.`,
        status: "refused",
        links: { missionId: mission.missionId },
        details: {
          cycleTaskIds: validation.cycleTaskIds,
          missingDependencies: validation.missingDependencies,
        },
      });
      return {
        tasks: generated,
        orderedTaskIds: [],
        safetyBlocked,
        dependencyBlockedTaskIds: generated.filter((t) => t.status === "blocked").map((t) => t.taskId),
        receipt,
      };
    }

    for (const task of approvedTasks) task.status = "queued";

    const receipt = this.receiptLog.create({
      summary:
        `Mission ${mission.missionId} decomposed: ${validation.orderedTaskIds.length} task(s) ordered, ` +
        `${safetyBlocked.length} blocked by SafetyGuard, ${dependencyBlockedTaskIds.length} blocked by dependency.`,
      status: validation.orderedTaskIds.length > 0 ? "approved" : "blocked",
      links: { missionId: mission.missionId },
      details: { orderedTaskIds: validation.orderedTaskIds, usedSnapshot: Boolean(snapshot) },
    });

    return {
      tasks: generated,
      orderedTaskIds: validation.orderedTaskIds,
      safetyBlocked,
      dependencyBlockedTaskIds,
      receipt,
    };
  }

  private generateTasks(mission: ColonyMission, snapshot?: ProjectSnapshot): ColonyTask[] {
    const now = new Date().toISOString();
    const tasks: ColonyTask[] = [];

    const makeTask = (
      title: string,
      description: string,
      priority: TaskPriority,
      dependsOnTaskIds: string[],
      expectedOutputKind: TaskOutputKind
    ): ColonyTask => {
      const task: ColonyTask = {
        taskId: nextPlannedTaskId(),
        missionId: mission.missionId,
        title,
        description,
        requiredRole: pickRole(`${title} ${description}`),
        priority,
        status: "proposed",
        createdAt: now,
        updatedAt: now,
        dependsOnTaskIds,
        expectedOutputKind,
      };
      tasks.push(task);
      return task;
    };

    // Mission-level opener: when a real snapshot exists, everything starts
    // from an investigation of what the project actually looks like.
    let snapshotTask: ColonyTask | undefined;
    if (snapshot) {
      snapshotTask = makeTask(
        "Investigate the project snapshot",
        `Investigate the read-only project snapshot (${snapshot.summary.totalFiles} file(s), ` +
          `${snapshot.summary.totalFolders} folder(s), ${snapshot.summary.totalSkipped} skipped) ` +
          `and note structures relevant to this mission.`,
        "normal",
        [],
        "analysis"
      );
    }

    const auditTaskIds: string[] = [];

    for (const goal of mission.goals) {
      const investigate = makeTask(
        `Investigate goal: ${goal.description}`,
        `Investigate the current state relevant to the goal "${goal.description}" (read-only).`,
        "normal",
        snapshotTask ? [snapshotTask.taskId] : [],
        "analysis"
      );

      const plan = makeTask(
        `Plan the approach for goal: ${goal.description}`,
        `Plan the approach for the goal "${goal.description}" using the investigation findings.`,
        "normal",
        [investigate.taskId],
        "analysis"
      );

      // Wording note: this description must avoid SafetyGuard's own indicator
      // substrings (e.g. "executed" contains "exec"), or the guard would
      // block every build-proposal task the engine generates.
      // Phase 3: this task's expected output is a CodeProposal data object.
      const propose = makeTask(
        `Propose how to build goal: ${goal.description}`,
        `Propose how to build the goal "${goal.description}" as a CodeProposal data object only — no files touched, nothing run.`,
        "normal",
        [plan.taskId],
        "code-proposal"
      );

      const verify = makeTask(
        `Propose the verification plan for goal: ${goal.description}`,
        `Propose the verification plan for the goal "${goal.description}" — what should be checked, without running anything.`,
        "normal",
        [propose.taskId],
        "analysis"
      );

      const audit = makeTask(
        `Review and audit the proposals for goal: ${goal.description}`,
        `Review and audit the build and verification proposals for the goal "${goal.description}".`,
        "high",
        [propose.taskId, verify.taskId],
        "analysis"
      );

      auditTaskIds.push(audit.taskId);
    }

    makeTask(
      "Report mission outcome to the human",
      "Report mission outcome to the human: what was planned, what was blocked, and which receipts to review.",
      "high",
      auditTaskIds,
      "report"
    );

    return tasks;
  }
}
