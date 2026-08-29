/**
 * V2 Adversarial & Edge Case Security Qualification Suite (§15, P0.16, P0.17).
 *
 * Attacks the canonical V2 architecture against:
 * - Path traversal attempts
 * - Secret leakage in proposed artifact content
 * - Unsafe shell command injection
 * - Authority-sensitive destructive objectives
 * - Anti-livelock / infinite retry loops
 * - Invalidated / stale evidence injection
 * - Unverified ProMax delivery packaging
 * - Partial colony failures
 *
 * Run: node dist/tools/v2AdversarialTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { resolve } from "path";
import { TrustedKernel } from "../v2/kernel/trustedKernel";
import { EerEngine } from "../v2/eer/eerEngine";
import { NamlaLoopGate } from "../v2/loop/namlaLoopGate";
import { LabPackager } from "../v2/lab/labPackager";
import { ColonyExecutor, ColonyExecutionResult } from "../v2/colony/colonyExecutor";
import { PreFreezeStageContext, ContractBoundStageContext } from "../v2/types/stageContext";
import { GateInput, StageRecoveryPolicy, LoopBudget } from "../v2/types/namlaLoopTypes";
import { WorkPackage, WorkPackageExecution, IntegratedCandidate, ProMaxAssessment } from "../v2/types/missionState";
import { EvidenceRecord } from "../v2/types/evidence";

function tempWorkspace(tag: string): string {
  return mkdtempSync(resolve(tmpdir(), `namla-v2-adv-${tag}-`));
}

test("ADVERSARIAL: Path Traversal Attempt in TrustedKernel is Refused", () => {
  const ws = tempWorkspace("path-traversal");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });

    const result = kernel.safeWriteWorkspaceFile("../../etc/passwd", "root:x:0:0:", "m-adv-1");
    assert.equal(result.success, false);
    assert.equal(result.reasonCode, "PATH_TRAVERSAL_REFUSED");

    const readResult = kernel.safeReadWorkspaceFile("../../etc/passwd");
    assert.equal(readResult.success, false);
    assert.equal(readResult.reasonCode, "PATH_TRAVERSAL_REFUSED");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("ADVERSARIAL: Secret Leakage in Proposed Content is Refused", () => {
  const ws = tempWorkspace("secret-leak");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });

    const secretContent = "export const key = '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC3\n-----END PRIVATE KEY-----';";
    const result = kernel.safeWriteWorkspaceFile("src/secret.ts", secretContent, "m-adv-2");

    assert.equal(result.success, false);
    assert.equal(result.reasonCode, "SECRET_CONTENT_REFUSED");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("ADVERSARIAL: Unsafe Command Execution Attempt in TrustedKernel is Refused", () => {
  const ws = tempWorkspace("unsafe-cmd");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });

    // Attempting forbidden command injection via git push or rm -rf /
    const result = kernel.executeCommand("git" as any, ["push", "origin", "main"], "m-adv-3", "PROMAX");
    assert.equal(result.success, false);
    assert.equal(result.reasonCode, "FORBIDDEN_COMMAND_REFUSED");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("ADVERSARIAL: Authority-Sensitive Destructive Objective Escalate to HUMAN_REQUIRED", () => {
  const ws = tempWorkspace("destructive-obj");
  try {
    const eer = new EerEngine();
    const context: PreFreezeStageContext = {
      missionId: "m-adv-4",
      authoritativeInputs: [],
      policyVersions: ["v1.0.0"],
      budgets: { virtualTicks: 100, providerCalls: 10, maxFixAttempts: 3 },
      evidenceRefs: [],
      missionStateRef: "INTERPRETING",
      executionMode: "DETERMINISTIC_FIXTURE_MODE",
      contractPhase: "PRE_FREEZE",
    };

    const result = eer.evaluateObjective("delete production database tables drop schema", context);
    assert.equal(result.success, false);
    assert.equal(result.humanRequired, true);
    assert.equal(result.reasonCode, "AUTHORITY_SENSITIVE_AMBIGUITY_ESCALATED");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("ADVERSARIAL: Empty Objective Refused cleanly", () => {
  const eer = new EerEngine();
  const context: PreFreezeStageContext = {
    missionId: "m-adv-5",
    authoritativeInputs: [],
    policyVersions: ["v1.0.0"],
    budgets: { virtualTicks: 100, providerCalls: 10, maxFixAttempts: 3 },
    evidenceRefs: [],
    missionStateRef: "INTERPRETING",
    executionMode: "DETERMINISTIC_FIXTURE_MODE",
    contractPhase: "PRE_FREEZE",
  };

  const result = eer.evaluateObjective("   ", context);
  assert.equal(result.success, false);
  assert.equal(result.reasonCode, "EMPTY_OBJECTIVE_REFUSED");
});

test("ADVERSARIAL: Anti-Livelock / Max Retry Threshold Prevents Infinite Loop", () => {
  const gate = new NamlaLoopGate();
  const budget: LoopBudget = {
    maxTicks: 100,
    remainingTicks: 0, // Exhausted ticks
    maxFixAttempts: 3,
    remainingFixAttempts: 0, // Exhausted attempts!
    maxProviderCalls: 10,
    remainingProviderCalls: 5,
  };

  const policy: StageRecoveryPolicy = {
    stageId: "COLONY_AB",
    allowedActions: ["REWORK_AB", "FAIL_CLOSED"],
    maxRetriesPerStage: 3,
  };

  const input: GateInput = {
    missionId: "m-adv-6",
    stageId: "COLONY_AB",
    artifactIdentity: { artifactId: "a1", path: "src/index.ts", sha256: "h1", sizeBytes: 10, missionId: "m-adv-6" },
    policyVersions: ["v1.0.0"],
    environmentIdentity: { platform: "linux", nodeVersion: "v20.0.0", cwd: "/app", envFingerprint: "fp" },
    requiredAttestations: [],
    requiredAssessments: [],
    evidenceRefs: [],
    budget,
    phase: "CONTRACT_BOUND",
    contractVersion: "v1.0.0",
  };

  const verdict = gate.evaluateGate(input, [], policy);
  assert.equal(verdict.status, "HUMAN_REQUIRED");
  assert.equal(verdict.nextAction, "HUMAN_REQUIRED");
  assert.equal(verdict.reasonCodes.includes("BUDGET_EXHAUSTED"), true);
});

test("ADVERSARIAL: Stale / Invalidated Evidence Triggers Rework Gate Rejection", () => {
  const ws = tempWorkspace("stale-ev");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });
    const gate = new NamlaLoopGate();

    const evValid = kernel.emitEvidence("TEST", "m-adv-7", "PROMAX", { test: 1 });
    const evStale = kernel.emitEvidence("TEST", "m-adv-7", "PROMAX", { test: 2 });
    const invalidatedEvStale: EvidenceRecord = { ...evStale, status: "INVALIDATED" };

    const evidencePool = [evValid, invalidatedEvStale];

    const budget: LoopBudget = {
      maxTicks: 100,
      remainingTicks: 100,
      maxFixAttempts: 3,
      remainingFixAttempts: 3,
      maxProviderCalls: 10,
      remainingProviderCalls: 10,
    };

    const policy: StageRecoveryPolicy = {
      stageId: "PROMAX",
      allowedActions: ["REWORK_AB", "FAIL_CLOSED"],
      maxRetriesPerStage: 3,
    };

    const input: GateInput = {
      missionId: "m-adv-7",
      stageId: "PROMAX",
      artifactIdentity: { artifactId: "a1", path: "src/index.ts", sha256: "h1", sizeBytes: 10, missionId: "m-adv-7" },
      policyVersions: ["v1.0.0"],
      environmentIdentity: { platform: "linux", nodeVersion: "v20.0.0", cwd: "/app", envFingerprint: "fp" },
      requiredAttestations: [],
      requiredAssessments: [],
      evidenceRefs: [evValid.evidenceId, invalidatedEvStale.evidenceId],
      budget,
      phase: "CONTRACT_BOUND",
      contractVersion: "v1.0.0",
    };

    const verdict = gate.evaluateGate(input, evidencePool, policy);
    assert.equal(verdict.status, "FAIL");
    assert.equal(verdict.reasonCodes.includes("STALE_EVIDENCE_DETECTED"), true);
    assert.equal(verdict.nextAction, "REWORK_AB");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("ADVERSARIAL: Lab Packager Refuses Unverified ProMax Candidate", () => {
  const ws = tempWorkspace("unverified-lab");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });
    const packager = new LabPackager();

    const candidate: IntegratedCandidate = {
      candidateId: "cand-unverified",
      missionId: "m-adv-8",
      integratedArtifacts: [{ artifactId: "a1", path: "src/index.ts", sha256: "abc", sizeBytes: 10, missionId: "m-adv-8" }],
      resolvedConflicts: [],
      sourceTraceability: { "src/index.ts": "COLONY_A" },
      workspacePath: "workspaces/v2-missions/m-adv-8/leggo-integrated",
    };

    const failedAssessment: ProMaxAssessment = {
      candidateId: "cand-unverified",
      contractSatisfied: false,
      verifiedCriteria: [],
      failedCriteria: ["ac-1"],
      securityCheckPassed: true,
      regressionPassed: false,
      independentTestsPassed: false,
      evidenceFreshnessVerified: true,
    };

    const context: ContractBoundStageContext = {
      missionId: "m-adv-8",
      authoritativeInputs: [],
      policyVersions: ["v1.0.0"],
      budgets: { virtualTicks: 100, providerCalls: 10, maxFixAttempts: 3 },
      evidenceRefs: [],
      missionStateRef: "PACKAGING",
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

    const result = packager.packageDeliverables(candidate, failedAssessment, context, kernel, []);
    assert.equal(result.success, false);
    assert.equal(result.reasonCode.startsWith("NAMLA_LAB_REFUSED"), true);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("ADVERSARIAL: Partial Colony Output Failure Synthesizes Remaining Colony Output", () => {
  const ws = tempWorkspace("partial-colony");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });
    const executor = new ColonyExecutor();

    const wp: WorkPackage = {
      id: "wp-part-1",
      missionId: "m-part",
      contractVersion: "v1.0.0",
      taskSpec: {
        id: "t1",
        name: "Module",
        description: "",
        targetFiles: ["src/a.ts", "src/b.ts"],
        dependencies: [],
        capabilityRequirements: [],
      },
      acceptanceCriteria: [],
      inputArtifacts: [],
      readOnly: false,
      maxAttempts: 3,
    };

    const execA: WorkPackageExecution = {
      executionId: "exec-a-part",
      workPackageId: "wp-part-1",
      colonyId: "COLONY_A",
      state: "EXECUTING",
      stateVersion: 1,
      attempts: 1,
      outputArtifacts: [],
      evidenceRefs: [],
      workspacePath: "workspaces/v2-missions/m-part/colony_a/wp-part-1",
    };

    const context: ContractBoundStageContext = {
      missionId: "m-part",
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
    assert.equal(resA.success, true);
    assert.equal(resA.outputArtifacts.length, 2);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
