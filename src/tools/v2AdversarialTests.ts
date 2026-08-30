/**
 * V2 Adversarial & Edge Case Security Qualification Suite (§15, P0.16, P0.17, P0-T2, P0-A1..P0-A9, P0-P1..P0-P8, P0-C1..P0-C11).
 *
 * Attacks the canonical V2 architecture against:
 * - Path traversal attempts
 * - Secret leakage in proposed artifact content
 * - Unsafe shell command injection
 * - Authority-Sensitive destructive objectives
 * - Anti-livelock / infinite retry loops
 * - Invalidated / stale evidence injection
 * - Unverified ProMax delivery packaging
 * - Unmapped acceptance criteria (P0-T2 & P0-A9 human bug fix verification)
 * - Cross-mission, cross-criterion, artifact-mutation replay attempts (P0-A5)
 * - Provenance attack matrix & proof laundering prevention (P0-P7, P0-P8)
 * - One test must not prove two criteria (P0-C9 human bug regression)
 * - Cross-verifier confusion matrix (P0-C10)
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
import { ProMaxVerifier } from "../v2/promax/proMaxVerifier";
import { ColonyExecutor } from "../v2/colony/colonyExecutor";
import { PreFreezeStageContext, ContractBoundStageContext } from "../v2/types/stageContext";
import { GateInput, StageRecoveryPolicy, LoopBudget } from "../v2/types/namlaLoopTypes";
import { WorkPackage, WorkPackageExecution, IntegratedCandidate, ProMaxAssessment } from "../v2/types/missionState";
import { EvidenceRecord } from "../v2/types/evidence";
import { createHash } from "crypto";

function tempWorkspace(tag: string): string {
  return mkdtempSync(resolve(tmpdir(), `namla-v2-adv-${tag}-`));
}

test("P0-C9 REGRESSION: Passing Test For AC-1 Must NOT Prove Unbound AC-2", () => {
  const ws = tempWorkspace("bug-p0c9");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });
    const verifier = new ProMaxVerifier();
    const packager = new LabPackager();

    const leggoRelPath = "workspaces/v2-missions/m-bug9c/leggo-integrated";
    kernel.safeWriteWorkspaceFile(`${leggoRelPath}/package.json`, JSON.stringify({ name: "bug9c", version: "1.0.0", scripts: { build: "npm --version", test: "npm --version" } }), "m-bug9c");
    kernel.safeWriteWorkspaceFile(`${leggoRelPath}/src/index.ts`, "export const x = 1;", "m-bug9c");

    const content = "export const x = 1;";
    const hash = createHash("sha256").update(content).digest("hex");

    const candidate: IntegratedCandidate = {
      candidateId: "cand-bug9c",
      missionId: "m-bug9c",
      integratedArtifacts: [{ artifactId: "a1", path: "src/index.ts", sha256: hash, sizeBytes: content.length, missionId: "m-bug9c" }],
      resolvedConflicts: [],
      sourceTraceability: { "src/index.ts": "COLONY_A" },
      workspacePath: leggoRelPath,
    };

    const context: ContractBoundStageContext = {
      missionId: "m-bug9c",
      authoritativeInputs: [],
      policyVersions: ["v1.0.0"],
      budgets: { virtualTicks: 100, providerCalls: 10, maxFixAttempts: 3 },
      evidenceRefs: [],
      missionStateRef: "VERIFYING",
      executionMode: "DETERMINISTIC_FIXTURE_MODE",
      contractPhase: "CONTRACT_BOUND",
      frozenPlanContract: {
        contractId: "c1",
        version: "v1.0.0",
        contractHash: "h1",
        objective: "Obj",
        acceptanceCriteria: [
          { id: "ac-1", description: "Invalid email addresses are rejected", verificationMethod: "TEST", required: true, requiredRequirementId: "tr-invalid-email" },
          { id: "ac-2", description: "Duplicate users are prevented", verificationMethod: "TEST", required: true, requiredRequirementId: "tr-duplicate-user" },
        ],
        constraints: [],
        tasks: [],
        dependencies: [],
        allowedCapabilities: [],
        requiredTests: [
          { id: "tr-invalid-email", name: "Invalid Email Test", command: "npm --version", expectedExitCode: 0, provesCriterionIds: ["ac-1"] },
        ],
        securityRequirements: [],
        expectedArtifacts: [],
        evidenceRequirements: [],
        riskClassification: "LOW",
        completionConditions: [],
        frozenAt: Date.now(),
      },
    };

    // tr-invalid-email passes and proves ac-1, but no test requirement proves ac-2!
    const result = verifier.verifyCandidate(candidate, context, kernel, []);

    assert.equal(result.success, false, "Contract MUST NOT be satisfied when AC-2 is unmapped");
    assert.equal(result.assessment.contractSatisfied, false);

    const proofAc1 = result.proofMappings.find((p) => p.criterionId === "ac-1");
    assert.equal(proofAc1?.status, "VERIFIED");

    const proofAc2 = result.proofMappings.find((p) => p.criterionId === "ac-2");
    assert.equal(proofAc2?.status, "UNVERIFIED");

    const labResult = packager.packageDeliverables(candidate, result.assessment, context, kernel, []);
    assert.equal(labResult.success, false);
    assert.equal(labResult.reasonCode.startsWith("NAMLA_LAB_REFUSED"), true);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("P0-C10: Comprehensive Cross-Verifier Confusion Matrix Rejection Suite", () => {
  const ws = tempWorkspace("confusion-matrix");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });
    const verifier = new ProMaxVerifier();

    const leggoRelPath = "workspaces/v2-missions/m-conf/leggo-integrated";
    kernel.safeWriteWorkspaceFile(`${leggoRelPath}/package.json`, JSON.stringify({ name: "conf", version: "1.0.0" }), "m-conf");
    kernel.safeWriteWorkspaceFile(`${leggoRelPath}/src/index.ts`, "export const x = 1;", "m-conf");

    const content = "export const x = 1;";
    const hash = createHash("sha256").update(content).digest("hex");

    const candidate: IntegratedCandidate = {
      candidateId: "cand-conf",
      missionId: "m-conf",
      integratedArtifacts: [{ artifactId: "a1", path: "src/index.ts", sha256: hash, sizeBytes: content.length, missionId: "m-conf" }],
      resolvedConflicts: [],
      sourceTraceability: { "src/index.ts": "COLONY_A" },
      workspacePath: leggoRelPath,
    };

    const context: ContractBoundStageContext = {
      missionId: "m-conf",
      authoritativeInputs: [],
      policyVersions: ["v1.0.0"],
      budgets: { virtualTicks: 100, providerCalls: 10, maxFixAttempts: 3 },
      evidenceRefs: [],
      missionStateRef: "VERIFYING",
      executionMode: "DETERMINISTIC_FIXTURE_MODE",
      contractPhase: "CONTRACT_BOUND",
      frozenPlanContract: {
        contractId: "c1",
        version: "v1.0.0",
        contractHash: "h1",
        objective: "Obj",
        acceptanceCriteria: [
          { id: "ac-1", description: "Target criterion 1", verificationMethod: "TEST", required: true, requiredRequirementId: "tr-1" },
        ],
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

    // 1. TEST requirement A proof reused for TEST criterion B (rejected)
    const ev1 = kernel.emitEvidence("TEST_SUITE_VERIFIER", "m-conf", "PROMAX", {
      criterionId: "ac-2-UNBOUND",
      testRequirementId: "tr-other",
      proofKind: "QUALIFICATION_PROOF",
    });
    assert.equal(verifier.verifyCandidate(candidate, context, kernel, [ev1]).success, false);

    // 2. SMOKE proof reused for unrelated TEST criterion (rejected)
    const ev2 = kernel.emitEvidence("SMOKE_VERIFIER", "m-conf", "PROMAX", {
      criterionId: "ac-unrelated",
      proofKind: "QUALIFICATION_PROOF",
    });
    assert.equal(verifier.verifyCandidate(candidate, context, kernel, [ev2]).success, false);

    // 3. BUILD proof reused for INVARIANT criterion without binding (rejected)
    const ev3 = kernel.emitEvidence("BUILD_VERIFIER", "m-conf", "PROMAX", {
      criterionId: "ac-invariant-unbound",
      proofKind: "QUALIFICATION_PROOF",
    });
    assert.equal(verifier.verifyCandidate(candidate, context, kernel, [ev3]).success, false);

    // 4. Generic npm test PASS with no criterion binding (rejected)
    const ev4 = kernel.emitEvidence("TEST_SUITE_VERIFIER", "m-conf", "PROMAX", {
      command: "npm test",
      proofKind: "QUALIFICATION_PROOF",
    });
    assert.equal(verifier.verifyCandidate(candidate, context, kernel, [ev4]).success, false);

    // 5. Generic TRUSTED_KERNEL_COMMAND PASS with criterionId injected (rejected)
    const ev5 = kernel.emitEvidence("TRUSTED_KERNEL_COMMAND", "m-conf", "PROMAX", {
      criterionId: "ac-1",
      proofKind: "QUALIFICATION_PROOF",
    });
    assert.equal(verifier.verifyCandidate(candidate, context, kernel, [ev5]).success, false);

    // 6. PROMAX-generated record without underlying verifier proof (rejected)
    const ev6 = kernel.emitEvidence("PROMAX", "m-conf", "PROMAX", {
      criterionId: "ac-1",
      proofKind: "QUALIFICATION_PROOF",
    });
    assert.equal(verifier.verifyCandidate(candidate, context, kernel, [ev6]).success, false);

    // 7. Correct verifier but wrong testRequirementId (rejected)
    const ev7 = kernel.emitEvidence("TEST_SUITE_VERIFIER", "m-conf", "PROMAX", {
      criterionId: "ac-1",
      testRequirementId: "tr-WRONG-REQ-ID",
      proofKind: "QUALIFICATION_PROOF",
    });
    assert.equal(verifier.verifyCandidate(candidate, context, kernel, [ev7]).success, false);

    // 8. Correct criterion/testRequirement but wrong candidate snapshot (rejected)
    const ev8 = kernel.emitEvidence("TEST_SUITE_VERIFIER", "m-conf", "PROMAX", {
      criterionId: "ac-1",
      testRequirementId: "tr-1",
      candidateSnapshotHash: "WRONG_SNAPSHOT_HASH_999",
      proofKind: "QUALIFICATION_PROOF",
    });
    assert.equal(verifier.verifyCandidate(candidate, context, kernel, [ev8]).success, false);

    // 9. Correct proof from earlier artifact version (rejected)
    const ev9 = kernel.emitEvidence("TEST_SUITE_VERIFIER", "m-conf", "PROMAX", {
      criterionId: "ac-1",
      testRequirementId: "tr-1",
      targetFile: "src/index.ts",
      sha256: "OLD_MUTATED_ARTIFACT_HASH",
      proofKind: "QUALIFICATION_PROOF",
    });
    assert.equal(verifier.verifyCandidate(candidate, context, kernel, [ev9]).success, false);

    // 10. Proof explicitly bound to ac-1 cannot qualify ac-2 (rejected)
    const ev10 = kernel.emitEvidence("TEST_SUITE_VERIFIER", "m-conf", "PROMAX", {
      criterionId: "ac-1",
      testRequirementId: "tr-1",
      proofKind: "QUALIFICATION_PROOF",
    });
    const contextAc2: ContractBoundStageContext = {
      ...context,
      frozenPlanContract: {
        ...context.frozenPlanContract,
        acceptanceCriteria: [{ id: "ac-2", description: "AC2", verificationMethod: "TEST", required: true, requiredRequirementId: "tr-2" }],
      },
    };
    assert.equal(verifier.verifyCandidate(candidate, contextAc2, kernel, [ev10]).success, false);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("P0-P7 REGRESSION: COLONY_A / LEGGO Claim/Traceability Evidence Cannot Prove Behavioral Criterion", () => {
  const ws = tempWorkspace("bug-p0p7");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });
    const verifier = new ProMaxVerifier();
    const packager = new LabPackager();

    const leggoRelPath = "workspaces/v2-missions/m-bug7/leggo-integrated";
    kernel.safeWriteWorkspaceFile(`${leggoRelPath}/package.json`, JSON.stringify({ name: "bug7", version: "1.0.0", scripts: { build: "npm --version", test: "npm --version" } }), "m-bug7");
    kernel.safeWriteWorkspaceFile(`${leggoRelPath}/src/index.ts`, "export const x = 1;", "m-bug7");

    const content = "export const x = 1;";
    const hash = createHash("sha256").update(content).digest("hex");

    const candidate: IntegratedCandidate = {
      candidateId: "cand-bug7",
      missionId: "m-bug7",
      integratedArtifacts: [{ artifactId: "a1", path: "src/index.ts", sha256: hash, sizeBytes: content.length, missionId: "m-bug7" }],
      resolvedConflicts: [],
      sourceTraceability: { "src/index.ts": "COLONY_A" },
      workspacePath: leggoRelPath,
    };

    const context: ContractBoundStageContext = {
      missionId: "m-bug7",
      authoritativeInputs: [],
      policyVersions: ["v1.0.0"],
      budgets: { virtualTicks: 100, providerCalls: 10, maxFixAttempts: 3 },
      evidenceRefs: [],
      missionStateRef: "VERIFYING",
      executionMode: "DETERMINISTIC_FIXTURE_MODE",
      contractPhase: "CONTRACT_BOUND",
      frozenPlanContract: {
        contractId: "c1",
        version: "v1.0.0",
        contractHash: "h1",
        objective: "Obj",
        acceptanceCriteria: [
          { id: "ac-x", description: "Invalid email addresses are rejected", verificationMethod: "TEST", required: true },
        ],
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

    // COLONY_A evidence claiming ac-x (proofKind: CLAIM)
    const colonyClaimEv = kernel.emitEvidence("COLONY_A", "m-bug7", "COLONY_AB", {
      workPackageId: "wp-1",
      targetFile: "src/index.ts",
      sha256: hash,
      criterionId: "ac-x",
      acceptanceCriteria: ["ac-x"],
      proofKind: "CLAIM",
    });

    // LEGGO evidence containing ac-x (proofKind: TRACEABILITY)
    const leggoTraceEv = kernel.emitEvidence("LEGGO", "m-bug7", "LEGGO", {
      candidateId: "cand-bug7",
      targetFile: "src/index.ts",
      sha256: hash,
      acceptanceCriteria: ["ac-x"],
      proofKind: "TRACEABILITY",
    });

    // Run ProMax with CLAIM and TRACEABILITY evidence in pool
    const result = verifier.verifyCandidate(candidate, context, kernel, [colonyClaimEv, leggoTraceEv]);

    // MUST evaluate ac-x as UNVERIFIED because producer CLAIM/TRACEABILITY is NOT QUALIFICATION_PROOF!
    assert.equal(result.success, false, "Producer CLAIM/TRACEABILITY evidence MUST NOT prove criterion");
    assert.equal(result.assessment.contractSatisfied, false);

    const proof = result.proofMappings.find((p) => p.criterionId === "ac-x");
    assert.equal(proof !== undefined, true);
    assert.equal(proof?.status, "UNVERIFIED");

    // Lab MUST refuse packaging
    const labResult = packager.packageDeliverables(candidate, result.assessment, context, kernel, [colonyClaimEv, leggoTraceEv]);
    assert.equal(labResult.success, false);
    assert.equal(labResult.reasonCode.startsWith("NAMLA_LAB_REFUSED"), true);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("P0-P8: Comprehensive Provenance Attack Matrix Rejection Suite", () => {
  const ws = tempWorkspace("prov-matrix");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });
    const verifier = new ProMaxVerifier();

    const leggoRelPath = "workspaces/v2-missions/m-prov/leggo-integrated";
    kernel.safeWriteWorkspaceFile(`${leggoRelPath}/src/index.ts`, "export const x = 1;", "m-prov");

    const content = "export const x = 1;";
    const hashCurrent = createHash("sha256").update(content).digest("hex");

    const candidate: IntegratedCandidate = {
      candidateId: "cand-prov",
      missionId: "m-prov",
      integratedArtifacts: [{ artifactId: "a1", path: "src/index.ts", sha256: hashCurrent, sizeBytes: content.length, missionId: "m-prov" }],
      resolvedConflicts: [],
      sourceTraceability: { "src/index.ts": "COLONY_A" },
      workspacePath: leggoRelPath,
    };

    const context: ContractBoundStageContext = {
      missionId: "m-prov",
      authoritativeInputs: [],
      policyVersions: ["v1.0.0"],
      budgets: { virtualTicks: 100, providerCalls: 10, maxFixAttempts: 3 },
      evidenceRefs: [],
      missionStateRef: "VERIFYING",
      executionMode: "DETERMINISTIC_FIXTURE_MODE",
      contractPhase: "CONTRACT_BOUND",
      frozenPlanContract: {
        contractId: "c1",
        version: "v1.0.0",
        contractHash: "h1",
        objective: "Obj",
        acceptanceCriteria: [
          { id: "ac-1", description: "Test requirement 1", verificationMethod: "TEST", required: true },
        ],
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

    // 1. COLONY_A self-claiming criterion (rejected)
    const ev1 = kernel.emitEvidence("COLONY_A", "m-prov", "COLONY_AB", { criterionId: "ac-1", proofKind: "CLAIM" });
    assert.equal(verifier.verifyCandidate(candidate, context, kernel, [ev1]).success, false);

    // 2. COLONY_B self-claiming criterion (rejected)
    const ev2 = kernel.emitEvidence("COLONY_B", "m-prov", "COLONY_AB", { criterionId: "ac-1", proofKind: "CLAIM" });
    assert.equal(verifier.verifyCandidate(candidate, context, kernel, [ev2]).success, false);

    // 3. LEGGO claiming criterion (rejected)
    const ev3 = kernel.emitEvidence("LEGGO", "m-prov", "LEGGO", { criterionId: "ac-1", proofKind: "TRACEABILITY" });
    assert.equal(verifier.verifyCandidate(candidate, context, kernel, [ev3]).success, false);

    // 4. Correct criterionId from unauthorized producer (rejected)
    const ev4 = kernel.emitEvidence("UNAUTHORIZED_SELF_PRODUCER", "m-prov", "STAGE", { criterionId: "ac-1", proofKind: "QUALIFICATION_PROOF" });
    assert.equal(verifier.verifyCandidate(candidate, context, kernel, [ev4]).success, false);

    // 5. Correct criterionId but wrong verifier category (BUILD_VERIFIER trying to satisfy TEST criterion - rejected)
    const ev5 = kernel.emitEvidence("BUILD_VERIFIER", "m-prov", "PROMAX", { criterionId: "ac-1", proofKind: "QUALIFICATION_PROOF" });
    assert.equal(verifier.verifyCandidate(candidate, context, kernel, [ev5]).success, false);

    // 6. Correct verifier category but wrong mission ID (rejected)
    const ev6 = kernel.emitEvidence("TEST_SUITE_VERIFIER", "WRONG_MISSION_ID", "PROMAX", { criterionId: "ac-1", proofKind: "QUALIFICATION_PROOF" });
    assert.equal(verifier.verifyCandidate(candidate, context, kernel, [ev6]).success, false);

    // 7. Correct verifier but old/mutated artifact hash (rejected)
    const ev7 = kernel.emitEvidence("TEST_SUITE_VERIFIER", "m-prov", "PROMAX", { criterionId: "ac-1", targetFile: "src/index.ts", sha256: "OLD_MUTATED_HASH_999", proofKind: "QUALIFICATION_PROOF" });
    assert.equal(verifier.verifyCandidate(candidate, context, kernel, [ev7]).success, false);

    // 8. Correct verifier but INVALIDATED status (rejected)
    const ev8Raw = kernel.emitEvidence("TEST_SUITE_VERIFIER", "m-prov", "PROMAX", { criterionId: "ac-1", proofKind: "QUALIFICATION_PROOF" });
    const ev8 = { ...ev8Raw, status: "INVALIDATED" as const };
    assert.equal(verifier.verifyCandidate(candidate, context, kernel, [ev8]).success, false);

    // 9. Proof for ac-1 replayed for ac-2 (rejected for ac-2)
    const contextAc2: ContractBoundStageContext = {
      ...context,
      frozenPlanContract: { ...context.frozenPlanContract, acceptanceCriteria: [{ id: "ac-2", description: "AC2", verificationMethod: "TEST", required: true }] },
    };
    const ev9 = kernel.emitEvidence("TEST_SUITE_VERIFIER", "m-prov", "PROMAX", { criterionId: "ac-1", proofKind: "QUALIFICATION_PROOF" });
    assert.equal(verifier.verifyCandidate(candidate, contextAc2, kernel, [ev9]).success, false);

    // 10. Traceability record mislabeled as qualification attempt without authorized producer (rejected)
    const ev10 = kernel.emitEvidence("COLONY_A", "m-prov", "COLONY_AB", { criterionId: "ac-1", proofKind: "QUALIFICATION_PROOF" });
    assert.equal(verifier.verifyCandidate(candidate, context, kernel, [ev10]).success, false);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

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

test("ADVERSARIAL: Unmapped Acceptance Criterion Remains UNVERIFIED & Fails ProMax Verification (P0-T2)", () => {
  const ws = tempWorkspace("unmapped-criterion");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });
    const verifier = new ProMaxVerifier();
    const packager = new LabPackager();

    kernel.safeWriteWorkspaceFile("workspaces/v2-missions/m-unmap/leggo-integrated/package.json", JSON.stringify({ name: "unmapped", version: "1.0.0", scripts: { build: "node -v", test: "node -v" } }), "m-unmap");
    kernel.safeWriteWorkspaceFile("workspaces/v2-missions/m-unmap/leggo-integrated/src/index.ts", "export const ok = true;", "m-unmap");

    const content = "export const ok = true;";
    const hash = createHash("sha256").update(content).digest("hex");

    const candidate: IntegratedCandidate = {
      candidateId: "cand-unmap",
      missionId: "m-unmap",
      integratedArtifacts: [{ artifactId: "a1", path: "src/index.ts", sha256: hash, sizeBytes: content.length, missionId: "m-unmap" }],
      resolvedConflicts: [],
      sourceTraceability: { "src/index.ts": "COLONY_A" },
      workspacePath: "workspaces/v2-missions/m-unmap/leggo-integrated",
    };

    const context: ContractBoundStageContext = {
      missionId: "m-unmap",
      authoritativeInputs: [],
      policyVersions: ["v1.0.0"],
      budgets: { virtualTicks: 100, providerCalls: 10, maxFixAttempts: 3 },
      evidenceRefs: [],
      missionStateRef: "VERIFYING",
      executionMode: "DETERMINISTIC_FIXTURE_MODE",
      contractPhase: "CONTRACT_BOUND",
      frozenPlanContract: {
        contractId: "c1",
        version: "v1.0.0",
        contractHash: "h1",
        objective: "Obj",
        acceptanceCriteria: [
          { id: "ac-unmapped-specific", description: "Invalid email addresses are rejected", verificationMethod: "TEST", required: true },
        ],
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

    // All generic checks (BUILD, TYPECHECK, TEST) pass, but no evidence exists for ac-unmapped-specific!
    const res = verifier.verifyCandidate(candidate, context, kernel, []);
    assert.equal(res.success, false, "Contract must NOT be satisfied when an acceptance criterion is unmapped");
    assert.equal(res.assessment.contractSatisfied, false);

    const unmappedProof = res.proofMappings.find((p) => p.criterionId === "ac-unmapped-specific");
    assert.equal(unmappedProof !== undefined, true);
    assert.equal(unmappedProof?.status, "UNVERIFIED");

    // Lab must refuse packaging
    const labRes = packager.packageDeliverables(candidate, res.assessment, context, kernel, []);
    assert.equal(labRes.success, false);
    assert.equal(labRes.reasonCode.startsWith("NAMLA_LAB_REFUSED"), true);
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
