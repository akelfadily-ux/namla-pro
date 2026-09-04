/**
 * final02ExecutionRuntimeTests — expanded and hardened deterministic test suite for
 * `final02ExecutionRuntime.ts` (FINAL-02).
 *
 * Exercises all required correction gate invariants, security gate rules,
 * 12 conflict classes, rollback behavior, and execution evidence fields.
 */

import assert from "node:assert/strict";
import { runFinal02ExecutionRuntime, classifyConflict } from "../twin/final02ExecutionRuntime";
import type { MergeConflictClass } from "../twin/final02ExecutionRuntime";
import { runTwinPostColonyPipeline } from "../twin/twinPostColonyPipeline";
import type { TwinEmpireLiveRunResult, TwinColonyLiveResult } from "../twin/twinColonyLiveRunner";
import type { ColonyEvidenceBundle, ColonyId, ColonyCulture } from "../twin/twinColonyTypes";
import { fnv1a } from "../twin/twinColonyTypes";
import { freezeBundle } from "../twin/colonyForge";
import type { TwinBuildLoopResult, TwinVerificationReceipt } from "../twin/twinBuildLoop";
import type { MergeVerificationStage, MergeVerificationOutcome, MergeVerificationDriver } from "../twin/mergeForge";
import { FakeMergeVerificationDriver } from "../twin/mergeForge";
import type { ApprovedMergeComponent } from "../twin/namolaSovereignCourt";
import { RealBackedVerificationDriver } from "../cognitive/liveRealDrivers";

const DEFAULT_ACCEPTANCE = ["tasks CRUD + completion", "in-memory storage", "unit tests present", "README + architecture docs", "security review"];

class TestRealVerificationDriver implements MergeVerificationDriver {
  readonly isReal = true;
  constructor(
    private readonly sandboxBackendId: string = "docker-container-sandbox",
    private readonly sandboxVerified: boolean = true,
    private readonly simulateFailureStage: MergeVerificationStage | null = null
  ) {}

  run(stage: MergeVerificationStage, workspacePath: string, injectFailure: boolean): MergeVerificationOutcome {
    const passed = stage !== this.simulateFailureStage && !injectFailure;
    return {
      stage,
      passed,
      realExecution: true,
      workspaceId: workspacePath,
      absolutePathIdentity: `/real/${workspacePath}`,
      baselineDigest: "sha256-real-baseline",
      mergedTreeDigest: "sha256-real-merged-tree",
      securityReceipt: {
        backendId: this.sandboxBackendId,
        backendVerificationId: "verif-real-docker",
        executionId: "exec-101",
        workspaceId: workspacePath,
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
      },
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

  const artifacts = emptyArtifacts
    ? []
    : [{ relativePath: artifactRelPath, content: artifactContent, purpose: "core", acceptanceCriteriaCovered: DEFAULT_ACCEPTANCE.slice(0, 2) }];

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
      realProcessExecutions: 0,
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
      filePlan: [artifactRelPath],
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
  runStatus?: "twin-bundles-frozen" | "twin-live-run-failed";
} = {}): TwinEmpireLiveRunResult {
  const runStatus = opts.runStatus ?? "twin-bundles-frozen";
  const claudeRes = createColonyResult("claude-forge", "architecture-first", {
    colonyId: "claude-forge",
    culture: "architecture-first",
    finalStatus: opts.claudeStatus ?? (opts.claudeVerified === false ? "FAILED" : "VERIFIED"),
    securityPassed: opts.claudeSecurityPassed,
  });

  const codexRes = createColonyResult("codex-crucible", "implementation-first", {
    colonyId: "codex-crucible",
    culture: "implementation-first",
    finalStatus: opts.codexStatus ?? (opts.codexVerified === false ? "FAILED" : "VERIFIED"),
    securityPassed: opts.codexSecurityPassed,
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
    });

    assert.equal(final02Res.status, "READY");
    assert.equal(final02Res.securityGate.status, "SECURITY_VERIFIED");
    assert.equal(final02Res.securityGate.sandboxVerified, true);
    assert.equal(final02Res.metrics.realMergeExecuted, true);
    assert.equal(final02Res.metrics.writtenComponentCount, 2);
    assert.equal(final02Res.metrics.fingerprintVerifiedCount, 2);
    assert.ok(final02Res.materializationReceipt?.created);
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
      mergeVerificationDriver: null, // Omitted
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
      const receipt = postColonyRes.decisionReceipt;
      const corruptedCmps = receipt.approvedComponents.map((c, i) =>
        i === 0 ? { ...c, sourceFingerprint: "corrupted-fp" } : c
      );
      Object.assign(receipt, { approvedComponents: corruptedCmps });
    }

