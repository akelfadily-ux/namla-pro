/**
 * V2 ProMax Proof Mapping & Evidence Verification Tests (P0.1, P0.15, P0.16, P0.17, P0-T2, P0-P1..P0-P5).
 *
 * Verifies that ProMax requires evidence-backed proof mapping for every verified criterion,
 * independently recomputes SHA-256 hashes from raw file bytes to detect post-acceptance mutation,
 * checks stale evidence in evidencePool, and executes real verification commands.
 *
 * Run: node dist/tools/v2ProMaxProofMappingTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { resolve, join } from "path";
import { createHash } from "crypto";
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

    const leggoRelPath = "workspaces/v2-missions/m-promax/leggo-integrated";
    const content = "export const x = 1;\n";
    const sha256 = createHash("sha256").update(content).digest("hex");

    kernel.safeWriteWorkspaceFile(`${leggoRelPath}/src/index.ts`, content, "m-promax");

    const candidate: IntegratedCandidate = {
      candidateId: "cand-1",
      missionId: "m-promax",
      integratedArtifacts: [
        { artifactId: "art-1", path: "src/index.ts", sha256, sizeBytes: content.length, missionId: "m-promax" },
      ],
      resolvedConflicts: [],
      sourceTraceability: { "src/index.ts": "COLONY_A" },
      workspacePath: leggoRelPath,
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
        requiredTests: [{ id: "t1", name: "Version Check", command: "npm --version", expectedExitCode: 0, provesCriterionIds: ["ac-1"] }],
        securityRequirements: [{ id: "sec-1", rule: "NO_SECRET_LEAKAGE", failClosed: true }],
        expectedArtifacts: [],
        evidenceRequirements: [],
        riskClassification: "LOW",
        completionConditions: [],
        frozenAt: Date.now(),
      },
    };

    const acEv = kernel.emitEvidence("TEST_SUITE_VERIFIER", "m-promax", "PROMAX", {
      criterionId: "ac-1",
      targetFile: "src/index.ts",
      sha256,
      proofKind: "QUALIFICATION_PROOF",
    });

    const result = verifier.verifyCandidate(candidate, context, kernel, [acEv]);

    assert.equal(result.success, true);
    assert.equal(result.proofMappings.length >= 2, true, "Proof mappings must exist");

    const acMapping = result.proofMappings.find((m) => m.criterionId === "ac-1");
    assert.equal(acMapping !== undefined, true);
    assert.equal(acMapping?.status, "VERIFIED");
    assert.equal(acMapping?.evidenceRef.length! > 0, true);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("ProMaxVerifier: P0.16 Artifact Mutation / Substitution is Detected and Fails Verification", () => {
  const ws = tempWorkspace("artifact-mutation");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });
    const verifier = new ProMaxVerifier();

    const leggoRelPath = "workspaces/v2-missions/m-mut/leggo-integrated";
    const originalContent = "export const x = 1;\n";
    const originalHash = createHash("sha256").update(originalContent).digest("hex");

    // 1. Create accepted artifact identity with original hash
    kernel.safeWriteWorkspaceFile(`${leggoRelPath}/src/index.ts`, originalContent, "m-mut");

    const candidate: IntegratedCandidate = {
      candidateId: "cand-mut",
      missionId: "m-mut",
      integratedArtifacts: [
        { artifactId: "art-1", path: "src/index.ts", sha256: originalHash, sizeBytes: originalContent.length, missionId: "m-mut" },
      ],
      resolvedConflicts: [],
      sourceTraceability: { "src/index.ts": "COLONY_A" },
      workspacePath: leggoRelPath,
    };

    // 2. Mutate file on disk AFTER candidate creation!
    const mutatedContent = "export const x = 999; // MUTATED PAYLOAD\n";
    writeFileSync(resolve(join(ws, leggoRelPath, "src/index.ts")), mutatedContent, "utf8");

    const context: ContractBoundStageContext = {
      missionId: "m-mut",
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

    // 3. ProMax MUST recompute SHA-256 and detect mismatch
    const result = verifier.verifyCandidate(candidate, context, kernel, []);

    assert.equal(result.success, false, "ProMax MUST fail verification when artifact content is mutated");
    assert.equal(result.assessment.contractSatisfied, false);
    assert.equal(result.assessment.failedCriteria.some((f) => f.includes("Artifact substitution detected")), true);

    const mutMapping = result.proofMappings.find((m) => m.criterionId === "artifact-src/index.ts");
    assert.equal(mutMapping?.status, "FAILED");
    assert.equal(mutMapping?.observation.includes("ARTIFACT SUBSTITUTION DETECTED"), true);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("ProMaxVerifier: P0.17 Stale Evidence Fails Verification and Leaves Criteria Unverified", () => {
  const ws = tempWorkspace("stale-evidence");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });
    const verifier = new ProMaxVerifier();

    const leggoRelPath = "workspaces/v2-missions/m-stale/leggo-integrated";
    const content = "export const x = 1;\n";
    const sha256 = createHash("sha256").update(content).digest("hex");

    kernel.safeWriteWorkspaceFile(`${leggoRelPath}/src/index.ts`, content, "m-stale");

    const candidate: IntegratedCandidate = {
      candidateId: "cand-2",
      missionId: "m-stale",
      integratedArtifacts: [
        { artifactId: "art-1", path: "src/index.ts", sha256, sizeBytes: content.length, missionId: "m-stale" },
      ],
      resolvedConflicts: [],
      sourceTraceability: { "src/index.ts": "COLONY_A" },
      workspacePath: leggoRelPath,
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
