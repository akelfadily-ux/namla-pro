/**
 * twinRunMetrics — hardened, pure, evidence-first metrics snapshot derivation
 * over an existing `TwinColonyLiveResult` (TASK 001 Hardened).
 *
 * This module is PURE by construction:
 * - NO fs, child_process, network, process.env, Date, performance.now, timers,
 *   randomness, console logging, telemetry, or analytics.
 * - NO provider calls, sandbox calls, file writes, or global mutable state.
 * - NO mutation or freezing of the caller's input `TwinColonyLiveResult`.
 * - NO influence on runtime execution, court decisions, or permit minting.
 * - NO normalization or reconciliation of disagreeing evidence facts (MEASURE, DO NOT DECIDE).
 *
 * It reads facts directly present in the result and returns an immutable, deep-frozen
 * snapshot object.
 */

import type { TwinColonyLiveResult, TwinProviderDiagnostic, TwinRole } from "./twinColonyLiveRunner";
import type { TwinBuildLoopResult, TwinLoopState, TwinRepairReceipt, TwinVerificationReceipt, TwinVerificationStatus } from "./twinBuildLoop";

/** Exhaustive check helper ensuring all union cases are handled at compile time. */
function assertNever(x: never): never {
  throw new Error(`Unexpected status or role in exhaustive check: ${String(x)}`);
}

/** Per-role diagnostic metrics snapshot. */
export interface TwinRoleMetrics {
  /** The role identifier. */
  readonly role: TwinRole;
  /**
   * Number of TwinProviderDiagnostic records recorded for this role.
   * DIRECT SOURCE: count of diagnostics matching this role in result.diagnostics.
   * NOTE: Diagnostic count and executed provider call count are separate facts;
   * slot-acquisition failures record diagnostics without executing a provider call.
   */
  readonly diagnosticCount: number;
  /** Sum of durationMs for diagnostics in this role. */
  readonly durationMs: number;
  /** Sum of requestBytes for diagnostics in this role. */
  readonly requestBytes: number;
  /** Sum of responseBytes for diagnostics in this role. */
  readonly responseBytes: number;
}

/** Verification status counts with compile-time exhaustive union handling. */
export interface TwinVerificationStatusCounts {
  /** DIRECT SOURCE: count of receipts with status === "PASS". */
  readonly passCount: number;
  /** DIRECT SOURCE: count of receipts with status === "FAIL". */
  readonly failCount: number;
  /** DIRECT SOURCE: count of receipts with status === "BLOCKED". */
  readonly blockedCount: number;
  /** DIRECT SOURCE: count of receipts with status === "UNVERIFIED". */
  readonly unverifiedCount: number;
}

/** Verification loop metrics snapshot. */
export interface TwinLoopMetricsSnapshot {
  /** DIRECT SOURCE: result.loop !== null. */
  readonly available: boolean;
  /** DIRECT SOURCE: result.loop.state (null when loop is null). */
  readonly finalLoopState: TwinLoopState | null;
  /** DIRECT SOURCE: result.loop.finalStatus (null when loop is null). */
  readonly finalVerificationStatus: TwinVerificationStatus | null;
  /** DIRECT SOURCE: result.loop.verificationRounds. */
  readonly verificationRounds: number;
  /** DIRECT SOURCE: result.loop.receipts.length. */
  readonly verificationStageExecutions: number;
  /** DIRECT SOURCE: result.loop.repairAttempts. */
  readonly repairAttempts: number;
  /** DIRECT SOURCE: result.loop.filesAppliedByRepair. */
  readonly filesAppliedByRepair: number;
  /** DIRECT SOURCE: result.loop.stopReason. */
  readonly stopReason: string | null;
  /** Status breakdown over loop.receipts. */
  readonly statusCounts: TwinVerificationStatusCounts;
}

