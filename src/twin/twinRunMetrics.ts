/**
 * twinRunMetrics — pure, deterministic metrics snapshot derivation over an
 * existing `TwinColonyLiveResult` (TASK 001).
 *
 * This module is PURE by construction:
 * - NO fs, child_process, network, process.env, Date, performance.now, timers,
 *   randomness, console logging, telemetry, or analytics.
 * - NO provider calls, sandbox calls, file writes, or global mutable state.
 * - NO mutation of the input `TwinColonyLiveResult`.
 * - NO influence on runtime execution, court decisions, or permit minting.
 *
 * It reads facts already present in the result and returns an immutable, deep-frozen
 * snapshot object.
 */

import type { TwinColonyLiveResult, TwinRole } from "./twinColonyLiveRunner";
import type { TwinLoopState, TwinVerificationStatus } from "./twinBuildLoop";

export interface TwinRoleMetrics {
  readonly role: TwinRole;
  readonly callCount: number;
  readonly durationMs: number;
  readonly requestBytes: number;
  readonly responseBytes: number;
}

export interface TwinVerificationStatusCounts {
  readonly passCount: number;
  readonly failCount: number;
  readonly blockedCount: number;
  readonly unverifiedCount: number;
}

export interface TwinLoopMetricsSnapshot {
  readonly available: boolean;
  readonly finalLoopState: TwinLoopState | null;
  readonly finalVerificationStatus: TwinVerificationStatus | null;
  readonly verificationRounds: number;
  readonly verificationStageExecutions: number;
  readonly repairAttempts: number;
  readonly filesAppliedByRepair: number;
  readonly stopReason: string | null;
  readonly statusCounts: TwinVerificationStatusCounts;
}

export interface TwinRepairMetricsSnapshot {
  readonly repairReceiptCount: number;
  readonly repairRealProviderProcessExecutions: number;
  readonly repairFilesProposed: number;
  readonly repairFilesApplied: number;
  readonly repairRequestBytes: number;
  readonly repairResponseBytes: number;
}

export interface TwinRunMetricsSnapshot {
  // IDENTITY / RESULT
  readonly colonyId: string;
  readonly colonyOk: boolean;
  readonly failureReason: string | null;
  readonly candidateVerified: boolean;

  // PROVIDER EXECUTION
  readonly providerCalls: number;
  readonly realProviderProcessExecutions: number;
  readonly totalProviderDurationMs: number;
  readonly totalProviderRequestBytes: number;
  readonly totalProviderResponseBytes: number;

  // ROLE BREAKDOWN
  readonly roleBreakdown: {
    readonly architecture: TwinRoleMetrics;
    readonly implementation: TwinRoleMetrics;
    readonly review: TwinRoleMetrics;
  };

  // ARTIFACT / REVIEW
  readonly artifactsApplied: number;
  readonly independentReviews: number;
  readonly reviewApproved: boolean;

  // VERIFICATION LOOP
  readonly loop: TwinLoopMetricsSnapshot;

  // REPAIR EXECUTION
  readonly repair: TwinRepairMetricsSnapshot;

  // DERIVED AVERAGES (null when providerCalls === 0)
  readonly averageProviderDurationMs: number | null;
  readonly averageProviderRequestBytes: number | null;
  readonly averageProviderResponseBytes: number | null;
}

function emptyRoleMetrics(role: TwinRole): TwinRoleMetrics {
  return Object.freeze({
    role,
    callCount: 0,
    durationMs: 0,
    requestBytes: 0,
    responseBytes: 0,
  });
}

/**
 * Derive a pure, deterministic metrics snapshot from an existing `TwinColonyLiveResult`.
 * Returns a deep-frozen structure. Does NOT mutate the input.
 */
