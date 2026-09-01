/**
 * src/twin/final02/verificationRunner.ts — Zero-Trust Verification Runner for FINAL-02.
 *
 * Runs all 5 zero-trust merge verification stages from scratch against the exact merged workspace.
 * Verifies that driver outcomes bind to expected workspaceId and absoluteWorkspacePath.
 * Real executions must bind to exact mergedTreeDigest.
 */

import type { MergeVerificationDriver, MergeVerificationOutcome, MergeVerificationDriverInput } from "../mergeForge";
import { MERGE_STAGES } from "../mergeForge";
import type { VerificationReceipt } from "./contracts";

export function runZeroTrustVerification(
  workspaceId: string,
  absoluteWorkspacePath: string,
  mergedTreeDigest: string,
  driver: MergeVerificationDriver,
  injectFailureStage: string | null = null
): VerificationReceipt {
  const stageOutcomes: MergeVerificationOutcome[] = [];

  for (const s of MERGE_STAGES) {
    const driverInput: MergeVerificationDriverInput = {
      stage: s,
      workspaceId,
      absoluteWorkspacePath,
      expectedMergedTreeDigest: mergedTreeDigest,
      injectFailure: s === injectFailureStage,
    };
    const outcome = (driver as any).run.length === 1
      ? driver.run(driverInput)
      : driver.run(s, workspaceId, s === injectFailureStage);

    // P0-3: Mandatory Verification Binding Requirement
    // Every outcome must match expected workspaceId and absoluteWorkspacePath.
    // For real process executions, mergedTreeDigest MUST match exactly.
    let validBinding = true;

    if (!outcome.workspaceId || outcome.workspaceId !== workspaceId) {
      validBinding = false;
    }

    if (!outcome.absolutePathIdentity || outcome.absolutePathIdentity !== absoluteWorkspacePath) {
      validBinding = false;
    }

    if (outcome.realExecution === true) {
      if (!outcome.mergedTreeDigest || outcome.mergedTreeDigest !== mergedTreeDigest) {
        validBinding = false;
      }
    }

    stageOutcomes.push({
      ...outcome,
      passed: outcome.passed && validBinding,
    });
  }

  const passed = stageOutcomes.every((o) => o.passed);

  return Object.freeze({
    fromZero: true,
    workspaceId,
    mergedTreeDigest,
    stageOutcomes: Object.freeze(stageOutcomes),
    passed,
  });
}
