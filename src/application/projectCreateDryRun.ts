/**
 * Capability C1 — pure create dry-run evaluator.
 *
 * Combines the C0 approval contract (verifyApproval), the C0 structural
 * policy (evaluateCreatePolicy), and a C1 read-only CreateTargetInspection
 * into a single dry-run decision. It writes canonical ReceiptLog receipts
 * and returns a CreateDryRunResult.
 *
 * NO WRITE AUTHORITY. This module imports no fs and performs no mutation.
 * The real filesystem access happens only in ProjectInspector, whose result
 * is injected here as data. A successful dry-run means exactly one thing:
 * "the current read-only inspection found no blocking condition." It does
 * NOT authorize a write, does not create/modify anything, does not consume
 * the approval grant, and is not authority for a future write. C2 must
 * recompute the operation integrity and re-run every filesystem check
 * immediately before any exclusive-create.
 *
 * Fail-closed: any missing gate, corrupted invariant, incomplete
 * inspection, or filesystem boundary refuses or blocks — the "ready"
 * outcome is reachable only when every gate is clean.
 *
 * Every reason literal is audited against the canonical protected-text
 * matcher; receipts carry ids, counts, fixed reason codes, and path
 * fingerprints only — never raw paths, content, or filesystem error text.
 */

import type { CodeProposal } from "../generation/codeProposal";
import { ReceiptLog } from "../core/receiptLog";
import type { ReceiptStatus } from "../types/receiptTypes";
import type {
  ConsumedApprovalState,
  CreateOperationDescriptor,
  HumanApprovalGrant,
} from "./createCapabilityTypes";
import type {
  CreateTargetInspection,
  RollbackInstructionPreview,
} from "./createTargetInspectionTypes";
import { verifyApproval } from "./approvalVerifier";
import { evaluateCreatePolicy } from "./projectCreatePolicy";

export type CreateDryRunStatus = "completed" | "refused" | "blocked" | "failed";

/** Fixed, protected-text-audited reason vocabulary for a dry-run decision. */
export type CreateDryRunReasonCode =
  | "dry-run-clean"
  | "structural-policy-refused"
  | "c0-approval-refused"
  | "descriptor-invariant-corrupted"
  | "inspection-error"
  | "boundary-target-escapes-root"
  | "boundary-real-parent-escapes-root"
  | "boundary-parent-missing"
  | "boundary-parent-not-directory"
  | "boundary-parent-chain-link"
  | "boundary-target-is-link"
  | "boundary-target-exists"
  | "boundary-case-insensitive-collision";

export interface CreateDryRunResult {
  proposalId: string;
  grantId: string;
  status: CreateDryRunStatus;
  reasonCode: CreateDryRunReasonCode;
  /** The specific C0/structural sub-reason when the refusal came from a gate. */
  underlyingReasonCode?: string;

  approvedContract: boolean;
  structuralPolicyPassed: boolean;
  filesystemInspectionPassed: boolean;
  /** True ONLY in the fully-clean completed case — and still not authority. */
  readyForFutureWriteReview: boolean;

  // Literal-typed safety invariants: a written/authorized dry-run is
  // unrepresentable, and a fresh C2 revalidation is always required.
  simulated: true;
  executed: false;
  writePerformed: false;
  writeAuthorized: false;
  authoritativeForWrite: false;
  rollbackExecuted: false;
  requiresFreshC2Revalidation: true;

  receiptId: string;
  /** Data-only, non-executable rollback preview. */
  rollbackPreview: RollbackInstructionPreview;
}

export interface CreateDryRunInput {
  proposal: CodeProposal;
  descriptor: CreateOperationDescriptor;
  grant: HumanApprovalGrant;
  consumed: ConsumedApprovalState;
  /** Injected read-only inspection (from ProjectInspector or a test fixture). */
  targetInspection: CreateTargetInspection;
  receiptLog: ReceiptLog;
  currentSequence?: number;
  reviewVerdict?: string;
  reviewReceiptId?: string;
  /** Number of file operations described; must be exactly one. Defaults to 1. */
  operationCount?: number;
}