/** Repair execution metrics snapshot derived directly from TwinRepairReceipt items. */
export interface TwinRepairMetricsSnapshot {
  /** DIRECT SOURCE: result.loop.repairReceipts.length. */
  readonly repairReceiptCount: number;
  /** DIRECT SOURCE: count(repReceipt.realProcessExecution === true). */
  readonly repairRealProviderProcessExecutions: number;
  /** DIRECT SOURCE: sum(repReceipt.filesProposed). */
  readonly repairFilesProposed: number;
  /** DIRECT SOURCE: sum(repReceipt.filesApplied). */
  readonly repairFilesApplied: number;
  /** DIRECT SOURCE: sum(repReceipt.requestBytes). */
  readonly repairRequestBytes: number;
  /** DIRECT SOURCE: sum(repReceipt.responseBytes). */
  readonly repairResponseBytes: number;
}

/** Hardened pure metrics snapshot. All properties are readonly. */
export interface TwinRunMetricsSnapshot {
  // IDENTITY / RESULT
  /** DIRECT SOURCE: result.colonyId. */
  readonly colonyId: string;
  /** DIRECT SOURCE: result.ok. */
  readonly colonyOk: boolean;
  /** DIRECT SOURCE: result.failureReason. */
  readonly failureReason: string | null;
  /** DIRECT SOURCE: result.candidateVerified. */
  readonly candidateVerified: boolean;

  // INITIAL PROVIDER EXECUTION (architecture / implementation / review role calls)
  /** DIRECT SOURCE: result.providerCalls. */
  readonly initialProviderCalls: number;
  /** DIRECT SOURCE: count(diagnostics.realProcessExecution === true). */
  readonly initialRealProviderProcessExecutions: number;
  /** DIRECT SOURCE: diagnostics.length. */
  readonly initialDiagnosticCount: number;
  /** DIRECT SOURCE: sum(diagnostics.durationMs). */
  readonly initialProviderDurationMs: number;
  /** DIRECT SOURCE: sum(diagnostics.requestBytes). */
  readonly initialProviderRequestBytes: number;
  /** DIRECT SOURCE: sum(diagnostics.responseBytes). */
  readonly initialProviderResponseBytes: number;

  // GLOBAL REAL PROCESS EXECUTION & BYTE TOTALS (initial + repair)
  /** DERIVED FORMULA: initialRealProviderProcessExecutions + repairRealProviderProcessExecutions. */
  readonly totalRealProviderProcessExecutions: number;
  /** DERIVED FORMULA: initialProviderRequestBytes + repairRequestBytes. */
  readonly totalProviderRequestBytes: number;
  /** DERIVED FORMULA: initialProviderResponseBytes + repairResponseBytes. */
  readonly totalProviderResponseBytes: number;

  // ROLE BREAKDOWN
  /** Role breakdown over initial provider diagnostics. */
  readonly roleBreakdown: {
    readonly architecture: TwinRoleMetrics;
    readonly implementation: TwinRoleMetrics;
    readonly review: TwinRoleMetrics;
  };

  // ARTIFACT / REVIEW
  /** DIRECT SOURCE: result.artifactsApplied. */
  readonly artifactsApplied: number;
  /** DIRECT SOURCE: result.independentReviews. */
  readonly independentReviews: number;
  /** DIRECT SOURCE: result.reviewApproved. */
  readonly reviewApproved: boolean;

  // VERIFICATION LOOP
  readonly loop: TwinLoopMetricsSnapshot;

  // REPAIR EXECUTION
  readonly repair: TwinRepairMetricsSnapshot;

  // DERIVED INITIAL DIAGNOSTIC AVERAGES (null when initialDiagnosticCount === 0)
  /** DERIVED FORMULA: initialDiagnosticCount > 0 ? initialProviderDurationMs / initialDiagnosticCount : null. */
  readonly averageInitialDiagnosticDurationMs: number | null;
  /** DERIVED FORMULA: initialDiagnosticCount > 0 ? initialProviderRequestBytes / initialDiagnosticCount : null. */
  readonly averageInitialDiagnosticRequestBytes: number | null;
  /** DERIVED FORMULA: initialDiagnosticCount > 0 ? initialProviderResponseBytes / initialDiagnosticCount : null. */
  readonly averageInitialDiagnosticResponseBytes: number | null;
}