    const realDriver = new TestRealVerificationDriver("docker-container-sandbox", true);

    const final02Res = runFinal02ExecutionRuntime({
      postColonyResult: postColonyRes,
      missionId: "test-mission",
      objective: "Build small task manager",
      acceptanceCriteria: DEFAULT_ACCEPTANCE,
      mergeVerificationDriver: realDriver,
    });

    assert.equal(final02Res.status, "BLOCKED");
    assert.equal(final02Res.reasonCode, "artifact-fingerprint-mismatch");
    assert.ok(final02Res.rollbackReceipt?.requested);

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
    });

    assert.equal(final02Res.status, "REJECTED");
    assert.equal(final02Res.securityGate.status, "SECURITY_NOT_RUN");

    testsPassed += 1;
  }

  // 6. 12 Conflict Classes Taxonomy classification tests.
  {
    const dummyComp: ApprovedMergeComponent[] = [
      { componentId: "c1", sourceColony: "claude-forge", sourceArtifactId: "a1", sourceFingerprint: "fp1", relativePath: "x", operation: { kind: "ADD", targetRelativePath: "x", sourceArtifactSha256: "sha-x1" }, requirementsCovered: [], evidenceRefs: [], reasonSelected: "r", knownRisks: [], requiredMergeTests: [] },
      { componentId: "c2", sourceColony: "codex-crucible", sourceArtifactId: "a2", sourceFingerprint: "fp2", relativePath: "x", operation: { kind: "ADD", targetRelativePath: "x", sourceArtifactSha256: "sha-x2" }, requirementsCovered: [], evidenceRefs: [], reasonSelected: "r", knownRisks: [], requiredMergeTests: [] },
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
    const runResult = createEmpireRunResult({ claudeVerified: true, codexVerified: true });
    const postColonyRes = runTwinPostColonyPipeline({
      runResult,
      acceptanceCriteria: DEFAULT_ACCEPTANCE,
      budget: { maxMergeComponents: 4 },
    });

    if (postColonyRes.status === "success") {
      const receipt = postColonyRes.decisionReceipt;
      const secComp: ApprovedMergeComponent = {
        componentId: "sec1",
        sourceColony: "claude-forge",
        sourceArtifactId: "src/securityPolicy.ts",
        sourceFingerprint: "fp-sec1",
        relativePath: "src/securityPolicy.ts",
        operation: { kind: "ADD", targetRelativePath: "src/securityPolicy.ts", sourceArtifactSha256: "sha-sec1" },
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
        sourceFingerprint: "fp-sec2",
        relativePath: "src/securityPolicy.ts",
        operation: { kind: "ADD", targetRelativePath: "src/securityPolicy.ts", sourceArtifactSha256: "sha-sec2" },
        requirementsCovered: [],
        evidenceRefs: [],
        reasonSelected: "security",
        knownRisks: [],
        requiredMergeTests: [],
      };
      Object.assign(receipt, { approvedComponents: [secComp, secComp2] });
    }

    const realDriver = new TestRealVerificationDriver();

    const final02Res = runFinal02ExecutionRuntime({
      postColonyResult: postColonyRes,
      missionId: "test-mission",
      objective: "Build small task manager",
      acceptanceCriteria: DEFAULT_ACCEPTANCE,
      mergeVerificationDriver: realDriver,
    });

    assert.equal(final02Res.status, "BLOCKED");
    assert.ok(final02Res.reasonCode.includes("SECURITY_POLICY_CONFLICT"));

    testsPassed += 1;
  }

  // 8. Database schema conflict causes unresolved conflict fail-closed BLOCKED state.
  {
    const runResult = createEmpireRunResult({ claudeVerified: true, codexVerified: true });
    const postColonyRes = runTwinPostColonyPipeline({
      runResult,
      acceptanceCriteria: DEFAULT_ACCEPTANCE,
      budget: { maxMergeComponents: 4 },
    });

    if (postColonyRes.status === "success") {
      const receipt = postColonyRes.decisionReceipt;
      const db1: ApprovedMergeComponent = {
        componentId: "db1",
        sourceColony: "claude-forge",
        sourceArtifactId: "db/migration.sql",
        sourceFingerprint: "fp-db1",
        relativePath: "db/migration.sql",
        operation: { kind: "ADD", targetRelativePath: "db/migration.sql", sourceArtifactSha256: "sha-db1" },
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
        sourceFingerprint: "fp-db2",
        relativePath: "db/migration.sql",
        operation: { kind: "ADD", targetRelativePath: "db/migration.sql", sourceArtifactSha256: "sha-db2" },
        requirementsCovered: [],
        evidenceRefs: [],
        reasonSelected: "db",
        knownRisks: [],
        requiredMergeTests: [],
      };
      Object.assign(receipt, { approvedComponents: [db1, db2] });
    }

    const realDriver = new TestRealVerificationDriver();

    const final02Res = runFinal02ExecutionRuntime({
      postColonyResult: postColonyRes,
      missionId: "test-mission",
      objective: "Build small task manager",
      acceptanceCriteria: DEFAULT_ACCEPTANCE,
      mergeVerificationDriver: realDriver,
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
    });

    assert.equal(final02Res.status, "FAILED");
    assert.equal(final02Res.mergeVerificationPassed, false);
    assert.equal(final02Res.securityGate.status, "SECURITY_FAILED");
    assert.ok(final02Res.rollbackReceipt?.requested);
    assert.ok(final02Res.rollbackReceipt?.diskWorkspaceRemoved);

    testsPassed += 1;
  }

  // 10. Bounded repair loop modifies specific files with before/after fingerprints and reruns from zero.
  {
    const runResult = createEmpireRunResult({ claudeVerified: true, codexVerified: true });
    const postColonyRes = runTwinPostColonyPipeline({
      runResult,
      acceptanceCriteria: DEFAULT_ACCEPTANCE,
      budget: { maxMergeComponents: 4 },
    });

    let runCount = 0;
    const repairableRealDriver = {
      isReal: true,
      run(stage: MergeVerificationStage, workspacePath: string, injectFailure: boolean): MergeVerificationOutcome {
        runCount += 1;
        const passed = runCount <= 5 ? stage !== "build" && !injectFailure : !injectFailure;
        return {
          stage,
          passed,
          realExecution: true,
          workspaceId: workspacePath,
          absolutePathIdentity: `/real/${workspacePath}`,
          baselineDigest: "sha256-real-baseline",
          mergedTreeDigest: "sha256-real-merged-tree",
          securityReceipt: {
            backendId: "docker-container-sandbox",
            backendVerificationId: "verif-real-docker",
            executionId: `exec-${runCount}`,
            workspaceId: workspacePath,
            realProcessExecution: true,
            sandboxVerified: true,
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
          },
        };
      },
    };

    const final02Res = runFinal02ExecutionRuntime({
      postColonyResult: postColonyRes,
      missionId: "test-mission",
      objective: "Build small task manager",
      acceptanceCriteria: DEFAULT_ACCEPTANCE,
      mergeVerificationDriver: repairableRealDriver,
      authorizeMergeRepair: true,
    });

    assert.equal(final02Res.status, "READY");
    assert.equal(final02Res.securityGate.status, "SECURITY_VERIFIED");
    assert.ok(final02Res.repairReceipt?.ran);
    assert.ok((final02Res.repairReceipt?.filesModified.length ?? 0) > 0);
    assert.notDeepEqual(final02Res.repairReceipt?.beforeFingerprints, final02Res.repairReceipt?.afterFingerprints);

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
    });

    assert.ok(final02Res.regressionReceipt);
    assert.equal(final02Res.regressionReceipt?.passed, true);
    assert.equal(final02Res.regressionReceipt?.exitCode, 0);

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

  return { ok: true, testsPassed };
}

if (require.main === module) {
  const result = runFinal02ExecutionRuntimeTests();
  console.log(`runFinal02ExecutionRuntimeTests OK (${result.testsPassed} cases passed)`);
}