export function evaluateCreateDryRun(input: CreateDryRunInput): CreateDryRunResult {
  const { proposal, descriptor, grant, consumed, targetInspection, receiptLog } = input;

  const rollbackPreview: RollbackInstructionPreview = {
    // Fingerprint reference to the would-be-created path — never a raw path.
    targetPathReference: `pathfp:${targetInspection.normalizedRelativePathFingerprint}`,
    reason: "Would remove the file only if a future approved creation succeeds.",
    executed: false,
    requiresSeparateHumanApproval: true,
    availableOnlyAfterSuccessfulFutureCreation: true,
  };

  const decide = (
    status: CreateDryRunStatus,
    reasonCode: CreateDryRunReasonCode,
    fields: {
      approvedContract: boolean;
      structuralPolicyPassed: boolean;
      filesystemInspectionPassed: boolean;
      readyForFutureWriteReview: boolean;
      underlyingReasonCode?: string;
    }
  ): CreateDryRunResult => {
    const receiptStatus: ReceiptStatus = status;
    const receipt = receiptLog.create({
      summary: `Create dry-run ${statusPhrase(status)}.`,
      status: receiptStatus,
      links: {},
      details: {
        reasonCode,
        underlyingReasonCode: fields.underlyingReasonCode,
        normalizedRelativePathFingerprint: targetInspection.normalizedRelativePathFingerprint,
        inspectedEntryCount: targetInspection.inspectedEntryCount,
      },
    });

    return {
      proposalId: proposal.proposalId,
      grantId: grant.grantId,
      status,
      reasonCode,
      underlyingReasonCode: fields.underlyingReasonCode,
      approvedContract: fields.approvedContract,
      structuralPolicyPassed: fields.structuralPolicyPassed,
      filesystemInspectionPassed: fields.filesystemInspectionPassed,
      readyForFutureWriteReview: fields.readyForFutureWriteReview,
      simulated: true,
      executed: false,
      writePerformed: false,
      writeAuthorized: false,
      authoritativeForWrite: false,
      rollbackExecuted: false,
      requiresFreshC2Revalidation: true,
      receiptId: receipt.receiptId,
      rollbackPreview,
    };
  };

  // Gate 1: structural (C0) admission. Shape must be permissible first.
  const policy = evaluateCreatePolicy({
    changeKind: descriptor.changeKind,
    normalizedRelativePath: descriptor.normalizedRelativePath,
    contentByteLength: descriptor.contentByteLength,
    operationCount: input.operationCount ?? 1,
  });
  if (!policy.structuralPolicyPassed) {
    return decide("refused", "structural-policy-refused", {
      approvedContract: false,
      structuralPolicyPassed: false,
      filesystemInspectionPassed: false,
      readyForFutureWriteReview: false,
      underlyingReasonCode: policy.reasonCode,
    });
  }

  // Gate 2: C0 approval contract. Any drift (integrity, scope, replay,
  // freshness, review) refuses BEFORE filesystem admission.
  const approval = verifyApproval({
    proposal,
    descriptor,
    grant,
    consumed,
    currentSequence: input.currentSequence,
    reviewVerdict: input.reviewVerdict,
    reviewReceiptId: input.reviewReceiptId,
  });
  if (!approval.approved) {
    return decide("refused", "c0-approval-refused", {
      approvedContract: false,
      structuralPolicyPassed: true,
      filesystemInspectionPassed: false,
      readyForFutureWriteReview: false,
      underlyingReasonCode: approval.reasonCode,
    });
  }

  // Gate 3: descriptor invariants must survive (cast-defense).
  if (
    descriptor.simulated !== true ||
    descriptor.executed !== false ||
    descriptor.requiresHumanApproval !== true ||
    descriptor.changeKind !== "create"
  ) {
    return decide("refused", "descriptor-invariant-corrupted", {
      approvedContract: true,
      structuralPolicyPassed: true,
      filesystemInspectionPassed: false,
      readyForFutureWriteReview: false,
    });
  }

  // Gate 4: the inspection must have completed (an internal error fails closed).
  if (!targetInspection.filesystemInspectionCompleted) {
    return decide("failed", "inspection-error", {
      approvedContract: true,
      structuralPolicyPassed: true,
      filesystemInspectionPassed: false,
      readyForFutureWriteReview: false,
    });
  }

  // Gate 5: real filesystem boundaries. Any one blocks the admitted dry-run.
  const boundary = firstBoundary(targetInspection);
  if (boundary !== undefined) {
    return decide("blocked", boundary, {
      approvedContract: true,
      structuralPolicyPassed: true,
      filesystemInspectionPassed: false,
      readyForFutureWriteReview: false,
    });
  }

  // Gate 6: all clear. Ready for a FUTURE write review only — never authority.
  return decide("completed", "dry-run-clean", {
    approvedContract: true,
    structuralPolicyPassed: true,
    filesystemInspectionPassed: true,
    readyForFutureWriteReview: true,
  });
}

function firstBoundary(i: CreateTargetInspection): CreateDryRunReasonCode | undefined {
  if (!i.parentChainInsideProject) return "boundary-target-escapes-root";
  if (!i.realParentInsideProject) return "boundary-real-parent-escapes-root";
  if (i.parentChainContainsLink) return "boundary-parent-chain-link";
  if (!i.parentExists) return "boundary-parent-missing";
  if (!i.parentIsDirectory) return "boundary-parent-not-directory";
  if (i.targetIsLink) return "boundary-target-is-link";
  if (i.targetExists) return "boundary-target-exists";
  if (i.caseInsensitiveCollision) return "boundary-case-insensitive-collision";
  return undefined;
}

function statusPhrase(status: CreateDryRunStatus): string {
  switch (status) {
    case "completed":
      return "evaluation completed with no current blocker";
    case "refused":
      return "refused before filesystem admission";
    case "blocked":
      return "blocked at a filesystem boundary";
    case "failed":
      return "did not complete";
  }
}