// --- PURE HELPER FUNCTIONS ---

interface InitialDiagnosticTotals {
  readonly realExecutions: number;
  readonly durationMs: number;
  readonly requestBytes: number;
  readonly responseBytes: number;
  readonly count: number;
}

function collectInitialDiagnosticTotals(diagnostics: readonly TwinProviderDiagnostic[]): InitialDiagnosticTotals {
  let realExecutions = 0;
  let durationMs = 0;
  let requestBytes = 0;
  let responseBytes = 0;

  for (const diag of diagnostics) {
    if (diag.realProcessExecution) {
      realExecutions += 1;
    }
    durationMs += diag.durationMs;
    requestBytes += diag.requestBytes;
    responseBytes += diag.responseBytes;
  }

  return { realExecutions, durationMs, requestBytes, responseBytes, count: diagnostics.length };
}

function collectRoleBreakdown(diagnostics: readonly TwinProviderDiagnostic[]): TwinRunMetricsSnapshot["roleBreakdown"] {
  const roleData: Record<TwinRole, { diagnosticCount: number; durationMs: number; requestBytes: number; responseBytes: number }> = {
    architecture: { diagnosticCount: 0, durationMs: 0, requestBytes: 0, responseBytes: 0 },
    implementation: { diagnosticCount: 0, durationMs: 0, requestBytes: 0, responseBytes: 0 },
    review: { diagnosticCount: 0, durationMs: 0, requestBytes: 0, responseBytes: 0 },
  };

  for (const diag of diagnostics) {
    switch (diag.role) {
      case "architecture":
      case "implementation":
      case "review": {
        const acc = roleData[diag.role];
        acc.diagnosticCount += 1;
        acc.durationMs += diag.durationMs;
        acc.requestBytes += diag.requestBytes;
        acc.responseBytes += diag.responseBytes;
        break;
      }
      default:
        assertNever(diag.role);
    }
  }

  const architecture: TwinRoleMetrics = Object.freeze({ role: "architecture", ...roleData.architecture });
  const implementation: TwinRoleMetrics = Object.freeze({ role: "implementation", ...roleData.implementation });
  const review: TwinRoleMetrics = Object.freeze({ role: "review", ...roleData.review });

  return Object.freeze({
    architecture,
    implementation,
    review,
  });
}

function collectStatusCounts(receipts: readonly TwinVerificationReceipt[]): TwinVerificationStatusCounts {
  let passCount = 0;
  let failCount = 0;
  let blockedCount = 0;
  let unverifiedCount = 0;

  for (const receipt of receipts) {
    switch (receipt.status) {
      case "PASS":
        passCount += 1;
        break;
      case "FAIL":
        failCount += 1;
        break;
      case "BLOCKED":
        blockedCount += 1;
        break;
      case "UNVERIFIED":
        unverifiedCount += 1;
        break;
      default:
        assertNever(receipt.status);
    }
  }

  return Object.freeze({
    passCount,
    failCount,
    blockedCount,
    unverifiedCount,
  });
}

function collectLoopMetrics(loop: TwinBuildLoopResult | null): TwinLoopMetricsSnapshot {
  if (loop === null) {
    const emptyCounts: TwinVerificationStatusCounts = Object.freeze({
      passCount: 0,
      failCount: 0,
      blockedCount: 0,
      unverifiedCount: 0,
    });
    return Object.freeze({
      available: false,
      finalLoopState: null,
      finalVerificationStatus: null,
      verificationRounds: 0,
      verificationStageExecutions: 0,
      repairAttempts: 0,
      filesAppliedByRepair: 0,
      stopReason: null,
      statusCounts: emptyCounts,
    });
  }

  return Object.freeze({
    available: true,
    finalLoopState: loop.state,
    finalVerificationStatus: loop.finalStatus,
    verificationRounds: loop.verificationRounds,
    verificationStageExecutions: loop.receipts.length,
    repairAttempts: loop.repairAttempts,
    filesAppliedByRepair: loop.filesAppliedByRepair,
    stopReason: loop.stopReason,
    statusCounts: collectStatusCounts(loop.receipts),
  });
}

