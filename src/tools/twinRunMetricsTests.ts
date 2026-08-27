/**
 * twinRunMetricsTests — focused deterministic test suite for `twinRunMetrics.ts`
 * (TASK 001 Review Fixes).
 *
 * Exercises all required test scenarios and regression cases:
 * 1. ZERO / NO CANDIDATE
 * 2. FAKE IS NOT REAL
 * 3. PROVIDER TOTALS
 * 4. ROLE BREAKDOWN (diagnosticCount)
 * 5. VERIFIED CANDIDATE
 * 6. VERIFICATION BLOCKED
 * 7. FAIL CLOSED
 * 8. REPAIR METRICS
 * 9. DETERMINISM
 * 10. STRENGTHENED INPUT IMMUTABILITY & FREEZE
 * 11. GLOBAL REAL PROCESS EXECUTION INCLUDES REPAIRS
 * 12. SLOT ACQUISITION FAILURE DIAGNOSTIC SEMANTICS
 */

import assert from "node:assert/strict";
import { collectTwinRunMetrics } from "../twin/twinRunMetrics";
import type { TwinColonyLiveResult, TwinProviderDiagnostic } from "../twin/twinColonyLiveRunner";
import type { TwinBuildLoopResult, TwinVerificationReceipt, TwinRepairReceipt } from "../twin/twinBuildLoop";

function makeMinimalResult(overrides: Partial<TwinColonyLiveResult> = {}): TwinColonyLiveResult {
  return {
    colonyId: "claude-forge",
    ok: false,
    failureReason: "no-build-artifacts",
    bundle: null,
    providerCalls: 0,
    artifactsApplied: 0,
    independentReviews: 0,
    selfReviewsAccepted: 0,
    architecturePlan: [],
    reviewApproved: false,
    diagnostics: [],
    realProviderProcessExecutions: 0,
    normalizationReceipts: [],
    reviewSkippedReason: "no-build-artifacts",
    completedRoles: [],
    loop: null,
    candidateVerified: false,
    ...overrides,
  };
}

