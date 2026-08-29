/**
 * NAMLA PRO V2 Adversarial Security & Invariant Qualification Suite (§15).
 *
 * Attacks NAMLA V2 runtime boundaries:
 * - Path traversal attempts
 * - Secret leakage attempts
 * - Authority-sensitive ambiguity escalation
 * - Anti-livelock & budget exhaustion
 * - Stale evidence detection
 * - Unverified candidate delivery refusal
 *
 * Run: node dist/tools/v2AdversarialTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { resolve } from "path";
import { TrustedKernel } from "../v2/kernel/trustedKernel";
import { NamlaLoopGate } from "../v2/loop/namlaLoopGate";
import { EerEngine } from "../v2/eer/eerEngine";
import { LabPackager } from "../v2/lab/labPackager";
import { GateInput, LoopBudget, StageRecoveryPolicy } from "../v2/types/namlaLoopTypes";
import { EvidenceRecord, ArtifactIdentity, EnvironmentIdentity } from "../v2/types/evidence";
import { PlanContract } from "../v2/types/contracts";
import { ProMaxAssessment, IntegratedCandidate } from "../v2/types/missionState";

function tempWorkspace(tag: string): string {
  return mkdtempSync(resolve(tmpdir(), `namla-v2-adv-${tag}-`));
}

test("ADVERSARIAL: Path Traversal Attempt in TrustedKernel is Refused", () => {
  const ws = tempWorkspace("path-traversal");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });
    const result = kernel.safeWriteWorkspaceFile("../../etc/malicious.txt", "payload", "mission-attack");

    assert.equal(result.success, false, "Path traversal must be refused");
    assert.equal(result.reasonCode, "PATH_TRAVERSAL_REFUSED");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("ADVERSARIAL: Secret Leakage in Proposed Content is Refused", () => {
  const ws = tempWorkspace("secret-leak");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });
    const secretContent = "export const key = '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...';";

    const result = kernel.safeWriteWorkspaceFile("src/secret.ts", secretContent, "mission-secret");

    assert.equal(result.success, false, "Secret leakage content must be refused");
    assert.equal(result.reasonCode, "SECRET_CONTENT_REFUSED");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("ADVERSARIAL: Authority-Sensitive Destructive Objective Escalate to HUMAN_REQUIRED", () => {
  const engine = new EerEngine();
  const context = {
    missionId: "mission-destructive",
    authoritativeInputs: [],
    policyVersions: ["v1.0.0"],
    budgets: { virtualTicks: 100, providerCalls: 10, maxFixAttempts: 3 },
    evidenceRefs: [],
    missionStateRef: "INTERPRETING",
    contractPhase: "PRE_FREEZE" as const,
  };

  const result = engine.evaluateObjective("delete production database immediately", context);

  assert.equal(result.success, false, "Destructive action must not succeed automatically");
  assert.equal(result.humanRequired, true, "Destructive action must escalate to HUMAN_REQUIRED");
  assert.equal(result.reasonCode, "AUTHORITY_SENSITIVE_AMBIGUITY_ESCALATED");
});

test("ADVERSARIAL: Anti-Livelock / Max Retry Threshold Prevents Infinite Loop", () => {
  const gate = new NamlaLoopGate({ maxLivelockThreshold: 2 });
  const budget: LoopBudget = {
    maxTicks: 100,
    remainingTicks: 100,
    maxFixAttempts: 3,
    remainingFixAttempts: 3,
    maxProviderCalls: 10,
    remainingProviderCalls: 10,
  };

  const envIdentity: EnvironmentIdentity = {
    platform: "linux",
    nodeVersion: "v20.0.0",
    cwd: "/app",
    envFingerprint: "fp123",
  };

  const artifact: ArtifactIdentity = {
    artifactId: "art-1",
    path: "src/index.ts",
    sha256: "hash1",
    sizeBytes: 10,
    missionId: "mission-livelock",
  };

  const input: GateInput = {
    missionId: "mission-livelock",
    stageId: "COLONY_AB",
    artifactIdentity: artifact,
    policyVersions: ["v1.0.0"],
    environmentIdentity: envIdentity,
    requiredAttestations: [],
    requiredAssessments: [],
    evidenceRefs: ["ev-missing"],
    budget,
    phase: "PRE_CONTRACT",
  };

  const policy: StageRecoveryPolicy = {
    stageId: "COLONY_AB",
    allowedActions: ["FIX", "REWORK_AB", "FAIL_CLOSED"],
    maxRetriesPerStage: 2,
  };

  // Attempt 1: missing evidence -> FAIL (FIX)
  const v1 = gate.evaluateGate(input, [], policy);
  assert.equal(v1.status, "FAIL");

  // Attempt 2: missing evidence -> FAIL (FIX)
  const v2 = gate.evaluateGate(input, [], policy);
  assert.equal(v2.status, "FAIL");

  // Attempt 3: exceeds maxLivelockThreshold (2) -> FAIL_CLOSED
  const v3 = gate.evaluateGate(input, [], policy);
  assert.equal(v3.status, "FAIL");
  assert.equal(v3.nextAction, "FAIL_CLOSED", "Livelock trigger must force FAIL_CLOSED");
  assert.equal(v3.reasonCodes.includes("ANTI_LIVELOCK_TRIGGERED"), true);
});

test("ADVERSARIAL: Stale / Invalidated Evidence Triggers Rework Gate Rejection", () => {
  const gate = new NamlaLoopGate();
  const budget: LoopBudget = {
    maxTicks: 100,
    remainingTicks: 100,
    maxFixAttempts: 3,
    remainingFixAttempts: 3,
    maxProviderCalls: 10,
    remainingProviderCalls: 10,
  };

  const staleEvidence: EvidenceRecord = {
    evidenceId: "ev-stale-1",
    producer: "COLONY_A",
    missionId: "mission-stale",
    stageId: "COLONY_AB",
    environmentIdentity: { platform: "linux", nodeVersion: "v20", cwd: "/app", envFingerprint: "fp" },
    timestamp: Date.now(),
    sequenceNumber: 1,
    status: "INVALIDATED",
    details: {},
    hash: "hash-stale",
  };

  const artifact: ArtifactIdentity = {
    artifactId: "art-1",
    path: "src/index.ts",
    sha256: "hash1",
    sizeBytes: 10,
    missionId: "mission-stale",
  };

  const input: GateInput = {
    missionId: "mission-stale",
    stageId: "SON",
    artifactIdentity: artifact,
    policyVersions: ["v1.0.0"],
    environmentIdentity: staleEvidence.environmentIdentity,
    requiredAttestations: [],
    requiredAssessments: [],
    evidenceRefs: ["ev-stale-1"],
    budget,
    phase: "PRE_CONTRACT",
  };

  const policy: StageRecoveryPolicy = {
    stageId: "SON",
    allowedActions: ["REWORK_AB", "FAIL_CLOSED"],
    maxRetriesPerStage: 3,
  };

  const verdict = gate.evaluateGate(input, [staleEvidence], policy);
  assert.equal(verdict.status, "FAIL");
  assert.equal(verdict.nextAction, "REWORK_AB", "Stale evidence must trigger REWORK_AB");
  assert.equal(verdict.staleEvidenceRefs.includes("ev-stale-1"), true);
});

test("ADVERSARIAL: Lab Packager Refuses Unverified ProMax Candidate", () => {
  const ws = tempWorkspace("lab-refuse");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });
    const lab = new LabPackager();

    const candidate: IntegratedCandidate = {
      candidateId: "cand-unverified",
      missionId: "mission-unverified",
      integratedArtifacts: [
        { artifactId: "art-1", path: "src/index.ts", sha256: "hash", sizeBytes: 10, missionId: "m" },
      ],
      resolvedConflicts: [],
      sourceTraceability: { "src/index.ts": "COLONY_A" },
      workspacePath: "workspaces/v2-missions/m/leggo-integrated",
    };

    const failedProMaxAssessment: ProMaxAssessment = {
      candidateId: "cand-unverified",
      contractSatisfied: false, // Verification failed!
      verifiedCriteria: [],
      failedCriteria: ["AC-1: Unit tests failed"],
      securityCheckPassed: true,
      regressionPassed: false,
      independentTestsPassed: false,
      evidenceFreshnessVerified: true,
    };

    const contract: PlanContract = {
      contractId: "c-1",
      version: "v1.0.0",
      contractHash: "hash",
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
    };

    const context = {
      missionId: "mission-unverified",
      authoritativeInputs: [],
      policyVersions: ["v1.0.0"],
      budgets: { virtualTicks: 100, providerCalls: 10, maxFixAttempts: 3 },
      evidenceRefs: [],
      missionStateRef: "PACKAGING",
      contractPhase: "CONTRACT_BOUND" as const,
      frozenPlanContract: contract,
    };

    const result = lab.packageDeliverables(candidate, failedProMaxAssessment, context, kernel, []);

    assert.equal(result.success, false, "Lab must refuse to package unverified candidate");
    assert.equal(result.reasonCode.includes("ProMax verification failed"), true);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
