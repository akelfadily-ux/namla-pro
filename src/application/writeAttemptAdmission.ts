/**
 * Capability C2-A — pure write-attempt admission-candidate evaluation.
 *
 * Combines: a write-authority permit (identity-checked), the C0 approval
 * contract, unconsumed grant state, the strict C2 create policy, exact-byte
 * preparation, and an injected C1 CreateTargetInspection. It concludes only
 * `candidate-ready-for-c2b-review`, `refused`, or `blocked`.
 *
 * It NEVER concludes: write authorized, write executed, grant consumed, or
 * file created. It performs no filesystem access and no mutation, consumes
 * no grant, and writes nothing. A fresh FINAL C1 inspection immediately
 * before open is still required in C2-B — a clean injected inspection here
 * is necessary but not sufficient for a future write.
 *
 * Pure: no fs, no process/env, no network, no timers. Fixed reason codes
 * only; no raw content or path.
 */

import type { CodeProposal } from "../generation/codeProposal";
import { verifyApproval } from "./approvalVerifier";
import type {
  ConsumedApprovalState,
  CreateOperationDescriptor,
  HumanApprovalGrant,
} from "./createCapabilityTypes";
import type { CreateTargetInspection } from "./createTargetInspectionTypes";
import { evaluateC2CreatePolicy } from "./c2CreatePolicy";
import { isValidWriteAuthorityPermit } from "./writeAuthority";
import type { WriteAttemptAdmissionCandidate } from "./fileCreationTypes";

export interface WriteAttemptAdmissionInput {
  /** Validated by WeakSet identity — an untyped/forged object is refused. */
  permit: unknown;
  proposal: CodeProposal;
  descriptor: CreateOperationDescriptor;
  grant: HumanApprovalGrant;
  consumed: ConsumedApprovalState;
  targetInspection: CreateTargetInspection;
  reviewVerdict?: string;
  reviewReceiptId?: string;
  currentSequence?: number;
  operationCount?: number;
}

type Boundary =
  | "boundary-target-escapes-root"
  | "boundary-real-parent-escapes-root"
  | "boundary-parent-chain-link"
  | "boundary-parent-missing"
  | "boundary-parent-not-directory"
  | "boundary-target-is-link"
  | "boundary-target-exists"
  | "boundary-case-insensitive-collision";

function firstBoundary(i: CreateTargetInspection): Boundary | undefined {
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

export function evaluateWriteAttemptAdmission(
  input: WriteAttemptAdmissionInput
): WriteAttemptAdmissionCandidate {
  const { proposal, descriptor, grant } = input;

  const mk = (
    status: WriteAttemptAdmissionCandidate["status"],
    reasonCode: string,
    fields: {
      authorityRecognized: boolean;
      approvalValid: boolean;
      c2PolicyPassed: boolean;
      exactBytesOk: boolean;
      inspectionClean: boolean;
      byteLength: number;
      contentBytesFingerprint?: string;
      underlyingReasonCode?: string;
    }
  ): WriteAttemptAdmissionCandidate => ({
    status,
    reasonCode,
    underlyingReasonCode: fields.underlyingReasonCode,
    proposalId: proposal.proposalId,
    grantId: grant.grantId,
    authorityRecognized: fields.authorityRecognized,
    approvalValid: fields.approvalValid,
    c2PolicyPassed: fields.c2PolicyPassed,
    exactBytesOk: fields.exactBytesOk,
    inspectionClean: fields.inspectionClean,
    contentBytesFingerprint: fields.contentBytesFingerprint,
    byteLength: fields.byteLength,
    simulated: true,
    executed: false,
    writeAuthorized: false,
    grantConsumed: false,
    requiresFinalC1Revalidation: true,
  });

  // Gate 1: write-authority permit identity (forged/missing → refused).
  if (!isValidWriteAuthorityPermit(input.permit)) {
    return mk("refused", "write-authority-permit-invalid", {
      authorityRecognized: false,
      approvalValid: false,
      c2PolicyPassed: false,
      exactBytesOk: false,
      inspectionClean: false,
      byteLength: 0,
    });
  }

  // Gate 2: strict C2 structural + exact-byte policy.
  const content = typeof proposal.proposedContent === "string" ? proposal.proposedContent : "";
  const policy = evaluateC2CreatePolicy({
    changeKind: descriptor.changeKind,
    normalizedRelativePath: descriptor.normalizedRelativePath,
    content,
    operationCount: input.operationCount ?? 1,
    requiresHumanApproval: proposal.requiresHumanApproval,
    applied: proposal.applied,
  });
  if (!policy.structuralPolicyPassed) {
    return mk("refused", "c2-policy-refused", {
      authorityRecognized: true,
      approvalValid: false,
      c2PolicyPassed: false,
      exactBytesOk: false,
      inspectionClean: false,
      byteLength: policy.byteLength,
      underlyingReasonCode: policy.reasonCode,
    });
  }

  // Gate 3: C0 approval contract (integrity/scope/replay/freshness/review).
  const approval = verifyApproval({
    proposal,
    descriptor,
    grant,
    consumed: input.consumed,
    currentSequence: input.currentSequence,
    reviewVerdict: input.reviewVerdict,
    reviewReceiptId: input.reviewReceiptId,
  });
  if (!approval.approved) {
    return mk("refused", "c0-approval-refused", {
      authorityRecognized: true,
      approvalValid: false,
      c2PolicyPassed: true,
      exactBytesOk: true,
      inspectionClean: false,
      byteLength: policy.byteLength,
      contentBytesFingerprint: policy.contentBytesFingerprint,
      underlyingReasonCode: approval.reasonCode,
    });
  }

  // Gate 4: injected inspection must have completed (else blocked).
  if (!input.targetInspection.filesystemInspectionCompleted) {
    return mk("blocked", "inspection-incomplete", {
      authorityRecognized: true,
      approvalValid: true,
      c2PolicyPassed: true,
      exactBytesOk: true,
      inspectionClean: false,
      byteLength: policy.byteLength,
      contentBytesFingerprint: policy.contentBytesFingerprint,
    });
  }

  // Gate 5: real filesystem boundary from the injected inspection.
  const boundary = firstBoundary(input.targetInspection);
  if (boundary !== undefined) {
    return mk("blocked", boundary, {
      authorityRecognized: true,
      approvalValid: true,
      c2PolicyPassed: true,
      exactBytesOk: true,
      inspectionClean: false,
      byteLength: policy.byteLength,
      contentBytesFingerprint: policy.contentBytesFingerprint,
    });
  }

  // Gate 6: candidate ready for C2-B review ONLY. Still not a write
  // authorization, and a fresh final C1 inspection is still required.
  return mk("candidate-ready-for-c2b-review", "candidate-ready-for-c2b-review", {
    authorityRecognized: true,
    approvalValid: true,
    c2PolicyPassed: true,
    exactBytesOk: true,
    inspectionClean: true,
    byteLength: policy.byteLength,
    contentBytesFingerprint: policy.contentBytesFingerprint,
  });
}