export function collectTwinRunMetrics(result: TwinColonyLiveResult): TwinRunMetricsSnapshot {
  // Identity / Result
  const colonyId = result.colonyId;
  const colonyOk = result.ok;
  const failureReason = result.failureReason;
  const candidateVerified = result.candidateVerified;

  // Provider Execution & Role Breakdown
  let realProviderProcessExecutions = 0;
  let totalProviderDurationMs = 0;
  let totalProviderRequestBytes = 0;
  let totalProviderResponseBytes = 0;

  const roleData: Record<TwinRole, { callCount: number; durationMs: number; requestBytes: number; responseBytes: number }> = {
    architecture: { callCount: 0, durationMs: 0, requestBytes: 0, responseBytes: 0 },
    implementation: { callCount: 0, durationMs: 0, requestBytes: 0, responseBytes: 0 },
    review: { callCount: 0, durationMs: 0, requestBytes: 0, responseBytes: 0 },
  };

  for (const diag of result.diagnostics) {
    if (diag.realProcessExecution) {
      realProviderProcessExecutions += 1;
    }
    totalProviderDurationMs += diag.durationMs;
    totalProviderRequestBytes += diag.requestBytes;
    totalProviderResponseBytes += diag.responseBytes;

    const roleAcc = roleData[diag.role];
    if (roleAcc) {
      roleAcc.callCount += 1;
      roleAcc.durationMs += diag.durationMs;
      roleAcc.requestBytes += diag.requestBytes;
      roleAcc.responseBytes += diag.responseBytes;
    }
  }

  const providerCalls = result.providerCalls;

  // Derived Averages
  const averageProviderDurationMs = providerCalls > 0 ? totalProviderDurationMs / providerCalls : null;
  const averageProviderRequestBytes = providerCalls > 0 ? totalProviderRequestBytes / providerCalls : null;
  const averageProviderResponseBytes = providerCalls > 0 ? totalProviderResponseBytes / providerCalls : null;

  // Role Metrics Snapshot
  const roleBreakdown = Object.freeze({
    architecture: Object.freeze({ role: "architecture" as const, ...roleData.architecture }),
    implementation: Object.freeze({ role: "implementation" as const, ...roleData.implementation }),
    review: Object.freeze({ role: "review" as const, ...roleData.review }),
  });

  // Artifact / Review
  const artifactsApplied = result.artifactsApplied;
  const independentReviews = result.independentReviews;
  const reviewApproved = result.reviewApproved;

  // Verification Loop & Status Counts
  let loopSnapshot: TwinLoopMetricsSnapshot;
  if (result.loop === null) {
    loopSnapshot = Object.freeze({
      available: false,
      finalLoopState: null,
      finalVerificationStatus: null,
      verificationRounds: 0,
      verificationStageExecutions: 0,
      repairAttempts: 0,
      filesAppliedByRepair: 0,
      stopReason: null,
      statusCounts: Object.freeze({
        passCount: 0,
        failCount: 0,
        blockedCount: 0,
        unverifiedCount: 0,
      }),
    });
  } else {
    let passCount = 0;
    let failCount = 0;
    let blockedCount = 0;
    let unverifiedCount = 0;

    for (const receipt of result.loop.receipts) {
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
      }
    }

    loopSnapshot = Object.freeze({
      available: true,
      finalLoopState: result.loop.state,
      finalVerificationStatus: result.loop.finalStatus,
      verificationRounds: result.loop.verificationRounds,
      verificationStageExecutions: result.loop.receipts.length,
      repairAttempts: result.loop.repairAttempts,
      filesAppliedByRepair: result.loop.filesAppliedByRepair,
      stopReason: result.loop.stopReason,
      statusCounts: Object.freeze({
        passCount,
        failCount,
        blockedCount,
        unverifiedCount,
      }),
    });
  }

  // Repair Execution
  let repairReceiptCount = 0;
  let repairRealProviderProcessExecutions = 0;
  let repairFilesProposed = 0;
  let repairFilesApplied = 0;
  let repairRequestBytes = 0;
  let repairResponseBytes = 0;

  if (result.loop !== null && result.loop.repairReceipts.length > 0) {
    repairReceiptCount = result.loop.repairReceipts.length;
    for (const repReceipt of result.loop.repairReceipts) {
      if (repReceipt.realProcessExecution) {
        repairRealProviderProcessExecutions += 1;
      }
      repairFilesProposed += repReceipt.filesProposed;
      repairFilesApplied += repReceipt.filesApplied;
      repairRequestBytes += repReceipt.requestBytes;
      repairResponseBytes += repReceipt.responseBytes;
    }
  }

  const repairSnapshot: TwinRepairMetricsSnapshot = Object.freeze({
    repairReceiptCount,
    repairRealProviderProcessExecutions,
    repairFilesProposed,
    repairFilesApplied,
    repairRequestBytes,
    repairResponseBytes,
  });

  const snapshot: TwinRunMetricsSnapshot = Object.freeze({
    colonyId,
    colonyOk,
    failureReason,
    candidateVerified,
    providerCalls,
    realProviderProcessExecutions,
    totalProviderDurationMs,
    totalProviderRequestBytes,
    totalProviderResponseBytes,
    roleBreakdown,
    artifactsApplied,
    independentReviews,
    reviewApproved,
    loop: loopSnapshot,
    repair: repairSnapshot,
    averageProviderDurationMs,
    averageProviderRequestBytes,
    averageProviderResponseBytes,
  });

  return snapshot;
}
