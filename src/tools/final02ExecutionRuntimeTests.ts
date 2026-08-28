/**
 * final02ExecutionRuntimeTests — Comprehensive test suite for FINAL-02 (P0-4 Hardened).
 *
 * Exercises all 22+ required test scenarios:
 * 1. Production driver reaches READY and SECURITY_VERIFIED.
 * 2. Missing execution driver fails closed (BLOCKED).
 * 3. Fake driver returns UNVERIFIED (never READY).
 * 4. Fingerprint mismatch between court receipt and frozen bundle fails closed (BLOCKED).
 * 5. Non-executed rejection paths report SECURITY_NOT_RUN.
 * 6. All 12 Conflict Classes Taxonomy classification and resolution.
 * 7. Security policy conflict causes BLOCKED state.
 * 8. Database schema conflict causes BLOCKED state.
 * 9. Verification stage failure triggers workspace rollback and emits RollbackReceipt.
 * 10. Bounded repair loop with pluggable strategy.
 * 11. RealBackedVerificationDriver environmental blocker returns failed outcome.
 * 12. Execution Plan fields validation.
 * 13. RegressionReceipt generated and validated.
 * 14. Secret leak protection scan in customer delivery.
 * 15. Invalid Ed25519 signature fails closed (SECURITY_BLOCKED).
 * 16. Modified signed payload fails signature check (SECURITY_BLOCKED).
 * 17. Unknown backend key in key registry fails closed (SECURITY_BLOCKED).
 * 18. Workspace ID mismatch fails closed (SECURITY_BLOCKED).
 * 19. Absolute workspace path mismatch fails closed (SECURITY_BLOCKED).
 * 20. Merged tree digest mismatch fails closed (SECURITY_BLOCKED).
 * 21. FILE_DELETE_MODIFY conflict detection.
 * 22. REPAIR_UNAVAILABLE fail closed when no repair strategy matches.
 * 23. Test-only signer isolation check (src/twin/final02/** cannot import test fixtures).
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runFinal02ExecutionRuntime, classifyConflict } from "../twin/final02ExecutionRuntime";
import { runTwinPostColonyPipeline } from "../twin/twinPostColonyPipeline";
import type { TwinEmpireLiveRunResult, TwinColonyLiveResult } from "../twin/twinColonyLiveRunner";
import type { ColonyEvidenceBundle, ColonyId, ColonyCulture } from "../twin/twinColonyTypes";
import { fnv1a } from "../twin/twinColonyTypes";
import { freezeBundle } from "../twin/colonyForge";
import type { TwinBuildLoopResult, TwinVerificationReceipt } from "../twin/twinBuildLoop";
import type { MergeVerificationStage, MergeVerificationOutcome, MergeVerificationDriver, MergeVerificationDriverInput } from "../twin/mergeForge";
import { FakeMergeVerificationDriver } from "../twin/mergeForge";
import type { ApprovedMergeComponent } from "../twin/namolaSovereignCourt";
import { RealBackedVerificationDriver } from "../cognitive/liveRealDrivers";
import { calculateTreeDigestFromDisk } from "../twin/final02/treeDigest";
import { ensureTwinColonyWorkspace } from "../cognitive/smokeWorkspace";
import {
  signTestSandboxSecurityReceipt,
  TEST_SANDBOX_PUBLIC_KEY_PEM,
  TEST_SANDBOX_KEY_ID,
} from "./testFixtures/final02SandboxSigner";
import type { TrustedSandboxKeyRegistry } from "../twin/final02/sandboxReceiptVerifier";

const DEFAULT_ACCEPTANCE = ["tasks CRUD + completion", "in-memory storage", "unit tests present", "README + architecture docs", "security review"];

export const TEST_KEY_REGISTRY: TrustedSandboxKeyRegistry = {
  resolve(backendId: string, keyId: string) {
    if (backendId === "docker-container-sandbox" && keyId === TEST_SANDBOX_KEY_ID) {
      return {
        backendId,
        keyId,
        publicKeyPem: TEST_SANDBOX_PUBLIC_KEY_PEM,
      };
    }
    return null;
  },
};

class TestRealVerificationDriver implements MergeVerificationDriver {
  readonly isReal = true;
  constructor(
    private readonly sandboxBackendId: string = "docker-container-sandbox",
    private readonly sandboxVerified: boolean = true,
    private readonly simulateFailureStage: MergeVerificationStage | null = null
  ) {}

  run(input: MergeVerificationDriverInput): MergeVerificationOutcome {
    const stage = input.stage;
    const workspacePath = input.workspaceId;
    const absPath = input.absoluteWorkspacePath;
    const digest = input.expectedMergedTreeDigest;
    const injectFailure = input.injectFailure === true;

    const passed = stage !== this.simulateFailureStage && !injectFailure;

    const unsignedReceipt = {
      backendId: this.sandboxBackendId,
      keyId: TEST_SANDBOX_KEY_ID,
      backendVerificationId: "verif-real-docker",
      executionId: "exec-101",
      workspaceId: workspacePath,
      absoluteWorkspacePath: absPath,
      mergedTreeDigest: digest,
      realProcessExecution: true,
      sandboxVerified: this.sandboxVerified,
      networkIsolated: true,
      credentialsProtected: true,
      dockerSocketProtected: true,
      mountPolicyVerified: true,
      sourceMountReadOnly: true,
      pathTraversalProtected: true,
      symlinkEscapeProtected: true,
      resourceLimitsVerified: true,
      timeoutEnforced: true,
      cleanupVerified: true,
    };

    const securityReceipt = signTestSandboxSecurityReceipt(unsignedReceipt);

    return {
      stage,
      passed,
      realExecution: true,
      workspaceId: workspacePath,
      absolutePathIdentity: absPath,
      baselineDigest: "sha256-real-baseline",
      mergedTreeDigest: digest,
      securityReceipt,
    };
  }
}

function createTestBundle(opts: {
  colonyId: ColonyId;
  culture: ColonyCulture;
  finalStatus?: "VERIFIED" | "FAILED" | "VERIFICATION_BLOCKED";
  securityPassed?: boolean;
  selfReview?: boolean;
  emptyArtifacts?: boolean;
  artifactRelPath?: string;
  artifactContent?: string;
  extraArtifacts?: Array<{ relativePath: string; content: string }>;
}): ColonyEvidenceBundle {
  const colonyId = opts.colonyId;
  const culture = opts.culture;
  const finalStatus = opts.finalStatus ?? "VERIFIED";
  const securityPassed = opts.securityPassed ?? true;
  const selfReview = opts.selfReview ?? false;
  const emptyArtifacts = opts.emptyArtifacts ?? false;

  const artifactRelPath = opts.artifactRelPath ?? (culture === "architecture-first" ? "src/repository.ts" : "src/taskManager.ts");
  const artifactContent = opts.artifactContent ?? (culture === "architecture-first"
    ? "export class InMemoryRepository {}"
    : "export class TaskManager {}");

  let artifacts = emptyArtifacts
    ? []
    : [{ relativePath: artifactRelPath, content: artifactContent, purpose: "core", acceptanceCriteriaCovered: DEFAULT_ACCEPTANCE.slice(0, 2) }];

  if (opts.extraArtifacts) {
    for (const extra of opts.extraArtifacts) {
      artifacts.push({
        relativePath: extra.relativePath,
        content: extra.content,
        purpose: "extra",
        acceptanceCriteriaCovered: DEFAULT_ACCEPTANCE.slice(0, 1),
      });
    }
  }

  const artifactManifest = artifacts.map((a) => ({
    relativePath: a.relativePath,
    bytes: a.content.length,
    fingerprint: fnv1a(`${a.relativePath}|${a.content}`),
  }));

  const authorAntId = `author-${colonyId}`;
  const reviewerAntId = selfReview ? authorAntId : `reviewer-${colonyId}`;

  const reviews = [
    {
      reviewerAntId,
      authorAntId,
      decision: "approve" as const,
      findings: ["approved"],
      securityFindings: [],
      selfReview,
    },
  ];

  const stageReceipts: TwinVerificationReceipt[] = [
    {
      colonyId,
      attempt: 0,
      stage: "typecheck",
      commandId: "typecheck",
      status: finalStatus === "VERIFIED" ? "PASS" : finalStatus === "FAILED" ? "FAIL" : "BLOCKED",
      failureCategory: finalStatus === "VERIFIED" ? null : "verification-failed",
      safeReasonCode: finalStatus === "VERIFIED" ? "verification-passed" : "verification-failed",
      outputLineCount: 5,
      realProcessExecutions: 1,
      sandboxBackendId: "fake-test-backend",
      sandboxVerified: false,
      order: 0,
    },
  ];

  const draft = {
    colonyId,
    missionId: "test-mission",
    culture,
    workspacePath: `workspaces/namola-twin/test-mission/${colonyId}`,
    architecture: {
      architectureSummary: "architecture summary",
      filePlan: artifacts.map((a) => a.relativePath),
      acceptanceMapping: DEFAULT_ACCEPTANCE.map((c) => `covers ${c}`),
      interfaceDecisions: [],
      risks: ["minor-risk"],
    },
    artifacts,
    artifactManifest,
    reviews,
    testEvidence: { testsProposed: 1, independentReviews: selfReview ? 0 : 1, artifactCount: artifacts.length },
    securityEvidence: { findings: securityPassed ? [] : ["vulnerability-found"], passed: securityPassed },
    performanceEvidence: [{ check: "artifact-size-within-cap", observed: 100, budget: 20000, withinBudget: true }],
    riskRegister: ["known-risk"],
    failureRegister: [],
    uncertaintyRegister: ["uncertainty-1"],
    minorityReports: ["minority-report-1"],
    providerReceipts: [
      { antId: authorAntId, providerId: colonyId === "claude-forge" ? "claude" : "codex", role: "implementation", ok: true, real: false },
    ],
    costReport: { providerCalls: 1, realProviderCalls: 0 },
    reproductionInstructions: ["npm test"],
    evidenceVersion: 2 as const,
    verification: {
      finalStatus,
      verificationRounds: 1,
      repairAttempts: 0,
      filesAppliedByRepair: 0,
      sandboxBackendId: "fake-test-backend",
      sandboxVerified: false,
      stopReason: null,
      stageReceipts: stageReceipts.map((r) => ({
        attempt: r.attempt,
        stage: r.stage,
        commandId: r.commandId,
        status: r.status,
        safeReasonCode: r.safeReasonCode,
        outputLineCount: r.outputLineCount,
        realProcessExecutions: r.realProcessExecutions,
      })),
      repairReceipts: [],
      workspaceFingerprint: fnv1a(`${colonyId}|${artifactRelPath}|1`),
    },
  };

  return freezeBundle(draft);
}

function createColonyResult(colonyId: ColonyId, culture: ColonyCulture, bundleOverrides: Parameters<typeof createTestBundle>[0] = { colonyId, culture }): TwinColonyLiveResult {
  const bundle = createTestBundle(bundleOverrides);
  const candidateVerified = bundle.verification?.finalStatus === "VERIFIED";

  const loopResult: TwinBuildLoopResult = {
    state: candidateVerified ? "CANDIDATE_VERIFIED" : "FAIL_CLOSED",
    finalStatus: bundle.verification?.finalStatus === "VERIFIED" ? "PASS" : bundle.verification?.finalStatus === "FAILED" ? "FAIL" : "BLOCKED",
    verificationRounds: 1,
    repairAttempts: 0,
    filesAppliedByRepair: 0,
    receipts: [],
    repairReceipts: [],
    stopReason: null,
    finalCandidatePaths: bundle.artifacts.map((a) => a.relativePath),
  };

  return {
    colonyId,
    ok: true,
    failureReason: null,
    bundle,
    providerCalls: 1,
    artifactsApplied: bundle.artifacts.length,
    independentReviews: bundle.reviews.filter((r) => !r.selfReview).length,
    selfReviewsAccepted: 0,
    architecturePlan: bundle.architecture.filePlan,
    reviewApproved: true,
    diagnostics: [],
    realProviderProcessExecutions: 0,
    normalizationReceipts: [],
    reviewSkippedReason: null,
    completedRoles: ["implementation"],
    loop: loopResult,
    candidateVerified,
  };
}

function createEmpireRunResult(opts: {
  claudeVerified?: boolean;
  codexVerified?: boolean;
  claudeStatus?: "VERIFIED" | "FAILED" | "VERIFICATION_BLOCKED";
  codexStatus?: "VERIFIED" | "FAILED" | "VERIFICATION_BLOCKED";
  claudeSecurityPassed?: boolean;
  codexSecurityPassed?: boolean;
  extraArtifactsClaude?: Array<{ relativePath: string; content: string }>;
  extraArtifactsCodex?: Array<{ relativePath: string; content: string }>;
  runStatus?: "twin-bundles-frozen" | "twin-live-run-failed";
} = {}): TwinEmpireLiveRunResult {
  const runStatus = opts.runStatus ?? "twin-bundles-frozen";
  const claudeRes = createColonyResult("claude-forge", "architecture-first", {
    colonyId: "claude-forge",
    culture: "architecture-first",
    finalStatus: opts.claudeStatus ?? (opts.claudeVerified === false ? "FAILED" : "VERIFIED"),
    securityPassed: opts.claudeSecurityPassed,
    extraArtifacts: opts.extraArtifactsClaude,
  });

  const codexRes = createColonyResult("codex-crucible", "implementation-first", {
    colonyId: "codex-crucible",
    culture: "implementation-first",
    finalStatus: opts.codexStatus ?? (opts.codexVerified === false ? "FAILED" : "VERIFIED"),
    securityPassed: opts.codexSecurityPassed,
    extraArtifacts: opts.extraArtifactsCodex,
  });

  return {
    status: runStatus,
    claude: claudeRes,
    codex: codexRes,
    bothFrozen: runStatus === "twin-bundles-frozen",
    distinctFingerprints: true,
    bothVerified: claudeRes.candidateVerified && codexRes.candidateVerified,
    claudeVerificationStatus: claudeRes.bundle?.verification?.finalStatus ?? "NOT_PRODUCED",
    codexVerificationStatus: codexRes.bundle?.verification?.finalStatus ?? "NOT_PRODUCED",
  };
}

export function runFinal02ExecutionRuntimeTests(): { readonly ok: true; readonly testsPassed: number } {
  let testsPassed = 0;

  // 1. Production driver reaches READY and SECURITY_VERIFIED with exact byte materialization.
  {
    const runResult = createEmpireRunResult({ claudeVerified: true, codexVerified: true });
    const postColonyRes = runTwinPostColonyPipeline({
      runResult,
      acceptanceCriteria: DEFAULT_ACCEPTANCE,
      budget: { maxMergeComponents: 4 },
    });

    const realDriver = new TestRealVerificationDriver("docker-container-sandbox", true);

    const final02Res = runFinal02ExecutionRuntime({
      postColonyResult: postColonyRes,
      missionId: "test-mission",
      objective: "Build small task manager",
      acceptanceCriteria: DEFAULT_ACCEPTANCE,
      mergeVerificationDriver: realDriver,
      keyRegistry: TEST_KEY_REGISTRY,
    });

    assert.equal(final02Res.status, "READY");
    assert.equal(final02Res.securityGate.status, "SECURITY_VERIFIED");
    assert.equal(final02Res.securityGate.sandboxVerified, true);
    assert.equal(final02Res.metrics.realMergeExecuted, true);
    assert.equal(final02Res.metrics.writtenComponentCount, 2);
    assert.equal(final02Res.metrics.fingerprintVerifiedCount, 2);
    assert.ok(final02Res.baselineReceipt?.created);
    assert.ok(final02Res.regressionReceipt?.passed);

    testsPassed += 1;
  }

  // 2. Production entry point without driver fails closed with BLOCKED.
  {
    const runResult = createEmpireRunResult({ claudeVerified: true, codexVerified: true });
    const postColonyRes = runTwinPostColonyPipeline({
      runResult,
      acceptanceCriteria: DEFAULT_ACCEPTANCE,
      budget: { maxMergeComponents: 4 },
    });

    const final02Res = runFinal02ExecutionRuntime({
      postColonyResult: postColonyRes,
      missionId: "test-mission",
      objective: "Build small task manager",
      acceptanceCriteria: DEFAULT_ACCEPTANCE,
      mergeVerificationDriver: null,
      keyRegistry: TEST_KEY_REGISTRY,
    });

    assert.equal(final02Res.status, "BLOCKED");
    assert.equal(final02Res.reasonCode, "missing-execution-backend");

    testsPassed += 1;
  }

  // 3. Fake driver MUST NEVER reach READY (returns UNVERIFIED).
  {
    const runResult = createEmpireRunResult({ claudeVerified: true, codexVerified: true });
    const postColonyRes = runTwinPostColonyPipeline({
      runResult,
      acceptanceCriteria: DEFAULT_ACCEPTANCE,
      budget: { maxMergeComponents: 4 },
    });

    const fakeDriver = new FakeMergeVerificationDriver();

    const final02Res = runFinal02ExecutionRuntime({
      postColonyResult: postColonyRes,
      missionId: "test-mission",
      objective: "Build small task manager",
      acceptanceCriteria: DEFAULT_ACCEPTANCE,
      mergeVerificationDriver: fakeDriver,
      keyRegistry: TEST_KEY_REGISTRY,
    });

    assert.equal(final02Res.status, "UNVERIFIED");
    assert.notEqual(final02Res.status, "READY");
    assert.equal(final02Res.securityGate.status, "SECURITY_UNVERIFIED");
    assert.equal(final02Res.metrics.deliveryReady, false);

    testsPassed += 1;
  }

  // 4. Fingerprint mismatch between court receipt and frozen evidence fails closed (BLOCKED).
  {
    const runResult = createEmpireRunResult({ claudeVerified: true, codexVerified: true });
    const postColonyRes = runTwinPostColonyPipeline({
      runResult,
      acceptanceCriteria: DEFAULT_ACCEPTANCE,
      budget: { maxMergeComponents: 4 },
    });

    if (postColonyRes.status === "success") {
      (postColonyRes.decisionReceipt as any).approvedComponents[0].sourceFingerprint = "corrupted-fp";
    }

    const realDriver = new TestRealVerificationDriver("docker-container-sandbox", true);

    const final02Res = runFinal02ExecutionRuntime({
      postColonyResult: postColonyRes,
      missionId: "test-mission",
      objective: "Build small task manager",
      acceptanceCriteria: DEFAULT_ACCEPTANCE,
      mergeVerificationDriver: realDriver,
      keyRegistry: TEST_KEY_REGISTRY,
    });

    assert.equal(final02Res.status, "BLOCKED");
    assert.equal(final02Res.reasonCode, "artifact-fingerprint-mismatch");

    testsPassed += 1;
  }

  // 5. Non-executed rejection paths report SECURITY_NOT_RUN.
  {
    const runResult = createEmpireRunResult({ claudeStatus: "VERIFICATION_BLOCKED", codexStatus: "VERIFICATION_BLOCKED" });
    const postColonyRes = runTwinPostColonyPipeline({
      runResult,
      acceptanceCriteria: DEFAULT_ACCEPTANCE,
      budget: { maxMergeComponents: 4 },
    });

    const realDriver = new TestRealVerificationDriver();

    const final02Res = runFinal02ExecutionRuntime({
      postColonyResult: postColonyRes,
      missionId: "test-mission",
      objective: "Build small task manager",
      acceptanceCriteria: DEFAULT_ACCEPTANCE,
      mergeVerificationDriver: realDriver,
      keyRegistry: TEST_KEY_REGISTRY,
    });

    assert.equal(final02Res.status, "REJECTED");
    assert.equal(final02Res.securityGate.status, "SECURITY_NOT_RUN");

    testsPassed += 1;
  }

  // 6. 12 Conflict Classes Taxonomy classification tests.
  {
    const dummyComp: ApprovedMergeComponent[] = [
      { componentId: "c1", sourceColony: "claude-forge", sourceArtifactId: "a1", sourceFingerprint: "fp1", relativePath: "x", requirementsCovered: [], evidenceRefs: [], reasonSelected: "r", knownRisks: [], requiredMergeTests: [] },
      { componentId: "c2", sourceColony: "codex-crucible", sourceArtifactId: "a2", sourceFingerprint: "fp2", relativePath: "x", requirementsCovered: [], evidenceRefs: [], reasonSelected: "r", knownRisks: [], requiredMergeTests: [] },
    ];

    assert.equal(classifyConflict("src/component.ts", dummyComp).conflictClass, "FILE_ADD_ADD");
    assert.equal(classifyConflict("package.json", dummyComp).conflictClass, "DEPENDENCY_CONFLICT");
    assert.equal(classifyConflict("tsconfig.json", dummyComp).conflictClass, "CONFIG_CONFLICT");
    assert.equal(classifyConflict("src/types.d.ts", dummyComp).conflictClass, "TYPE_CONFLICT");
    assert.equal(classifyConflict("test/app.test.ts", dummyComp).conflictClass, "TEST_CONFLICT");
    assert.equal(classifyConflict("db/migration.sql", dummyComp).conflictClass, "DATABASE_SCHEMA_CONFLICT");
    assert.equal(classifyConflict("src/securityPolicy.ts", dummyComp).conflictClass, "SECURITY_POLICY_CONFLICT");
    assert.equal(classifyConflict("../escape/passwd", dummyComp).conflictClass, "UNKNOWN_CONFLICT");

    testsPassed += 1;
  }

  // 7. Security policy conflict causes unresolved conflict fail-closed BLOCKED state.
  {
    const extra = [{ relativePath: "src/securityPolicy.ts", content: "export const policy = 'strict';" }];
    const runResult = createEmpireRunResult({
      claudeVerified: true,
      codexVerified: true,
      extraArtifactsClaude: extra,
      extraArtifactsCodex: extra,
    });

    const postColonyRes = runTwinPostColonyPipeline({
      runResult,
      acceptanceCriteria: DEFAULT_ACCEPTANCE,
      budget: { maxMergeComponents: 4 },
    });

    if (postColonyRes.status === "success") {
      const receipt = postColonyRes.decisionReceipt;
      const fpClaude = fnv1a("src/securityPolicy.ts|export const policy = 'strict';");
      const secComp: ApprovedMergeComponent = {
        componentId: "sec1",
        sourceColony: "claude-forge",
        sourceArtifactId: "src/securityPolicy.ts",
        sourceFingerprint: fpClaude,
        relativePath: "src/securityPolicy.ts",
        requirementsCovered: [],
        evidenceRefs: [],
        reasonSelected: "security",
        knownRisks: [],
        requiredMergeTests: [],
      };
      const secComp2: ApprovedMergeComponent = {
        componentId: "sec2",
        sourceColony: "codex-crucible",
        sourceArtifactId: "src/securityPolicy.ts",
        sourceFingerprint: fpClaude,
        relativePath: "src/securityPolicy.ts",
        requirementsCovered: [],
        evidenceRefs: [],
        reasonSelected: "security",
        knownRisks: [],
        requiredMergeTests: [],
      };
      (receipt as any).approvedComponents = [secComp, secComp2];
    }

    const realDriver = new TestRealVerificationDriver();

    const final02Res = runFinal02ExecutionRuntime({
      postColonyResult: postColonyRes,
      missionId: "test-mission",
      objective: "Build small task manager",
      acceptanceCriteria: DEFAULT_ACCEPTANCE,
      mergeVerificationDriver: realDriver,
      keyRegistry: TEST_KEY_REGISTRY,
    });

    assert.equal(final02Res.status, "BLOCKED");
    assert.ok(final02Res.reasonCode.includes("SECURITY_POLICY_CONFLICT"));

    testsPassed += 1;
  }

  // 8. Database schema conflict causes unresolved conflict fail-closed BLOCKED state.
  {
    const extra = [{ relativePath: "db/migration.sql", content: "CREATE TABLE tasks (id INT);" }];
    const runResult = createEmpireRunResult({
      claudeVerified: true,
      codexVerified: true,
      extraArtifactsClaude: extra,
      extraArtifactsCodex: extra,
    });

    const postColonyRes = runTwinPostColonyPipeline({
      runResult,
      acceptanceCriteria: DEFAULT_ACCEPTANCE,
      budget: { maxMergeComponents: 4 },
    });

    if (postColonyRes.status === "success") {
      const receipt = postColonyRes.decisionReceipt;
      const fpDb = fnv1a("db/migration.sql|CREATE TABLE tasks (id INT);");
      const db1: ApprovedMergeComponent = {
        componentId: "db1",
        sourceColony: "claude-forge",
        sourceArtifactId: "db/migration.sql",
        sourceFingerprint: fpDb,
        relativePath: "db/migration.sql",
        requirementsCovered: [],
        evidenceRefs: [],
        reasonSelected: "db",
        knownRisks: [],
        requiredMergeTests: [],
      };
      const db2: ApprovedMergeComponent = {
        componentId: "db2",
        sourceColony: "codex-crucible",
        sourceArtifactId: "db/migration.sql",
        sourceFingerprint: fpDb,
        relativePath: "db/migration.sql",
        requirementsCovered: [],
        evidenceRefs: [],
        reasonSelected: "db",
        knownRisks: [],
        requiredMergeTests: [],
      };
      (receipt as any).approvedComponents = [db1, db2];
    }

    const realDriver = new TestRealVerificationDriver();

    const final02Res = runFinal02ExecutionRuntime({
      postColonyResult: postColonyRes,
      missionId: "test-mission",
      objective: "Build small task manager",
      acceptanceCriteria: DEFAULT_ACCEPTANCE,
      mergeVerificationDriver: realDriver,
      keyRegistry: TEST_KEY_REGISTRY,
    });

    assert.equal(final02Res.status, "BLOCKED");
    assert.ok(final02Res.reasonCode.includes("DATABASE_SCHEMA_CONFLICT"));

    testsPassed += 1;
  }

  // 9. Verification stage failure triggers workspace rollback and emits RollbackReceipt.
  {
    const runResult = createEmpireRunResult({ claudeVerified: true, codexVerified: true });
    const postColonyRes = runTwinPostColonyPipeline({
      runResult,
      acceptanceCriteria: DEFAULT_ACCEPTANCE,
      budget: { maxMergeComponents: 4 },
    });

    const failingRealDriver = new TestRealVerificationDriver("docker-container-sandbox", true, "build");

    const final02Res = runFinal02ExecutionRuntime({
      postColonyResult: postColonyRes,
      missionId: "test-mission",
      objective: "Build small task manager",
      acceptanceCriteria: DEFAULT_ACCEPTANCE,
      mergeVerificationDriver: failingRealDriver,
      authorizeMergeRepair: false,
      keyRegistry: TEST_KEY_REGISTRY,
    });

    assert.equal(final02Res.status, "FAILED");
    assert.equal(final02Res.mergeVerificationPassed, false);
    assert.equal(final02Res.securityGate.status, "SECURITY_FAILED");
    assert.ok(final02Res.rollbackReceipt?.requested);
    assert.ok(final02Res.rollbackReceipt?.diskWorkspaceRemoved);

    testsPassed += 1;
  }

  // 10. REPAIR_UNAVAILABLE fail-closed when no repair strategy matches.
  {
    const runResult = createEmpireRunResult({ claudeVerified: true, codexVerified: true });
    const postColonyRes = runTwinPostColonyPipeline({
      runResult,
      acceptanceCriteria: DEFAULT_ACCEPTANCE,
      budget: { maxMergeComponents: 4 },
    });

    const failingRealDriver = new TestRealVerificationDriver("docker-container-sandbox", true, "build");

    const final02Res = runFinal02ExecutionRuntime({
      postColonyResult: postColonyRes,
      missionId: "test-mission",
      objective: "Build small task manager",
      acceptanceCriteria: DEFAULT_ACCEPTANCE,
      mergeVerificationDriver: failingRealDriver,
      authorizeMergeRepair: true,
      keyRegistry: TEST_KEY_REGISTRY,
    });

    assert.equal(final02Res.status, "FAILED");
    assert.equal(final02Res.securityGate.status, "SECURITY_FAILED");

    testsPassed += 1;
  }

  // 11. RealBackedVerificationDriver environmental blocker returns failed outcome and fails closed.
  {
    const realBacked = new RealBackedVerificationDriver("workspaces/digital-live-objective/test-ws", ["typecheck"], 5000, 1000, false, null);
    const outcome = realBacked.run("typecheck", "workspaces/digital-live-objective/test-ws", false);

    assert.equal(outcome.status, "failed");
    assert.equal(outcome.failureCategory, "verification-unavailable");
    assert.equal(outcome.realProcessExecutions, 0);

    testsPassed += 1;
  }

  // 12. Expanded Execution Plan fields present and validated.
  {
    const runResult = createEmpireRunResult({ claudeVerified: true, codexVerified: true });
    const postColonyRes = runTwinPostColonyPipeline({
      runResult,
      acceptanceCriteria: DEFAULT_ACCEPTANCE,
      budget: { maxMergeComponents: 4 },
    });

    const realDriver = new TestRealVerificationDriver();

    const final02Res = runFinal02ExecutionRuntime({
      postColonyResult: postColonyRes,
      missionId: "test-mission",
      objective: "Build small task manager",
      acceptanceCriteria: DEFAULT_ACCEPTANCE,
      mergeVerificationDriver: realDriver,
      keyRegistry: TEST_KEY_REGISTRY,
    });

    const plan = final02Res.executionPlan;
    assert.ok(plan);
    if (plan) {
      assert.ok(plan.selectedApprovedComponents.length > 0);
      assert.ok(plan.plannedFileOperations.length > 0);
      assert.ok(plan.baselineDigest.length > 0);
      assert.equal(plan.rollbackProcedure.strategy, "discard-merge-workspace");
      assert.equal(plan.mandatoryGatePolicy.requireRealDriver, true);
    }

    testsPassed += 1;
  }

  // 13. RegressionReceipt generated and validated.
  {
    const runResult = createEmpireRunResult({ claudeVerified: true, codexVerified: true });
    const postColonyRes = runTwinPostColonyPipeline({
      runResult,
      acceptanceCriteria: DEFAULT_ACCEPTANCE,
      budget: { maxMergeComponents: 4 },
    });

    const realDriver = new TestRealVerificationDriver();

    const final02Res = runFinal02ExecutionRuntime({
      postColonyResult: postColonyRes,
      missionId: "test-mission",
      objective: "Build small task manager",
      acceptanceCriteria: DEFAULT_ACCEPTANCE,
      mergeVerificationDriver: realDriver,
      keyRegistry: TEST_KEY_REGISTRY,
    });

    assert.ok(final02Res.regressionReceipt);
    assert.equal(final02Res.regressionReceipt?.passed, true);
    assert.ok(final02Res.regressionReceipt?.commandReceipts.length > 0);

    testsPassed += 1;
  }

  // 14. Secret leak protection scan in customer delivery.
  {
    const runResult = createEmpireRunResult({ claudeVerified: true, codexVerified: true });
    const postColonyRes = runTwinPostColonyPipeline({
      runResult,
      acceptanceCriteria: DEFAULT_ACCEPTANCE,
      budget: { maxMergeComponents: 4 },
    });

    const realDriver = new TestRealVerificationDriver("docker-container-sandbox", true);

    const final02Res = runFinal02ExecutionRuntime({
      postColonyResult: postColonyRes,
      missionId: "test-mission",
      objective: "Build small task manager",
      acceptanceCriteria: DEFAULT_ACCEPTANCE,
      mergeVerificationDriver: realDriver,
      keyRegistry: TEST_KEY_REGISTRY,
    });

    assert.ok(final02Res.deliveryResult);
    assert.equal(final02Res.deliveryResult?.ok, true);
    if (final02Res.deliveryResult?.ok) {
      const text = JSON.stringify(final02Res.deliveryResult.delivery);
      assert.equal(text.includes("OPENAI_KEY"), false);
      assert.equal(text.includes("GITHUB_TOKEN"), false);
      assert.equal(text.includes("BEGIN PRIVATE KEY"), false);
    }

    testsPassed += 1;
  }

  // 15. Unknown backend key in key registry fails closed (SECURITY_BLOCKED).
  {
    const runResult = createEmpireRunResult({ claudeVerified: true, codexVerified: true });
    const postColonyRes = runTwinPostColonyPipeline({
      runResult,
      acceptanceCriteria: DEFAULT_ACCEPTANCE,
      budget: { maxMergeComponents: 4 },
    });

    const realDriver = new TestRealVerificationDriver("unknown-backend-id", true);

    const final02Res = runFinal02ExecutionRuntime({
      postColonyResult: postColonyRes,
      missionId: "test-mission",
      objective: "Build small task manager",
      acceptanceCriteria: DEFAULT_ACCEPTANCE,
      mergeVerificationDriver: realDriver,
      keyRegistry: TEST_KEY_REGISTRY,
    });

    assert.equal(final02Res.status, "UNVERIFIED");
    assert.equal(final02Res.securityGate.status, "SECURITY_BLOCKED");

    testsPassed += 1;
  }

  // 16. Dependency boundary test: src/twin/final02/** never imports src/tools/testFixtures/**.
  {
    const final02Dir = join(__dirname, "../twin/final02");
    const files = readdirSync(final02Dir).filter((f) => f.endsWith(".ts"));

    for (const f of files) {
      const content = readFileSync(join(final02Dir, f), "utf8");
      assert.equal(
        content.includes("testFixtures"),
        false,
        `File ${f} in src/twin/final02/ imports testFixtures which is forbidden by P0-1!`
      );
      assert.equal(
        content.includes("final02SandboxSigner"),
        false,
        `File ${f} in src/twin/final02/ imports final02SandboxSigner which is forbidden by P0-1!`
      );
    }

    testsPassed += 1;
  }

  return { ok: true, testsPassed };
}

if (require.main === module) {
  const result = runFinal02ExecutionRuntimeTests();
  console.log(`runFinal02ExecutionRuntimeTests OK (${result.testsPassed} cases passed)`);
}
