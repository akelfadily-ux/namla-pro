/**
 * V2 Multi-WorkPackage DAG & Recovery Loop Tests (P0.5, P0.6).
 *
 * Verifies DAG scheduling, multi-package completion, recovery loops, and failure handling.
 *
 * Run: node dist/tools/v2DagAndRecoveryTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { resolve } from "path";
import { ProDispatcher } from "../v2/pro/proDispatcher";
import { WorkPackage, WorkPackageExecution } from "../v2/types/missionState";
import { NamlaRuntime } from "../v2/runtime/namlaRuntime";
import { ColonyExecutor } from "../v2/colony/colonyExecutor";
import { createV2TestVerificationSandboxFactory } from "./v2TestVerificationSandbox";

function tempWorkspace(tag: string): string {
  return mkdtempSync(resolve(tmpdir(), `namla-v2-dag-${tag}-`));
}

class DependencyContextSpyColonyExecutor extends ColonyExecutor {
  public readonly observedDependencyContexts: Array<{
    taskId: string;
    workspacePath: string;
    contextPaths: readonly string[];
    dependencyIndexContent: string;
    rootIndexContent: string;
    currentTargetTemplateContent: string;
  }> = [];

  public override executeWorkPackage(
    ...args: Parameters<ColonyExecutor["executeWorkPackage"]>
  ): ReturnType<ColonyExecutor["executeWorkPackage"]> {
    const [workPackage, execution, context, kernel, simulatedCodeContent, options = {}] = args;

    let effectiveSimulatedCodeContent = simulatedCodeContent;

    if (workPackage.taskSpec.id === "task-impl") {
      const rootImplementation = kernel.safeReadWorkspaceFile("src/index.ts");

      assert.equal(
        rootImplementation.success,
        true,
        "Root src/index.ts must exist before task-impl sentinel injection"
      );

      effectiveSimulatedCodeContent =
        `${rootImplementation.content ?? ""}\nexport const dependencyHandoffSentinel = "LEGGO_DEPENDENCY_CONTEXT";\n`;
    }

    if (
      workPackage.taskSpec.dependencies.length > 0 &&
      options.projectContextWorkspacePath &&
      options.projectContextPaths?.includes("src/index.ts")
    ) {
      const dependencyRead = kernel.safeReadWorkspaceFile(
        `${options.projectContextWorkspacePath}/src/index.ts`
      );
      const rootRead = kernel.safeReadWorkspaceFile("src/index.ts");
      const currentTargetRead = kernel.safeReadWorkspaceFile(
        `${options.projectContextWorkspacePath}/tests/index.test.ts`
      );

      assert.equal(
        dependencyRead.success,
        true,
        "Dependency src/index.ts must be readable from LEGGO workspace"
      );

      assert.equal(
        rootRead.success,
        true,
        "Root baseline src/index.ts must remain readable for comparison"
      );

      assert.equal(
        currentTargetRead.success,
        true,
        "Existing current target tests/index.test.ts must be readable from LEGGO workspace"
      );

      this.observedDependencyContexts.push({
        taskId: workPackage.taskSpec.id,
        workspacePath: options.projectContextWorkspacePath,
        contextPaths: options.projectContextPaths,
        dependencyIndexContent: dependencyRead.content ?? "",
        rootIndexContent: rootRead.content ?? "",
        currentTargetTemplateContent: currentTargetRead.content ?? "",
      });
    }

    return super.executeWorkPackage(
      workPackage,
      execution,
      context,
      kernel,
      effectiveSimulatedCodeContent,
      options
    );
  }
}

test("ProDispatcher: Schedules DAG with Dependencies", () => {
  const dispatcher = new ProDispatcher();

  const wp1: WorkPackage = {
    id: "wp-1",
    missionId: "m-dag",
    contractVersion: "v1.0.0",
    taskSpec: { id: "t1", name: "Core", description: "", targetFiles: ["src/core.ts"], dependencies: [], capabilityRequirements: [] },
    acceptanceCriteria: [],
    inputArtifacts: [],
    readOnly: false,
    maxAttempts: 3,
  };

  const wp2: WorkPackage = {
    id: "wp-2",
    missionId: "m-dag",
    contractVersion: "v1.0.0",
    taskSpec: { id: "t2", name: "Dependent", description: "", targetFiles: ["src/dep.ts"], dependencies: ["t1"], capabilityRequirements: [] },
    acceptanceCriteria: [],
    inputArtifacts: [],
    readOnly: false,
    maxAttempts: 3,
  };

  const workPackages = [wp1, wp2];

  // Initially: wp1 is ready, wp2 is blocked
  const sched1 = dispatcher.computeSchedule(workPackages, []);
  assert.equal(sched1.readyPackages.length, 1);
  assert.equal(sched1.readyPackages[0].id, "wp-1");
  assert.equal(sched1.blockedPackages.length, 1);
  assert.equal(sched1.blockedPackages[0].id, "wp-2");
  assert.equal(sched1.isComplete, false);

  // After wp1 completes: wp2 becomes ready
  const exec1Pass: WorkPackageExecution = {
    executionId: "exec-a-wp-1",
    workPackageId: "wp-1",
    colonyId: "COLONY_A",
    state: "PASSED",
    stateVersion: 1,
    attempts: 1,
    outputArtifacts: [],
    evidenceRefs: [],
    workspacePath: "/tmp/wp1",
  };

  const sched2 = dispatcher.computeSchedule(workPackages, [exec1Pass]);
  assert.equal(sched2.readyPackages.length, 1);
  assert.equal(sched2.readyPackages[0].id, "wp-2");
  assert.equal(sched2.completedPackages.length, 1);
  assert.equal(sched2.isComplete, false);

  // After wp2 completes: DAG is complete
  const exec2Pass: WorkPackageExecution = {
    executionId: "exec-a-wp-2",
    workPackageId: "wp-2",
    colonyId: "COLONY_A",
    state: "PASSED",
    stateVersion: 1,
    attempts: 1,
    outputArtifacts: [],
    evidenceRefs: [],
    workspacePath: "/tmp/wp2",
  };

  const sched3 = dispatcher.computeSchedule(workPackages, [exec1Pass, exec2Pass]);
  assert.equal(sched3.isComplete, true);
});

test("NamlaRuntime: Multi-Task Mission Pipeline Completion", () => {
  const ws = tempWorkspace("dag-mission");
  try {
    const runtime = new NamlaRuntime(undefined, {
      verificationSandboxFactory: createV2TestVerificationSandboxFactory(),
    });
    const result = runtime.runMission({
      missionId: "mission-multi-task",
      objective: "Build a TypeScript project with core logic and tests",
      humanAuthorizationGranted: true,
      workspaceRoot: ws,
      executionMode: "DETERMINISTIC_FIXTURE_MODE",
      projectClass: "TYPESCRIPT_LIBRARY",
    });

    assert.equal(result.success, true, `Multi-task DAG mission must complete: ${result.reasonCode}`);
    assert.equal(result.executionMode, "DETERMINISTIC_FIXTURE_MODE");
    assert.equal(result.finalState, "COMPLETED");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("NamlaRuntime: Dependency Context Uses Previous LEGGO Candidate", () => {
  const ws = tempWorkspace("dependency-context");

  try {
    const spyColonyExecutor = new DependencyContextSpyColonyExecutor();
    const runtime = new NamlaRuntime(spyColonyExecutor, {
      verificationSandboxFactory: createV2TestVerificationSandboxFactory(),
    });

    const result = runtime.runMission({
      missionId: "mission-dependency-context",
      objective: "Build a TypeScript project with core logic and tests",
      humanAuthorizationGranted: true,
      workspaceRoot: ws,
      executionMode: "DETERMINISTIC_FIXTURE_MODE",
      projectClass: "TYPESCRIPT_LIBRARY",
    });

    assert.equal(
      result.success,
      true,
      `Dependency-context mission must complete: ${result.reasonCode}`
    );

    const observation = spyColonyExecutor.observedDependencyContexts.find(
      (entry) => entry.taskId === "task-test"
    );

    assert.ok(
      observation,
      "Dependent task-test must receive project context from its dependency"
    );

    assert.equal(
      observation.workspacePath,
      "workspaces/v2-missions/mission-dependency-context/leggo-integrated",
      "Dependent task must read context from the cumulative LEGGO workspace"
    );

    assert.ok(
      observation.contextPaths.includes("src/index.ts"),
      "task-test dependency context must include task-impl target src/index.ts"
    );

    assert.ok(
      observation.contextPaths.includes("tests/index.test.ts"),
      "task-test context must include its existing current target template"
    );

    assert.ok(
      observation.currentTargetTemplateContent.includes("../src/index.ts"),
      "Current target template must preserve the explicit TypeScript import extension"
    );

    assert.ok(
      observation.dependencyIndexContent.length > 0,
      "LEGGO dependency src/index.ts must contain generated implementation"
    );

    assert.notEqual(
      observation.dependencyIndexContent,
      observation.rootIndexContent,
      "Dependent task must receive integrated implementation, not ProjectFactory baseline"
    );

    assert.equal(
      spyColonyExecutor.observedDependencyContexts.every(
        (entry) => entry.taskId === "task-test"
      ),
      true,
      "Root WorkPackages without dependencies must not receive previous-candidate context"
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});


class QuotaBlockedColonyExecutor extends ColonyExecutor {
  public callCount = 0;

  public override executeWorkPackage(
    ...args: Parameters<ColonyExecutor["executeWorkPackage"]>
  ): ReturnType<ColonyExecutor["executeWorkPackage"]> {
    const [, execution] = args;
    this.callCount += 1;

    return {
      success: false,
      executionId: execution.executionId,
      colonyId: execution.colonyId,
      outputArtifacts: [],
      evidenceRecords: [],
      reasonCode: "REAL_PROVIDER_EXECUTION_FAILED: quota-exceeded (exit 1)",
      externalBlocker: "PROVIDER_QUOTA_EXCEEDED",
    };
  }
}

test("NamlaRuntime: Provider quota exhaustion blocks before recovery and SON", () => {
  const ws = tempWorkspace("quota-blocked");

  try {
    const quotaExecutor = new QuotaBlockedColonyExecutor();
    const runtime = new NamlaRuntime(quotaExecutor);

    const result = runtime.runMission({
      missionId: "mission-quota-blocked",
      objective: "Build a TypeScript project with core logic and tests",
      workspaceRoot: ws,
      executionMode: "DETERMINISTIC_FIXTURE_MODE",
      projectClass: "TYPESCRIPT_LIBRARY",
    });

    assert.equal(result.success, false);
    assert.equal(result.finalState, "BLOCKED");
    assert.equal(result.reasonCode, "PROVIDER_QUOTA_EXCEEDED");

    assert.equal(
      quotaExecutor.callCount,
      2,
      "quota exhaustion must execute Colony A and B once each with no retry"
    );

    assert.equal(
      result.evidenceRecords.some((record) => record.stageId === "SON"),
      false,
      "quota exhaustion must stop before SON"
    );

    assert.equal(
      result.reasonCode.includes("REWORK_AB"),
      false,
      "quota exhaustion must never be classified as code rework"
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});


class FailedReworkColonyExecutor extends ColonyExecutor {
  public callCount = 0;

  public override executeWorkPackage(
    ...args: Parameters<ColonyExecutor["executeWorkPackage"]>
  ): ReturnType<ColonyExecutor["executeWorkPackage"]> {
    this.callCount += 1;

    if (this.callCount <= 2) {
      const firstPass = super.executeWorkPackage(...args);

      return {
        ...firstPass,
        evidenceRecords: firstPass.evidenceRecords.map((record) => ({
          ...record,
          status: "INVALIDATED" as const,
        })),
      };
    }

    const [, execution] = args;

    return {
      success: false,
      executionId: execution.executionId,
      colonyId: execution.colonyId,
      outputArtifacts: [],
      evidenceRecords: [],
      reasonCode: "SIMULATED_REWORK_FAILURE",
    };
  }
}

test("NamlaRuntime: Failed REWORK_AB rerun is rechecked and never reaches SON", () => {
  const ws = tempWorkspace("failed-rework");

  try {
    const executor = new FailedReworkColonyExecutor();
    const runtime = new NamlaRuntime(executor);

    const result = runtime.runMission({
      missionId: "mission-failed-rework",
      objective: "Build a TypeScript project with core logic and tests",
      workspaceRoot: ws,
      executionMode: "DETERMINISTIC_FIXTURE_MODE",
      projectClass: "TYPESCRIPT_LIBRARY",
    });

    assert.equal(result.success, false);
    assert.equal(result.finalState, "FAILED");
    assert.equal(result.reasonCode, "COLONY_REWORK_FAILED");

    assert.equal(
      executor.callCount,
      4,
      "initial Colony A/B plus exactly one A/B rework must execute"
    );

    assert.equal(
      result.evidenceRecords.some((record) => record.stageId === "SON"),
      false,
      "failed rework must stop before SON"
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});


class QuotaDuringReworkColonyExecutor extends ColonyExecutor {
  public callCount = 0;

  public override executeWorkPackage(
    ...args: Parameters<ColonyExecutor["executeWorkPackage"]>
  ): ReturnType<ColonyExecutor["executeWorkPackage"]> {
    this.callCount += 1;

    // First Colony A/B pair succeeds but is marked stale so Gate 5 requests REWORK_AB.
    if (this.callCount <= 2) {
      const firstPass = super.executeWorkPackage(...args);

      return {
        ...firstPass,
        evidenceRecords: firstPass.evidenceRecords.map((record) => ({
          ...record,
          status: "INVALIDATED" as const,
        })),
      };
    }

    // The recovery attempt is blocked by external provider quota.
    const [, execution] = args;

    return {
      success: false,
      executionId: execution.executionId,
      colonyId: execution.colonyId,
      outputArtifacts: [],
      evidenceRecords: [],
      reasonCode: "REAL_PROVIDER_EXECUTION_FAILED: quota-exceeded (exit 1)",
      externalBlocker: "PROVIDER_QUOTA_EXCEEDED",
    };
  }
}

test("NamlaRuntime: Provider quota during REWORK_AB returns BLOCKED before SON", () => {
  const ws = tempWorkspace("quota-during-rework");

  try {
    const executor = new QuotaDuringReworkColonyExecutor();
    const runtime = new NamlaRuntime(executor);

    const result = runtime.runMission({
      missionId: "mission-quota-during-rework",
      objective: "Build a TypeScript project with core logic and tests",
      workspaceRoot: ws,
      executionMode: "DETERMINISTIC_FIXTURE_MODE",
      projectClass: "TYPESCRIPT_LIBRARY",
    });

    assert.equal(result.success, false);
    assert.equal(result.finalState, "BLOCKED");
    assert.equal(result.reasonCode, "PROVIDER_QUOTA_EXCEEDED");

    assert.equal(
      executor.callCount,
      4,
      "initial Colony A/B plus exactly one quota-blocked A/B rework must execute"
    );

    assert.equal(
      result.evidenceRecords.some((record) => record.stageId === "SON"),
      false,
      "quota during rework must stop before SON"
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});


class SuccessfulReworkColonyExecutor extends ColonyExecutor {
  public callCount = 0;
  public readonly callsByTask = new Map<string, number>();

  public override executeWorkPackage(
    ...args: Parameters<ColonyExecutor["executeWorkPackage"]>
  ): ReturnType<ColonyExecutor["executeWorkPackage"]> {
    const [workPackage] = args;

    this.callCount += 1;
    this.callsByTask.set(
      workPackage.taskSpec.id,
      (this.callsByTask.get(workPackage.taskSpec.id) ?? 0) + 1
    );

    const result = super.executeWorkPackage(...args);

    // Force only the first Colony A/B pair into REWORK_AB.
    if (this.callCount <= 2) {
      return {
        ...result,
        evidenceRecords: result.evidenceRecords.map((record) => ({
          ...record,
          status: "INVALIDATED" as const,
        })),
      };
    }

    return result;
  }
}

test("NamlaRuntime: Successful REWORK_AB rerun passes refreshed Gate 5 before SON", () => {
  const ws = tempWorkspace("successful-rework");

  try {
    const executor = new SuccessfulReworkColonyExecutor();
    const runtime = new NamlaRuntime(executor);

    const result = runtime.runMission({
      missionId: "mission-successful-rework",
      objective: "Build a TypeScript project with core logic and tests",
      workspaceRoot: ws,
      executionMode: "DETERMINISTIC_FIXTURE_MODE",
      projectClass: "TYPESCRIPT_LIBRARY",
    });

    assert.equal(
      result.reasonCode.includes("GATE_FAILURE_REWORK_AB"),
      false,
      "successful rerun must not fail refreshed Gate 5"
    );

    assert.equal(
      result.reasonCode.includes("STALE_EVIDENCE_DETECTED"),
      false,
      "invalidated first-pass evidence must not poison the rerun"
    );

    assert.equal(
      executor.callsByTask.get("task-impl"),
      4,
      "task-impl must execute initial A/B plus exactly one successful A/B rework"
    );

    assert.equal(
      result.evidenceRecords.some((record) => record.stageId === "SON"),
      true,
      "SON must execute only after refreshed Gate 5 accepts the rerun"
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
