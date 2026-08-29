/**
 * PRO Dispatcher Implementation (§04, §10, §27).
 */

import { WorkPackage, WorkPackageExecution, WorkPackageExecutionState, MissionStateRecord } from "../types/missionState";
import { ContractBoundStageContext } from "../types/stageContext";

export interface DispatchSchedule {
  readonly readyPackages: readonly WorkPackage[];
  readonly blockedPackages: readonly WorkPackage[];
  readonly completedPackages: readonly WorkPackage[];
}

export class ProDispatcher {
  public computeSchedule(
    workPackages: readonly WorkPackage[],
    executions: readonly WorkPackageExecution[]
  ): DispatchSchedule {
    const completedPackageIds = new Set<string>();

    for (const exec of executions) {
      if (exec.state === "PASSED" || exec.state === "DONE") {
        const wpId = exec.workPackageId;
        completedPackageIds.add(wpId);
      }
    }

    const readyPackages: WorkPackage[] = [];
    const blockedPackages: WorkPackage[] = [];
    const completedPackages: WorkPackage[] = [];

    for (const wp of workPackages) {
      if (completedPackageIds.has(wp.id)) {
        completedPackages.push(wp);
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

    return {
      readyPackages,
      blockedPackages,
      completedPackages,
    };
  }

  public createDualExecutions(
    wp: WorkPackage,
    baseWorkspacePath: string,
    existingExecutions: readonly WorkPackageExecution[]
  ): { readonly executionA: WorkPackageExecution; readonly executionB: WorkPackageExecution } {
    const attempts = existingExecutions.filter((e) => e.workPackageId === wp.id).length / 2 + 1;

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
      READY: ["CLAIMED", "EXECUTING", "HUMAN_REQUIRED"],
      CLAIMED: ["EXECUTING", "HUMAN_REQUIRED"],
      EXECUTING: ["VERIFYING", "FAILED_FIXABLE", "FAILED_REWORK", "HUMAN_REQUIRED"],
      VERIFYING: ["PASSED", "FAILED_FIXABLE", "FAILED_REWORK", "HUMAN_REQUIRED"],
      FAILED_FIXABLE: ["EXECUTING", "HUMAN_REQUIRED"],
      FAILED_REWORK: ["REWORKING", "HUMAN_REQUIRED"],
      REWORKING: ["VERIFYING", "HUMAN_REQUIRED"],
      PASSED: ["INTEGRATING", "DONE"],
      INTEGRATING: ["DONE", "HUMAN_REQUIRED"],
      DONE: [],
      HUMAN_REQUIRED: ["READY", "REWORKING", "EXECUTING"],
    };

    return legalTransitions[current]?.includes(target) ?? false;
  }
}
