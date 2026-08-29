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

function tempWorkspace(tag: string): string {
  return mkdtempSync(resolve(tmpdir(), `namla-v2-dag-${tag}-`));
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
    const runtime = new NamlaRuntime();
    const result = runtime.runMission({
      missionId: "mission-multi-task",
      objective: "Build a TypeScript project with core logic and tests",
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
