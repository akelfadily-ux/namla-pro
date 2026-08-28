/**
 * twinRunMetricsTests — hardened deterministic test suite for `twinRunMetrics.ts`
 * (TASK 001 Hardened).
 *
 * Exercises 29 hardened test scenarios with clean builders and non-vacuous assertions.
 */

import assert from "node:assert/strict";
import { collectTwinRunMetrics } from "../twin/twinRunMetrics";
import type { TwinColonyLiveResult, TwinProviderDiagnostic, TwinRole } from "../twin/twinColonyLiveRunner";
import type { TwinBuildLoopResult, TwinRepairReceipt, TwinVerificationReceipt } from "../twin/twinBuildLoop";

// --- REUSABLE BUILDERS AND HELPERS ---

function createMinimalResult(overrides: Partial<TwinColonyLiveResult> = {}): TwinColonyLiveResult {
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

function createDiagnostic(role: TwinRole, real: boolean, durationMs = 100, requestBytes = 200, responseBytes = 400): TwinProviderDiagnostic {
  return {
    role,
    antId: `ant-${role}`,
    providerId: "claude",
    ok: true,
    failureCategory: "none",
    timeoutMs: 60000,
    durationMs,
    requestBytes,
    responseBytes,
    realProcessExecution: real,
  };
}

function createVerificationReceipt(status: TwinVerificationReceipt["status"], stage: TwinVerificationReceipt["stage"] = "typecheck", order = 0): TwinVerificationReceipt {
  return {
    colonyId: "claude-forge",
    attempt: 0,
    stage,
    commandId: stage,
    status,
    failureCategory: status === "PASS" ? null : "verification-failed",
    safeReasonCode: status === "PASS" ? "verification-passed" : "verification-failed",
    outputLineCount: 10,
    realProcessExecutions: 0,
    sandboxBackendId: "fake-test-backend",
    sandboxVerified: false,
    order,
  };
}

function createRepairReceipt(real: boolean, filesProposed = 1, filesApplied = 1, requestBytes = 300, responseBytes = 600, order = 0): TwinRepairReceipt {
  return {
    colonyId: "claude-forge",
    attempt: 1,
    antId: "ant-repair",
    taskId: "task-repair",
    providerId: "claude",
    ok: true,
    failureCategory: null,
    realProcessExecution: real,
    filesProposed,
    filesApplied,
    requestBytes,
    responseBytes,
    order,
  };
}

export function runTwinRunMetricsTests(): { readonly ok: true; readonly testsPassed: number } {
  let testsPassed = 0;

  // 1. Zero / No Candidate
  {
    const res = createMinimalResult();
    const m = collectTwinRunMetrics(res);

    assert.equal(m.colonyId, "claude-forge");
    assert.equal(m.colonyOk, false);
    assert.equal(m.failureReason, "no-build-artifacts");
    assert.equal(m.candidateVerified, false);
    assert.equal(m.initialProviderCalls, 0);
    assert.equal(m.initialDiagnosticCount, 0);
    assert.equal(m.initialRealProviderProcessExecutions, 0);
    assert.equal(m.totalRealProviderProcessExecutions, 0);
    assert.equal(m.initialProviderDurationMs, 0);
    assert.equal(m.initialProviderRequestBytes, 0);
    assert.equal(m.initialProviderResponseBytes, 0);
    assert.equal(m.totalProviderRequestBytes, 0);
    assert.equal(m.totalProviderResponseBytes, 0);
    assert.equal(m.averageInitialDiagnosticDurationMs, null);
    assert.equal(m.averageInitialDiagnosticRequestBytes, null);
    assert.equal(m.averageInitialDiagnosticResponseBytes, null);

    assert.equal(m.loop.available, false);
    assert.equal(m.loop.finalLoopState, null);
    assert.equal(m.loop.finalVerificationStatus, null);
    assert.equal(m.repair.repairReceiptCount, 0);

    testsPassed += 1;
  }

  // 2. Fake Execution Is Not Real Execution
  {
    const res = createMinimalResult({
      providerCalls: 1,
      diagnostics: [createDiagnostic("architecture", false)],
    });
    const m = collectTwinRunMetrics(res);

    assert.equal(m.initialProviderCalls, 1);
    assert.equal(m.initialDiagnosticCount, 1);
    assert.equal(m.initialRealProviderProcessExecutions, 0);
    assert.equal(m.totalRealProviderProcessExecutions, 0);

    testsPassed += 1;
  }

  // 3. Initial Diagnostic Totals
  {
    const d1 = createDiagnostic("architecture", true, 100, 200, 400);
    const d2 = createDiagnostic("implementation", true, 300, 800, 1200);
    const res = createMinimalResult({
      providerCalls: 2,
      diagnostics: [d1, d2],
    });
    const m = collectTwinRunMetrics(res);

    assert.equal(m.initialProviderDurationMs, 400);
    assert.equal(m.initialProviderRequestBytes, 1000);
    assert.equal(m.initialProviderResponseBytes, 1600);

    testsPassed += 1;
  }

  // 4. initialDiagnosticCount
  {
    const d1 = createDiagnostic("architecture", false);
    const d2 = createDiagnostic("implementation", false);
    const res = createMinimalResult({
      providerCalls: 2,
      diagnostics: [d1, d2],
    });
    const m = collectTwinRunMetrics(res);

    assert.equal(m.initialDiagnosticCount, 2);

    testsPassed += 1;
  }

  // 5. Diagnostic Averages
  {
    const d1 = createDiagnostic("architecture", false, 100, 200, 400);
    const d2 = createDiagnostic("implementation", false, 300, 800, 1200);
    const res = createMinimalResult({
      providerCalls: 2,
      diagnostics: [d1, d2],
    });
    const m = collectTwinRunMetrics(res);

    assert.equal(m.averageInitialDiagnosticDurationMs, 200);
    assert.equal(m.averageInitialDiagnosticRequestBytes, 500);
    assert.equal(m.averageInitialDiagnosticResponseBytes, 800);

    testsPassed += 1;
  }

  // 6. Role Breakdown
  {
    const dArch = createDiagnostic("architecture", false, 150, 300, 600);
    const dImpl = createDiagnostic("implementation", false, 250, 500, 1000);
    const dRev = createDiagnostic("review", false, 100, 200, 400);
    const res = createMinimalResult({
      providerCalls: 3,
      diagnostics: [dArch, dImpl, dRev],
    });
    const m = collectTwinRunMetrics(res);

    assert.equal(m.roleBreakdown.architecture.diagnosticCount, 1);
    assert.equal(m.roleBreakdown.architecture.durationMs, 150);
    assert.equal(m.roleBreakdown.architecture.requestBytes, 300);
    assert.equal(m.roleBreakdown.architecture.responseBytes, 600);

    assert.equal(m.roleBreakdown.implementation.diagnosticCount, 1);
    assert.equal(m.roleBreakdown.implementation.durationMs, 250);
    assert.equal(m.roleBreakdown.implementation.requestBytes, 500);
    assert.equal(m.roleBreakdown.implementation.responseBytes, 1000);

    assert.equal(m.roleBreakdown.review.diagnosticCount, 1);
    assert.equal(m.roleBreakdown.review.durationMs, 100);
    assert.equal(m.roleBreakdown.review.requestBytes, 200);
    assert.equal(m.roleBreakdown.review.responseBytes, 400);

    testsPassed += 1;
  }

  // 7. Verified Candidate
  {
    const loop: TwinBuildLoopResult = {
      state: "CANDIDATE_VERIFIED",
      finalStatus: "PASS",
      verificationRounds: 1,
      repairAttempts: 0,
      filesAppliedByRepair: 0,
      receipts: [createVerificationReceipt("PASS", "typecheck", 0)],
      repairReceipts: [],
      stopReason: null,
      finalCandidatePaths: ["src/index.ts"],
    };
    const res = createMinimalResult({ ok: true, candidateVerified: true, loop });
    const m = collectTwinRunMetrics(res);

    assert.equal(m.candidateVerified, true);
    assert.equal(m.loop.available, true);
    assert.equal(m.loop.finalLoopState, "CANDIDATE_VERIFIED");
    assert.equal(m.loop.finalVerificationStatus, "PASS");
    assert.equal(m.loop.statusCounts.passCount, 1);

    testsPassed += 1;
  }

  // 8. FAIL
  {
    const loop: TwinBuildLoopResult = {
      state: "FAIL_CLOSED",
      finalStatus: "FAIL",
      verificationRounds: 1,
      repairAttempts: 1,
      filesAppliedByRepair: 0,
      receipts: [createVerificationReceipt("FAIL", "typecheck", 0)],
      repairReceipts: [],
      stopReason: "repair-budget-exhausted",
      finalCandidatePaths: ["src/index.ts"],
    };
    const res = createMinimalResult({ loop });
    const m = collectTwinRunMetrics(res);

    assert.equal(m.loop.finalLoopState, "FAIL_CLOSED");
    assert.equal(m.loop.finalVerificationStatus, "FAIL");
    assert.equal(m.loop.statusCounts.failCount, 1);

    testsPassed += 1;
  }

  // 9. BLOCKED
  {
    const loop: TwinBuildLoopResult = {
      state: "VERIFICATION_BLOCKED",
      finalStatus: "BLOCKED",
      verificationRounds: 1,
      repairAttempts: 0,
      filesAppliedByRepair: 0,
      receipts: [createVerificationReceipt("BLOCKED", "typecheck", 0)],
      repairReceipts: [],
      stopReason: "sandbox-unavailable",
      finalCandidatePaths: ["src/index.ts"],
    };
    const res = createMinimalResult({ loop });
    const m = collectTwinRunMetrics(res);

    assert.equal(m.loop.finalLoopState, "VERIFICATION_BLOCKED");
    assert.equal(m.loop.finalVerificationStatus, "BLOCKED");
    assert.equal(m.loop.statusCounts.blockedCount, 1);

    testsPassed += 1;
  }

  // 10. UNVERIFIED
  {
    const loop: TwinBuildLoopResult = {
      state: "VERIFICATION_BLOCKED",
      finalStatus: "UNVERIFIED",
      verificationRounds: 0,
      repairAttempts: 0,
      filesAppliedByRepair: 0,
      receipts: [createVerificationReceipt("UNVERIFIED", "typecheck", 0)],
      repairReceipts: [],
      stopReason: "no-verification-driver",
      finalCandidatePaths: ["src/index.ts"],
    };
    const res = createMinimalResult({ loop });
    const m = collectTwinRunMetrics(res);

    assert.equal(m.loop.finalVerificationStatus, "UNVERIFIED");
    assert.equal(m.loop.statusCounts.unverifiedCount, 1);

    testsPassed += 1;
  }

  // 11. All Four Verification Statuses Mixed
  {
    const receipts = [
      createVerificationReceipt("PASS", "typecheck", 0),
      createVerificationReceipt("FAIL", "build", 1),
      createVerificationReceipt("BLOCKED", "test", 2),
      createVerificationReceipt("UNVERIFIED", "test", 3),
    ];
    const loop: TwinBuildLoopResult = {
      state: "FAIL_CLOSED",
      finalStatus: "FAIL",
      verificationRounds: 4,
      repairAttempts: 0,
      filesAppliedByRepair: 0,
      receipts,
      repairReceipts: [],
      stopReason: null,
      finalCandidatePaths: ["src/index.ts"],
    };
    const res = createMinimalResult({ loop });
    const m = collectTwinRunMetrics(res);

    assert.equal(m.loop.statusCounts.passCount, 1);
    assert.equal(m.loop.statusCounts.failCount, 1);
    assert.equal(m.loop.statusCounts.blockedCount, 1);
    assert.equal(m.loop.statusCounts.unverifiedCount, 1);
    assert.equal(m.loop.verificationStageExecutions, 4);

    testsPassed += 1;
  }

  // 12. Repair Metrics
  {
    const rep = createRepairReceipt(true, 3, 2, 400, 800, 0);
    const loop: TwinBuildLoopResult = {
      state: "CANDIDATE_VERIFIED",
      finalStatus: "PASS",
      verificationRounds: 2,
      repairAttempts: 1,
      filesAppliedByRepair: 2,
      receipts: [],
      repairReceipts: [rep],
      stopReason: null,
      finalCandidatePaths: ["src/index.ts", "src/fix.ts"],
    };
    const res = createMinimalResult({ loop });
    const m = collectTwinRunMetrics(res);

    assert.equal(m.repair.repairReceiptCount, 1);
    assert.equal(m.repair.repairRealProviderProcessExecutions, 1);
    assert.equal(m.repair.repairFilesProposed, 3);
    assert.equal(m.repair.repairFilesApplied, 2);
    assert.equal(m.repair.repairRequestBytes, 400);
    assert.equal(m.repair.repairResponseBytes, 800);

    testsPassed += 1;
  }

  // 13. Initial + Repair Global Real Execution
  {
    const diagReal = createDiagnostic("implementation", true);
    const repReal = createRepairReceipt(true);
    const loop: TwinBuildLoopResult = {
      state: "CANDIDATE_VERIFIED",
      finalStatus: "PASS",
      verificationRounds: 2,
      repairAttempts: 1,
      filesAppliedByRepair: 1,
      receipts: [],
      repairReceipts: [repReal],
      stopReason: null,
      finalCandidatePaths: ["src/index.ts"],
    };
    const res = createMinimalResult({
      providerCalls: 1,
      diagnostics: [diagReal],
      loop,
    });
    const m = collectTwinRunMetrics(res);

    assert.equal(m.initialRealProviderProcessExecutions, 1);
    assert.equal(m.repair.repairRealProviderProcessExecutions, 1);
    assert.equal(m.totalRealProviderProcessExecutions, 2);

    testsPassed += 1;
  }

  // 14. Initial + Repair Byte Totals
  {
    const diag = createDiagnostic("architecture", false, 100, 600, 1200);
    const rep = createRepairReceipt(false, 1, 1, 400, 800);
    const loop: TwinBuildLoopResult = {
      state: "CANDIDATE_VERIFIED",
      finalStatus: "PASS",
      verificationRounds: 2,
      repairAttempts: 1,
      filesAppliedByRepair: 1,
      receipts: [],
      repairReceipts: [rep],
      stopReason: null,
      finalCandidatePaths: ["src/index.ts"],
    };
    const res = createMinimalResult({
      providerCalls: 1,
      diagnostics: [diag],
      loop,
    });
    const m = collectTwinRunMetrics(res);

    assert.equal(m.initialProviderRequestBytes, 600);
    assert.equal(m.repair.repairRequestBytes, 400);
    assert.equal(m.totalProviderRequestBytes, 1000);

    assert.equal(m.initialProviderResponseBytes, 1200);
    assert.equal(m.repair.repairResponseBytes, 800);
    assert.equal(m.totalProviderResponseBytes, 2000);

    testsPassed += 1;
  }

  // 15. Fake + Real Repair Receipts Mixed
  {
    const repFake = createRepairReceipt(false, 1, 1, 200, 400, 0);
    const repReal = createRepairReceipt(true, 1, 1, 300, 500, 1);
    const loop: TwinBuildLoopResult = {
      state: "CANDIDATE_VERIFIED",
      finalStatus: "PASS",
      verificationRounds: 3,
      repairAttempts: 2,
      filesAppliedByRepair: 2,
      receipts: [],
      repairReceipts: [repFake, repReal],
      stopReason: null,
      finalCandidatePaths: ["src/index.ts"],
    };
    const res = createMinimalResult({ loop });
    const m = collectTwinRunMetrics(res);

    assert.equal(m.repair.repairReceiptCount, 2);
    assert.equal(m.repair.repairRealProviderProcessExecutions, 1);
    assert.equal(m.repair.repairRequestBytes, 500);
    assert.equal(m.repair.repairResponseBytes, 900);

    testsPassed += 1;
  }

  // 16. providerCalls != diagnosticCount
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
    const res = createMinimalResult({
      providerCalls: 0,
      diagnostics: [diagSlotFail],
    });
    const m = collectTwinRunMetrics(res);

    assert.equal(m.initialProviderCalls, 0);
    assert.equal(m.initialDiagnosticCount, 1);
    assert.equal(m.roleBreakdown.architecture.diagnosticCount, 1);

    testsPassed += 1;
  }

  // 17. candidateVerified Disagrees with Loop Status (Preserve Disagreement)
  {
    const loop: TwinBuildLoopResult = {
      state: "FAIL_CLOSED",
      finalStatus: "FAIL",
      verificationRounds: 1,
      repairAttempts: 1,
      filesAppliedByRepair: 0,
      receipts: [],
      repairReceipts: [],
      stopReason: "manual-override",
      finalCandidatePaths: ["src/index.ts"],
    };
    // Deliberate disagreement in source object
    const res = createMinimalResult({ candidateVerified: true, loop });
    const m = collectTwinRunMetrics(res);

    assert.equal(m.candidateVerified, true);
    assert.equal(m.loop.finalVerificationStatus, "FAIL");

    testsPassed += 1;
  }

  // 18. Loop filesAppliedByRepair Disagrees with Receipt Sum (Preserve Disagreement)
  {
    const rep = createRepairReceipt(false, 2, 1); // receipt claims 1 applied
    const loop: TwinBuildLoopResult = {
      state: "CANDIDATE_VERIFIED",
      finalStatus: "PASS",
      verificationRounds: 2,
      repairAttempts: 1,
      filesAppliedByRepair: 5, // loop claims 5 applied
      receipts: [],
      repairReceipts: [rep],
      stopReason: null,
      finalCandidatePaths: ["src/index.ts"],
    };
    const res = createMinimalResult({ loop });
    const m = collectTwinRunMetrics(res);

    assert.equal(m.loop.filesAppliedByRepair, 5);
    assert.equal(m.repair.repairFilesApplied, 1);

    testsPassed += 1;
  }

  // 19. Deterministic Repeated Execution
  {
    const diag = createDiagnostic("architecture", false, 100, 200, 400);
    const res = createMinimalResult({ providerCalls: 1, diagnostics: [diag] });

    const m1 = collectTwinRunMetrics(res);
    const m2 = collectTwinRunMetrics(res);

    assert.deepEqual(m1, m2);

    testsPassed += 1;
  }

  // 20. STRENGTHENED DEEP-VALUE INPUT IMMUTABILITY & FREEZE
  {
    const diag = createDiagnostic("architecture", false, 100, 200, 400);
    const vReceipt = createVerificationReceipt("PASS");
    const repReceipt = createRepairReceipt(false);
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

    const res = createMinimalResult({
      providerCalls: 1,
      diagnostics: originalDiagnostics,
      loop: loopResult,
    });

    // Capture deep value snapshot before collection
    const preCallSerialized = JSON.stringify(res);

    const m = collectTwinRunMetrics(res);

    // Assert exact deep-value equality of input after collection
    assert.equal(JSON.stringify(res), preCallSerialized);

    // Verify caller's input and nested properties are NOT frozen
    assert.equal(Object.isFrozen(res), false);
    assert.equal(Object.isFrozen(res.diagnostics), false);
    assert.equal(Object.isFrozen(res.diagnostics[0]), false);
    assert.equal(Object.isFrozen(loopResult), false);
    assert.equal(Object.isFrozen(originalReceipts), false);
    assert.equal(Object.isFrozen(originalReceipts[0]), false);
    assert.equal(Object.isFrozen(originalRepairReceipts), false);
    assert.equal(Object.isFrozen(originalRepairReceipts[0]), false);

    // Verify returned snapshot and all nested output objects ARE explicitly frozen
    assert.equal(Object.isFrozen(m), true);
    assert.equal(Object.isFrozen(m.roleBreakdown), true);
    assert.equal(Object.isFrozen(m.roleBreakdown.architecture), true);
    assert.equal(Object.isFrozen(m.roleBreakdown.implementation), true);
    assert.equal(Object.isFrozen(m.roleBreakdown.review), true);
    assert.equal(Object.isFrozen(m.loop), true);
    assert.equal(Object.isFrozen(m.loop.statusCounts), true);
    assert.equal(Object.isFrozen(m.repair), true);

    testsPassed += 1;
  }

  // 21. Caller Input References Unchanged
  {
    const diagArr = [createDiagnostic("architecture", false)];
    const vReceiptArr = [createVerificationReceipt("PASS")];
    const repReceiptArr = [createRepairReceipt(false)];
    const loop: TwinBuildLoopResult = {
      state: "CANDIDATE_VERIFIED",
      finalStatus: "PASS",
      verificationRounds: 1,
      repairAttempts: 1,
      filesAppliedByRepair: 1,
      receipts: vReceiptArr,
      repairReceipts: repReceiptArr,
      stopReason: null,
      finalCandidatePaths: ["src/index.ts"],
    };
    const res = createMinimalResult({ providerCalls: 1, diagnostics: diagArr, loop });

    collectTwinRunMetrics(res);

    assert.equal(res.diagnostics, diagArr);
    assert.equal(res.loop?.receipts, vReceiptArr);
    assert.equal(res.loop?.repairReceipts, repReceiptArr);

    testsPassed += 1;
  }

  // 22. Caller Input is NOT Frozen
  {
    const res = createMinimalResult({ diagnostics: [createDiagnostic("architecture", false)] });
    collectTwinRunMetrics(res);

    assert.equal(Object.isFrozen(res), false);
    assert.equal(Object.isFrozen(res.diagnostics), false);

    testsPassed += 1;
  }

  // 23. Complete Output Deep Freeze
  {
    const res = createMinimalResult({ diagnostics: [createDiagnostic("architecture", false)] });
    const m = collectTwinRunMetrics(res);

    assert.equal(Object.isFrozen(m), true);
    assert.equal(Object.isFrozen(m.roleBreakdown), true);
    assert.equal(Object.isFrozen(m.roleBreakdown.architecture), true);
    assert.equal(Object.isFrozen(m.roleBreakdown.implementation), true);
    assert.equal(Object.isFrozen(m.roleBreakdown.review), true);
    assert.equal(Object.isFrozen(m.loop), true);
    assert.equal(Object.isFrozen(m.loop.statusCounts), true);
    assert.equal(Object.isFrozen(m.repair), true);

    testsPassed += 1;
  }

  // 24. Zero Diagnostics => Diagnostic Averages Null
  {
    const res = createMinimalResult({ diagnostics: [] });
    const m = collectTwinRunMetrics(res);

    assert.equal(m.averageInitialDiagnosticDurationMs, null);
    assert.equal(m.averageInitialDiagnosticRequestBytes, null);
    assert.equal(m.averageInitialDiagnosticResponseBytes, null);

    testsPassed += 1;
  }

  // 25. Role Totals Reconcile with Global Diagnostic Totals
  {
    const dArch = createDiagnostic("architecture", false, 100, 200, 400);
    const dImpl = createDiagnostic("implementation", false, 300, 600, 1200);
    const dRev = createDiagnostic("review", false, 50, 100, 200);
    const res = createMinimalResult({ providerCalls: 3, diagnostics: [dArch, dImpl, dRev] });
    const m = collectTwinRunMetrics(res);

    const sumDiagnosticCount = m.roleBreakdown.architecture.diagnosticCount + m.roleBreakdown.implementation.diagnosticCount + m.roleBreakdown.review.diagnosticCount;
    const sumDurationMs = m.roleBreakdown.architecture.durationMs + m.roleBreakdown.implementation.durationMs + m.roleBreakdown.review.durationMs;
    const sumReqBytes = m.roleBreakdown.architecture.requestBytes + m.roleBreakdown.implementation.requestBytes + m.roleBreakdown.review.requestBytes;
    const sumResBytes = m.roleBreakdown.architecture.responseBytes + m.roleBreakdown.implementation.responseBytes + m.roleBreakdown.review.responseBytes;

    assert.equal(sumDiagnosticCount, m.initialDiagnosticCount);
    assert.equal(sumDurationMs, m.initialProviderDurationMs);
    assert.equal(sumReqBytes, m.initialProviderRequestBytes);
    assert.equal(sumResBytes, m.initialProviderResponseBytes);

    testsPassed += 1;
  }

  // 26. Status-Count Sum == verificationStageExecutions
  {
    const receipts = [
      createVerificationReceipt("PASS", "typecheck", 0),
      createVerificationReceipt("FAIL", "build", 1),
      createVerificationReceipt("BLOCKED", "test", 2),
      createVerificationReceipt("UNVERIFIED", "test", 3),
    ];
    const loop: TwinBuildLoopResult = {
      state: "FAIL_CLOSED",
      finalStatus: "FAIL",
      verificationRounds: 4,
      repairAttempts: 0,
      filesAppliedByRepair: 0,
      receipts,
      repairReceipts: [],
      stopReason: null,
      finalCandidatePaths: ["src/index.ts"],
    };
    const res = createMinimalResult({ loop });
    const m = collectTwinRunMetrics(res);

    const sumStatuses = m.loop.statusCounts.passCount + m.loop.statusCounts.failCount + m.loop.statusCounts.blockedCount + m.loop.statusCounts.unverifiedCount;
    assert.equal(sumStatuses, m.loop.verificationStageExecutions);

    testsPassed += 1;
  }

  // 27. Global Request Bytes == Initial Request Bytes + Repair Request Bytes
  {
    const diag = createDiagnostic("architecture", false, 100, 500, 1000);
    const rep = createRepairReceipt(false, 1, 1, 300, 700);
    const loop: TwinBuildLoopResult = {
      state: "CANDIDATE_VERIFIED",
      finalStatus: "PASS",
      verificationRounds: 2,
      repairAttempts: 1,
      filesAppliedByRepair: 1,
      receipts: [],
      repairReceipts: [rep],
      stopReason: null,
      finalCandidatePaths: ["src/index.ts"],
    };
    const res = createMinimalResult({ providerCalls: 1, diagnostics: [diag], loop });
    const m = collectTwinRunMetrics(res);

    assert.equal(m.totalProviderRequestBytes, m.initialProviderRequestBytes + m.repair.repairRequestBytes);
    assert.equal(m.totalProviderRequestBytes, 800);

    testsPassed += 1;
  }

  // 28. Global Response Bytes == Initial Response Bytes + Repair Response Bytes
  {
    const diag = createDiagnostic("architecture", false, 100, 500, 1000);
    const rep = createRepairReceipt(false, 1, 1, 300, 700);
    const loop: TwinBuildLoopResult = {
      state: "CANDIDATE_VERIFIED",
      finalStatus: "PASS",
      verificationRounds: 2,
      repairAttempts: 1,
      filesAppliedByRepair: 1,
      receipts: [],
      repairReceipts: [rep],
      stopReason: null,
      finalCandidatePaths: ["src/index.ts"],
    };
    const res = createMinimalResult({ providerCalls: 1, diagnostics: [diag], loop });
    const m = collectTwinRunMetrics(res);

    assert.equal(m.totalProviderResponseBytes, m.initialProviderResponseBytes + m.repair.repairResponseBytes);
    assert.equal(m.totalProviderResponseBytes, 1700);

    testsPassed += 1;
  }

  // 29. Global Real Executions == Initial Real Executions + Repair Real Executions
  {
    const diag = createDiagnostic("implementation", true);
    const rep = createRepairReceipt(true);
    const loop: TwinBuildLoopResult = {
      state: "CANDIDATE_VERIFIED",
      finalStatus: "PASS",
      verificationRounds: 2,
      repairAttempts: 1,
      filesAppliedByRepair: 1,
      receipts: [],
      repairReceipts: [rep],
      stopReason: null,
      finalCandidatePaths: ["src/index.ts"],
    };
    const res = createMinimalResult({ providerCalls: 1, diagnostics: [diag], loop });
    const m = collectTwinRunMetrics(res);

    assert.equal(m.totalRealProviderProcessExecutions, m.initialRealProviderProcessExecutions + m.repair.repairRealProviderProcessExecutions);
    assert.equal(m.totalRealProviderProcessExecutions, 2);

    testsPassed += 1;
  }

  return { ok: true, testsPassed };
}

if (require.main === module) {
  const result = runTwinRunMetricsTests();
  console.log(`runTwinRunMetricsTests OK (${result.testsPassed} cases passed)`);
}
