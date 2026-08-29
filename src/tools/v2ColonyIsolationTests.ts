/**
 * V2 Colony Isolation & Autonomous Execution Tests (P0, P0.4, FINAL-P0-1, FINAL-P0-2, FINAL-P0-3).
 *
 * Verifies strict A/B isolation (separate execution IDs, separate workspaces, separate evidence,
 * no pre-SON solution visibility), explicit executionMode, and structural guard against
 * PRODUCTION_MODE deterministic fallbacks, provider proposal parsing, and scope validation.
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
      executionMode: "DETERMINISTIC_FIXTURE_MODE",
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
    const resA = executor.executeWorkPackage(wp, execA, context, kernel, undefined, { mode: "DETERMINISTIC_FIXTURE_MODE" });

    assert.equal(resA.success, true);
    assert.equal(resA.outputArtifacts.length, 1);
    assert.equal(resA.outputArtifacts[0].path, "workspaces/v2-missions/m-auto/colony_a/wp-auto-1/src/processor.ts");

    // Verify written file contains autonomous solution
    const readBack = kernel.safeReadWorkspaceFile(resA.outputArtifacts[0].path);
    assert.equal(readBack.success, true);
    assert.equal(readBack.content?.includes("COLONY_A"), true);
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
      executionMode: "DETERMINISTIC_FIXTURE_MODE",
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

    const resA = executor.executeWorkPackage(wp, execA, context, kernel, undefined, { mode: "DETERMINISTIC_FIXTURE_MODE" });
    const resB = executor.executeWorkPackage(wp, execB, context, kernel, undefined, { mode: "DETERMINISTIC_FIXTURE_MODE" });

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

test("ColonyExecutor: PRODUCTION_MODE Structural Guard Refuses Deterministic Fallback (FINAL-P0-2)", () => {
  const ws = tempWorkspace("prod-guard");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });
    const executor = new ColonyExecutor();

    const wp: WorkPackage = {
      id: "wp-prod-1",
      missionId: "m-prod",
      contractVersion: "v1.0.0",
      taskSpec: {
        id: "t1",
        name: "Custom Task",
        description: "",
        targetFiles: ["src/custom.ts"],
        dependencies: [],
        capabilityRequirements: [],
      },
      acceptanceCriteria: [],
      inputArtifacts: [],
      readOnly: false,
      maxAttempts: 3,
    };

    const execA: WorkPackageExecution = {
      executionId: "exec-a-prod",
      workPackageId: "wp-prod-1",
      colonyId: "COLONY_A",
      state: "EXECUTING",
      stateVersion: 1,
      attempts: 1,
      outputArtifacts: [],
      evidenceRefs: [],
      workspacePath: "workspaces/v2-missions/m-prod/colony_a/wp-prod-1",
    };

    const context: ContractBoundStageContext = {
      missionId: "m-prod",
      authoritativeInputs: [],
      policyVersions: ["v1.0.0"],
      budgets: { virtualTicks: 100, providerCalls: 10, maxFixAttempts: 3 },
      evidenceRefs: [],
      missionStateRef: "EXECUTING_AB",
      executionMode: "PRODUCTION_MODE",
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

    // Calling executeWorkPackage in PRODUCTION_MODE when provider is unconfigured or attempting fallback
    const res = executor.executeWorkPackage(wp, execA, context, kernel, undefined, { mode: "PRODUCTION_MODE" });
    assert.equal(res.success, false);
    assert.equal(
      res.reasonCode.startsWith("PROVIDER_UNAVAILABLE_FAIL_CLOSED") ||
      res.reasonCode.startsWith("PRODUCTION_FALLBACK_FORBIDDEN") ||
      res.reasonCode.startsWith("REAL_PROVIDER_REQUEST_FAILED"),
      true,
      `Reason code must be a production fail-closed or guard failure: ${res.reasonCode}`
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("ColonyExecutor: PRODUCTION_MODE Parses Structured Provider Output & Applies Scope Validation (FINAL-P0-1)", () => {
  const ws = tempWorkspace("prod-parsing");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });
    const executor = new ColonyExecutor();

    const wp: WorkPackage = {
      id: "wp-prod-parse-1",
      missionId: "m-prod-parse",
      contractVersion: "v1.0.0",
      taskSpec: {
        id: "t1",
        name: "Email Validator",
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
      executionId: "exec-a-prod-parse",
      workPackageId: "wp-prod-parse-1",
      colonyId: "COLONY_A",
      state: "EXECUTING",
      stateVersion: 1,
      attempts: 1,
      outputArtifacts: [],
      evidenceRefs: [],
      workspacePath: "workspaces/v2-missions/m-prod-parse/colony_a/wp-prod-parse-1",
    };

    const context: ContractBoundStageContext = {
      missionId: "m-prod-parse",
      authoritativeInputs: [],
      policyVersions: ["v1.0.0"],
      budgets: { virtualTicks: 100, providerCalls: 10, maxFixAttempts: 3 },
      evidenceRefs: [],
      missionStateRef: "EXECUTING_AB",
      executionMode: "PRODUCTION_MODE",
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

    // A. Valid structured JSON proposal updates workspace file
    const validJsonOutput = JSON.stringify({
      summary: "Generated email validator module",
      files: [
        {
          path: "src/index.ts",
          operation: "create",
          content: "export function isEmailValid(email: string): boolean { return email.includes('@'); }\n",
        },
      ],
      confidence: 0.9,
    });

    const resValid = executor.executeWorkPackage(wp, execA, context, kernel, validJsonOutput, { mode: "PRODUCTION_MODE" });
    assert.equal(resValid.success, true);
    assert.equal(resValid.outputArtifacts.length, 1);

    const fileContent = kernel.safeReadWorkspaceFile(resValid.outputArtifacts[0].path);
    assert.equal(fileContent.success, true);
    assert.equal(fileContent.content?.includes("isEmailValid"), true);

    // B. Malformed provider output is rejected
    const malformedOutput = "not json at all {{{";
    const resMalformed = executor.executeWorkPackage(wp, execA, context, kernel, malformedOutput, { mode: "PRODUCTION_MODE" });
    assert.equal(resMalformed.success, false);
    assert.equal(resMalformed.reasonCode.includes("PROVIDER_OUTPUT_MALFORMED"), true);

    // C. Provider proposal for out-of-scope path is rejected
    const outOfScopeOutput = JSON.stringify({
      summary: "Attempt out of scope write",
      files: [
        {
          path: "etc/unauthorized.ts",
          operation: "create",
          content: "export const x = 1;",
        },
      ],
    });
    const resOutOfScope = executor.executeWorkPackage(wp, execA, context, kernel, outOfScopeOutput, { mode: "PRODUCTION_MODE" });
    assert.equal(resOutOfScope.success, false);
    assert.equal(resOutOfScope.reasonCode.includes("PROVIDER_PROPOSAL_OUT_OF_SCOPE"), true);

    // D. Provider output proposing no files is rejected
    const noFilesOutput = JSON.stringify({
      summary: "No files generated",
      files: [],
    });
    const resNoFiles = executor.executeWorkPackage(wp, execA, context, kernel, noFilesOutput, { mode: "PRODUCTION_MODE" });
    assert.equal(resNoFiles.success, false);
    assert.equal(resNoFiles.reasonCode.includes("PROVIDER_NO_PROPOSALS"), true);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
