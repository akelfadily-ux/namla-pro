/**
 * PRO Dispatcher Implementation (§04, §10, §27, P0.5).
 *
 * Canonical WorkPackage dispatcher and execution scheduler for full DAGs.
 */

import { WorkPackage, WorkPackageExecution, WorkPackageExecutionState } from "../types/missionState";

export interface DispatchSchedule {
  readonly readyPackages: readonly WorkPackage[];
  readonly blockedPackages: readonly WorkPackage[];
  readonly completedPackages: readonly WorkPackage[];
  readonly failedPackages: readonly WorkPackage[];
  readonly isComplete: boolean;
}

export class ProDispatcher {
  /**
   * Determine schedule of ready, blocked, completed, and failed WorkPackages in the DAG.
   */
  public computeSchedule(
    workPackages: readonly WorkPackage[],
    executions: readonly WorkPackageExecution[]
  ): DispatchSchedule {
    const completedPackageIds = new Set<string>();
    const failedPackageIds = new Set<string>();

    const wpExecMap = new Map<string, WorkPackageExecution[]>();
    for (const exec of executions) {
      const list = wpExecMap.get(exec.workPackageId) ?? [];
      list.push(exec);
      wpExecMap.set(exec.workPackageId, list);
    }

    for (const wp of workPackages) {
      const execs = wpExecMap.get(wp.id) ?? [];
      const passed = execs.some((e) => e.state === "PASSED" || e.state === "DONE");
      if (passed) {
        completedPackageIds.add(wp.id);
      } else {
        const failed = execs.some((e) => e.state === "FAILED_REWORK" && e.attempts >= wp.maxAttempts);
        if (failed) {
          failedPackageIds.add(wp.id);
        }
      }
    }

    const readyPackages: WorkPackage[] = [];
    const blockedPackages: WorkPackage[] = [];
    const completedPackages: WorkPackage[] = [];
    const failedPackages: WorkPackage[] = [];

    for (const wp of workPackages) {
      if (completedPackageIds.has(wp.id)) {
        completedPackages.push(wp);
        continue;
      }

      if (failedPackageIds.has(wp.id)) {
        failedPackages.push(wp);
        continue;
      }

      const allDepsMet = wp.taskSpec.dependencies.every((depTaskId) => {
        return workPackages.some(
          (otherWp) => otherWp.taskSpec.id === depTaskId && completedPackageIds.has(otherWp.id)
        );
      });

      if (allDepsMet) {
        readyPackages.push(wp);
      } else {
        blockedPackages.push(wp);
      }
    }

    const isComplete = completedPackages.length === workPackages.length;

    return {
      readyPackages,
      blockedPackages,
      completedPackages,
      failedPackages,
      isComplete,
    };
  }

  /**
   * Create dual execution records for Colony A and Colony B for a ready WorkPackage.
   */
  public createDualExecutions(
    wp: WorkPackage,
    baseWorkspacePath: string,
    existingExecutions: readonly WorkPackageExecution[]
  ): { readonly executionA: WorkPackageExecution; readonly executionB: WorkPackageExecution } {
    const attempts = Math.floor(existingExecutions.filter((e) => e.workPackageId === wp.id).length / 2) + 1;

    const executionA: WorkPackageExecution = {
      executionId: `exec-a-${wp.id}-att${attempts}`,
      workPackageId: wp.id,
      colonyId: "COLONY_A",
      state: "READY",
      stateVersion: 1,
      attempts,
      outputArtifacts: [],
      evidenceRefs: [],
      workspacePath: `${baseWorkspacePath}/colony-a/${wp.id}`,
    };

    const executionB: WorkPackageExecution = {
      executionId: `exec-b-${wp.id}-att${attempts}`,
      workPackageId: wp.id,
      colonyId: "COLONY_B",
      state: "READY",
      stateVersion: 1,
      attempts,
      outputArtifacts: [],
      evidenceRefs: [],
      workspacePath: `${baseWorkspacePath}/colony-b/${wp.id}`,
    };

    return {
      executionA: Object.freeze(executionA),
      executionB: Object.freeze(executionB),
    };
  }

  /**
   * Compare-and-transition state of a WorkPackageExecution safely (§27).
   */
  public transitionExecutionState(
    exec: WorkPackageExecution,
    targetState: WorkPackageExecutionState,
    updates: Partial<WorkPackageExecution> = {}
  ): { readonly success: boolean; readonly updatedExecution?: WorkPackageExecution; readonly reasonCode: string } {
    const isLegal = this.isLegalExecutionTransition(exec.state, targetState);
    if (!isLegal) {
      return {
        success: false,
        reasonCode: `ILLEGAL_TRANSITION: Cannot transition WorkPackageExecution from ${exec.state} to ${targetState}`,
      };
    }

    const updatedExecution: WorkPackageExecution = {
      ...exec,
      ...updates,
      state: targetState,
      stateVersion: exec.stateVersion + 1,
    };

    return {
      success: true,
      updatedExecution: Object.freeze(updatedExecution),
      reasonCode: "OK",
    };
  }

  private isLegalExecutionTransition(
    current: WorkPackageExecutionState,
    target: WorkPackageExecutionState
  ): boolean {
    const legalTransitions: Record<WorkPackageExecutionState, readonly WorkPackageExecutionState[]> = {
      READY: ["CLAIMED", "EXECUTING", "VERIFYING", "PASSED", "HUMAN_REQUIRED"],
      CLAIMED: ["EXECUTING", "HUMAN_REQUIRED"],
      EXECUTING: ["VERIFYING", "PASSED", "FAILED_FIXABLE", "FAILED_REWORK", "HUMAN_REQUIRED"],
      VERIFYING: ["PASSED", "FAILED_FIXABLE", "FAILED_REWORK", "HUMAN_REQUIRED"],
      FAILED_FIXABLE: ["EXECUTING", "HUMAN_REQUIRED"],
      FAILED_REWORK: ["REWORKING", "HUMAN_REQUIRED"],
      REWORKING: ["VERIFYING", "PASSED", "HUMAN_REQUIRED"],
      PASSED: ["INTEGRATING", "DONE"],
      INTEGRATING: ["DONE", "HUMAN_REQUIRED"],
      DONE: [],
      HUMAN_REQUIRED: ["READY", "REWORKING", "EXECUTING"],
    };

    return legalTransitions[current]?.includes(target) ?? false;
  }
}
