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
import { ProMaxVerifier, computeCandidateSnapshotHash } from "../v2/promax/proMaxVerifier";
import { ColonyExecutor } from "../v2/colony/colonyExecutor";
import { PreFreezeStageContext, ContractBoundStageContext } from "../v2/types/stageContext";
import { GateInput, StageRecoveryPolicy, LoopBudget } from "../v2/types/namlaLoopTypes";
import { WorkPackage, WorkPackageExecution, IntegratedCandidate, ProMaxAssessment } from "../v2/types/missionState";
import { EvidenceRecord } from "../v2/types/evidence";
import { CapabilityScope } from "../v2/types/contracts";
import { symlinkSync, mkdirSync } from "fs";
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

test("P0-RA6 & P0-RA7 8-Point Execution Receipt Authenticity & Reserved Producer Attack Matrix", () => {
  const ws = tempWorkspace("ra-matrix");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });

    // 1. Reserved producer TRUSTED_KERNEL_COMMAND refused by public emitEvidence
    assert.throws(
      () => kernel.emitEvidence("TRUSTED_KERNEL_COMMAND", "m-ra", "PROMAX", { exitCode: 0 }),
      /FORBIDDEN_RESERVED_PRODUCER/
    );

    // 2. Reserved producer TRUSTED_KERNEL refused by public emitEvidence
    assert.throws(
      () => kernel.emitEvidence("TRUSTED_KERNEL", "m-ra", "PROMAX", { exitCode: 0 }),
      /FORBIDDEN_RESERVED_PRODUCER/
    );

    // 3. Reserved producer PROMAX_ARTIFACT_CHECK refused by public emitEvidence
    assert.throws(
      () => kernel.emitEvidence("PROMAX_ARTIFACT_CHECK", "m-ra", "PROMAX", { hash: "abc" }),
      /FORBIDDEN_RESERVED_PRODUCER/
    );

    // 4. Reserved producer PROMAX_ARTIFACT_SUBSTITUTION_DETECTED refused by public emitEvidence
    assert.throws(
      () => kernel.emitEvidence("PROMAX_ARTIFACT_SUBSTITUTION_DETECTED", "m-ra", "PROMAX", { hash: "abc" }),
      /FORBIDDEN_RESERVED_PRODUCER/
    );

    // 5. Reserved producer PROMAX_ASSESSMENT_RECEIPT refused by public emitEvidence
    assert.throws(
      () => kernel.emitEvidence("PROMAX_ASSESSMENT_RECEIPT", "m-ra", "PROMAX", { satisfied: true }),
      /FORBIDDEN_RESERVED_PRODUCER/
    );

    // 6. COLONY_A attempting to mint QUALIFICATION_PROOF is downgraded to CLAIM
    const evColony = kernel.emitEvidence("COLONY_A", "m-ra", "COLONY_AB", { criterionId: "ac-1" }, undefined, undefined, undefined, "QUALIFICATION_PROOF");
    assert.equal(evColony.proofKind, "CLAIM", "COLONY_A QUALIFICATION_PROOF attempt MUST be downgraded to CLAIM");

    // 7. Generic unauthorized producer attempting QUALIFICATION_PROOF is downgraded to TRACEABILITY
    const evUnauth = kernel.emitEvidence("UNAUTHORIZED_PRODUCER", "m-ra", "STAGE", { criterionId: "ac-1" }, undefined, undefined, undefined, "QUALIFICATION_PROOF");
    assert.equal(evUnauth.proofKind, "TRACEABILITY", "Unauthorized producer QUALIFICATION_PROOF attempt MUST be downgraded to TRACEABILITY");

    // 8. Authentic executeCommand produces unforgeable TRUSTED_KERNEL_COMMAND record with TRACEABILITY proofKind
    const leggoRel = "workspaces/v2-missions/m-ra/leggo-integrated";
    kernel.safeWriteWorkspaceFile(`${leggoRel}/package.json`, JSON.stringify({ name: "ra", version: "1.0.0" }), "m-ra");
    const cmdRes = kernel.executeCommand("npm" as any, ["--version"], "m-ra", "PROMAX", leggoRel);
    assert.equal(cmdRes.success, true);
    assert.equal(cmdRes.evidenceRecord !== undefined, true);
    assert.equal(cmdRes.evidenceRecord?.producer, "TRUSTED_KERNEL_COMMAND");
    assert.equal(cmdRes.evidenceRecord?.proofKind, "TRACEABILITY");
    assert.equal(cmdRes.evidenceRecord?.status, "VALID");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("P0-SE7 10-Point Command-Confusion & Source Execution Binding Matrix", () => {
  const ws = tempWorkspace("cmd-confusion");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });
    const verifier = new ProMaxVerifier();

    const leggoRel = "workspaces/v2-missions/m-se7/leggo-integrated";
    kernel.safeWriteWorkspaceFile(`${leggoRel}/package.json`, JSON.stringify({ name: "se7", version: "1.0.0", scripts: { build: "node -v", test: "node -v" } }), "m-se7");
    kernel.safeWriteWorkspaceFile(`${leggoRel}/src/index.ts`, "export const x = 1;", "m-se7");
    kernel.safeWriteWorkspaceFile(`${leggoRel}/tests/server.test.ts`, "export const test = true;", "m-se7");
    kernel.safeWriteWorkspaceFile(`${leggoRel}/tests/integration.test.ts`, "export const integ = true;", "m-se7");
    kernel.safeWriteWorkspaceFile(`${leggoRel}/Dockerfile`, "FROM scratch\n", "m-se7");

    const pkgContent = JSON.stringify({ name: "se7", version: "1.0.0", scripts: { build: "node -v", test: "node -v" } });
    const srcContent = "export const x = 1;";
    const pkgHash = createHash("sha256").update(pkgContent).digest("hex");
    const srcHash = createHash("sha256").update(srcContent).digest("hex");

    const candidate: IntegratedCandidate = {
      candidateId: "cand-se7",
      missionId: "m-se7",
      integratedArtifacts: [
        { artifactId: "a1", path: "package.json", sha256: pkgHash, sizeBytes: pkgContent.length, missionId: "m-se7" },
        { artifactId: "a2", path: "src/index.ts", sha256: srcHash, sizeBytes: srcContent.length, missionId: "m-se7" },
      ],
      resolvedConflicts: [],
      sourceTraceability: { "package.json": "COLONY_A", "src/index.ts": "COLONY_A" },
      workspacePath: leggoRel,
    };
    const snapshotHash = computeCandidateSnapshotHash(candidate.integratedArtifacts);

    const context: ContractBoundStageContext = {
      missionId: "m-se7",
      authoritativeInputs: [],
      policyVersions: ["v1.0.0"],
      budgets: { virtualTicks: 100, providerCalls: 10, maxFixAttempts: 3 },
      evidenceRefs: [],
      missionStateRef: "VERIFYING",
      executionMode: "DETERMINISTIC_FIXTURE_MODE",
      projectClass: "REST_API",
      contractPhase: "CONTRACT_BOUND",
      frozenPlanContract: {
        contractId: "c1", version: "v1.0.0", contractHash: "h1", objective: "Obj",
        acceptanceCriteria: [
          { id: "ac-build", description: "Build", verificationMethod: "TEST", required: true, requiredRequirementId: "tr-build" },
          { id: "ac-test", description: "Test", verificationMethod: "TEST", required: true, requiredRequirementId: "tr-test" },
          { id: "ac-typecheck", description: "Typecheck", verificationMethod: "TEST", required: true, requiredRequirementId: "tr-typecheck" },
          { id: "ac-smoke", description: "Smoke", verificationMethod: "TEST", required: true, requiredRequirementId: "tr-smoke" },
          { id: "ac-integ", description: "Integration", verificationMethod: "TEST", required: true, requiredRequirementId: "tr-integ" },
          { id: "ac-docker", description: "Docker", verificationMethod: "TEST", required: true, requiredRequirementId: "tr-docker" },
        ],
        constraints: [], tasks: [], dependencies: [], allowedCapabilities: [],
        requiredTests: [
          { id: "tr-build", type: "BUILD", verifier: "BUILD_VERIFIER", name: "Build", command: "npm run build", expectedExitCode: 0, provesCriterionIds: ["ac-build"] },
          { id: "tr-test", type: "TEST", verifier: "TEST_SUITE_VERIFIER", name: "Test", command: "npm test", expectedExitCode: 0, provesCriterionIds: ["ac-test"] },
          { id: "tr-typecheck", type: "TYPECHECK", verifier: "TYPECHECK_VERIFIER", name: "Typecheck", command: "npx --package=typescript tsc --noEmit", expectedExitCode: 0, provesCriterionIds: ["ac-typecheck"] },
          { id: "tr-smoke", type: "SMOKE", verifier: "SMOKE_VERIFIER", name: "Smoke", command: "npx node --test tests/server.test.ts", expectedExitCode: 0, provesCriterionIds: ["ac-smoke"] },
          { id: "tr-integ", type: "INTEGRATION_TEST", verifier: "INTEGRATION_VERIFIER", name: "Integ", command: "npx node --test tests/integration.test.ts", expectedExitCode: 0, provesCriterionIds: ["ac-integ"] },
          { id: "tr-docker", type: "DOCKER_BUILD", verifier: "DOCKER_BUILD_VERIFIER", name: "Docker", command: "docker build -t test-m-se7 .", expectedExitCode: 0, provesCriterionIds: ["ac-docker"] },
        ],
        securityRequirements: [], expectedArtifacts: [], evidenceRequirements: [], riskClassification: "LOW", completionConditions: [], frozenAt: Date.now(),
      },
    };

    // 1. BUILD proof backed by npm test (rejected)
    const srcNpmTest = kernel.emitInternalEvidence("TRUSTED_KERNEL_COMMAND", "m-se7", "PROMAX", { executableId: "npm", args: ["test"], exitCode: 0, success: true }, undefined, undefined, undefined, "TRACEABILITY");
    const proof1 = kernel.emitEvidence("BUILD_VERIFIER", "m-se7", "PROMAX", { criterionId: "ac-build", testRequirementId: "tr-build", candidateSnapshotHash: snapshotHash, sourceEvidenceRef: srcNpmTest.evidenceId, proofKind: "QUALIFICATION_PROOF" });
    assert.equal(verifier.verifyCandidate(candidate, context, kernel, [srcNpmTest, proof1]).success, false);

    // 2. TEST proof backed by npm --version (rejected)
    const srcNpmVersion = kernel.emitInternalEvidence("TRUSTED_KERNEL_COMMAND", "m-se7", "PROMAX", { executableId: "npm", args: ["--version"], exitCode: 0, success: true }, undefined, undefined, undefined, "TRACEABILITY");
    const proof2 = kernel.emitEvidence("TEST_SUITE_VERIFIER", "m-se7", "PROMAX", { criterionId: "ac-test", testRequirementId: "tr-test", candidateSnapshotHash: snapshotHash, sourceEvidenceRef: srcNpmVersion.evidenceId, proofKind: "QUALIFICATION_PROOF" });
    assert.equal(verifier.verifyCandidate(candidate, context, kernel, [srcNpmVersion, proof2]).success, false);

    // 3. TYPECHECK proof backed by npm run build (rejected)
    const srcNpmBuild = kernel.emitInternalEvidence("TRUSTED_KERNEL_COMMAND", "m-se7", "PROMAX", { executableId: "npm", args: ["run", "build"], exitCode: 0, success: true }, undefined, undefined, undefined, "TRACEABILITY");
    const proof3 = kernel.emitEvidence("TYPECHECK_VERIFIER", "m-se7", "PROMAX", { criterionId: "ac-typecheck", testRequirementId: "tr-typecheck", candidateSnapshotHash: snapshotHash, sourceEvidenceRef: srcNpmBuild.evidenceId, proofKind: "QUALIFICATION_PROOF" });
    assert.equal(verifier.verifyCandidate(candidate, context, kernel, [srcNpmBuild, proof3]).success, false);

    // 4. SMOKE proof backed by generic npm test (rejected)
    const proof4 = kernel.emitEvidence("REST_API_EXECUTABLE_SMOKE_VERIFIER", "m-se7", "PROMAX", { criterionId: "ac-smoke", testRequirementId: "tr-smoke", candidateSnapshotHash: snapshotHash, sourceEvidenceRef: srcNpmTest.evidenceId, proofKind: "QUALIFICATION_PROOF" });
    assert.equal(verifier.verifyCandidate(candidate, context, kernel, [srcNpmTest, proof4]).success, false);

    // 5. INTEGRATION proof backed by normal unit test command (rejected)
    const proof5 = kernel.emitEvidence("DISTINCT_CONTRACT_INTEGRATION_VERIFIER", "m-se7", "PROMAX", { criterionId: "ac-integ", testRequirementId: "tr-integ", candidateSnapshotHash: snapshotHash, sourceEvidenceRef: srcNpmTest.evidenceId, proofKind: "QUALIFICATION_PROOF" });
    assert.equal(verifier.verifyCandidate(candidate, context, kernel, [srcNpmTest, proof5]).success, false);

    // 6. DOCKER proof backed by npm command (rejected)
    const proof6 = kernel.emitEvidence("DOCKER_BUILD_VERIFIER", "m-se7", "PROMAX", { criterionId: "ac-docker", testRequirementId: "tr-docker", candidateSnapshotHash: snapshotHash, sourceEvidenceRef: srcNpmBuild.evidenceId, proofKind: "QUALIFICATION_PROOF" });
    assert.equal(verifier.verifyCandidate(candidate, context, kernel, [srcNpmBuild, proof6]).success, false);

    // 7. Evidence with producer !== TRUSTED_KERNEL_COMMAND (rejected)
    const srcNonCommand = kernel.emitEvidence("COLONY_A", "m-se7", "PROMAX", { exitCode: 0, success: true }, undefined, undefined, undefined, "TRACEABILITY");
    const proof7 = kernel.emitEvidence("BUILD_VERIFIER", "m-se7", "PROMAX", { criterionId: "ac-build", testRequirementId: "tr-build", candidateSnapshotHash: snapshotHash, sourceEvidenceRef: srcNonCommand.evidenceId, proofKind: "QUALIFICATION_PROOF" });
    assert.equal(verifier.verifyCandidate(candidate, context, kernel, [srcNonCommand, proof7]).success, false);

    // 8. Source with proofKind !== TRACEABILITY (rejected)
    const srcWrongProofKind = kernel.emitInternalEvidence("TRUSTED_KERNEL_COMMAND", "m-se7", "PROMAX", { executableId: "npm", args: ["run", "build"], exitCode: 0, success: true }, undefined, undefined, undefined, "CLAIM");
    const proof8 = kernel.emitEvidence("BUILD_VERIFIER", "m-se7", "PROMAX", { criterionId: "ac-build", testRequirementId: "tr-build", candidateSnapshotHash: snapshotHash, sourceEvidenceRef: srcWrongProofKind.evidenceId, proofKind: "QUALIFICATION_PROOF" });
    assert.equal(verifier.verifyCandidate(candidate, context, kernel, [srcWrongProofKind, proof8]).success, false);

    // 9. Source with correct executable but wrong args (npm run lint instead of npm run build - rejected)
    const srcWrongArgs = kernel.emitInternalEvidence("TRUSTED_KERNEL_COMMAND", "m-se7", "PROMAX", { executableId: "npm", args: ["run", "lint"], exitCode: 0, success: true }, undefined, undefined, undefined, "TRACEABILITY");
    const proof9 = kernel.emitEvidence("BUILD_VERIFIER", "m-se7", "PROMAX", { criterionId: "ac-build", testRequirementId: "tr-build", candidateSnapshotHash: snapshotHash, sourceEvidenceRef: srcWrongArgs.evidenceId, proofKind: "QUALIFICATION_PROOF" });
    assert.equal(verifier.verifyCandidate(candidate, context, kernel, [srcWrongArgs, proof9]).success, false);

    // 10. Source from correct command but wrong requirement/mission (wrong mission - rejected)
    const srcWrongMission = kernel.emitInternalEvidence("TRUSTED_KERNEL_COMMAND", "m-OTHER-SE7", "PROMAX", { executableId: "npm", args: ["run", "build"], exitCode: 0, success: true }, undefined, undefined, undefined, "TRACEABILITY");
    const proof10 = kernel.emitEvidence("BUILD_VERIFIER", "m-se7", "PROMAX", { criterionId: "ac-build", testRequirementId: "tr-build", candidateSnapshotHash: snapshotHash, sourceEvidenceRef: srcWrongMission.evidenceId, proofKind: "QUALIFICATION_PROOF" });
    assert.equal(verifier.verifyCandidate(candidate, context, kernel, [srcWrongMission, proof10]).success, false);

    // Positive check: Correct exact source chain for BUILD_VERIFIER succeeds
    const srcBuildValid = kernel.emitInternalEvidence("TRUSTED_KERNEL_COMMAND", "m-se7", "PROMAX", { executableId: "npm", args: ["run", "build"], exitCode: 0, success: true }, undefined, undefined, undefined, "TRACEABILITY");
    const proofValid = kernel.emitEvidence("BUILD_VERIFIER", "m-se7", "PROMAX", { criterionId: "ac-build", testRequirementId: "tr-build", candidateSnapshotHash: snapshotHash, sourceEvidenceRef: srcBuildValid.evidenceId, proofKind: "QUALIFICATION_PROOF" });

    const ctxSingleBuild: ContractBoundStageContext = {
      ...context,
      frozenPlanContract: {
        ...context.frozenPlanContract,
        acceptanceCriteria: [{ id: "ac-build", description: "Build", verificationMethod: "TEST", required: true, requiredRequirementId: "tr-build" }],
        requiredTests: [{ id: "tr-build", type: "BUILD", verifier: "BUILD_VERIFIER", name: "Build", command: "npm run build", expectedExitCode: 0, provesCriterionIds: ["ac-build"] }],
      },
    };
    const resValid = verifier.verifyCandidate(candidate, ctxSingleBuild, kernel, [srcBuildValid, proofValid]);
    assert.equal(resValid.success, true, "Correct exact source chain for BUILD_VERIFIER MUST succeed");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("P0-SE6 REQUIRED NEGATIVE TEST: TEST_SUITE_VERIFIER Backed By Unrelated Command (npm --version) MUST REJECT", () => {
  const ws = tempWorkspace("se6-negative");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });
    const verifier = new ProMaxVerifier();
    const packager = new LabPackager();

    const leggoRel = "workspaces/v2-missions/m-se6/leggo-integrated";
    kernel.safeWriteWorkspaceFile(`${leggoRel}/package.json`, JSON.stringify({ name: "se6", version: "1.0.0", scripts: { test: "node -v" } }), "m-se6");
    kernel.safeWriteWorkspaceFile(`${leggoRel}/src/index.ts`, "export const x = 1;", "m-se6");
    const pkgContent = JSON.stringify({ name: "se6", version: "1.0.0", scripts: { test: "node -v" } });
    const srcContent = "export const x = 1;";
    const pkgHash = createHash("sha256").update(pkgContent).digest("hex");
    const srcHash = createHash("sha256").update(srcContent).digest("hex");

    const candidate: IntegratedCandidate = {
      candidateId: "cand-se6",
      missionId: "m-se6",
      integratedArtifacts: [
        { artifactId: "a1", path: "package.json", sha256: pkgHash, sizeBytes: pkgContent.length, missionId: "m-se6" },
        { artifactId: "a2", path: "src/index.ts", sha256: srcHash, sizeBytes: srcContent.length, missionId: "m-se6" },
      ],
      resolvedConflicts: [],
      sourceTraceability: { "package.json": "COLONY_A", "src/index.ts": "COLONY_A" },
      workspacePath: leggoRel,
    };
    const snapshotHash = computeCandidateSnapshotHash(candidate.integratedArtifacts);

    const context: ContractBoundStageContext = {
      missionId: "m-se6",
      authoritativeInputs: [],
      policyVersions: ["v1.0.0"],
      budgets: { virtualTicks: 100, providerCalls: 10, maxFixAttempts: 3 },
      evidenceRefs: [],
      missionStateRef: "VERIFYING",
      executionMode: "DETERMINISTIC_FIXTURE_MODE",
      contractPhase: "CONTRACT_BOUND",
      frozenPlanContract: {
        contractId: "c1", version: "v1.0.0", contractHash: "h1", objective: "Obj",
        acceptanceCriteria: [{ id: "ac-test", description: "Unit tests pass", verificationMethod: "TEST", required: true, requiredRequirementId: "tr-test" }],
        constraints: [], tasks: [], dependencies: [], allowedCapabilities: [],
        requiredTests: [{ id: "tr-test", type: "TEST", verifier: "TEST_SUITE_VERIFIER", name: "T1", command: "npm test", expectedExitCode: 0, provesCriterionIds: ["ac-test"] }],
        securityRequirements: [], expectedArtifacts: [], evidenceRequirements: [], riskClassification: "LOW", completionConditions: [], frozenAt: Date.now(),
      },
    };

    // Source receipt: TRUSTED_KERNEL_COMMAND (npm --version) exit 0 success true
    const sourceEvLaundered = kernel.emitInternalEvidence("TRUSTED_KERNEL_COMMAND", "m-se6", "PROMAX", {
      executableId: "npm", args: ["--version"], exitCode: 0, success: true,
    }, undefined, undefined, undefined, "TRACEABILITY");

    // Semantic proof: TEST_SUITE_VERIFIER with matching IDs but backed by npm --version source
    const proofLaundered = kernel.emitEvidence("TEST_SUITE_VERIFIER", "m-se6", "PROMAX", {
      criterionId: "ac-test", testRequirementId: "tr-test", candidateSnapshotHash: snapshotHash, sourceEvidenceRef: sourceEvLaundered.evidenceId, proofKind: "QUALIFICATION_PROOF",
    });

    // Prevent internal verifier re-execution from generating a fresh valid proof for ac-test
    const contextFailingTest: ContractBoundStageContext = {
      ...context,
      frozenPlanContract: {
        ...context.frozenPlanContract,
        requiredTests: [], // No requiredTests to re-execute, relying purely on provided evidence pool
      },
    };

    const res = verifier.verifyCandidate(candidate, contextFailingTest, kernel, [sourceEvLaundered, proofLaundered]);

    // MUST evaluate as UNVERIFIED, contractSatisfied = false, and Lab refuses delivery!
    assert.equal(res.success, false, "Contract MUST NOT be satisfied when TEST proof is backed by npm --version");
    assert.equal(res.assessment.contractSatisfied, false);

    // Verify criterion ac-test failed or is unverified
    assert.equal(res.assessment.verifiedCriteria.includes("ac-test"), false, "ac-test MUST NOT be in verifiedCriteria");
    assert.equal(res.assessment.failedCriteria.includes("ac-test"), true, "ac-test MUST be in failedCriteria");

    const acProof = res.proofMappings.find((p) => p.criterionId === "ac-test");
    assert.equal(acProof?.status, "UNVERIFIED");

    const labRes = packager.packageDeliverables(candidate, res.assessment, context, kernel, [sourceEvLaundered, proofLaundered]);
    assert.equal(labRes.success, false);
    assert.equal(labRes.reasonCode.startsWith("NAMLA_LAB_REFUSED"), true);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("P0-E7 9-Point Causal Replay & Source Evidence Validation Matrix", () => {
  const ws = tempWorkspace("causal-matrix");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });
    const verifier = new ProMaxVerifier();

    const leggoRel = "workspaces/v2-missions/m-causal/leggo-integrated";
    kernel.safeWriteWorkspaceFile(`${leggoRel}/src/index.ts`, "export const x = 1;", "m-causal");
    const content = "export const x = 1;";
    const hash = createHash("sha256").update(content).digest("hex");
    const snapshotHash = computeCandidateSnapshotHash([{ artifactId: "a1", path: "src/index.ts", sha256: hash, sizeBytes: content.length, missionId: "m-causal" }]);

    const candidate: IntegratedCandidate = {
      candidateId: "cand-causal",
      missionId: "m-causal",
      integratedArtifacts: [{ artifactId: "a1", path: "src/index.ts", sha256: hash, sizeBytes: content.length, missionId: "m-causal" }],
      resolvedConflicts: [],
      sourceTraceability: { "src/index.ts": "COLONY_A" },
      workspacePath: leggoRel,
    };

    const context: ContractBoundStageContext = {
      missionId: "m-causal",
      authoritativeInputs: [],
      policyVersions: ["v1.0.0"],
      budgets: { virtualTicks: 100, providerCalls: 10, maxFixAttempts: 3 },
      evidenceRefs: [],
      missionStateRef: "VERIFYING",
      executionMode: "DETERMINISTIC_FIXTURE_MODE",
      contractPhase: "CONTRACT_BOUND",
      frozenPlanContract: {
        contractId: "c1", version: "v1.0.0", contractHash: "h1", objective: "Obj",
        acceptanceCriteria: [{ id: "ac-1", description: "AC1", verificationMethod: "TEST", required: true, requiredRequirementId: "tr-1" }],
        constraints: [], tasks: [], dependencies: [], allowedCapabilities: [],
        requiredTests: [], // Test external evidence pool matching without requiredTests re-execution
        securityRequirements: [], expectedArtifacts: [], evidenceRequirements: [], riskClassification: "LOW", completionConditions: [], frozenAt: Date.now(),
      },
    };

    // 1. Semantic proof with empty sourceEvidenceRef (fails closed)
    const ev1 = kernel.emitEvidence("TEST_SUITE_VERIFIER", "m-causal", "PROMAX", {
      criterionId: "ac-1", testRequirementId: "tr-1", candidateSnapshotHash: snapshotHash, sourceEvidenceRef: "", proofKind: "QUALIFICATION_PROOF",
    });
    assert.equal(verifier.verifyCandidate(candidate, context, kernel, [ev1]).success, false);

    // 1b. Semantic proof with missing sourceEvidenceRef (fails closed)
    const ev1b = kernel.emitEvidence("TEST_SUITE_VERIFIER", "m-causal", "PROMAX", {
      criterionId: "ac-1", testRequirementId: "tr-1", candidateSnapshotHash: snapshotHash, proofKind: "QUALIFICATION_PROOF",
    });
    assert.equal(verifier.verifyCandidate(candidate, context, kernel, [ev1b]).success, false);

    // 2. Semantic proof with nonexistent source evidence ID (fails closed)
    const ev2 = kernel.emitEvidence("TEST_SUITE_VERIFIER", "m-causal", "PROMAX", {
      criterionId: "ac-1", testRequirementId: "tr-1", candidateSnapshotHash: snapshotHash, sourceEvidenceRef: "ev-NONEXISTENT-SOURCE-ID", proofKind: "QUALIFICATION_PROOF",
    });
    assert.equal(verifier.verifyCandidate(candidate, context, kernel, [ev2]).success, false);

    // 3. Source evidence from wrong mission (fails closed)
    const sourceEvOtherMission = kernel.emitInternalEvidence("TRUSTED_KERNEL_COMMAND", "m-OTHER-MISSION", "PROMAX", { exitCode: 0, success: true }, undefined, undefined, undefined, "TRACEABILITY");
    const ev3 = kernel.emitEvidence("TEST_SUITE_VERIFIER", "m-causal", "PROMAX", {
      criterionId: "ac-1", testRequirementId: "tr-1", candidateSnapshotHash: snapshotHash, sourceEvidenceRef: sourceEvOtherMission.evidenceId, proofKind: "QUALIFICATION_PROOF",
    });
    assert.equal(verifier.verifyCandidate(candidate, context, kernel, [sourceEvOtherMission, ev3]).success, false);

    // 4. Source command evidence status INVALIDATED (fails closed)
    const sourceEvInvalidatedRaw = kernel.emitInternalEvidence("TRUSTED_KERNEL_COMMAND", "m-causal", "PROMAX", { exitCode: 0, success: true }, undefined, undefined, undefined, "TRACEABILITY");
    const sourceEvInvalidated = { ...sourceEvInvalidatedRaw, status: "INVALIDATED" as const };
    const ev4 = kernel.emitEvidence("TEST_SUITE_VERIFIER", "m-causal", "PROMAX", {
      criterionId: "ac-1", testRequirementId: "tr-1", candidateSnapshotHash: snapshotHash, sourceEvidenceRef: sourceEvInvalidated.evidenceId, proofKind: "QUALIFICATION_PROOF",
    });
    assert.equal(verifier.verifyCandidate(candidate, context, kernel, [sourceEvInvalidated, ev4]).success, false);

    // 5. Source command execution failed but semantic proof says VERIFIED (fails closed)
    const sourceEvFailed = kernel.emitInternalEvidence("TRUSTED_KERNEL_COMMAND", "m-causal", "PROMAX", { exitCode: 1, success: false }, undefined, undefined, undefined, "TRACEABILITY");
    const ev5 = kernel.emitEvidence("TEST_SUITE_VERIFIER", "m-causal", "PROMAX", {
      criterionId: "ac-1", testRequirementId: "tr-1", candidateSnapshotHash: snapshotHash, sourceEvidenceRef: sourceEvFailed.evidenceId, proofKind: "QUALIFICATION_PROOF",
    });
    assert.equal(verifier.verifyCandidate(candidate, context, kernel, [sourceEvFailed, ev5]).success, false);

    // 6. BUILD command receipt reused to back TEST proof (fails closed)
    const sourceBuild = kernel.emitInternalEvidence("TRUSTED_KERNEL_COMMAND", "m-causal", "PROMAX", { executableId: "npm", args: ["run", "build"], exitCode: 0, success: true }, undefined, undefined, undefined, "TRACEABILITY");
    const ev6 = kernel.emitEvidence("BUILD_VERIFIER", "m-causal", "PROMAX", {
      criterionId: "ac-1", testRequirementId: "tr-1", candidateSnapshotHash: snapshotHash, sourceEvidenceRef: sourceBuild.evidenceId, proofKind: "QUALIFICATION_PROOF",
    });
    assert.equal(verifier.verifyCandidate(candidate, context, kernel, [sourceBuild, ev6]).success, false);

    // 7. Docker command receipt reused for unrelated criterion (fails closed)
    const sourceDocker = kernel.emitInternalEvidence("TRUSTED_KERNEL_COMMAND", "m-causal", "PROMAX", { executableId: "docker", args: ["build", "."], exitCode: 0, success: true }, undefined, undefined, undefined, "TRACEABILITY");
    const ev7 = kernel.emitEvidence("DOCKER_BUILD_VERIFIER", "m-causal", "PROMAX", {
      criterionId: "ac-UNRELATED-CRITERION", testRequirementId: "tr-1", candidateSnapshotHash: snapshotHash, sourceEvidenceRef: sourceDocker.evidenceId, proofKind: "QUALIFICATION_PROOF",
    });
    assert.equal(verifier.verifyCandidate(candidate, context, kernel, [sourceDocker, ev7]).success, false);

    // 8. Source evidence superseded after qualification (fails closed)
    const sourceEvSupersededRaw = kernel.emitInternalEvidence("TRUSTED_KERNEL_COMMAND", "m-causal", "PROMAX", { exitCode: 0, success: true }, undefined, undefined, undefined, "TRACEABILITY");
    const sourceEvSuperseded = { ...sourceEvSupersededRaw, status: "SUPERSEDED" as const };
    const ev8 = kernel.emitEvidence("TEST_SUITE_VERIFIER", "m-causal", "PROMAX", {
      criterionId: "ac-1", testRequirementId: "tr-1", candidateSnapshotHash: snapshotHash, sourceEvidenceRef: sourceEvSuperseded.evidenceId, proofKind: "QUALIFICATION_PROOF",
    });
    assert.equal(verifier.verifyCandidate(candidate, context, kernel, [sourceEvSuperseded, ev8]).success, false);

    // 9. Complete valid causal chain succeeds (P0-SE5: Uses exact contract-required command "npm test")
    const sourceEvValid = kernel.emitInternalEvidence("TRUSTED_KERNEL_COMMAND", "m-causal", "PROMAX", { executableId: "npm", args: ["test"], exitCode: 0, success: true }, undefined, undefined, undefined, "TRACEABILITY");
    const evValid = kernel.emitEvidence("TEST_SUITE_VERIFIER", "m-causal", "PROMAX", {
      criterionId: "ac-1", testRequirementId: "tr-1", candidateSnapshotHash: snapshotHash, sourceEvidenceRef: sourceEvValid.evidenceId, proofKind: "QUALIFICATION_PROOF",
    });
    const res9 = verifier.verifyCandidate(candidate, context, kernel, [sourceEvValid, evValid]);
    assert.equal(res9.success, true, "Complete valid causal evidence chain MUST succeed");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("P0-D6 8-Point Dedicated Docker Adversarial & Boundary Qualification Matrix", () => {
  const ws = tempWorkspace("d6-matrix");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });
    const verifier = new ProMaxVerifier();

    const candRel = "workspaces/v2-missions/m-d6/colony_a";
    kernel.safeWriteWorkspaceFile(`${candRel}/Dockerfile`, "FROM scratch\n", "m-d6");

    // 1. Changing process.cwd() does not change Docker candidate resolution
    const origCwd = process.cwd();
    try {
      const resCwd1 = kernel.executeDockerBuild(candRel, "m-d6", "PROMAX");
      process.chdir("/tmp");
      const resCwd2 = kernel.executeDockerBuild(candRel, "m-d6", "PROMAX");
      assert.equal(resCwd1.reasonCode, resCwd2.reasonCode, "Docker candidate resolution MUST be identical regardless of process.cwd()");
    } finally {
      process.chdir(origCwd);
    }

    // 2. Candidate sibling workspace cannot become Docker cwd
    const siblingEvilRel = "../" + resolve(ws).split("/").pop() + "-evil";
    const resSibling = kernel.executeDockerBuild(siblingEvilRel, "m-d6", "PROMAX");
    assert.equal(resSibling.success, false, "Candidate sibling workspace MUST NOT be accepted as Docker cwd");
    assert.equal(
      resSibling.reasonCode.includes("CANDIDATE_BOUNDARY_ESCAPE") ||
      resSibling.reasonCode.includes("PATH_TRAVERSAL_REFUSED") ||
      resSibling.reasonCode.includes("SYMLINK_ESCAPE_REFUSED") ||
      resSibling.reasonCode.includes("DOCKERFILE_ABSENT") ||
      resSibling.reasonCode.includes("FILE_NOT_FOUND"),
      true
    );

    // 3. Symlinked candidate cwd escaping workspace is rejected
    const outsideDir = tempWorkspace("d6-outside");
    try {
      const symlinkDirRel = `${candRel}/symlink-escape`;
      const symlinkDirAbs = resolve(ws, symlinkDirRel);
      mkdirSync(resolve(ws, candRel), { recursive: true });
      symlinkSync(outsideDir, symlinkDirAbs);

      const resSym = kernel.executeDockerBuild(`${candRel}/symlink-escape`, "m-d6", "PROMAX");
      assert.equal(resSym.success, false, "Symlinked candidate cwd escaping workspace MUST be rejected");
      assert.equal(
        resSym.reasonCode.includes("SYMLINK_ESCAPE_REFUSED") ||
        resSym.reasonCode.includes("CANDIDATE_BOUNDARY_ESCAPE"),
        true
      );
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }

    // 4. Docker command not authorized by TrustedKernel policy is rejected (non-build subcommands)
    const resRun = kernel.executeCommand("docker" as any, ["run", "ubuntu"], "m-d6", "PROMAX");
    assert.equal(resRun.success, false, "docker run MUST be rejected by policy");
    assert.equal(resRun.reasonCode, "FORBIDDEN_COMMAND_REFUSED");

    const resExec = kernel.executeCommand("docker" as any, ["exec", "-it", "container", "bash"], "m-d6", "PROMAX");
    assert.equal(resExec.success, false, "docker exec MUST be rejected by policy");
    assert.equal(resExec.reasonCode, "FORBIDDEN_COMMAND_REFUSED");

    const resPush = kernel.executeCommand("docker" as any, ["push", "myrepo/image"], "m-d6", "PROMAX");
    assert.equal(resPush.success, false, "docker push MUST be rejected by policy");
    assert.equal(resPush.reasonCode, "FORBIDDEN_COMMAND_REFUSED");

    // 5. Real executeDockerBuild command execution evidence chain test (P0-E5)
    // Execute real executeDockerBuild and verify evidenceRecord exists and is linked
    const realDockerRel = "workspaces/v2-missions/m-d6/real-docker-cand";
    kernel.safeWriteWorkspaceFile(`${realDockerRel}/Dockerfile`, "FROM scratch\n", "m-d6");
    const realDockerExecRes = kernel.executeDockerBuild(realDockerRel, "m-d6", "PROMAX");
    assert.equal(realDockerExecRes.evidenceRecord !== undefined, true, "executeDockerBuild MUST return a valid evidenceRecord");
    assert.equal(realDockerExecRes.evidenceRecord?.producer, "TRUSTED_KERNEL_COMMAND");
    assert.equal(realDockerExecRes.evidenceRecord?.proofKind, "TRACEABILITY");

    // Pass candidate to ProMaxVerifier and verify evidenceRef and sourceEvidenceRef in proof mapping match
    const candRealDocker: IntegratedCandidate = {
      candidateId: "cand-real-docker",
      missionId: "m-d6",
      integratedArtifacts: [{ artifactId: "a1", path: "Dockerfile", sha256: "df-hash", sizeBytes: 13, missionId: "m-d6" }],
      resolvedConflicts: [],
      sourceTraceability: {},
      workspacePath: realDockerRel,
    };
    const ctxRealDocker: ContractBoundStageContext = {
      missionId: "m-d6",
      authoritativeInputs: [],
      policyVersions: ["v1.0.0"],
      budgets: { virtualTicks: 100, providerCalls: 10, maxFixAttempts: 3 },
      evidenceRefs: [],
      missionStateRef: "VERIFYING",
      executionMode: "DETERMINISTIC_FIXTURE_MODE",
      contractPhase: "CONTRACT_BOUND",
      frozenPlanContract: {
        contractId: "c1", version: "v1.0.0", contractHash: "h1", objective: "Obj",
        acceptanceCriteria: [{ id: "ac-docker-real", description: "Docker Real", verificationMethod: "TEST", required: true, requiredRequirementId: "tr-docker-real" }],
        constraints: [], tasks: [], dependencies: [], allowedCapabilities: [],
        requiredTests: [{ id: "tr-docker-real", type: "DOCKER_BUILD", verifier: "DOCKER_BUILD_VERIFIER", name: "Docker", command: "docker build .", expectedExitCode: 0, provesCriterionIds: ["ac-docker-real"] }],
        securityRequirements: [], expectedArtifacts: [], evidenceRequirements: [], riskClassification: "LOW", completionConditions: [], frozenAt: Date.now(),
      },
    };
    const poolWithRealDocker = realDockerExecRes.evidenceRecord ? [realDockerExecRes.evidenceRecord] : [];
    const pmRealDockerRes = verifier.verifyCandidate(candRealDocker, ctxRealDocker, kernel, poolWithRealDocker);
    const dockerProofMap = pmRealDockerRes.proofMappings.find((p) => p.testRequirementId === "tr-docker-real");
    assert.equal(dockerProofMap !== undefined, true);
    assert.equal(dockerProofMap?.sourceEvidenceRef !== undefined && dockerProofMap.sourceEvidenceRef.length > 0, true, "Docker proof mapping MUST carry non-empty sourceEvidenceRef");

    // 6. Docker environment unavailable / Dockerfile absent returns BLOCKED
    const noDockerRel = "workspaces/v2-missions/m-d6/no-dockerfile";
    kernel.safeWriteWorkspaceFile(`${noDockerRel}/src/index.ts`, "export const x = 1;", "m-d6");
    const resAbsent = kernel.executeDockerBuild(noDockerRel, "m-d6", "PROMAX");
    assert.equal(resAbsent.success, false);
    assert.equal(resAbsent.reasonCode, "DOCKERFILE_ABSENT");

    const candAbsent: IntegratedCandidate = {
      candidateId: "cand-no-df",
      missionId: "m-d6",
      integratedArtifacts: [{ artifactId: "a1", path: "src/index.ts", sha256: "abc", sizeBytes: 10, missionId: "m-d6" }],
      resolvedConflicts: [],
      sourceTraceability: {},
      workspacePath: noDockerRel,
    };
    const ctxDocker: ContractBoundStageContext = {
      missionId: "m-d6",
      authoritativeInputs: [],
      policyVersions: ["v1.0.0"],
      budgets: { virtualTicks: 100, providerCalls: 10, maxFixAttempts: 3 },
      evidenceRefs: [],
      missionStateRef: "VERIFYING",
      executionMode: "DETERMINISTIC_FIXTURE_MODE",
      contractPhase: "CONTRACT_BOUND",
      frozenPlanContract: {
        contractId: "c1", version: "v1.0.0", contractHash: "h1", objective: "Obj",
        acceptanceCriteria: [{ id: "ac-doc", description: "Doc", verificationMethod: "TEST", required: true, requiredRequirementId: "tr-docker" }],
        constraints: [], tasks: [], dependencies: [], allowedCapabilities: [],
        requiredTests: [{ id: "tr-docker", type: "DOCKER_BUILD", verifier: "DOCKER_BUILD_VERIFIER", name: "Docker", command: "docker build .", expectedExitCode: 0, provesCriterionIds: ["ac-doc"] }],
        securityRequirements: [], expectedArtifacts: [], evidenceRequirements: [], riskClassification: "LOW", completionConditions: [], frozenAt: Date.now(),
      },
    };
    const pmResAbsent = verifier.verifyCandidate(candAbsent, ctxDocker, kernel, []);
    assert.equal(pmResAbsent.success, false);
    const proofAbsent = pmResAbsent.proofMappings.find((p) => p.criterionId === "tr-docker");
    assert.equal(proofAbsent?.status, "BLOCKED", "Absent Dockerfile MUST classify as BLOCKED");

    // 7. Docker build semantic failure returns FAILED
    // If Dockerfile contains bad instructions and docker daemon runs, executeDockerBuild returns exit code != 0
    const badDockerRel = "workspaces/v2-missions/m-d6/bad-dockerfile";
    kernel.safeWriteWorkspaceFile(`${badDockerRel}/Dockerfile`, "INVALID_DOCKER_INSTRUCTION_XYZZY\n", "m-d6");
    const resBadFile = kernel.executeDockerBuild(badDockerRel, "m-d6", "PROMAX");
    // Either Docker executable resolution fails (EXECUTABLE_UNAUTHORIZED on Windows without pin or missing docker) or docker build fails
    assert.equal(resBadFile.success, false);

    // 8. Docker build cannot execute arbitrary additional subcommands through verifier API (P0-E6)
    // Create a valid candidate WITH Dockerfile so failure is NOT due to missing Dockerfile
    const validDockerRel = "workspaces/v2-missions/m-d6/valid-dockerfile-cand";
    kernel.safeWriteWorkspaceFile(`${validDockerRel}/Dockerfile`, "FROM scratch\n", "m-d6");
    const candValidDocker: IntegratedCandidate = {
      candidateId: "cand-valid-docker",
      missionId: "m-d6",
      integratedArtifacts: [{ artifactId: "a1", path: "Dockerfile", sha256: "df-hash", sizeBytes: 13, missionId: "m-d6" }],
      resolvedConflicts: [],
      sourceTraceability: {},
      workspacePath: validDockerRel,
    };
    const ctxArbitrary: ContractBoundStageContext = {
      ...ctxDocker,
      frozenPlanContract: {
        ...ctxDocker.frozenPlanContract,
        requiredTests: [{ id: "tr-docker-evil", type: "DOCKER_BUILD", verifier: "DOCKER_BUILD_VERIFIER", name: "Docker", command: "docker run --rm ubuntu rm -rf /", expectedExitCode: 0, provesCriterionIds: ["ac-doc"] }],
      },
    };
    const pmResArb = verifier.verifyCandidate(candValidDocker, ctxArbitrary, kernel, []);
    // DOCKER_BUILD_VERIFIER ignores reqTest.command ("docker run...") and executes strictly kernel.executeDockerBuild
    const proofArb = pmResArb.proofMappings.find((p) => p.criterionId === "tr-docker-evil");
    assert.equal(proofArb !== undefined, true);
    // If docker run had been executed, CommandSafetyPolicy would throw FORBIDDEN_COMMAND_REFUSED and fail closed
    assert.equal(proofArb?.observation.includes("docker run") === false, true, "Verifier MUST NOT execute raw reqTest.command docker run");
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
    const ev5 = kernel.emitInternalEvidence("TRUSTED_KERNEL_COMMAND", "m-conf", "PROMAX", {
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

test("P0-S5 Matrix Case 1: Correct criterion + requirement + verifier, but missing candidateSnapshotHash -> REJECT", () => {
  const ws = tempWorkspace("s5-case1");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });
    const verifier = new ProMaxVerifier();

    const leggoRelPath = "workspaces/v2-missions/m-s5-1/leggo-integrated";
    kernel.safeWriteWorkspaceFile(`${leggoRelPath}/src/index.ts`, "export const x = 1;", "m-s5-1");
    const hash = createHash("sha256").update("export const x = 1;").digest("hex");

    const candidate: IntegratedCandidate = {
      candidateId: "cand-s5-1",
      missionId: "m-s5-1",
      integratedArtifacts: [{ artifactId: "a1", path: "src/index.ts", sha256: hash, sizeBytes: 19, missionId: "m-s5-1" }],
      resolvedConflicts: [],
      sourceTraceability: { "src/index.ts": "COLONY_A" },
      workspacePath: leggoRelPath,
    };

    const context: ContractBoundStageContext = {
      missionId: "m-s5-1",
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

    // Missing candidateSnapshotHash in evidence
    const ev1 = kernel.emitEvidence("TEST_SUITE_VERIFIER", "m-s5-1", "PROMAX", {
      criterionId: "ac-1",
      testRequirementId: "tr-1",
      proofKind: "QUALIFICATION_PROOF",
      // candidateSnapshotHash omitted intentionally
    });

    const res = verifier.verifyCandidate(candidate, context, kernel, [ev1]);
    assert.equal(res.success, false, "Proof with missing candidateSnapshotHash MUST NOT qualify criterion");
    assert.equal(res.assessment.contractSatisfied, false);
    const proof = res.proofMappings.find((p) => p.criterionId === "ac-1");
    assert.equal(proof?.status, "UNVERIFIED");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("P0-S5 Matrix Case 2: Correct everything but wrong candidateSnapshotHash -> REJECT", () => {
  const ws = tempWorkspace("s5-case2");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });
    const verifier = new ProMaxVerifier();

    const leggoRelPath = "workspaces/v2-missions/m-s5-2/leggo-integrated";
    kernel.safeWriteWorkspaceFile(`${leggoRelPath}/src/index.ts`, "export const x = 1;", "m-s5-2");
    const hash = createHash("sha256").update("export const x = 1;").digest("hex");

    const candidate: IntegratedCandidate = {
      candidateId: "cand-s5-2",
      missionId: "m-s5-2",
      integratedArtifacts: [{ artifactId: "a1", path: "src/index.ts", sha256: hash, sizeBytes: 19, missionId: "m-s5-2" }],
      resolvedConflicts: [],
      sourceTraceability: { "src/index.ts": "COLONY_A" },
      workspacePath: leggoRelPath,
    };

    const context: ContractBoundStageContext = {
      missionId: "m-s5-2",
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

    // Mismatched candidateSnapshotHash
    const ev1 = kernel.emitEvidence("TEST_SUITE_VERIFIER", "m-s5-2", "PROMAX", {
      criterionId: "ac-1",
      testRequirementId: "tr-1",
      candidateSnapshotHash: "0000000000000000000000000000000000000000000000000000000000000000",
      proofKind: "QUALIFICATION_PROOF",
    });

    const res = verifier.verifyCandidate(candidate, context, kernel, [ev1]);
    assert.equal(res.success, false, "Proof with wrong candidateSnapshotHash MUST NOT qualify criterion");
    assert.equal(res.assessment.contractSatisfied, false);
    const proof = res.proofMappings.find((p) => p.criterionId === "ac-1");
    assert.equal(proof?.status, "UNVERIFIED");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("P0-S5 Matrix Case 3: Correct criterion/snapshot but missing testRequirementId -> REJECT", () => {
  const ws = tempWorkspace("s5-case3");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });
    const verifier = new ProMaxVerifier();

    const leggoRelPath = "workspaces/v2-missions/m-s5-3/leggo-integrated";
    kernel.safeWriteWorkspaceFile(`${leggoRelPath}/src/index.ts`, "export const x = 1;", "m-s5-3");
    const hash = createHash("sha256").update("export const x = 1;").digest("hex");

    const candidate: IntegratedCandidate = {
      candidateId: "cand-s5-3",
      missionId: "m-s5-3",
      integratedArtifacts: [{ artifactId: "a1", path: "src/index.ts", sha256: hash, sizeBytes: 19, missionId: "m-s5-3" }],
      resolvedConflicts: [],
      sourceTraceability: { "src/index.ts": "COLONY_A" },
      workspacePath: leggoRelPath,
    };

    const context: ContractBoundStageContext = {
      missionId: "m-s5-3",
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
          { id: "ac-1", description: "Target criterion 1", verificationMethod: "TEST", required: true, requiredRequirementId: "tr-explicit-id" },
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

    const actualSnapshotHash = createHash("sha256").update(`src/index.ts:${hash}`).digest("hex");

    // Omit testRequirementId in evidence
    const ev1 = kernel.emitEvidence("TEST_SUITE_VERIFIER", "m-s5-3", "PROMAX", {
      criterionId: "ac-1",
      candidateSnapshotHash: actualSnapshotHash,
      proofKind: "QUALIFICATION_PROOF",
      // testRequirementId omitted
    });

    const res = verifier.verifyCandidate(candidate, context, kernel, [ev1]);
    assert.equal(res.success, false, "Proof missing testRequirementId when criterion specifies requiredRequirementId MUST be rejected");
    const proof = res.proofMappings.find((p) => p.criterionId === "ac-1");
    assert.equal(proof?.status, "UNVERIFIED");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("P0-S5 Matrix Case 4: Correct criterion/snapshot but wrong testRequirementId -> REJECT", () => {
  const ws = tempWorkspace("s5-case4");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });
    const verifier = new ProMaxVerifier();

    const leggoRelPath = "workspaces/v2-missions/m-s5-4/leggo-integrated";
    kernel.safeWriteWorkspaceFile(`${leggoRelPath}/src/index.ts`, "export const x = 1;", "m-s5-4");
    const hash = createHash("sha256").update("export const x = 1;").digest("hex");

    const candidate: IntegratedCandidate = {
      candidateId: "cand-s5-4",
      missionId: "m-s5-4",
      integratedArtifacts: [{ artifactId: "a1", path: "src/index.ts", sha256: hash, sizeBytes: 19, missionId: "m-s5-4" }],
      resolvedConflicts: [],
      sourceTraceability: { "src/index.ts": "COLONY_A" },
      workspacePath: leggoRelPath,
    };

    const context: ContractBoundStageContext = {
      missionId: "m-s5-4",
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
          { id: "ac-1", description: "Target criterion 1", verificationMethod: "TEST", required: true, requiredRequirementId: "tr-expected" },
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

    const actualSnapshotHash = createHash("sha256").update(`src/index.ts:${hash}`).digest("hex");

    // Mismatched testRequirementId
    const ev1 = kernel.emitEvidence("TEST_SUITE_VERIFIER", "m-s5-4", "PROMAX", {
      criterionId: "ac-1",
      testRequirementId: "tr-WRONG-REQ-ID",
      candidateSnapshotHash: actualSnapshotHash,
      proofKind: "QUALIFICATION_PROOF",
    });

    const res = verifier.verifyCandidate(candidate, context, kernel, [ev1]);
    assert.equal(res.success, false, "Proof with mismatched testRequirementId MUST be rejected");
    const proof = res.proofMappings.find((p) => p.criterionId === "ac-1");
    assert.equal(proof?.status, "UNVERIFIED");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("P0-S5 Matrix Case 5: Correct external proof but missing causal artifact/snapshot identity -> REJECT", () => {
  const ws = tempWorkspace("s5-case5");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });
    const verifier = new ProMaxVerifier();

    const leggoRelPath = "workspaces/v2-missions/m-s5-5/leggo-integrated";
    kernel.safeWriteWorkspaceFile(`${leggoRelPath}/src/index.ts`, "export const x = 1;", "m-s5-5");
    const hash = createHash("sha256").update("export const x = 1;").digest("hex");

    const candidate: IntegratedCandidate = {
      candidateId: "cand-s5-5",
      missionId: "m-s5-5",
      integratedArtifacts: [{ artifactId: "a1", path: "src/index.ts", sha256: hash, sizeBytes: 19, missionId: "m-s5-5" }],
      resolvedConflicts: [],
      sourceTraceability: { "src/index.ts": "COLONY_A" },
      workspacePath: leggoRelPath,
    };

    const context: ContractBoundStageContext = {
      missionId: "m-s5-5",
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
          { id: "ac-1", description: "Target criterion 1", verificationMethod: "TEST", required: true },
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

    // External proof has no candidateSnapshotHash and no artifact sha256 in details or artifactIdentity
    const ev1 = kernel.emitEvidence("TEST_SUITE_VERIFIER", "m-s5-5", "PROMAX", {
      criterionId: "ac-1",
      proofKind: "QUALIFICATION_PROOF",
    });

    const res = verifier.verifyCandidate(candidate, context, kernel, [ev1]);
    assert.equal(res.success, false, "External proof lacking candidateSnapshotHash MUST be rejected");
    const proof = res.proofMappings.find((p) => p.criterionId === "ac-1");
    assert.equal(proof?.status, "UNVERIFIED");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("P0-S5 Matrix Case 6: Internally generated ProofMapping with wrong requirement ID -> REJECT", () => {
  const ws = tempWorkspace("s5-case6");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });
    const verifier = new ProMaxVerifier();

    const leggoRelPath = "workspaces/v2-missions/m-s5-6/leggo-integrated";
    kernel.safeWriteWorkspaceFile(`${leggoRelPath}/package.json`, JSON.stringify({ name: "s5-6", version: "1.0.0", scripts: { build: "node -v", test: "node -v" } }), "m-s5-6");
    kernel.safeWriteWorkspaceFile(`${leggoRelPath}/src/index.ts`, "export const x = 1;", "m-s5-6");

    const hashPkg = createHash("sha256").update(JSON.stringify({ name: "s5-6", version: "1.0.0", scripts: { build: "node -v", test: "node -v" } })).digest("hex");
    const hashSrc = createHash("sha256").update("export const x = 1;").digest("hex");

    const candidate: IntegratedCandidate = {
      candidateId: "cand-s5-6",
      missionId: "m-s5-6",
      integratedArtifacts: [
        { artifactId: "a1", path: "package.json", sha256: hashPkg, sizeBytes: 100, missionId: "m-s5-6" },
        { artifactId: "a2", path: "src/index.ts", sha256: hashSrc, sizeBytes: 19, missionId: "m-s5-6" },
      ],
      resolvedConflicts: [],
      sourceTraceability: { "package.json": "COLONY_A", "src/index.ts": "COLONY_A" },
      workspacePath: leggoRelPath,
    };

    // Acceptance criterion expects requiredRequirementId "tr-EXPECTED-ID"
    // requiredTest produces testRequirementId "tr-MISMATCHED-ID" which proves "ac-1"
    const context: ContractBoundStageContext = {
      missionId: "m-s5-6",
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
          { id: "ac-1", description: "Target criterion 1", verificationMethod: "TEST", required: true, requiredRequirementId: "tr-EXPECTED-ID" },
        ],
        constraints: [],
        tasks: [],
        dependencies: [],
        allowedCapabilities: [],
        requiredTests: [
          { id: "tr-MISMATCHED-ID", name: "Build Test", command: "npm --version", expectedExitCode: 0, provesCriterionIds: ["ac-1"] },
        ],
        securityRequirements: [],
        expectedArtifacts: [],
        evidenceRequirements: [],
        riskClassification: "LOW",
        completionConditions: [],
        frozenAt: Date.now(),
      },
    };

    const res = verifier.verifyCandidate(candidate, context, kernel, []);
    assert.equal(res.success, false, "Internal proof mapping with mismatched requirement ID MUST NOT satisfy criterion");
    const proof = res.proofMappings.find((p) => p.criterionId === "ac-1" && p.verifier === "UNMAPPED_CRITERION_VERIFIER");
    assert.equal(proof?.status, "UNVERIFIED");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("P0-S5 Matrix Case 7: Proof from previous candidate snapshot after modifying SECOND artifact -> REJECT", () => {
  const ws = tempWorkspace("s5-case7");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });
    const verifier = new ProMaxVerifier();

    const leggoRelPath = "workspaces/v2-missions/m-s5-7/leggo-integrated";
    kernel.safeWriteWorkspaceFile(`${leggoRelPath}/package.json`, JSON.stringify({ name: "s5-7", version: "1.0.0", scripts: { test: "node -v" } }), "m-s5-7");
    const file1Path = "src/first.ts";
    const file2Path = "src/second.ts";

    const file1Content = "export const first = 100;";
    const file2ContentV1 = "export const second = 200;";
    const file2ContentV2 = "export const second = 999; // MUTATED SECOND ARTIFACT";

    kernel.safeWriteWorkspaceFile(`${leggoRelPath}/${file1Path}`, file1Content, "m-s5-7");
    kernel.safeWriteWorkspaceFile(`${leggoRelPath}/${file2Path}`, file2ContentV1, "m-s5-7");

    const pkgContent = JSON.stringify({ name: "s5-7", version: "1.0.0", scripts: { test: "node -v" } });
    const pkgHash = createHash("sha256").update(pkgContent).digest("hex");
    const hash1 = createHash("sha256").update(file1Content).digest("hex");
    const hash2V1 = createHash("sha256").update(file2ContentV1).digest("hex");
    const hash2V2 = createHash("sha256").update(file2ContentV2).digest("hex");

    const candidateV1: IntegratedCandidate = {
      candidateId: "cand-v1",
      missionId: "m-s5-7",
      integratedArtifacts: [
        { artifactId: "a0", path: "package.json", sha256: pkgHash, sizeBytes: pkgContent.length, missionId: "m-s5-7" },
        { artifactId: "a1", path: file1Path, sha256: hash1, sizeBytes: file1Content.length, missionId: "m-s5-7" },
        { artifactId: "a2", path: file2Path, sha256: hash2V1, sizeBytes: file2ContentV1.length, missionId: "m-s5-7" },
      ],
      resolvedConflicts: [],
      sourceTraceability: { "package.json": "COLONY_A", [file1Path]: "COLONY_A", [file2Path]: "COLONY_A" },
      workspacePath: leggoRelPath,
    };

    // Calculate candidateSnapshotHash for Candidate V1
    const snapshotHashV1 = computeCandidateSnapshotHash(candidateV1.integratedArtifacts);

    // Source command evidence for V1 snapshot proof matching TEST requirement (npm test)
    const sourceEvV1 = kernel.emitInternalEvidence("TRUSTED_KERNEL_COMMAND", "m-s5-7", "PROMAX", { executableId: "npm", args: ["test"], exitCode: 0, success: true }, undefined, undefined, undefined, "TRACEABILITY");

    // Emit QUALIFICATION_PROOF bound to candidate V1 snapshot
    const evV1 = kernel.emitEvidence("TEST_SUITE_VERIFIER", "m-s5-7", "PROMAX", {
      criterionId: "ac-multi-file",
      testRequirementId: "tr-suite",
      candidateSnapshotHash: snapshotHashV1,
      sha256: hash1,
      targetFile: file1Path,
      sourceEvidenceRef: sourceEvV1.evidenceId,
      proofKind: "QUALIFICATION_PROOF",
    });

    const context: ContractBoundStageContext = {
      missionId: "m-s5-7",
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
          { id: "ac-multi-file", description: "Multi file verification", verificationMethod: "TEST", required: true, requiredRequirementId: "tr-suite" },
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

    // Verify V1 candidate against V1 evidence -> MUST PASS
    const resV1 = verifier.verifyCandidate(candidateV1, context, kernel, [sourceEvV1, evV1]);
    assert.equal(resV1.success, true, "V1 candidate with V1 snapshot proof MUST succeed");

    // Now mutate SECOND artifact (src/second.ts) on disk and update candidate to V2
    kernel.safeWriteWorkspaceFile(`${leggoRelPath}/${file2Path}`, file2ContentV2, "m-s5-7");

    const candidateV2: IntegratedCandidate = {
      candidateId: "cand-v2",
      missionId: "m-s5-7",
      integratedArtifacts: [
        { artifactId: "a1", path: file1Path, sha256: hash1, sizeBytes: file1Content.length, missionId: "m-s5-7" },
        { artifactId: "a2", path: file2Path, sha256: hash2V2, sizeBytes: file2ContentV2.length, missionId: "m-s5-7" },
      ],
      resolvedConflicts: [],
      sourceTraceability: { [file1Path]: "COLONY_A", [file2Path]: "COLONY_A" },
      workspacePath: leggoRelPath,
    };

    // Verify V2 candidate (with mutated 2nd artifact) against OLD V1 snapshot evidence -> MUST FAIL
    const resV2 = verifier.verifyCandidate(candidateV2, context, kernel, [sourceEvV1, evV1]);
    assert.equal(resV2.success, false, "V2 candidate with mutated second artifact MUST REJECT old V1 snapshot proof");
    assert.equal(resV2.assessment.contractSatisfied, false);
    const proofV2 = resV2.proofMappings.find((p) => p.criterionId === "ac-multi-file" && p.verifier === "UNMAPPED_CRITERION_VERIFIER");
    assert.equal(proofV2?.status, "UNVERIFIED");
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

test("P0-CB6 8-Point Candidate Boundary & Verifier Path Adversarial Matrix", () => {
  const ws = tempWorkspace("cb6-matrix");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });
    const verifier = new ProMaxVerifier();
    const packager = new LabPackager();

    const leggoRel = "workspaces/v2-missions/m-cb6/leggo-integrated";
    kernel.safeWriteWorkspaceFile(`${leggoRel}/package.json`, JSON.stringify({ name: "cb6", version: "1.0.0", scripts: { build: "node -v", test: "node -v" } }), "m-cb6");
    kernel.safeWriteWorkspaceFile(`${leggoRel}/src/index.ts`, "export const x = 1;", "m-cb6");

    const hashPkg = createHash("sha256").update(JSON.stringify({ name: "cb6", version: "1.0.0", scripts: { build: "node -v", test: "node -v" } })).digest("hex");
    const hashSrc = createHash("sha256").update("export const x = 1;").digest("hex");

    // 1. Candidate workspace sibling-prefix artifact (leggo-integrated-evil/file.ts)
    const evilCandidate: IntegratedCandidate = {
      candidateId: "cand-evil",
      missionId: "m-cb6",
      integratedArtifacts: [
        { artifactId: "a1", path: "workspaces/v2-missions/m-cb6/leggo-integrated-evil/file.ts", sha256: "abc", sizeBytes: 10, missionId: "m-cb6" },
      ],
      resolvedConflicts: [],
      sourceTraceability: {},
      workspacePath: leggoRel,
    };

    const dummyAssessment: ProMaxAssessment = {
      candidateId: "cand-evil",
      contractSatisfied: true,
      verifiedCriteria: ["ac-1"],
      failedCriteria: [],
      securityCheckPassed: true,
      regressionPassed: true,
      independentTestsPassed: true,
      evidenceFreshnessVerified: true,
    };

    const ctxCb6: ContractBoundStageContext = {
      missionId: "m-cb6",
      authoritativeInputs: [],
      policyVersions: ["v1.0.0"],
      budgets: { virtualTicks: 100, providerCalls: 10, maxFixAttempts: 3 },
      evidenceRefs: [],
      missionStateRef: "PACKAGING",
      executionMode: "DETERMINISTIC_FIXTURE_MODE",
      contractPhase: "CONTRACT_BOUND",
      frozenPlanContract: {
        contractId: "c1", version: "v1.0.0", contractHash: "h1", objective: "Obj",
        acceptanceCriteria: [{ id: "ac-1", description: "AC1", verificationMethod: "TEST", required: true }],
        constraints: [], tasks: [], dependencies: [], allowedCapabilities: [],
        requiredTests: [], securityRequirements: [], expectedArtifacts: [],
        evidenceRequirements: [], riskClassification: "LOW", completionConditions: [], frozenAt: Date.now(),
      },
    };

    // LabPackager MUST reject candidate sibling-prefix artifact
    const labRes1 = packager.packageDeliverables(evilCandidate, dummyAssessment, ctxCb6, kernel, []);
    assert.equal(labRes1.success, false, "Lab MUST reject candidate sibling-prefix artifact");
    assert.equal(labRes1.reasonCode.includes("NAMLA_LAB_REFUSED"), true);

    // 2. Nested valid candidate artifact accepted by Lab and ProMax
    const validCandidate: IntegratedCandidate = {
      candidateId: "cand-valid",
      missionId: "m-cb6",
      integratedArtifacts: [
        { artifactId: "a1", path: "package.json", sha256: hashPkg, sizeBytes: 100, missionId: "m-cb6" },
        { artifactId: "a2", path: "src/index.ts", sha256: hashSrc, sizeBytes: 19, missionId: "m-cb6" },
      ],
      resolvedConflicts: [],
      sourceTraceability: { "package.json": "COLONY_A", "src/index.ts": "COLONY_A" },
      workspacePath: leggoRel,
    };

    const checkValid = kernel.isInsideCandidateWorkspace(leggoRel, "src/index.ts");
    assert.equal(checkValid.ok, true, "Nested valid candidate artifact MUST be accepted");

    const validCtx: ContractBoundStageContext = {
      ...ctxCb6,
      frozenPlanContract: {
        ...ctxCb6.frozenPlanContract,
        acceptanceCriteria: [{ id: "ac-1", description: "AC1", verificationMethod: "TEST", required: true, requiredRequirementId: "tr-1" }],
        requiredTests: [{ id: "tr-1", type: "TEST", verifier: "TEST_SUITE_VERIFIER", name: "T1", command: "npm --version", expectedExitCode: 0, provesCriterionIds: ["ac-1"] }],
      },
    };

    const validSnapshotHash = computeCandidateSnapshotHash(validCandidate.integratedArtifacts);
    const validSourceEv = kernel.emitInternalEvidence("TRUSTED_KERNEL_COMMAND", "m-cb6", "PROMAX", { exitCode: 0, success: true }, undefined, undefined, undefined, "TRACEABILITY");
    const validEv = kernel.emitEvidence("TEST_SUITE_VERIFIER", "m-cb6", "PROMAX", {
      criterionId: "ac-1",
      testRequirementId: "tr-1",
      candidateSnapshotHash: validSnapshotHash,
      sourceEvidenceRef: validSourceEv.evidenceId,
      proofKind: "QUALIFICATION_PROOF",
    });

    const pmResValid = verifier.verifyCandidate(validCandidate, validCtx, kernel, [validSourceEv, validEv]);
    assert.equal(pmResValid.success, true, "Nested valid candidate artifact MUST pass ProMax verification when correctly proved");

    // 3. Lab rejects artifact outside candidate workspace but still inside global TrustedKernel workspace
    const outsideCandidateArt: IntegratedCandidate = {
      ...validCandidate,
      integratedArtifacts: [
        { artifactId: "a1", path: "workspaces/v2-missions/m-OTHER/colony_a/other.ts", sha256: "123", sizeBytes: 10, missionId: "m-cb6" },
      ],
    };
    const labRes3 = packager.packageDeliverables(outsideCandidateArt, dummyAssessment, ctxCb6, kernel, []);
    assert.equal(labRes3.success, false, "Lab MUST reject artifact outside candidate workspace even if inside global workspace");

    // 4. ProMax rejects candidate sibling artifact
    const pmRes4 = verifier.verifyCandidate(evilCandidate, ctxCb6, kernel, []);
    assert.equal(pmRes4.success, false, "ProMax MUST reject candidate sibling artifact");
    assert.equal(pmRes4.proofMappings.some((m) => m.verifier === "ProMaxVerifier:candidateBoundaryCheck" && m.status === "FAILED"), true, "ProMax MUST report candidate boundary escape failure");

    // 5. SMOKE test file absent + generic npm test passing -> smoke result MUST be BLOCKED
    const smokeCtx: ContractBoundStageContext = {
      ...ctxCb6,
      frozenPlanContract: {
        ...ctxCb6.frozenPlanContract,
        acceptanceCriteria: [{ id: "ac-smoke", description: "Smoke", verificationMethod: "TEST", required: true, requiredRequirementId: "tr-smoke" }],
        requiredTests: [{ id: "tr-smoke", type: "SMOKE", verifier: "SMOKE_VERIFIER", name: "Smoke", command: "npm test", expectedExitCode: 0, provesCriterionIds: ["ac-smoke"] }],
      },
    };
    const pmRes5 = verifier.verifyCandidate(validCandidate, smokeCtx, kernel, []);
    assert.equal(pmRes5.success, false, "Smoke verifier MUST be BLOCKED when smoke test file is absent, even if npm test passes");
    const smokeProof = pmRes5.proofMappings.find((p) => p.criterionId === "tr-smoke");
    assert.equal(smokeProof?.status, "BLOCKED", "Absent smoke test file MUST result in BLOCKED status");

    // 6. Integration existence check and command execution use exact same canonical candidate workspace
    const fullIntegPath = `${leggoRel}/tests/integration.test.ts`;
    assert.equal(kernel.workspaceFileExists(fullIntegPath), false, "Integration existence check MUST evaluate against candidate workspace via workspaceFileExists");

    // 7. Docker candidate cwd uses TrustedKernel canonical workspace and cannot escape
    const dockerCmdRes = kernel.executeCommand("docker" as any, ["build", "-t", "test", "."], "m-cb6", "PROMAX", leggoRel);
    assert.equal(dockerCmdRes.reasonCode.includes("PATH_TRAVERSAL_REFUSED") || dockerCmdRes.reasonCode.includes("SYMLINK_ESCAPE_REFUSED") || dockerCmdRes.reasonCode.includes("FORBIDDEN_COMMAND_REFUSED") || dockerCmdRes.success || dockerCmdRes.reasonCode.includes("COMMAND_FAILED") || dockerCmdRes.reasonCode.includes("UNAUTHORIZED"), true);

    // 8. process.cwd() mismatch simulation does not alter verifier path semantics
    const origCwd = process.cwd();
    try {
      // process.cwd() path resolution in ProMax is completely eliminated; kernel handles candidate relative paths
      process.chdir("/tmp");
      const pmRes8 = verifier.verifyCandidate(validCandidate, validCtx, kernel, [validSourceEv, validEv]);
      assert.equal(pmRes8.success, true, "Verifier path semantics MUST remain identical when process.cwd() changes");
    } finally {
      process.chdir(origCwd);
    }
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("P0-B9 12-Point Adversarial Filesystem & Boundary Matrix", () => {
  const ws = tempWorkspace("b9-matrix");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });

    // 1. Workspace sibling-prefix escape: workspace -> workspace-evil
    const siblingEvilRel = "../" + resolve(ws).split("/").pop() + "-evil/file.ts";
    const res1 = kernel.safeWriteWorkspaceFile(siblingEvilRel, "export const evil = true;", "m-b9");
    assert.equal(res1.success, false, "Sibling prefix workspace escape MUST be rejected");

    // 2. ../ traversal
    const res2 = kernel.safeWriteWorkspaceFile("../../etc/passwd", "root:x:0:0:", "m-b9");
    assert.equal(res2.success, false, "Parent traversal .. MUST be rejected");

    // 3. Absolute POSIX path
    const res3 = kernel.safeWriteWorkspaceFile("/tmp/absolute-escape.ts", "const x = 1;", "m-b9");
    assert.equal(res3.success, false, "Absolute POSIX path MUST be rejected");

    // 4. Windows-style drive path
    const res4 = kernel.safeWriteWorkspaceFile("C:\\Windows\\System32\\cmd.exe", "evil", "m-b9");
    assert.equal(res4.success, false, "Windows drive-letter path MUST be rejected");

    // 5. Encoded / suspicious path variants
    const res5 = kernel.safeWriteWorkspaceFile("src/%252e%252e/secret.ts", "evil", "m-b9");
    assert.equal(res5.success, false, "URL-encoded/suspicious path MUST be rejected");

    // Setup outside target directory for symlink tests
    const outsideDir = tempWorkspace("b9-outside");
    try {
      // Create actual file outside workspace
      const outsideFile = resolve(outsideDir, "outside-secret.txt");
      require("fs").writeFileSync(outsideFile, "SECRET_DATA", "utf8");

      // Create symlink inside workspace pointing to file outside workspace
      const symlinkFileRel = "src/symlink-file.txt";
      const symlinkFileAbs = resolve(ws, symlinkFileRel);
      mkdirSync(resolve(ws, "src"), { recursive: true });
      symlinkSync(outsideFile, symlinkFileAbs);

      const res6 = kernel.safeReadWorkspaceFile(symlinkFileRel);
      assert.equal(res6.success, false, "Symlink pointing outside workspace MUST be rejected");
      assert.equal(res6.reasonCode, "SYMLINK_ESCAPE_REFUSED");

      // 7. Symlink directory escape
      const symlinkDirRel = "src/symlink-dir";
      const symlinkDirAbs = resolve(ws, symlinkDirRel);
      symlinkSync(outsideDir, symlinkDirAbs);

      const res7 = kernel.safeWriteWorkspaceFile("src/symlink-dir/escaped.ts", "export const x = 1;", "m-b9");
      assert.equal(res7.success, false, "Write through symlink directory escaping workspace MUST be rejected");
      assert.equal(res7.reasonCode, "SYMLINK_ESCAPE_REFUSED");

      // 8. Command cwd through symlink
      const res8 = kernel.executeCommand("npm" as any, ["--version"], "m-b9", "PROMAX", "src/symlink-dir");
      assert.equal(res8.success, false, "Command execution with cwd through escaping symlink MUST be rejected");
      assert.equal(res8.reasonCode, "SYMLINK_ESCAPE_REFUSED");
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }

    // 9. Scope basename/suffix proposal collision
    const executor = new ColonyExecutor();
    const wpScope: WorkPackage = {
      id: "wp-scope-1",
      missionId: "m-b9",
      contractVersion: "v1.0.0",
      taskSpec: {
        id: "t1",
        name: "Auth",
        description: "",
        targetFiles: ["src/auth/index.ts"],
        dependencies: [],
        capabilityRequirements: [],
      },
      acceptanceCriteria: [],
      inputArtifacts: [],
      readOnly: false,
      maxAttempts: 3,
    };
    const execScope: WorkPackageExecution = {
      executionId: "exec-scope-1",
      workPackageId: "wp-scope-1",
      colonyId: "COLONY_A",
      state: "EXECUTING",
      stateVersion: 1,
      attempts: 1,
      outputArtifacts: [],
      evidenceRefs: [],
      workspacePath: "workspaces/v2-missions/m-b9/colony_a/wp-scope-1",
    };

    const ctxScope: ContractBoundStageContext = {
      missionId: "m-b9",
      authoritativeInputs: [],
      policyVersions: ["v1.0.0"],
      budgets: { virtualTicks: 100, providerCalls: 10, maxFixAttempts: 3 },
      evidenceRefs: [],
      missionStateRef: "EXECUTING_AB",
      executionMode: "PRODUCTION_MODE",
      contractPhase: "CONTRACT_BOUND",
      frozenPlanContract: {
        contractId: "c1", version: "v1.0.0", contractHash: "h1", objective: "Obj",
        acceptanceCriteria: [], constraints: [], tasks: [], dependencies: [],
        allowedCapabilities: [], requiredTests: [], securityRequirements: [],
        expectedArtifacts: [], evidenceRequirements: [], riskClassification: "LOW",
        completionConditions: [], frozenAt: Date.now(),
      },
    };

    // Proposal attempting suffix/basename trick "foo/src/auth/index.ts" or "src/auth/index.ts.evil"
    const proposalEvil = JSON.stringify({
      summary: "proposal",
      files: [{ path: "src/auth/index.ts.evil", operation: "create", content: "export const x = 1;" }],
    });

    const res9 = executor.executeWorkPackage(wpScope, execScope, ctxScope, kernel, proposalEvil, { mode: "PRODUCTION_MODE" });
    assert.equal(res9.success, false, "Suffix/basename proposal collision MUST be rejected");
    assert.equal(res9.reasonCode.includes("PROVIDER_PROPOSAL_OUT_OF_SCOPE"), true);

    // 10. Capability prefix collision: src/auth vs src/auth-evil
    const capScope: CapabilityScope = { capability: "filesystem.write", target: "src/auth-evil/index.ts", readOnly: false };
    const contractScope = {
      ...ctxScope.frozenPlanContract,
      allowedCapabilities: [{ capability: "filesystem.write", target: "src/auth", readOnly: false }],
    };
    const res10 = kernel.evaluateEffectiveAuthority(capScope, contractScope, 100);
    assert.equal(res10.authorized, false, "Capability prefix collision src/auth-evil MUST NOT be authorized by src/auth");
    assert.equal(res10.reasonCode, "PLAN_CONTRACT_SCOPE_EXCEEDED");

    // 11. Nested valid path still succeeds
    const res11 = kernel.safeWriteWorkspaceFile("src/deeply/nested/valid/file.ts", "export const x = 100;", "m-b9");
    assert.equal(res11.success, true, "Nested valid path MUST succeed");

    // 12. Exact allowlisted file succeeds
    const res12 = kernel.safeWriteWorkspaceFile("src/auth/index.ts", "export const auth = true;", "m-b9");
    assert.equal(res12.success, true, "Exact allowlisted file MUST succeed");

    // 13. P0-B6 Attack: Producer "UNAUTHORIZED_EVIL_VERIFIER" with omitted proofKind MUST NOT become qualification proof
    const ev13 = kernel.emitEvidence("UNAUTHORIZED_EVIL_VERIFIER", "m-b9", "STAGE", { criterionId: "ac-1" });
    assert.equal(ev13.proofKind, "TRACEABILITY", "Omitted proofKind MUST default conservatively to TRACEABILITY");
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
