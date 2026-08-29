/**
 * V2 ProMax Proof Mapping & Evidence Verification Tests (P0.1).
 *
 * Verifies that ProMax requires evidence-backed proof mapping for every verified criterion,
 * executes real verification commands via TrustedKernel, and leaves unsupported criteria unverified.
 *
 * Run: node dist/tools/v2ProMaxProofMappingTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { resolve } from "path";
import { ProMaxVerifier } from "../v2/promax/proMaxVerifier";
import { TrustedKernel } from "../v2/kernel/trustedKernel";
import { IntegratedCandidate } from "../v2/types/missionState";
import { ContractBoundStageContext } from "../v2/types/stageContext";

function tempWorkspace(tag: string): string {
  return mkdtempSync(resolve(tmpdir(), `namla-v2-promax-${tag}-`));
}

test("ProMaxVerifier: Generates Proof Mappings and Verifies Observed Evidence", () => {
  const ws = tempWorkspace("proof-map");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });
    const verifier = new ProMaxVerifier();

    // Write file into workspace
    kernel.safeWriteWorkspaceFile("src/index.ts", "export const x = 1;", "m-promax");

    const candidate: IntegratedCandidate = {
      candidateId: "cand-1",
      missionId: "m-promax",
      integratedArtifacts: [
        { artifactId: "art-1", path: "src/index.ts", sha256: "hash1", sizeBytes: 19, missionId: "m-promax" },
      ],
      resolvedConflicts: [],
      sourceTraceability: { "src/index.ts": "COLONY_A" },
      workspacePath: "workspaces/v2-missions/m-promax/leggo-integrated",
    };

    const context: ContractBoundStageContext = {
      missionId: "m-promax",
      authoritativeInputs: [],
      policyVersions: ["v1.0.0"],
      budgets: { virtualTicks: 100, providerCalls: 10, maxFixAttempts: 3 },
      evidenceRefs: [],
      missionStateRef: "VERIFYING",
      contractPhase: "CONTRACT_BOUND",
      frozenPlanContract: {
        contractId: "c1",
        version: "v1.0.0",
        contractHash: "h1",
        objective: "Build module",
        acceptanceCriteria: [
          { id: "ac-1", description: "Must compile", verificationMethod: "TEST", required: true },
        ],
        constraints: [],
        tasks: [],
        dependencies: [],
        allowedCapabilities: [],
        requiredTests: [],
        securityRequirements: [{ id: "sec-1", rule: "NO_SECRET_LEAKAGE", failClosed: true }],
        expectedArtifacts: [],
        evidenceRequirements: [],
        riskClassification: "LOW",
        completionConditions: [],
        frozenAt: Date.now(),
      },
    };

    const result = verifier.verifyCandidate(candidate, context, kernel, []);

    assert.equal(result.success, true);
    assert.equal(result.proofMappings.length >= 2, true, "Proof mappings must exist for artifacts, security, and criteria");

    const acMapping = result.proofMappings.find((m) => m.criterionId === "ac-1");
    assert.equal(acMapping !== undefined, true);
    assert.equal(acMapping?.status, "VERIFIED");
    assert.equal(acMapping?.evidenceRef.length! > 0, true, "EvidenceRef must not be empty");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("ProMaxVerifier: Stale Evidence Fails Verification and Leaves Criteria Unverified", () => {
  const ws = tempWorkspace("stale-evidence");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });
    const verifier = new ProMaxVerifier();

    kernel.safeWriteWorkspaceFile("src/index.ts", "export const x = 1;", "m-stale");

    const candidate: IntegratedCandidate = {
      candidateId: "cand-2",
      missionId: "m-stale",
      integratedArtifacts: [
        { artifactId: "art-1", path: "src/index.ts", sha256: "hash1", sizeBytes: 19, missionId: "m-stale" },
      ],
      resolvedConflicts: [],
      sourceTraceability: { "src/index.ts": "COLONY_A" },
      workspacePath: "workspaces/v2-missions/m-stale/leggo-integrated",
    };

    const context: ContractBoundStageContext = {
      missionId: "m-stale",
      authoritativeInputs: [],
      policyVersions: ["v1.0.0"],
      budgets: { virtualTicks: 100, providerCalls: 10, maxFixAttempts: 3 },
      evidenceRefs: [],
      missionStateRef: "VERIFYING",
      contractPhase: "CONTRACT_BOUND",
      frozenPlanContract: {
        contractId: "c1",
        version: "v1.0.0",
        contractHash: "h1",
        objective: "Build module",
        acceptanceCriteria: [
          { id: "ac-1", description: "Must compile", verificationMethod: "TEST", required: true },
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

    const staleEvidence = [
      {
        evidenceId: "ev-stale-99",
        producer: "COLONY_A",
        missionId: "m-stale",
        stageId: "COLONY_AB",
        environmentIdentity: { platform: "linux", nodeVersion: "v20", cwd: "/app", envFingerprint: "fp" },
        timestamp: Date.now(),
        sequenceNumber: 1,
        status: "INVALIDATED" as const,
        details: {},
        hash: "h-stale",
      },
    ];

    const result = verifier.verifyCandidate(candidate, context, kernel, staleEvidence);

    assert.equal(result.success, false, "Stale evidence must cause ProMax verification failure");
    assert.equal(result.assessment.evidenceFreshnessVerified, false);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
