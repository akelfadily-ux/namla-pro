/**
 * V2 Concurrency, DAG, Anti-Livelock, Resource Limits & A/B Isolation Hardening Suite (HARDENING-6, 7, 15, 16).
 *
 * Tests A/B isolation attacks, retry budget anti-livelock ceilings,
 * DAG scheduling & dependency edge cases, and resource limits.
 *
 * Seed: 0x3d4e5f6a
 * Run: node dist/tools/v2DagConcurrencyAndIsolationHardeningTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { resolve } from "path";
import { ProDispatcher } from "../v2/pro/proDispatcher";
import { NamlaLoopGate } from "../v2/loop/namlaLoopGate";
import { ColonyExecutor } from "../v2/colony/colonyExecutor";
import { TrustedKernel } from "../v2/kernel/trustedKernel";
import { WorkPackage, WorkPackageExecution } from "../v2/types/missionState";
import { LoopBudget, StageRecoveryPolicy, GateInput } from "../v2/types/namlaLoopTypes";

function tempWorkspace(tag: string): string {
  return mkdtempSync(resolve(tmpdir(), `namla-v2-fuzz-p4-${tag}-`));
}

test("HARDENING-7: Anti-Livelock & Budget Ceiling Enforcement", () => {
  const gate = new NamlaLoopGate({ maxLivelockThreshold: 3 });

  const exhaustedBudget: LoopBudget = {
    maxTicks: 100,
    remainingTicks: 0, // Exhausted
    maxFixAttempts: 3,
    remainingFixAttempts: 0,
    maxProviderCalls: 10,
    remainingProviderCalls: 0,
  };

  const policy: StageRecoveryPolicy = {
    stageId: "COLONY_AB",
    allowedActions: ["REWORK_AB", "FAIL_CLOSED"],
    maxRetriesPerStage: 3,
  };

  const input: GateInput = {
    missionId: "m-livelock",
    stageId: "COLONY_AB",
    artifactIdentity: { artifactId: "a1", path: "src/index.ts", sha256: "h1", sizeBytes: 10, missionId: "m-livelock" },
    policyVersions: ["v1.0.0"],
    environmentIdentity: { platform: "linux", nodeVersion: "v20.0.0", cwd: "/app", envFingerprint: "fp" },
    requiredAttestations: [],
    requiredAssessments: [],
    evidenceRefs: [],
    budget: exhaustedBudget,
    phase: "CONTRACT_BOUND",
    contractVersion: "v1.0.0",
  };

  const verdict = gate.evaluateGate(input, [], policy);
  assert.equal(verdict.status, "HUMAN_REQUIRED");
  assert.equal(verdict.reasonCodes.includes("BUDGET_EXHAUSTED"), true);
});

test("HARDENING-15: DAG Scheduler Dependency Graph Invariants", () => {
  const dispatcher = new ProDispatcher();

  const wp1: WorkPackage = {
    id: "wp-1",
    missionId: "m-dag",
    contractVersion: "v1.0.0",
    taskSpec: { id: "t1", name: "Task 1", description: "", targetFiles: ["src/a.ts"], dependencies: [], capabilityRequirements: [] },
    acceptanceCriteria: [],
    inputArtifacts: [],
    readOnly: false,
    maxAttempts: 3,
  };

  const wp2: WorkPackage = {
    id: "wp-2",
    missionId: "m-dag",
    contractVersion: "v1.0.0",
    taskSpec: { id: "t2", name: "Task 2", description: "", targetFiles: ["src/b.ts"], dependencies: ["t1"], capabilityRequirements: [] },
    acceptanceCriteria: [],
    inputArtifacts: [],
    readOnly: false,
    maxAttempts: 3,
  };

  const workPackages = [wp1, wp2];

  // Before task 1 passes, task 2 is BLOCKED
  const sched1 = dispatcher.computeSchedule(workPackages, []);
  assert.equal(sched1.readyPackages.length, 1);
  assert.equal(sched1.readyPackages[0].id, "wp-1");
  assert.equal(sched1.blockedPackages.length, 1);
  assert.equal(sched1.blockedPackages[0].id, "wp-2");

  // After task 1 passes, task 2 is READY
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
});

test("HARDENING-6: Colony A/B Cross-Workspace Isolation", () => {
  const ws = tempWorkspace("ab-isolation");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });
    const executor = new ColonyExecutor();

    const wp: WorkPackage = {
      id: "wp-iso",
      missionId: "m-iso",
      contractVersion: "v1.0.0",
      taskSpec: { id: "t1", name: "Iso Task", description: "", targetFiles: ["src/index.ts"], dependencies: [], capabilityRequirements: [] },
      acceptanceCriteria: [],
      inputArtifacts: [],
      readOnly: false,
      maxAttempts: 3,
    };

    const execA: WorkPackageExecution = {
      executionId: "exec-a-iso",
      workPackageId: "wp-iso",
      colonyId: "COLONY_A",
      state: "EXECUTING",
      stateVersion: 1,
      attempts: 1,
      outputArtifacts: [],
      evidenceRefs: [],
      workspacePath: "workspaces/v2-missions/m-iso/colony_a/wp-iso",
    };

    const execB: WorkPackageExecution = {
      executionId: "exec-b-iso",
      workPackageId: "wp-iso",
      colonyId: "COLONY_B",
      state: "EXECUTING",
      stateVersion: 1,
      attempts: 1,
      outputArtifacts: [],
      evidenceRefs: [],
      workspacePath: "workspaces/v2-missions/m-iso/colony_b/wp-iso",
    };

    const context = {
      missionId: "m-iso",
      authoritativeInputs: [],
      policyVersions: ["v1.0.0"],
      budgets: { virtualTicks: 100, providerCalls: 10, maxFixAttempts: 3 },
      evidenceRefs: [],
      missionStateRef: "EXECUTING_AB",
      executionMode: "DETERMINISTIC_FIXTURE_MODE" as const,
      contractPhase: "CONTRACT_BOUND" as const,
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
        riskClassification: "LOW" as const,
        completionConditions: [],
        frozenAt: Date.now(),
      },
    };

    const resA = executor.executeWorkPackage(wp, execA, context, kernel, undefined, { mode: "DETERMINISTIC_FIXTURE_MODE" });
    const resB = executor.executeWorkPackage(wp, execB, context, kernel, undefined, { mode: "DETERMINISTIC_FIXTURE_MODE" });

    // Workspace paths are completely distinct
    assert.notEqual(resA.outputArtifacts[0].path, resB.outputArtifacts[0].path);
    assert.equal(resA.outputArtifacts[0].path.includes("colony_a"), true);
    assert.equal(resB.outputArtifacts[0].path.includes("colony_b"), true);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