export function runTwinRunMetricsTests(): { readonly ok: true; readonly testsPassed: number } {
  let testsPassed = 0;

  // 1. ZERO / NO CANDIDATE
  {
    const res = makeMinimalResult();
    const metrics = collectTwinRunMetrics(res);

    assert.equal(metrics.colonyId, "claude-forge");
    assert.equal(metrics.colonyOk, false);
    assert.equal(metrics.failureReason, "no-build-artifacts");
    assert.equal(metrics.candidateVerified, false);
    assert.equal(metrics.providerCalls, 0);
    assert.equal(metrics.realProviderProcessExecutions, 0);
    assert.equal(metrics.totalProviderDurationMs, 0);
    assert.equal(metrics.totalProviderRequestBytes, 0);
    assert.equal(metrics.totalProviderResponseBytes, 0);
    assert.equal(metrics.averageProviderDurationMs, null);
    assert.equal(metrics.averageProviderRequestBytes, null);
    assert.equal(metrics.averageProviderResponseBytes, null);

    assert.equal(metrics.artifactsApplied, 0);
    assert.equal(metrics.independentReviews, 0);
    assert.equal(metrics.reviewApproved, false);

    assert.equal(metrics.loop.available, false);
    assert.equal(metrics.loop.finalLoopState, null);
    assert.equal(metrics.loop.finalVerificationStatus, null);
    assert.equal(metrics.loop.verificationRounds, 0);
    assert.equal(metrics.loop.verificationStageExecutions, 0);
    assert.equal(metrics.loop.repairAttempts, 0);
    assert.equal(metrics.loop.filesAppliedByRepair, 0);
    assert.equal(metrics.loop.stopReason, null);
    assert.equal(metrics.loop.statusCounts.passCount, 0);
    assert.equal(metrics.loop.statusCounts.failCount, 0);
    assert.equal(metrics.loop.statusCounts.blockedCount, 0);
    assert.equal(metrics.loop.statusCounts.unverifiedCount, 0);

    assert.equal(metrics.repair.repairReceiptCount, 0);
    assert.equal(metrics.repair.repairRealProviderProcessExecutions, 0);
    assert.equal(metrics.repair.repairFilesProposed, 0);
    assert.equal(metrics.repair.repairFilesApplied, 0);
    assert.equal(metrics.repair.repairRequestBytes, 0);
    assert.equal(metrics.repair.repairResponseBytes, 0);

    testsPassed += 1;
  }

  // 2. FAKE IS NOT REAL
  {
    const diagFake: TwinProviderDiagnostic = {
      role: "architecture",
      antId: "ant-1",
      providerId: "claude",
      ok: true,
      failureCategory: "none",
      timeoutMs: 60000,
      durationMs: 120,
      requestBytes: 500,
      responseBytes: 1500,
      realProcessExecution: false,
    };
    const res = makeMinimalResult({
      providerCalls: 1,
      diagnostics: [diagFake],
    });
    const metrics = collectTwinRunMetrics(res);

    assert.equal(metrics.providerCalls, 1);
    assert.equal(metrics.realProviderProcessExecutions, 0);

    testsPassed += 1;
  }

  // 3. PROVIDER TOTALS & AVERAGES
  {
    const diag1: TwinProviderDiagnostic = {
      role: "architecture",
      antId: "ant-1",
      providerId: "claude",
      ok: true,
      failureCategory: "none",
      timeoutMs: 60000,
      durationMs: 100,
      requestBytes: 200,
      responseBytes: 400,
      realProcessExecution: true,
    };
    const diag2: TwinProviderDiagnostic = {
      role: "implementation",
      antId: "ant-1",
      providerId: "claude",
      ok: true,
      failureCategory: "none",
      timeoutMs: 60000,
      durationMs: 300,
      requestBytes: 800,
      responseBytes: 1200,
      realProcessExecution: true,
    };
    const res = makeMinimalResult({
      providerCalls: 2,
      diagnostics: [diag1, diag2],
    });
    const metrics = collectTwinRunMetrics(res);

    assert.equal(metrics.providerCalls, 2);
    assert.equal(metrics.realProviderProcessExecutions, 2);
    assert.equal(metrics.totalProviderDurationMs, 400);
    assert.equal(metrics.totalProviderRequestBytes, 1000);
    assert.equal(metrics.totalProviderResponseBytes, 1600);
    assert.equal(metrics.averageProviderDurationMs, 200);
    assert.equal(metrics.averageProviderRequestBytes, 500);
    assert.equal(metrics.averageProviderResponseBytes, 800);

    testsPassed += 1;
  }

  // 4. ROLE BREAKDOWN (diagnosticCount)
  {
    const diagArch: TwinProviderDiagnostic = {
      role: "architecture",
      antId: "ant-arch",
      providerId: "claude",
      ok: true,
      failureCategory: "none",
      timeoutMs: 60000,
      durationMs: 150,
      requestBytes: 300,
      responseBytes: 600,
      realProcessExecution: false,
    };
    const diagImpl: TwinProviderDiagnostic = {
      role: "implementation",
      antId: "ant-impl",
      providerId: "claude",
      ok: true,
      failureCategory: "none",
      timeoutMs: 60000,
      durationMs: 250,
      requestBytes: 500,
      responseBytes: 1000,
      realProcessExecution: false,
    };
    const diagRev: TwinProviderDiagnostic = {
      role: "review",
      antId: "ant-rev",
      providerId: "claude",
      ok: true,
      failureCategory: "none",
      timeoutMs: 60000,
      durationMs: 100,
      requestBytes: 200,
      responseBytes: 400,
      realProcessExecution: false,
    };
    const res = makeMinimalResult({
      providerCalls: 3,
      diagnostics: [diagArch, diagImpl, diagRev],
    });
    const metrics = collectTwinRunMetrics(res);

    assert.equal(metrics.roleBreakdown.architecture.diagnosticCount, 1);
    assert.equal(metrics.roleBreakdown.architecture.durationMs, 150);
    assert.equal(metrics.roleBreakdown.architecture.requestBytes, 300);
    assert.equal(metrics.roleBreakdown.architecture.responseBytes, 600);

    assert.equal(metrics.roleBreakdown.implementation.diagnosticCount, 1);
    assert.equal(metrics.roleBreakdown.implementation.durationMs, 250);
    assert.equal(metrics.roleBreakdown.implementation.requestBytes, 500);
    assert.equal(metrics.roleBreakdown.implementation.responseBytes, 1000);

    assert.equal(metrics.roleBreakdown.review.diagnosticCount, 1);
    assert.equal(metrics.roleBreakdown.review.durationMs, 100);
    assert.equal(metrics.roleBreakdown.review.requestBytes, 200);
    assert.equal(metrics.roleBreakdown.review.responseBytes, 400);

    testsPassed += 1;
  }

  // 5. VERIFIED CANDIDATE
  {
    const vReceipt1: TwinVerificationReceipt = {
      colonyId: "claude-forge",
      attempt: 0,
      stage: "typecheck",
      commandId: "typecheck",
      status: "PASS",
      failureCategory: null,
      safeReasonCode: "verification-passed",
      outputLineCount: 10,
      realProcessExecutions: 0,
      sandboxBackendId: "fake-test-backend",
      sandboxVerified: false,
      order: 0,
    };
    const vReceipt2: TwinVerificationReceipt = {
      colonyId: "claude-forge",
      attempt: 0,
      stage: "test",
      commandId: "test",
      status: "PASS",
      failureCategory: null,
      safeReasonCode: "verification-passed",
      outputLineCount: 15,
      realProcessExecutions: 0,
      sandboxBackendId: "fake-test-backend",
      sandboxVerified: false,
      order: 1,
    };
    const loopResult: TwinBuildLoopResult = {
      state: "CANDIDATE_VERIFIED",
      finalStatus: "PASS",
      verificationRounds: 1,
      repairAttempts: 0,
      filesAppliedByRepair: 0,
      receipts: [vReceipt1, vReceipt2],
      repairReceipts: [],
      stopReason: null,
      finalCandidatePaths: ["src/index.ts"],
    };
    const res = makeMinimalResult({
      ok: true,
      candidateVerified: true,
      loop: loopResult,
    });
    const metrics = collectTwinRunMetrics(res);

    assert.equal(metrics.candidateVerified, true);
    assert.equal(metrics.loop.available, true);
    assert.equal(metrics.loop.finalLoopState, "CANDIDATE_VERIFIED");
    assert.equal(metrics.loop.finalVerificationStatus, "PASS");
    assert.equal(metrics.loop.verificationRounds, 1);
    assert.equal(metrics.loop.verificationStageExecutions, 2);
    assert.equal(metrics.loop.statusCounts.passCount, 2);
    assert.equal(metrics.loop.statusCounts.failCount, 0);
    assert.equal(metrics.loop.statusCounts.blockedCount, 0);
    assert.equal(metrics.loop.statusCounts.unverifiedCount, 0);

    testsPassed += 1;
  }

  // 6. VERIFICATION BLOCKED
  {
    const vReceiptBlocked: TwinVerificationReceipt = {
      colonyId: "claude-forge",
      attempt: 0,
      stage: "typecheck",
      commandId: "typecheck",
      status: "BLOCKED",
      failureCategory: "sandbox-runtime-unavailable",
      safeReasonCode: "sandbox-unavailable",
      outputLineCount: 0,
      realProcessExecutions: 0,
      sandboxBackendId: "none",
      sandboxVerified: false,
      order: 0,
    };
    const loopResult: TwinBuildLoopResult = {
      state: "VERIFICATION_BLOCKED",
      finalStatus: "BLOCKED",
      verificationRounds: 1,
      repairAttempts: 0,
      filesAppliedByRepair: 0,
      receipts: [vReceiptBlocked],
      repairReceipts: [],
      stopReason: "sandbox-unavailable",
      finalCandidatePaths: ["src/index.ts"],
    };
    const res = makeMinimalResult({
      ok: true,
      candidateVerified: false,
      loop: loopResult,
    });
    const metrics = collectTwinRunMetrics(res);

    assert.equal(metrics.candidateVerified, false);
    assert.equal(metrics.loop.available, true);
    assert.equal(metrics.loop.finalLoopState, "VERIFICATION_BLOCKED");
    assert.equal(metrics.loop.finalVerificationStatus, "BLOCKED");
    assert.equal(metrics.loop.statusCounts.passCount, 0);
    assert.equal(metrics.loop.statusCounts.failCount, 0);
    assert.equal(metrics.loop.statusCounts.blockedCount, 1);
    assert.equal(metrics.loop.statusCounts.unverifiedCount, 0);

    testsPassed += 1;
  }

  // 7. FAIL CLOSED
  {
    const vReceiptFail: TwinVerificationReceipt = {
      colonyId: "claude-forge",
      attempt: 0,
      stage: "typecheck",
      commandId: "typecheck",
      status: "FAIL",
      failureCategory: "verification-command-failed",
      safeReasonCode: "typecheck-error",
      outputLineCount: 5,
      realProcessExecutions: 0,
      sandboxBackendId: "fake-test-backend",
      sandboxVerified: false,
      order: 0,
    };
    const loopResult: TwinBuildLoopResult = {
      state: "FAIL_CLOSED",
      finalStatus: "FAIL",
      verificationRounds: 1,
      repairAttempts: 1,
      filesAppliedByRepair: 0,
      receipts: [vReceiptFail],
      repairReceipts: [],
      stopReason: "repair-budget-exhausted",
      finalCandidatePaths: ["src/index.ts"],
    };
    const res = makeMinimalResult({
      ok: false,
      candidateVerified: false,
      loop: loopResult,
    });
    const metrics = collectTwinRunMetrics(res);

    assert.equal(metrics.loop.finalLoopState, "FAIL_CLOSED");
    assert.equal(metrics.loop.finalVerificationStatus, "FAIL");
    assert.equal(metrics.loop.statusCounts.failCount, 1);

    testsPassed += 1;
  }

  // 8. REPAIR METRICS
  {
    const repReceipt: TwinRepairReceipt = {
      colonyId: "claude-forge",
      attempt: 1,
      antId: "ant-repair",
      taskId: "task-repair-1",
      providerId: "claude",
      ok: true,
      failureCategory: null,
      realProcessExecution: true,
      filesProposed: 2,
      filesApplied: 2,
      requestBytes: 400,
      responseBytes: 900,
      order: 0,
    };
    const loopResult: TwinBuildLoopResult = {
      state: "CANDIDATE_VERIFIED",
      finalStatus: "PASS",
      verificationRounds: 2,
      repairAttempts: 1,
      filesAppliedByRepair: 2,
      receipts: [],
      repairReceipts: [repReceipt],
      stopReason: null,
      finalCandidatePaths: ["src/index.ts", "src/fix.ts"],
    };
    const res = makeMinimalResult({
      loop: loopResult,
    });
    const metrics = collectTwinRunMetrics(res);

    assert.equal(metrics.repair.repairReceiptCount, 1);
    assert.equal(metrics.repair.repairRealProviderProcessExecutions, 1);
    assert.equal(metrics.repair.repairFilesProposed, 2);
    assert.equal(metrics.repair.repairFilesApplied, 2);
    assert.equal(metrics.repair.repairRequestBytes, 400);
    assert.equal(metrics.repair.repairResponseBytes, 900);

    testsPassed += 1;
  }

  // 9. DETERMINISM
  {
    const diag: TwinProviderDiagnostic = {
      role: "architecture",
      antId: "ant-1",
      providerId: "claude",
      ok: true,
      failureCategory: "none",
      timeoutMs: 60000,
      durationMs: 120,
      requestBytes: 500,
      responseBytes: 1500,
      realProcessExecution: false,
    };
    const res = makeMinimalResult({
      providerCalls: 1,
      diagnostics: [diag],
    });

    const metrics1 = collectTwinRunMetrics(res);
    const metrics2 = collectTwinRunMetrics(res);

    assert.deepEqual(metrics1, metrics2);

    testsPassed += 1;
  }

  // 10. STRENGTHENED INPUT IMMUTABILITY & FREEZE
  {
    const diag: TwinProviderDiagnostic = {
      role: "architecture",
      antId: "ant-1",
      providerId: "claude",
      ok: true,
      failureCategory: "none",
      timeoutMs: 60000,
      durationMs: 120,
      requestBytes: 500,
      responseBytes: 1500,
      realProcessExecution: false,
    };
    const vReceipt: TwinVerificationReceipt = {
      colonyId: "claude-forge",
      attempt: 0,
      stage: "typecheck",
      commandId: "typecheck",
      status: "PASS",
      failureCategory: null,
      safeReasonCode: "verification-passed",
      outputLineCount: 10,
      realProcessExecutions: 0,
      sandboxBackendId: "fake-test-backend",
      sandboxVerified: false,
      order: 0,
    };
    const repReceipt: TwinRepairReceipt = {
      colonyId: "claude-forge",
      attempt: 1,
      antId: "ant-repair",
      taskId: "task-repair-1",
      providerId: "claude",
      ok: true,
      failureCategory: null,
      realProcessExecution: false,
      filesProposed: 1,
      filesApplied: 1,
      requestBytes: 300,
      responseBytes: 600,
      order: 1,
    };
    const originalDiagnostics = [diag];
    const originalReceipts = [vReceipt];
    const originalRepairReceipts = [repReceipt];

    const loopResult: TwinBuildLoopResult = {
      state: "CANDIDATE_VERIFIED",
      finalStatus: "PASS",
      verificationRounds: 1,
      repairAttempts: 1,
      filesAppliedByRepair: 1,
      receipts: originalReceipts,
      repairReceipts: originalRepairReceipts,
      stopReason: null,
      finalCandidatePaths: ["src/index.ts"],
    };

    const res = makeMinimalResult({
      providerCalls: 1,
      diagnostics: originalDiagnostics,
      loop: loopResult,
    });

    const metrics = collectTwinRunMetrics(res);

    // Verify input result structure & nested objects are unchanged
    assert.equal(res.diagnostics, originalDiagnostics);
    assert.equal(res.diagnostics.length, 1);
    assert.equal(res.diagnostics[0], diag);
    assert.equal(res.loop, loopResult);
    assert.equal(res.loop?.receipts, originalReceipts);
    assert.equal(res.loop?.receipts[0], vReceipt);
    assert.equal(res.loop?.repairReceipts, originalRepairReceipts);
    assert.equal(res.loop?.repairReceipts[0], repReceipt);

    // Verify caller's input was not frozen or mutated
    assert.equal(Object.isFrozen(res), false);
    assert.equal(Object.isFrozen(res.diagnostics), false);
    assert.equal(Object.isFrozen(loopResult), false);
    assert.equal(Object.isFrozen(originalReceipts), false);
    assert.equal(Object.isFrozen(originalRepairReceipts), false);

    // Verify returned snapshot is deep-frozen
    assert.equal(Object.isFrozen(metrics), true);
    assert.equal(Object.isFrozen(metrics.roleBreakdown), true);
    assert.equal(Object.isFrozen(metrics.loop), true);
    assert.equal(Object.isFrozen(metrics.loop.statusCounts), true);
    assert.equal(Object.isFrozen(metrics.repair), true);

    testsPassed += 1;
  }

  // 11. GLOBAL REAL PROCESS EXECUTION INCLUDES REPAIRS
  {
    const diagReal: TwinProviderDiagnostic = {
      role: "implementation",
      antId: "ant-impl",
      providerId: "claude",
      ok: true,
      failureCategory: "none",
      timeoutMs: 60000,
      durationMs: 300,
      requestBytes: 600,
      responseBytes: 1200,
      realProcessExecution: true,
    };
    const repReceiptReal: TwinRepairReceipt = {
      colonyId: "claude-forge",
      attempt: 1,
      antId: "ant-repair",
      taskId: "task-repair-1",
      providerId: "claude",
      ok: true,
      failureCategory: null,
      realProcessExecution: true,
      filesProposed: 1,
      filesApplied: 1,
      requestBytes: 400,
      responseBytes: 800,
      order: 0,
    };
    const loopResult: TwinBuildLoopResult = {
      state: "CANDIDATE_VERIFIED",
      finalStatus: "PASS",
      verificationRounds: 2,
      repairAttempts: 1,
      filesAppliedByRepair: 1,
      receipts: [],
      repairReceipts: [repReceiptReal],
      stopReason: null,
      finalCandidatePaths: ["src/index.ts"],
    };
    const res = makeMinimalResult({
      providerCalls: 1,
      diagnostics: [diagReal],
      loop: loopResult,
    });

    const metrics = collectTwinRunMetrics(res);

    assert.equal(metrics.realProviderProcessExecutions, 2);
    assert.equal(metrics.repair.repairRealProviderProcessExecutions, 1);

    testsPassed += 1;
  }

  // 12. SLOT ACQUISITION FAILURE DIAGNOSTIC SEMANTICS
  {
    const diagSlotFail: TwinProviderDiagnostic = {
      role: "architecture",
      antId: "ant-arch",
      providerId: "claude",
      ok: false,
      failureCategory: "empire-permit-slot-unavailable",
      timeoutMs: 60000,
      durationMs: 0,
      requestBytes: 0,
      responseBytes: 0,
      realProcessExecution: false,
    };
    const res = makeMinimalResult({
      providerCalls: 0, // slot failure means providerDriver.call was NOT executed
      diagnostics: [diagSlotFail],
    });

    const metrics = collectTwinRunMetrics(res);

    assert.equal(metrics.roleBreakdown.architecture.diagnosticCount, 1);
    assert.equal(metrics.providerCalls, 0);
    assert.equal("callCount" in metrics.roleBreakdown.architecture, false);

    testsPassed += 1;
  }

  return { ok: true, testsPassed };
}

if (require.main === module) {
  const result = runTwinRunMetricsTests();
  console.log(`runTwinRunMetricsTests OK (${result.testsPassed} cases passed)`);
}
