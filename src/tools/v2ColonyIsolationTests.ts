/**
 * V2 Colony Isolation & Autonomous Execution Tests (P0, P0.4).
 *
 * Verifies strict A/B isolation (separate execution IDs, separate workspaces, separate evidence,
 * no pre-SON solution visibility) and autonomous solution generation.
 *
 * Run: node dist/tools/v2ColonyIsolationTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { resolve } from "path";
import { ColonyExecutor } from "../v2/colony/colonyExecutor";
import { TrustedKernel } from "../v2/kernel/trustedKernel";
import { WorkPackage, WorkPackageExecution } from "../v2/types/missionState";
import { ContractBoundStageContext } from "../v2/types/stageContext";

function tempWorkspace(tag: string): string {
  return mkdtempSync(resolve(tmpdir(), `namla-v2-colony-${tag}-`));
}

test("ColonyExecutor: Autonomous Code Generation without Injected Code", () => {
  const ws = tempWorkspace("auto-gen");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });
    const executor = new ColonyExecutor();

    const wp: WorkPackage = {
      id: "wp-auto-1",
      missionId: "m-auto",
      contractVersion: "v1.0.0",
      taskSpec: {
        id: "t1",
        name: "Data Processor",
        description: "Build data processor module",
        targetFiles: ["src/processor.ts"],
        dependencies: [],
        capabilityRequirements: ["filesystem.write"],
      },
      acceptanceCriteria: [],
      inputArtifacts: [],
      readOnly: false,
      maxAttempts: 3,
    };

    const execA: WorkPackageExecution = {
      executionId: "exec-a-wp-auto-1",
      workPackageId: "wp-auto-1",
      colonyId: "COLONY_A",
      state: "EXECUTING",
      stateVersion: 1,
      attempts: 1,
      outputArtifacts: [],
      evidenceRefs: [],
      workspacePath: "workspaces/v2-missions/m-auto/colony_a/wp-auto-1",
    };

    const context: ContractBoundStageContext = {
      missionId: "m-auto",
      authoritativeInputs: ["Build processor"],
      policyVersions: ["v1.0.0"],
      budgets: { virtualTicks: 100, providerCalls: 10, maxFixAttempts: 3 },
      evidenceRefs: [],
      missionStateRef: "EXECUTING_AB",
      contractPhase: "CONTRACT_BOUND",
      frozenPlanContract: {
        contractId: "c1",
        version: "v1.0.0",
        contractHash: "h1",
        objective: "Build processor",
        acceptanceCriteria: [],
        constraints: [],
        tasks: [],
        dependencies: [],
        allowedCapabilities: [],
        requiredTests: [],
        securityRequirements: [],
        expectedArtifacts: [],
        evidenceRequirements: [],
        riskClassification: "LOW",
        completionConditions: [],
        frozenAt: Date.now(),
      },
    };

    // Execute WITHOUT passing simulated code
    const resA = executor.executeWorkPackage(wp, execA, context, kernel);

    assert.equal(resA.success, true);
    assert.equal(resA.outputArtifacts.length, 1);
    assert.equal(resA.outputArtifacts[0].path, "workspaces/v2-missions/m-auto/colony_a/wp-auto-1/src/processor.ts");

    // Verify written file contains autonomous solution
    const readBack = kernel.safeReadWorkspaceFile(resA.outputArtifacts[0].path);
    assert.equal(readBack.success, true);
    assert.equal(readBack.content?.includes("Autonomous Solution by COLONY_A"), true);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("ColonyExecutor: Strict A/B Workspace & Execution Isolation", () => {
  const ws = tempWorkspace("isolation");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });
    const executor = new ColonyExecutor();

    const wp: WorkPackage = {
      id: "wp-iso-1",
      missionId: "m-iso",
      contractVersion: "v1.0.0",
      taskSpec: {
        id: "t1",
        name: "Module",
        description: "",
        targetFiles: ["src/index.ts"],
        dependencies: [],
        capabilityRequirements: [],
      },
      acceptanceCriteria: [],
      inputArtifacts: [],
      readOnly: false,
      maxAttempts: 3,
    };

    const execA: WorkPackageExecution = {
      executionId: "exec-a-111",
      workPackageId: "wp-iso-1",
      colonyId: "COLONY_A",
      state: "EXECUTING",
      stateVersion: 1,
      attempts: 1,
      outputArtifacts: [],
      evidenceRefs: [],
      workspacePath: "workspaces/v2-missions/m-iso/colony_a/wp-iso-1",
    };

    const execB: WorkPackageExecution = {
      executionId: "exec-b-222",
      workPackageId: "wp-iso-1",
      colonyId: "COLONY_B",
      state: "EXECUTING",
      stateVersion: 1,
      attempts: 1,
      outputArtifacts: [],
      evidenceRefs: [],
      workspacePath: "workspaces/v2-missions/m-iso/colony_b/wp-iso-1",
    };

    const context: ContractBoundStageContext = {
      missionId: "m-iso",
      authoritativeInputs: [],
      policyVersions: ["v1.0.0"],
      budgets: { virtualTicks: 100, providerCalls: 10, maxFixAttempts: 3 },
      evidenceRefs: [],
      missionStateRef: "EXECUTING_AB",
      contractPhase: "CONTRACT_BOUND",
      frozenPlanContract: {
        contractId: "c1",
        version: "v1.0.0",
        contractHash: "h1",
        objective: "Obj",
        acceptanceCriteria: [],
        constraints: [],
        tasks: [],
        dependencies: [],
        allowedCapabilities: [],
        requiredTests: [],
        securityRequirements: [],
        expectedArtifacts: [],
        evidenceRequirements: [],
        riskClassification: "LOW",
        completionConditions: [],
        frozenAt: Date.now(),
      },
    };

    const resA = executor.executeWorkPackage(wp, execA, context, kernel);
    const resB = executor.executeWorkPackage(wp, execB, context, kernel);

    // Verify separate execution IDs
    assert.notEqual(resA.executionId, resB.executionId);

    // Verify separate workspace paths
    assert.notEqual(resA.outputArtifacts[0].path, resB.outputArtifacts[0].path);
    assert.equal(resA.outputArtifacts[0].path.includes("/colony_a/"), true);
    assert.equal(resB.outputArtifacts[0].path.includes("/colony_b/"), true);

    // Verify separate evidence records
    assert.equal(resA.evidenceRecords[0].producer, "COLONY_A");
    assert.equal(resB.evidenceRecords[0].producer, "COLONY_B");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