function collectRepairMetrics(repairReceipts: readonly TwinRepairReceipt[]): TwinRepairMetricsSnapshot {
  let repairRealProviderProcessExecutions = 0;
  let repairFilesProposed = 0;
  let repairFilesApplied = 0;
  let repairRequestBytes = 0;
  let repairResponseBytes = 0;

  for (const receipt of repairReceipts) {
    if (receipt.realProcessExecution) {
      repairRealProviderProcessExecutions += 1;
    }
    repairFilesProposed += receipt.filesProposed;
    repairFilesApplied += receipt.filesApplied;
    repairRequestBytes += receipt.requestBytes;
    repairResponseBytes += receipt.responseBytes;
  }

  return Object.freeze({
    repairReceiptCount: repairReceipts.length,
    repairRealProviderProcessExecutions,
    repairFilesProposed,
    repairFilesApplied,
    repairRequestBytes,
    repairResponseBytes,
  });
}

/**
 * Derive a pure, deterministic, evidence-first metrics snapshot from `TwinColonyLiveResult`.
 * Returns an explicitly frozen structure. Does NOT mutate or freeze caller inputs.
 */
export function collectTwinRunMetrics(result: TwinColonyLiveResult): TwinRunMetricsSnapshot {
  const diagTotals = collectInitialDiagnosticTotals(result.diagnostics);
  const roleBreakdown = collectRoleBreakdown(result.diagnostics);
  const loopSnapshot = collectLoopMetrics(result.loop);
  const repairReceipts = result.loop !== null ? result.loop.repairReceipts : [];
  const repairSnapshot = collectRepairMetrics(repairReceipts);

  const initialDiagnosticCount = diagTotals.count;
  const initialProviderCalls = result.providerCalls;

  const averageInitialDiagnosticDurationMs = initialDiagnosticCount > 0 ? diagTotals.durationMs / initialDiagnosticCount : null;
  const averageInitialDiagnosticRequestBytes = initialDiagnosticCount > 0 ? diagTotals.requestBytes / initialDiagnosticCount : null;
  const averageInitialDiagnosticResponseBytes = initialDiagnosticCount > 0 ? diagTotals.responseBytes / initialDiagnosticCount : null;

  const totalRealProviderProcessExecutions = diagTotals.realExecutions + repairSnapshot.repairRealProviderProcessExecutions;
  const totalProviderRequestBytes = diagTotals.requestBytes + repairSnapshot.repairRequestBytes;
  const totalProviderResponseBytes = diagTotals.responseBytes + repairSnapshot.repairResponseBytes;

  const snapshot: TwinRunMetricsSnapshot = Object.freeze({
    colonyId: result.colonyId,
    colonyOk: result.ok,
    failureReason: result.failureReason,
    candidateVerified: result.candidateVerified,
    initialProviderCalls,
    initialRealProviderProcessExecutions: diagTotals.realExecutions,
    initialDiagnosticCount,
    initialProviderDurationMs: diagTotals.durationMs,
    initialProviderRequestBytes: diagTotals.requestBytes,
    initialProviderResponseBytes: diagTotals.responseBytes,
    totalRealProviderProcessExecutions,
    totalProviderRequestBytes,
    totalProviderResponseBytes,
    roleBreakdown,
    artifactsApplied: result.artifactsApplied,
    independentReviews: result.independentReviews,
    reviewApproved: result.reviewApproved,
    loop: loopSnapshot,
    repair: repairSnapshot,
    averageInitialDiagnosticDurationMs,
    averageInitialDiagnosticRequestBytes,
    averageInitialDiagnosticResponseBytes,
  });

  return snapshot;
}
