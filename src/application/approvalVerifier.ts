/**
 * Capability C0 — pure ApprovalVerifier.
 *
 * Verifies that a candidate CreateOperationDescriptor + reviewed
 * CodeProposal + HumanApprovalGrant + ConsumedApprovalState + optional
 * review-outcome metadata are consistent, scoped, fresh, unreplayed, and
 * that the full-operation integrity fingerprint matches when recomputed
 * from the proposal itself. Every reason literal below is audited against
 * the canonical protected-text matcher — no summary/detail carries raw
 * content, raw path, prompts, diffs, credentials, tokens, or key material.
 *
 * Pure and deterministic: no fs, no process/env, no network, no timers,
 * no mutation of the inputs. No ReceiptLog write happens here; C0 remains
 * data-only.
 */

import type { CodeProposal } from "../generation/codeProposal";
import { holdsCoreProposalInvariants } from "../generation/codeProposal";
import type {
  ApprovalDecision,
  ConsumedApprovalState,
  CreateOperationDescriptor,
  HumanApprovalGrant,
} from "./createCapabilityTypes";
import { computeIntegrityFingerprint, displayIntegrityFingerprint } from "./proposalIntegrity";

/** Fixed reason vocabulary, audited against protected-text indicators. */
export type ApprovalReasonCode =
  | "approval-valid"
  | "grant-already-consumed"
  | "grant-proposal-mismatch"
  | "grant-scope-mismatch"
  | "grant-not-single-use"
  | "integrity-mismatch"
  | "proposal-invariant-failed"
  | "wrong-change-kind"
  | "missing-create-content"
  | "unexpected-diff-on-create"
  | "review-not-approved"
  | "approval-declaration-invalid"
  | "grant-expired"
  | "descriptor-path-mismatch"
  | "descriptor-length-mismatch"
  | "descriptor-fingerprint-mismatch";

export interface ApprovalVerifierInput {
  proposal: CodeProposal;
  descriptor: CreateOperationDescriptor;
  grant: HumanApprovalGrant;
  consumed: ConsumedApprovalState;
  /** Deterministic verification sequence; used only for freshness. */
  currentSequence?: number;
  /** Optional review metadata — a "clean" verdict is required if present. */
  reviewVerdict?: string;
  reviewReceiptId?: string;
}

const REVIEW_APPROVED_VERDICTS = new Set(["clean"]);

/** Non-authoritative helper for shaping compact display fingerprints. */
export function shortDisplayFingerprint(full: string): string {
  return displayIntegrityFingerprint(full);
}

export function verifyApproval(input: ApprovalVerifierInput): ApprovalDecision {
  const { proposal, descriptor, grant, consumed } = input;

  const decide = (
    approved: boolean,
    reasonCode: ApprovalReasonCode,
    extra: Record<string, string | number | boolean> = {}
  ): ApprovalDecision => ({
    approved,
    reasonCode,
    grantId: grant.grantId,
    proposalId: proposal.proposalId,
    details: extra,
  });

  // Gate 1: proposal invariants must hold (cast-defense).
  if (!holdsCoreProposalInvariants(proposal) || proposal.applied !== false) {
    return decide(false, "proposal-invariant-failed");
  }

  // Gate 2: create contract — kind + content shape.
  if (proposal.changeKind !== "create" || descriptor.changeKind !== "create") {
    return decide(false, "wrong-change-kind");
  }
  const content = proposal.proposedContent;
  if (typeof content !== "string" || content.length === 0) {
    return decide(false, "missing-create-content");
  }
  if (proposal.proposedDiff !== undefined && proposal.proposedDiff.length > 0) {
    return decide(false, "unexpected-diff-on-create");
  }

  // Gate 3: grant scope + declaration + single-use.
  if (grant.scope !== "create-one-project-file") return decide(false, "grant-scope-mismatch");
  if (grant.singleUse !== true) return decide(false, "grant-not-single-use");
  if (grant.declaredApproverKind !== "human") return decide(false, "approval-declaration-invalid");
  if (grant.proposalId !== proposal.proposalId) return decide(false, "grant-proposal-mismatch");

  // Gate 4: replay state.
  if (consumed.consumedGrantIds.includes(grant.grantId)) {
    return decide(false, "grant-already-consumed");
  }

  // Gate 5: freshness (deterministic sequence, not wall-clock).
  if (
    grant.expiresAfterSequence !== undefined &&
    input.currentSequence !== undefined &&
    input.currentSequence > grant.expiresAfterSequence
  ) {
    return decide(false, "grant-expired");
  }

  // Gate 6: descriptor must match the proposal exactly.
  if (descriptor.proposalId !== proposal.proposalId) {
    return decide(false, "grant-proposal-mismatch");
  }
  if (descriptor.normalizedRelativePath !== proposal.targetRelativePath) {
    return decide(false, "descriptor-path-mismatch");
  }
  const contentByteLength = Buffer.byteLength(content, "utf8");
  if (descriptor.contentByteLength !== contentByteLength) {
    return decide(false, "descriptor-length-mismatch");
  }

  // Gate 7: review metadata acceptable (when supplied via grant/descriptor).
  const verdict = input.reviewVerdict ?? descriptor.reviewVerdict;
  if (verdict !== undefined && !REVIEW_APPROVED_VERDICTS.has(verdict)) {
    return decide(false, "review-not-approved");
  }

  // Gate 8: recompute the full-operation fingerprint from the proposal
  // itself and compare against the grant. Any drift after issuance
  // (content, path, ids, verdict, invariant) diverges the hash.
  const recomputed = computeIntegrityFingerprint({
    proposalId: proposal.proposalId,
    changeKind: proposal.changeKind,
    normalizedRelativePath: proposal.targetRelativePath,
    proposedContent: content,
    proposalReceiptId: proposal.receiptId,
    reviewVerdict: input.reviewVerdict ?? descriptor.reviewVerdict,
    reviewReceiptId: input.reviewReceiptId ?? descriptor.reviewReceiptId,
    requiresHumanApproval: proposal.requiresHumanApproval,
  });

  if (recomputed !== grant.proposalIntegrityFingerprint) {
    return decide(false, "integrity-mismatch", {
      recomputedDisplayFingerprint: shortDisplayFingerprint(recomputed),
      grantDisplayFingerprint: shortDisplayFingerprint(grant.proposalIntegrityFingerprint),
    });
  }
  if (recomputed !== descriptor.proposalIntegrityFingerprint) {
    return decide(false, "descriptor-fingerprint-mismatch");
  }

  return decide(true, "approval-valid", {
    contentByteLength,
    integrityDisplayFingerprint: shortDisplayFingerprint(recomputed),
  });
}
