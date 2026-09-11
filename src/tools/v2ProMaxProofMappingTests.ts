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
import { ProMaxVerifier, computeCandidateSnapshotHash } from "../v2/promax/proMaxVerifier";
import { TrustedKernel } from "../v2/kernel/trustedKernel";
import { IntegratedCandidate } from "../v2/types/missionState";
import { ContractBoundStageContext } from "../v2/types/stageContext";

function tempWorkspace(tag: string): string {
  return mkdtempSync(resolve(tmpdir(), `namla-v2-promax-${tag}-`));
}

test("ProMaxVerifier: Generates Proof Mappings and Verifies Observed Evidence", () => {
  const ws = tempWorkspace("proof-map");
  try {
    const permit = Object.freeze({ opaque: "promax-proof-map-permit" });

    const sandbox = {
      authorize(request: any) {
        assert.equal(request.objectiveId, "test");
        assert.equal(request.taskId, "test");
        assert.equal(request.humanAuthorized, true);
        assert.equal(request.executableId, "npm");
        assert.deepEqual([...request.fixedArguments], ["test"]);

        return {
          ok: true,
          permit,
          receipt: {
            backendId: "verified-test-backend",
            capabilityState: "available-and-verified",
            executionStarted: false,
            executionCompleted: false,
            exitCategory: "not-started",
            timeoutMs: 15000,
            cpuLimit: 1,
            memoryLimitMb: 256,
            pidLimit: 64,
            networkPolicy: "denied",
            mountPolicy: "bounded-workspace-only",
            cleanupComplete: false,
            blocked: false,
            safeReasonCode: "ok",
            safeFingerprint: "sb-promax-auth",
          },
        };
      },

      execute(receivedPermit: any) {
        assert.strictEqual(receivedPermit, permit);

        return {
          backendId: "verified-test-backend",
          capabilityState: "available-and-verified",
          executionStarted: true,
          executionCompleted: true,
          exitCategory: "completed",
          timeoutMs: 15000,
          cpuLimit: 1,
          memoryLimitMb: 256,
          pidLimit: 64,
          networkPolicy: "denied",
          mountPolicy: "bounded-workspace-only",
          cleanupComplete: true,
          blocked: false,
          safeReasonCode: "ok",
          safeFingerprint: "sb-promax-exec",
        };
      },
    };

    const kernel = new TrustedKernel({
      workspaceRoot: ws,
      humanAuthorizationGranted: true,
      verificationSandbox: sandbox as any,
      verificationHumanAuthorized: true,
    });

    const leggoRelPath = "workspaces/v2-missions/m-promax/leggo-integrated";
    kernel.safeWriteWorkspaceFile(`${leggoRelPath}/package.json`, JSON.stringify({ name: "promax", version: "1.0.0", scripts: { test: "node -v" } }), "m-promax");
    kernel.safeWriteWorkspaceFile(`${leggoRelPath}/src/index.ts`, "export const x = 1;\n", "m-promax");

    const pkgContent = JSON.stringify({ name: "promax", version: "1.0.0", scripts: { test: "node -v" } });
    const srcContent = "export const x = 1;\n";
    const pkgHash = createHash("sha256").update(pkgContent).digest("hex");
    const srcHash = createHash("sha256").update(srcContent).digest("hex");

    const candidate: IntegratedCandidate = {
      candidateId: "cand-1",
      missionId: "m-promax",
      integratedArtifacts: [
        { artifactId: "art-0", path: "package.json", sha256: pkgHash, sizeBytes: pkgContent.length, missionId: "m-promax" },
        { artifactId: "art-1", path: "src/index.ts", sha256: srcHash, sizeBytes: srcContent.length, missionId: "m-promax" },
      ],
      resolvedConflicts: [],
      sourceTraceability: { "package.json": "COLONY_A", "src/index.ts": "COLONY_A" },
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
        requiredTests: [{ id: "t1", type: "TEST", verifier: "TEST_SUITE_VERIFIER", name: "Version Check", command: "npm test", expectedExitCode: 0, provesCriterionIds: ["ac-1"] }],
        securityRequirements: [{ id: "sec-1", rule: "NO_SECRET_LEAKAGE", failClosed: true }],
        expectedArtifacts: [],
        evidenceRequirements: [],
        riskClassification: "LOW",
        completionConditions: [],
        frozenAt: Date.now(),
      },
    };

    const result = kernel.runProMaxVerification(candidate, context, []);

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
    const result = kernel.runProMaxVerification(candidate, context, []);

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

    const result = kernel.runProMaxVerification(candidate, context, staleEvidence);

    assert.equal(result.success, false, "Stale evidence must cause ProMax verification failure");
    assert.equal(result.assessment.evidenceFreshnessVerified, false);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("P0-PROMAX-SANDBOX: TYPECHECK never uses host executeCommand", () => {
  const ws = tempWorkspace("typecheck-routing");

  try {
    const kernel = new TrustedKernel({
      workspaceRoot: ws,
      humanAuthorizationGranted: true,
    });

    const candidateRelPath =
      "workspaces/v2-missions/m-typecheck-routing/leggo-integrated";

    const source = "export const routed = true;\n";
    const sourceHash = createHash("sha256").update(source).digest("hex");

    kernel.safeWriteWorkspaceFile(
      `${candidateRelPath}/src/index.ts`,
      source,
      "m-typecheck-routing"
    );

    const candidate: IntegratedCandidate = {
      candidateId: "cand-typecheck-routing",
      missionId: "m-typecheck-routing",
      integratedArtifacts: [
        {
          artifactId: "art-typecheck-routing",
          path: "src/index.ts",
          sha256: sourceHash,
          sizeBytes: source.length,
          missionId: "m-typecheck-routing",
        },
      ],
      resolvedConflicts: [],
      sourceTraceability: {
        "src/index.ts": "COLONY_A",
      },
      workspacePath: candidateRelPath,
    };

    const context: ContractBoundStageContext = {
      missionId: "m-typecheck-routing",
      authoritativeInputs: [],
      policyVersions: ["v1.0.0"],
      budgets: {
        virtualTicks: 100,
        providerCalls: 10,
        maxFixAttempts: 3,
      },
      evidenceRefs: [],
      missionStateRef: "VERIFYING",
      contractPhase: "CONTRACT_BOUND",
      projectClass: "TYPESCRIPT_LIBRARY",
      frozenPlanContract: {
        contractId: "c-typecheck-routing",
        version: "v1.0.0",
        contractHash: "h-typecheck-routing",
        objective: "Verify TypeScript candidate",
        acceptanceCriteria: [],
        constraints: [],
        tasks: [],
        dependencies: [],
        allowedCapabilities: [],
        requiredTests: [
          {
            id: "t-typecheck-routing",
            type: "TYPECHECK",
            verifier: "TYPECHECK_VERIFIER",
            name: "Trusted Typecheck",
            command: "npx tsc --noEmit",
            expectedExitCode: 0,
          },
        ],
        securityRequirements: [],
        expectedArtifacts: [],
        evidenceRequirements: [],
        riskClassification: "LOW",
        completionConditions: [],
        frozenAt: Date.now(),
      },
    };

    let hostExecuteCalls = 0;
    let verificationExecuteCalls = 0;

    (kernel as any).executeCommand = () => {
      hostExecuteCalls += 1;
      throw new Error(
        "HOST_EXECUTION_FORBIDDEN: ProMax TYPECHECK reached executeCommand()"
      );
    };

    (kernel as any).executeVerificationCommand = (
      commandId: string
    ) => {
      verificationExecuteCalls += 1;

      assert.equal(
        commandId,
        "typecheck",
        "TYPECHECK_VERIFIER must route through the closed typecheck command id"
      );

      return {
        success: false,
        exitCode: null,
        stdout: "",
        stderr: "synthetic sandbox refusal",
        reasonCode: "TEST_SANDBOX_REFUSAL",
      };
    };

    const result = kernel.runProMaxVerification(
      candidate,
      context,
      []
    );

    assert.equal(
      hostExecuteCalls,
      0,
      "ProMax TYPECHECK must never invoke host executeCommand()"
    );

    assert.equal(
      verificationExecuteCalls,
      1,
      "ProMax TYPECHECK must invoke executeVerificationCommand() exactly once"
    );

    assert.equal(
      result.success,
      false,
      "Synthetic sandbox refusal must fail verification, not be converted into success"
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
test("P0-PROMAX-SANDBOX: BUILD ignores candidate command and never uses host executeCommand", () => {
  const ws = tempWorkspace("build-routing");

  try {
    const kernel = new TrustedKernel({
      workspaceRoot: ws,
      humanAuthorizationGranted: true,
    });

    const candidateRelPath =
      "workspaces/v2-missions/m-build-routing/leggo-integrated";

    const source = "export const buildRouted = true;\n";
    const sourceHash = createHash("sha256").update(source).digest("hex");

    kernel.safeWriteWorkspaceFile(
      `${candidateRelPath}/src/index.ts`,
      source,
      "m-build-routing"
    );

    const candidate: IntegratedCandidate = {
      candidateId: "cand-build-routing",
      missionId: "m-build-routing",
      integratedArtifacts: [
        {
          artifactId: "art-build-routing",
          path: "src/index.ts",
          sha256: sourceHash,
          sizeBytes: source.length,
          missionId: "m-build-routing",
        },
      ],
      resolvedConflicts: [],
      sourceTraceability: {
        "src/index.ts": "COLONY_A",
      },
      workspacePath: candidateRelPath,
    };

    const context: ContractBoundStageContext = {
      missionId: "m-build-routing",
      authoritativeInputs: [],
      policyVersions: ["v1.0.0"],
      budgets: {
        virtualTicks: 100,
        providerCalls: 10,
        maxFixAttempts: 3,
      },
      evidenceRefs: [],
      missionStateRef: "VERIFYING",
      contractPhase: "CONTRACT_BOUND",
      projectClass: "TYPESCRIPT_LIBRARY",
      frozenPlanContract: {
        contractId: "c-build-routing",
        version: "v1.0.0",
        contractHash: "h-build-routing",
        objective: "Verify candidate build",
        acceptanceCriteria: [],
        constraints: [],
        tasks: [],
        dependencies: [],
        allowedCapabilities: [],
        requiredTests: [
          {
            id: "t-build-routing",
            type: "BUILD",
            verifier: "BUILD_VERIFIER",
            name: "Trusted Build",
            command: "node -e candidate-controlled-build",
            expectedExitCode: 0,
          },
        ],
        securityRequirements: [],
        expectedArtifacts: [],
        evidenceRequirements: [],
        riskClassification: "LOW",
        completionConditions: [],
        frozenAt: Date.now(),
      },
    };

    let hostExecuteCalls = 0;
    let verificationExecuteCalls = 0;

    (kernel as any).executeCommand = () => {
      hostExecuteCalls += 1;
      throw new Error(
        "HOST_EXECUTION_FORBIDDEN: ProMax BUILD reached executeCommand()"
      );
    };

    (kernel as any).executeVerificationCommand = (
      commandId: string
    ) => {
      verificationExecuteCalls += 1;

      assert.equal(
        commandId,
        "build",
        "BUILD_VERIFIER must ignore reqTest.command and use the closed build command id"
      );

      return {
        success: false,
        exitCode: null,
        stdout: "",
        stderr: "synthetic sandbox refusal",
        reasonCode: "TEST_SANDBOX_REFUSAL",
      };
    };

    const result = kernel.runProMaxVerification(
      candidate,
      context,
      []
    );

    assert.equal(
      hostExecuteCalls,
      0,
      "ProMax BUILD must never invoke host executeCommand()"
    );

    assert.equal(
      verificationExecuteCalls,
      1,
      "ProMax BUILD must invoke executeVerificationCommand() exactly once"
    );

    assert.equal(
      result.success,
      false,
      "Synthetic sandbox refusal must fail verification"
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
test("P0-PROMAX-SANDBOX: TEST ignores candidate command and never uses host executeCommand", () => {
  const ws = tempWorkspace("test-routing");

  try {
    const kernel = new TrustedKernel({
      workspaceRoot: ws,
      humanAuthorizationGranted: true,
    });

    const candidateRelPath =
      "workspaces/v2-missions/m-test-routing/leggo-integrated";

    const source = "export const testRouted = true;\n";
    const sourceHash = createHash("sha256").update(source).digest("hex");

    kernel.safeWriteWorkspaceFile(
      `${candidateRelPath}/src/index.ts`,
      source,
      "m-test-routing"
    );

    const candidate: IntegratedCandidate = {
      candidateId: "cand-test-routing",
      missionId: "m-test-routing",
      integratedArtifacts: [
        {
          artifactId: "art-test-routing",
          path: "src/index.ts",
          sha256: sourceHash,
          sizeBytes: source.length,
          missionId: "m-test-routing",
        },
      ],
      resolvedConflicts: [],
      sourceTraceability: {
        "src/index.ts": "COLONY_A",
      },
      workspacePath: candidateRelPath,
    };

    const context: ContractBoundStageContext = {
      missionId: "m-test-routing",
      authoritativeInputs: [],
      policyVersions: ["v1.0.0"],
      budgets: {
        virtualTicks: 100,
        providerCalls: 10,
        maxFixAttempts: 3,
      },
      evidenceRefs: [],
      missionStateRef: "VERIFYING",
      contractPhase: "CONTRACT_BOUND",
      projectClass: "TYPESCRIPT_LIBRARY",
      frozenPlanContract: {
        contractId: "c-test-routing",
        version: "v1.0.0",
        contractHash: "h-test-routing",
        objective: "Verify candidate tests",
        acceptanceCriteria: [],
        constraints: [],
        tasks: [],
        dependencies: [],
        allowedCapabilities: [],
        requiredTests: [
          {
            id: "t-test-routing",
            type: "TEST",
            verifier: "TEST_SUITE_VERIFIER",
            name: "Trusted Test Suite",
            command: "node -e candidate-controlled-test",
            expectedExitCode: 0,
          },
        ],
        securityRequirements: [],
        expectedArtifacts: [],
        evidenceRequirements: [],
        riskClassification: "LOW",
        completionConditions: [],
        frozenAt: Date.now(),
      },
    };

    let hostExecuteCalls = 0;
    let verificationExecuteCalls = 0;

    (kernel as any).executeCommand = () => {
      hostExecuteCalls += 1;
      throw new Error(
        "HOST_EXECUTION_FORBIDDEN: ProMax TEST reached executeCommand()"
      );
    };

    (kernel as any).executeVerificationCommand = (
      commandId: string
    ) => {
      verificationExecuteCalls += 1;

      assert.equal(
        commandId,
        "test",
        "TEST_SUITE_VERIFIER must ignore reqTest.command and use the closed test command id"
      );

      return {
        success: false,
        exitCode: null,
        stdout: "",
        stderr: "synthetic sandbox refusal",
        reasonCode: "TEST_SANDBOX_REFUSAL",
      };
    };

    const result = kernel.runProMaxVerification(
      candidate,
      context,
      []
    );

    assert.equal(
      hostExecuteCalls,
      0,
      "ProMax TEST must never invoke host executeCommand()"
    );

    assert.equal(
      verificationExecuteCalls,
      1,
      "ProMax TEST must invoke executeVerificationCommand() exactly once"
    );

    assert.equal(
      result.success,
      false,
      "Synthetic sandbox refusal must fail verification"
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
test("P0-PROMAX-SANDBOX: SMOKE uses closed command id and never host executeCommand", () => {
  const ws = tempWorkspace("smoke-routing");

  try {
    const kernel = new TrustedKernel({
      workspaceRoot: ws,
      humanAuthorizationGranted: true,
    });

    const candidateRelPath =
      "workspaces/v2-missions/m-smoke-routing/leggo-integrated";

    const source = "export const smokeRouted = true;\n";
    const smokeTest = "import test from 'node:test'; test('smoke', () => {});\n";

    const sourceHash = createHash("sha256").update(source).digest("hex");
    const smokeHash = createHash("sha256").update(smokeTest).digest("hex");

    kernel.safeWriteWorkspaceFile(
      `${candidateRelPath}/src/index.ts`,
      source,
      "m-smoke-routing"
    );

    kernel.safeWriteWorkspaceFile(
      `${candidateRelPath}/tests/index.test.ts`,
      smokeTest,
      "m-smoke-routing"
    );

    const candidate: IntegratedCandidate = {
      candidateId: "cand-smoke-routing",
      missionId: "m-smoke-routing",
      integratedArtifacts: [
        {
          artifactId: "art-smoke-source",
          path: "src/index.ts",
          sha256: sourceHash,
          sizeBytes: source.length,
          missionId: "m-smoke-routing",
        },
        {
          artifactId: "art-smoke-test",
          path: "tests/index.test.ts",
          sha256: smokeHash,
          sizeBytes: smokeTest.length,
          missionId: "m-smoke-routing",
        },
      ],
      resolvedConflicts: [],
      sourceTraceability: {
        "src/index.ts": "COLONY_A",
        "tests/index.test.ts": "COLONY_A",
      },
      workspacePath: candidateRelPath,
    };

    const context: ContractBoundStageContext = {
      missionId: "m-smoke-routing",
      authoritativeInputs: [],
      policyVersions: ["v1.0.0"],
      budgets: {
        virtualTicks: 100,
        providerCalls: 10,
        maxFixAttempts: 3,
      },
      evidenceRefs: [],
      missionStateRef: "VERIFYING",
      contractPhase: "CONTRACT_BOUND",
      projectClass: "TYPESCRIPT_LIBRARY",
      frozenPlanContract: {
        contractId: "c-smoke-routing",
        version: "v1.0.0",
        contractHash: "h-smoke-routing",
        objective: "Verify candidate smoke test",
        acceptanceCriteria: [],
        constraints: [],
        tasks: [],
        dependencies: [],
        allowedCapabilities: [],
        requiredTests: [
          {
            id: "t-smoke-routing",
            type: "SMOKE",
            verifier: "SMOKE_VERIFIER",
            name: "Trusted Smoke",
            command: "node --test attacker-controlled-path.ts",
            expectedExitCode: 0,
          },
        ],
        securityRequirements: [],
        expectedArtifacts: [],
        evidenceRequirements: [],
        riskClassification: "LOW",
        completionConditions: [],
        frozenAt: Date.now(),
      },
    };

    let hostExecuteCalls = 0;
    let verificationExecuteCalls = 0;

    (kernel as any).executeCommand = () => {
      hostExecuteCalls += 1;

      throw new Error(
        "HOST_EXECUTION_FORBIDDEN: ProMax SMOKE reached executeCommand()"
      );
    };

    (kernel as any).executeVerificationCommand = (
      commandId: string
    ) => {
      verificationExecuteCalls += 1;

      assert.equal(
        commandId,
        "smoke_index",
        "TYPESCRIPT_LIBRARY smoke must use the closed smoke_index command id"
      );

      return {
        success: false,
        exitCode: null,
        stdout: "",
        stderr: "synthetic sandbox refusal",
        reasonCode: "TEST_SANDBOX_REFUSAL",
      };
    };

    const result = kernel.runProMaxVerification(
      candidate,
      context,
      []
    );

    assert.equal(
      hostExecuteCalls,
      0,
      "ProMax SMOKE must never invoke host executeCommand()"
    );

    assert.equal(
      verificationExecuteCalls,
      1,
      "ProMax SMOKE must invoke executeVerificationCommand() exactly once"
    );

    assert.equal(
      result.success,
      false,
      "Synthetic sandbox refusal must fail verification"
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
test("P0-PROMAX-SANDBOX: INTEGRATION uses closed command id and never host executeCommand", () => {
  const ws = tempWorkspace("integration-routing");

  try {
    const kernel = new TrustedKernel({
      workspaceRoot: ws,
      humanAuthorizationGranted: true,
    });

    const candidateRelPath =
      "workspaces/v2-missions/m-integration-routing/leggo-integrated";

    const source = "export const integrationRouted = true;\n";
    const integrationTest =
      "import test from 'node:test'; test('integration', () => {});\n";

    const sourceHash = createHash("sha256").update(source).digest("hex");
    const integrationHash =
      createHash("sha256").update(integrationTest).digest("hex");

    kernel.safeWriteWorkspaceFile(
      `${candidateRelPath}/src/index.ts`,
      source,
      "m-integration-routing"
    );

    kernel.safeWriteWorkspaceFile(
      `${candidateRelPath}/tests/integration.test.ts`,
      integrationTest,
      "m-integration-routing"
    );

    const candidate: IntegratedCandidate = {
      candidateId: "cand-integration-routing",
      missionId: "m-integration-routing",
      integratedArtifacts: [
        {
          artifactId: "art-integration-source",
          path: "src/index.ts",
          sha256: sourceHash,
          sizeBytes: source.length,
          missionId: "m-integration-routing",
        },
        {
          artifactId: "art-integration-test",
          path: "tests/integration.test.ts",
          sha256: integrationHash,
          sizeBytes: integrationTest.length,
          missionId: "m-integration-routing",
        },
      ],
      resolvedConflicts: [],
      sourceTraceability: {
        "src/index.ts": "COLONY_A",
        "tests/integration.test.ts": "COLONY_A",
      },
      workspacePath: candidateRelPath,
    };

    const context: ContractBoundStageContext = {
      missionId: "m-integration-routing",
      authoritativeInputs: [],
      policyVersions: ["v1.0.0"],
      budgets: {
        virtualTicks: 100,
        providerCalls: 10,
        maxFixAttempts: 3,
      },
      evidenceRefs: [],
      missionStateRef: "VERIFYING",
      contractPhase: "CONTRACT_BOUND",
      projectClass: "TYPESCRIPT_LIBRARY",
      frozenPlanContract: {
        contractId: "c-integration-routing",
        version: "v1.0.0",
        contractHash: "h-integration-routing",
        objective: "Verify candidate integration test",
        acceptanceCriteria: [],
        constraints: [],
        tasks: [],
        dependencies: [],
        allowedCapabilities: [],
        requiredTests: [
          {
            id: "t-integration-routing",
            type: "INTEGRATION_TEST",
            verifier: "INTEGRATION_VERIFIER",
            name: "Trusted Integration",
            command: "node --test attacker-controlled-integration.ts",
            expectedExitCode: 0,
          },
        ],
        securityRequirements: [],
        expectedArtifacts: [],
        evidenceRequirements: [],
        riskClassification: "LOW",
        completionConditions: [],
        frozenAt: Date.now(),
      },
    };

    let hostExecuteCalls = 0;
    let verificationExecuteCalls = 0;

    (kernel as any).executeCommand = () => {
      hostExecuteCalls += 1;
      throw new Error(
        "HOST_EXECUTION_FORBIDDEN: ProMax INTEGRATION reached executeCommand()"
      );
    };

    (kernel as any).executeVerificationCommand = (commandId: string) => {
      verificationExecuteCalls += 1;

      assert.equal(
        commandId,
        "integration",
        "INTEGRATION_VERIFIER must use the closed integration command id"
      );

      return {
        success: false,
        exitCode: null,
        stdout: "",
        stderr: "synthetic sandbox refusal",
        reasonCode: "TEST_SANDBOX_REFUSAL",
      };
    };

    const result = kernel.runProMaxVerification(candidate, context, []);

    assert.equal(hostExecuteCalls, 0);
    assert.equal(verificationExecuteCalls, 1);
    assert.equal(result.success, false);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
test("P0-PROMAX-DEFAULT: unknown verifier fails closed without host execution", () => {
  const ws = tempWorkspace("unknown-verifier");

  try {
    const kernel = new TrustedKernel({
      workspaceRoot: ws,
      humanAuthorizationGranted: true,
    });

    const candidateRelPath =
      "workspaces/v2-missions/m-unknown-verifier/leggo-integrated";

    const source = "export const safe = true;\n";
    const sourceHash = createHash("sha256").update(source).digest("hex");

    kernel.safeWriteWorkspaceFile(
      `${candidateRelPath}/src/index.ts`,
      source,
      "m-unknown-verifier"
    );

    const candidate: IntegratedCandidate = {
      candidateId: "cand-unknown-verifier",
      missionId: "m-unknown-verifier",
      integratedArtifacts: [
        {
          artifactId: "art-unknown-verifier",
          path: "src/index.ts",
          sha256: sourceHash,
          sizeBytes: source.length,
          missionId: "m-unknown-verifier",
        },
      ],
      resolvedConflicts: [],
      sourceTraceability: {
        "src/index.ts": "COLONY_A",
      },
      workspacePath: candidateRelPath,
    };

    const context: ContractBoundStageContext = {
      missionId: "m-unknown-verifier",
      authoritativeInputs: [],
      policyVersions: ["v1.0.0"],
      budgets: {
        virtualTicks: 100,
        providerCalls: 10,
        maxFixAttempts: 3,
      },
      evidenceRefs: [],
      missionStateRef: "VERIFYING",
      contractPhase: "CONTRACT_BOUND",
      projectClass: "TYPESCRIPT_LIBRARY",
      frozenPlanContract: {
        contractId: "c-unknown-verifier",
        version: "v1.0.0",
        contractHash: "h-unknown-verifier",
        objective: "Reject unknown verifier",
        acceptanceCriteria: [],
        constraints: [],
        tasks: [],
        dependencies: [],
        allowedCapabilities: [],
        requiredTests: [
          {
            id: "t-unknown-verifier",
            type: "TEST",
            verifier: "UNKNOWN_VERIFIER" as any,
            name: "Unknown verifier",
            command: "node attacker-controlled.js",
            expectedExitCode: 0,
          },
        ],
        securityRequirements: [],
        expectedArtifacts: [],
        evidenceRequirements: [],
        riskClassification: "LOW",
        completionConditions: [],
        frozenAt: Date.now(),
      },
    };

    let hostExecuteCalls = 0;
    let verificationExecuteCalls = 0;

    (kernel as any).executeCommand = () => {
      hostExecuteCalls += 1;
      throw new Error(
        "HOST_EXECUTION_FORBIDDEN: unknown ProMax verifier reached executeCommand()"
      );
    };

    (kernel as any).executeVerificationCommand = () => {
      verificationExecuteCalls += 1;
      throw new Error(
        "VERIFICATION_EXECUTION_FORBIDDEN: unknown verifier must not execute anything"
      );
    };

    const result = kernel.runProMaxVerification(candidate, context, []);

    assert.equal(hostExecuteCalls, 0);
    assert.equal(verificationExecuteCalls, 0);
    assert.equal(result.success, false);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
test("P0-PROMAX-DOCKER: DOCKER_BUILD never executes host Docker", () => {
  const ws = tempWorkspace("docker-build-host-refusal");

  try {
    const kernel = new TrustedKernel({
      workspaceRoot: ws,
      humanAuthorizationGranted: true,
    });

    const candidateRelPath =
      "workspaces/v2-missions/m-docker-build/leggo-integrated";

    const source = "export const safe = true;\n";
    const sourceHash = createHash("sha256").update(source).digest("hex");

    kernel.safeWriteWorkspaceFile(
      `${candidateRelPath}/src/index.ts`,
      source,
      "m-docker-build"
    );

    const candidate: IntegratedCandidate = {
      candidateId: "cand-docker-build",
      missionId: "m-docker-build",
      integratedArtifacts: [
        {
          artifactId: "art-docker-build",
          path: "src/index.ts",
          sha256: sourceHash,
          sizeBytes: source.length,
          missionId: "m-docker-build",
        },
      ],
      resolvedConflicts: [],
      sourceTraceability: {
        "src/index.ts": "COLONY_A",
      },
      workspacePath: candidateRelPath,
    };

    const context: ContractBoundStageContext = {
      missionId: "m-docker-build",
      authoritativeInputs: [],
      policyVersions: ["v1.0.0"],
      budgets: {
        virtualTicks: 100,
        providerCalls: 10,
        maxFixAttempts: 3,
      },
      evidenceRefs: [],
      missionStateRef: "VERIFYING",
      contractPhase: "CONTRACT_BOUND",
      projectClass: "TYPESCRIPT_LIBRARY",
      frozenPlanContract: {
        contractId: "c-docker-build",
        version: "v1.0.0",
        contractHash: "h-docker-build",
        objective: "Refuse host Docker verification",
        acceptanceCriteria: [],
        constraints: [],
        tasks: [],
        dependencies: [],
        allowedCapabilities: [],
        requiredTests: [
          {
            id: "t-docker-build",
            type: "DOCKER_BUILD",
            verifier: "DOCKER_BUILD_VERIFIER",
            name: "Docker build",
            command: "docker build .",
            expectedExitCode: 0,
          },
        ],
        securityRequirements: [],
        expectedArtifacts: [],
        evidenceRequirements: [],
        riskClassification: "LOW",
        completionConditions: [],
        frozenAt: Date.now(),
      },
    };

    let hostDockerCalls = 0;

    (kernel as any).executeDockerBuild = () => {
      hostDockerCalls += 1;
      throw new Error(
        "HOST_DOCKER_FORBIDDEN: ProMax DOCKER_BUILD reached executeDockerBuild()"
      );
    };

    const result = kernel.runProMaxVerification(candidate, context, []);

    assert.equal(hostDockerCalls, 0);
    assert.equal(result.success, false);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
test("P0-PROMAX-DOCKER-ISOLATED: approved isolated builder verifies Docker without host execution", () => {
  const ws = tempWorkspace("docker-build-isolated");
  const candidateRelPath =
    "workspaces/v2-missions/m-docker-isolated/leggo-integrated";
  const expectedWorkspaceAbsolute = resolve(ws, candidateRelPath);

  let isolatedBuilderCalls = 0;
  let hostDockerCalls = 0;

  const dockerfile = "FROM scratch\n";
  const dockerfileHash = createHash("sha256")
    .update(dockerfile)
    .digest("hex");

  const isolatedDockerBuildExecutor = {
    build(request: any) {
      isolatedBuilderCalls += 1;

      assert.equal(
        request.workspaceAbsolutePath,
        expectedWorkspaceAbsolute,
        "Isolated builder must receive canonical absolute candidate workspace"
      );

      return {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        reasonCode: "OK",
      };
    },
  };

  try {
    const kernel = new TrustedKernel({
      workspaceRoot: ws,
      humanAuthorizationGranted: true,
      verificationHumanAuthorized: true,
      isolatedDockerBuildExecutor,
    } as any);

    kernel.safeWriteWorkspaceFile(
      `${candidateRelPath}/Dockerfile`,
      dockerfile,
      "m-docker-isolated"
    );

    const candidate: IntegratedCandidate = {
      candidateId: "cand-docker-isolated",
      missionId: "m-docker-isolated",
      integratedArtifacts: [
        {
          artifactId: "art-dockerfile",
          path: "Dockerfile",
          sha256: dockerfileHash,
          sizeBytes: dockerfile.length,
          missionId: "m-docker-isolated",
        },
      ],
      resolvedConflicts: [],
      sourceTraceability: {
        Dockerfile: "COLONY_A",
      },
      workspacePath: candidateRelPath,
    };

    const context: ContractBoundStageContext = {
      missionId: "m-docker-isolated",
      authoritativeInputs: [],
      policyVersions: ["v1.0.0"],
      budgets: {
        virtualTicks: 100,
        providerCalls: 10,
        maxFixAttempts: 3,
      },
      evidenceRefs: [],
      missionStateRef: "VERIFYING",
      contractPhase: "CONTRACT_BOUND",
      projectClass: "DOCKERIZED_SERVICE",
      frozenPlanContract: {
        contractId: "c-docker-isolated",
        version: "v1.0.0",
        contractHash: "h-docker-isolated",
        objective: "Verify Docker through isolated builder",
        acceptanceCriteria: [
          {
            id: "ac-docker-isolated",
            description: "Docker image builds in isolated builder",
            verificationMethod: "TEST",
            required: true,
            requiredRequirementId: "t-docker-isolated",
          },
        ],
        constraints: [],
        tasks: [],
        dependencies: [],
        allowedCapabilities: [],
        requiredTests: [
          {
            id: "t-docker-isolated",
            type: "DOCKER_BUILD",
            verifier: "DOCKER_BUILD_VERIFIER",
            name: "Docker isolated build",
            command: "docker run malicious-candidate-command",
            expectedExitCode: 0,
            provesCriterionIds: ["ac-docker-isolated"],
          },
        ],
        securityRequirements: [],
        expectedArtifacts: [],
        evidenceRequirements: [],
        riskClassification: "LOW",
        completionConditions: [],
        frozenAt: Date.now(),
      },
    };

    (kernel as any).executeDockerBuild = () => {
      hostDockerCalls += 1;
      throw new Error("HOST_DOCKER_FORBIDDEN");
    };

    const result = kernel.runProMaxVerification(candidate, context, []);

    assert.equal(hostDockerCalls, 0);
    assert.equal(isolatedBuilderCalls, 1);
    assert.equal(result.success, true);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("P0-PROMAX-DOCKER-AUTH: isolated Docker refuses before builder without verification authorization", () => {
  const ws = mkdtempSync(join(tmpdir(), "namla-promax-docker-auth-"));
  const candidateRelPath = "candidate";
  let isolatedBuilderCalls = 0;
  let hostDockerCalls = 0;

  const isolatedDockerBuildExecutor = {
    build() {
      isolatedBuilderCalls += 1;
      throw new Error("BUILDER_MUST_NOT_BE_CALLED");
    },
  };

  try {
    const kernel = new TrustedKernel({
      workspaceRoot: ws,
      humanAuthorizationGranted: true,
      verificationHumanAuthorized: false,
      isolatedDockerBuildExecutor,
    });

    const dockerfile = "FROM scratch\n";
    const dockerfileHash = createHash("sha256").update(dockerfile).digest("hex");
    kernel.safeWriteWorkspaceFile(candidateRelPath + "/Dockerfile", dockerfile, "m-docker-auth");

    const candidate: IntegratedCandidate = {
      candidateId: "cand-docker-auth",
      missionId: "m-docker-auth",
      integratedArtifacts: [
        {
          artifactId: "art-docker-auth",
          path: "Dockerfile",
          sha256: dockerfileHash,
          sizeBytes: dockerfile.length,
          missionId: "m-docker-auth",
        },
      ],
      resolvedConflicts: [],
      sourceTraceability: { Dockerfile: "COLONY_A" },
      workspacePath: candidateRelPath,
    };


    const context: ContractBoundStageContext = {
      missionId: "m-docker-auth",
      authoritativeInputs: [],
      policyVersions: ["v1.0.0"],
      budgets: {
        virtualTicks: 100,
        providerCalls: 10,
        maxFixAttempts: 3,
      },
      evidenceRefs: [],
      missionStateRef: "VERIFYING",
      contractPhase: "CONTRACT_BOUND",
      projectClass: "DOCKERIZED_SERVICE",
      frozenPlanContract: {
        contractId: "c-docker-auth",
        version: "v1.0.0",
        contractHash: "h-docker-auth",
        objective: "Refuse Docker verification without explicit authorization",
        acceptanceCriteria: [
          {
            id: "ac-docker-auth",
            description: "Docker image builds only with explicit verification authorization",
            verificationMethod: "TEST",
            required: true,
            requiredRequirementId: "t-docker-auth",
          },
        ],
        constraints: [],
        tasks: [],
        dependencies: [],
        allowedCapabilities: [],
        requiredTests: [
          {
            id: "t-docker-auth",
            type: "DOCKER_BUILD",
            verifier: "DOCKER_BUILD_VERIFIER",
            name: "Docker authorization refusal",
            command: "docker run malicious-candidate-command",
            expectedExitCode: 0,
            provesCriterionIds: ["ac-docker-auth"],
          },
        ],
        securityRequirements: [],
        expectedArtifacts: [],
        evidenceRequirements: [],
        riskClassification: "LOW",
        completionConditions: [],
        frozenAt: Date.now(),
      },
    };


    (kernel as any).executeDockerBuild = () => {
      hostDockerCalls += 1;
      throw new Error("HOST_DOCKER_FORBIDDEN");
    };

    const result = kernel.runProMaxVerification(candidate, context, []);

    assert.equal(hostDockerCalls, 0);
    assert.equal(isolatedBuilderCalls, 0);
    assert.equal(result.success, false);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("P0-PROMAX-DOCKER-UNAVAILABLE: missing isolated Docker builder fails closed without host fallback", () => {
  const ws = mkdtempSync(join(tmpdir(), "namla-promax-docker-unavailable-"));
  const candidateRelPath = "candidate";
  let hostDockerCalls = 0;

  try {
    const kernel = new TrustedKernel({
      workspaceRoot: ws,
      humanAuthorizationGranted: true,
      verificationHumanAuthorized: true,
    });

    const dockerfile = "FROM scratch\n";
    const dockerfileHash = createHash("sha256").update(dockerfile).digest("hex");
    kernel.safeWriteWorkspaceFile(candidateRelPath + "/Dockerfile", dockerfile, "m-docker-unavailable");

    const candidate: IntegratedCandidate = {
      candidateId: "cand-docker-unavailable",
      missionId: "m-docker-unavailable",
      integratedArtifacts: [
        {
          artifactId: "art-docker-unavailable",
          path: "Dockerfile",
          sha256: dockerfileHash,
          sizeBytes: dockerfile.length,
          missionId: "m-docker-unavailable",
        },
      ],
      resolvedConflicts: [],
      sourceTraceability: { Dockerfile: "COLONY_A" },
      workspacePath: candidateRelPath,
    };


    const context: ContractBoundStageContext = {
      missionId: "m-docker-unavailable",
      authoritativeInputs: [],
      policyVersions: ["v1.0.0"],
      budgets: {
        virtualTicks: 100,
        providerCalls: 10,
        maxFixAttempts: 3,
      },
      evidenceRefs: [],
      missionStateRef: "VERIFYING",
      contractPhase: "CONTRACT_BOUND",
      projectClass: "DOCKERIZED_SERVICE",
      frozenPlanContract: {
        contractId: "c-docker-unavailable",
        version: "v1.0.0",
        contractHash: "h-docker-unavailable",
        objective: "Fail closed when isolated Docker builder is unavailable",
        acceptanceCriteria: [
          {
            id: "ac-docker-unavailable",
            description: "Docker verification requires an isolated builder",
            verificationMethod: "TEST",
            required: true,
            requiredRequirementId: "t-docker-unavailable",
          },
        ],
        constraints: [],
        tasks: [],
        dependencies: [],
        allowedCapabilities: [],
        requiredTests: [
          {
            id: "t-docker-unavailable",
            type: "DOCKER_BUILD",
            verifier: "DOCKER_BUILD_VERIFIER",
            name: "Docker builder unavailable",
            command: "docker run malicious-candidate-command",
            expectedExitCode: 0,
            provesCriterionIds: ["ac-docker-unavailable"],
          },
        ],
        securityRequirements: [],
        expectedArtifacts: [],
        evidenceRequirements: [],
        riskClassification: "LOW",
        completionConditions: [],
        frozenAt: Date.now(),
      },
    };

    (kernel as any).executeDockerBuild = () => {
      hostDockerCalls += 1;
      throw new Error("HOST_DOCKER_FORBIDDEN");
    };

    const result = kernel.runProMaxVerification(candidate, context, []);
    const unavailableRequirementMapping = result.proofMappings.find((m) => m.criterionId === "t-docker-unavailable");
    const unavailableCriterionMapping = result.proofMappings.find((m) => m.criterionId === "ac-docker-unavailable");

    assert.equal(hostDockerCalls, 0);
    assert.equal(result.success, false);
    assert.equal(unavailableRequirementMapping !== undefined, true);
    assert.equal(unavailableRequirementMapping?.status, "BLOCKED");
    assert.equal(unavailableRequirementMapping?.observation.includes("Isolated Docker build executor unavailable"), true);
    assert.equal(unavailableCriterionMapping !== undefined, true);
    assert.equal(unavailableCriterionMapping?.status, "FAILED");
    assert.equal(unavailableCriterionMapping?.observation.includes("Prerequisite verification failure blocked criterion evaluation"), true);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("P0-PROMAX-DOCKER-EXECUTOR-ERROR: isolated Docker builder exception fails closed without host fallback", () => {
  const ws = mkdtempSync(join(tmpdir(), "namla-promax-docker-executor-error-"));
  const candidateRelPath = "candidate";
  let isolatedBuilderCalls = 0;
  let hostDockerCalls = 0;

  const isolatedDockerBuildExecutor = {
    build() {
      isolatedBuilderCalls += 1;
      throw new Error("SIMULATED_ISOLATED_BUILDER_FAILURE");
    },
  };

  try {
    const kernel = new TrustedKernel({
      workspaceRoot: ws,
      humanAuthorizationGranted: true,
      verificationHumanAuthorized: true,
      isolatedDockerBuildExecutor,
    });

    const dockerfile = "FROM scratch\n";
    const dockerfileHash = createHash("sha256").update(dockerfile).digest("hex");
    kernel.safeWriteWorkspaceFile(candidateRelPath + "/Dockerfile", dockerfile, "m-docker-executor-error");

    const candidate: IntegratedCandidate = {
      candidateId: "cand-docker-executor-error",
      missionId: "m-docker-executor-error",
      integratedArtifacts: [
        {
          artifactId: "art-docker-executor-error",
          path: "Dockerfile",
          sha256: dockerfileHash,
          sizeBytes: dockerfile.length,
          missionId: "m-docker-executor-error",
        },
      ],
      resolvedConflicts: [],
      sourceTraceability: { Dockerfile: "COLONY_A" },
      workspacePath: candidateRelPath,
    };


    const context: ContractBoundStageContext = {
      missionId: "m-docker-executor-error",
      authoritativeInputs: [],
      policyVersions: ["v1.0.0"],
      budgets: {
        virtualTicks: 100,
        providerCalls: 10,
        maxFixAttempts: 3,
      },
      evidenceRefs: [],
      missionStateRef: "VERIFYING",
      contractPhase: "CONTRACT_BOUND",
      projectClass: "DOCKERIZED_SERVICE",
      frozenPlanContract: {
        contractId: "c-docker-executor-error",
        version: "v1.0.0",
        contractHash: "h-docker-executor-error",
        objective: "Fail closed when isolated Docker builder throws",
        acceptanceCriteria: [
          {
            id: "ac-docker-executor-error",
            description: "Docker verification fails closed when isolated builder throws",
            verificationMethod: "TEST",
            required: true,
            requiredRequirementId: "t-docker-executor-error",
          },
        ],
        constraints: [],
        tasks: [],
        dependencies: [],
        allowedCapabilities: [],
        requiredTests: [
          {
            id: "t-docker-executor-error",
            type: "DOCKER_BUILD",
            verifier: "DOCKER_BUILD_VERIFIER",
            name: "Docker isolated builder throws",
            command: "docker run malicious-candidate-command",
            expectedExitCode: 0,
            provesCriterionIds: ["ac-docker-executor-error"],
          },
        ],
        securityRequirements: [],
        expectedArtifacts: [],
        evidenceRequirements: [],
        riskClassification: "LOW",
        completionConditions: [],
        frozenAt: Date.now(),
      },
    };

    (kernel as any).executeDockerBuild = () => {
      hostDockerCalls += 1;
      throw new Error("HOST_DOCKER_FORBIDDEN");
    };

    const result = kernel.runProMaxVerification(candidate, context, []);
    const executorErrorRequirementMapping = result.proofMappings.find((m) => m.criterionId === "t-docker-executor-error");
    const executorErrorCriterionMapping = result.proofMappings.find((m) => m.criterionId === "ac-docker-executor-error");

    assert.equal(hostDockerCalls, 0);
    assert.equal(isolatedBuilderCalls, 1);
    assert.equal(result.success, false);
    assert.equal(executorErrorRequirementMapping !== undefined, true);
    assert.equal(executorErrorRequirementMapping?.status, "BLOCKED");
    assert.equal(executorErrorRequirementMapping?.observation.includes("Isolated Docker build executor failed"), true);
    assert.equal(executorErrorCriterionMapping !== undefined, true);
    assert.equal(executorErrorCriterionMapping?.status, "FAILED");
    assert.equal(executorErrorCriterionMapping?.observation.includes("Prerequisite verification failure blocked criterion evaluation"), true);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
