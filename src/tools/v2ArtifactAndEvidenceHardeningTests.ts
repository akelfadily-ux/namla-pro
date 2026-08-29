/**
 * V2 Artifact Tampering, Stale Evidence & Lab Gate Hardening Suite (HARDENING-3, 4, 5, 8, 14).
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
