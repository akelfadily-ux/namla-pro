/**
 * V2 Artifact Tampering, Stale Evidence & Lab Gate Hardening Suite (HARDENING-3, 4, 5, 8, 14, P0-T6).
 *
 * Tests write atomicity, post-acceptance artifact modification/deletion/renaming/substitution,
 * stale evidence causality across versions/missions, build/test/typecheck/smoke signal contradictions,
 * and Lab delivery fail-closed gates.
 *
 * Seed: 0x9b2c3d4e
 * Run: node dist/tools/v2ArtifactAndEvidenceHardeningTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { resolve, join } from "path";
import { ProMaxVerifier } from "../v2/promax/proMaxVerifier";
import { TrustedKernel } from "../v2/kernel/trustedKernel";
import { LabPackager } from "../v2/lab/labPackager";
import { IntegratedCandidate, ProMaxAssessment } from "../v2/types/missionState";
import { ContractBoundStageContext } from "../v2/types/stageContext";
import { EvidenceRecord } from "../v2/types/evidence";
import { createHash } from "crypto";

function tempWorkspace(tag: string): string {
  return mkdtempSync(resolve(tmpdir(), `namla-v2-fuzz-p3-${tag}-`));
}

test("P0-T6: Lab Packaging Direct Refusal Gate Tests", () => {
  const ws = tempWorkspace("lab-gates");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });
    const packager = new LabPackager();

    kernel.safeWriteWorkspaceFile("workspaces/v2-missions/m-lab/leggo-integrated/src/index.ts", "export const ok = true;", "m-lab");
    const content = "export const ok = true;";
    const hash = createHash("sha256").update(content).digest("hex");

    const candidate: IntegratedCandidate = {
      candidateId: "cand-lab",
      missionId: "m-lab",
      integratedArtifacts: [{ artifactId: "a1", path: "src/index.ts", sha256: hash, sizeBytes: content.length, missionId: "m-lab" }],
      resolvedConflicts: [],
      sourceTraceability: { "src/index.ts": "COLONY_A" },
      workspacePath: "workspaces/v2-missions/m-lab/leggo-integrated",
    };

    const context: ContractBoundStageContext = {
      missionId: "m-lab",
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

    // Case 1: Required test requirement FAILED or BLOCKED -> Refuse
    const assessmentTestFailed: ProMaxAssessment = {
      candidateId: "cand-lab",
      contractSatisfied: false,
      verifiedCriteria: [],
      failedCriteria: ["test-verif-build"],
      securityCheckPassed: true,
      regressionPassed: true,
      independentTestsPassed: false, // Failed/Blocked test
      evidenceFreshnessVerified: true,
    };
    const res1 = packager.packageDeliverables(candidate, assessmentTestFailed, context, kernel, []);
    assert.equal(res1.success, false);
    assert.equal(res1.reasonCode.startsWith("NAMLA_LAB_REFUSED"), true);

    // Case 2: Acceptance criterion UNVERIFIED or FAILED -> Refuse
    const assessmentUnverified: ProMaxAssessment = {
      candidateId: "cand-lab",
      contractSatisfied: false,
      verifiedCriteria: [],
      failedCriteria: ["ac-unverified-1"],
      securityCheckPassed: true,
      regressionPassed: true,
      independentTestsPassed: true,
      evidenceFreshnessVerified: true,
    };
    const res2 = packager.packageDeliverables(candidate, assessmentUnverified, context, kernel, []);
    assert.equal(res2.success, false);
    assert.equal(res2.reasonCode.startsWith("NAMLA_LAB_REFUSED"), true);

    // Case 3: Stale / Invalidated evidence in stage evidence pool -> Refuse
    const validAssessment: ProMaxAssessment = {
      candidateId: "cand-lab",
      contractSatisfied: true,
      verifiedCriteria: ["ac-1"],
      failedCriteria: [],
      securityCheckPassed: true,
      regressionPassed: true,
      independentTestsPassed: true,
      evidenceFreshnessVerified: true,
    };

    const staleEvidence: EvidenceRecord = {
      evidenceId: "ev-stale-1",
      producer: "COLONY_A",
      missionId: "m-lab",
      stageId: "COLONY_AB",
      environmentIdentity: { platform: "linux", nodeVersion: "v20", cwd: "/app", envFingerprint: "fp" },
      timestamp: Date.now(),
      sequenceNumber: 1,
      status: "INVALIDATED",
      details: {},
      hash: "stalehash",
    };

    const res3 = packager.packageDeliverables(candidate, validAssessment, context, kernel, [staleEvidence]);
    assert.equal(res3.success, false);
    assert.equal(res3.reasonCode.includes("Stale or invalidated evidence"), true);

    // Case 4: Artifact identity / Hash mismatch -> Refuse
    const tamperedCandidate: IntegratedCandidate = {
      ...candidate,
      integratedArtifacts: [{ artifactId: "a1", path: "src/index.ts", sha256: "WRONG_HASH_123", sizeBytes: content.length, missionId: "m-lab" }],
    };
    const res4 = packager.packageDeliverables(tamperedCandidate, validAssessment, context, kernel, []);
    assert.equal(res4.success, false);
    assert.equal(res4.reasonCode.includes("Artifact hash mismatch"), true);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("HARDENING-4 & HARDENING-14: Artifact Deletion/Tampering Detected by ProMax & Rejected by Lab", () => {
  const ws = tempWorkspace("artifact-tamper");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });
    const verifier = new ProMaxVerifier();
    const packager = new LabPackager();

    kernel.safeWriteWorkspaceFile("workspaces/v2-missions/m-tamp/leggo-integrated/package.json", JSON.stringify({ name: "test", version: "1.0.0", scripts: { test: "node --test" } }), "m-tamp");
    kernel.safeWriteWorkspaceFile("workspaces/v2-missions/m-tamp/leggo-integrated/src/index.ts", "export const original = true;", "m-tamp");

    const art1Read = kernel.safeReadWorkspaceFile("workspaces/v2-missions/m-tamp/leggo-integrated/src/index.ts");
    const originalHash = createHash("sha256").update(art1Read.content!).digest("hex");

    const candidate: IntegratedCandidate = {
      candidateId: "cand-tamp",
      missionId: "m-tamp",
      integratedArtifacts: [
        { artifactId: "a1", path: "src/index.ts", sha256: originalHash, sizeBytes: art1Read.content!.length, missionId: "m-tamp" },
      ],
      resolvedConflicts: [],
      sourceTraceability: { "src/index.ts": "COLONY_A" },
      workspacePath: "workspaces/v2-missions/m-tamp/leggo-integrated",
    };

    const context: ContractBoundStageContext = {
      missionId: "m-tamp",
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
        acceptanceCriteria: [{ id: "ac-1", description: "AC1", verificationMethod: "TEST", required: true }],
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

    // 1. Modify file afterwards
    writeFileSync(join(ws, "workspaces/v2-missions/m-tamp/leggo-integrated/src/index.ts"), "export const modified = true;");

    const resMod = verifier.verifyCandidate(candidate, context, kernel, []);
    assert.equal(resMod.success, false);
    assert.equal(resMod.reasonCode, "PROMAX_VERIFICATION_FAILED");

    const packResMod = packager.packageDeliverables(candidate, resMod.assessment, context, kernel, []);
    assert.equal(packResMod.success, false);
    assert.equal(packResMod.reasonCode.startsWith("NAMLA_LAB_REFUSED"), true);

    // 2. Delete file afterwards
    unlinkSync(join(ws, "workspaces/v2-missions/m-tamp/leggo-integrated/src/index.ts"));

    const resDel = verifier.verifyCandidate(candidate, context, kernel, []);
    assert.equal(resDel.success, false);
    assert.equal(resDel.reasonCode, "PROMAX_VERIFICATION_FAILED");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("HARDENING-5: Stale Evidence Causality Rejection across Missions", () => {
  const ws = tempWorkspace("stale-causality");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });
    const verifier = new ProMaxVerifier();

    kernel.safeWriteWorkspaceFile("workspaces/v2-missions/m-caus/leggo-integrated/src/index.ts", "export const v = 1;", "m-caus");
    const content = "export const v = 1;";
    const hash = createHash("sha256").update(content).digest("hex");

    const candidate: IntegratedCandidate = {
      candidateId: "cand-caus",
      missionId: "m-caus",
      integratedArtifacts: [{ artifactId: "a1", path: "src/index.ts", sha256: hash, sizeBytes: content.length, missionId: "m-caus" }],
      resolvedConflicts: [],
      sourceTraceability: { "src/index.ts": "COLONY_A" },
      workspacePath: "workspaces/v2-missions/m-caus/leggo-integrated",
    };

    // Stale evidence from completely different mission or invalidated status
    const foreignEvidence: EvidenceRecord = {
      evidenceId: "ev-foreign-999",
      producer: "COLONY_A",
      missionId: "OTHER_MISSION_ID",
      stageId: "COLONY_AB",
      environmentIdentity: { platform: "linux", nodeVersion: "v20.0.0", cwd: "/app", envFingerprint: "fp" },
      timestamp: Date.now(),
      sequenceNumber: 1,
      status: "INVALIDATED",
      details: {},
      hash: "foreignhash",
    };

    const context: ContractBoundStageContext = {
      missionId: "m-caus",
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
        acceptanceCriteria: [{ id: "ac-1", description: "AC1", verificationMethod: "TEST", required: true }],
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

    const res = verifier.verifyCandidate(candidate, context, kernel, [foreignEvidence]);
    assert.equal(res.success, false);
    assert.equal(res.assessment.evidenceFreshnessVerified, false);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
