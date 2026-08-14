/**
 * Phase 3 code-proposal types. A CodeProposal is a proposed change as DATA:
 * an in-memory description of what an ant would write, never a write itself.
 *
 * Two invariants are enforced at the type level with literal types:
 * - `requiresHumanApproval: true` — a proposal can never be typed as
 *   pre-approved.
 * - `applied: false` — a proposal can never be typed as applied. There is no
 *   code path anywhere in Phase 3 that applies one, and the type makes even
 *   *representing* an applied proposal a compile error.
 */

import type { SafetyDecision } from "../types/safetyTypes";

export type ProposalChangeKind = "create" | "modify";

export type ProposalStatus = "pending" | "refused" | "withdrawn";

export interface CodeProposal {
  proposalId: string;
  missionId: string;
  taskId: string;
  targetRelativePath: string;
  changeKind: ProposalChangeKind;
  /** Full proposed file content (for "create", or full replacement text). */
  proposedContent?: string;
  /** Alternatively, a textual diff description (for "modify"). */
  proposedDiff?: string;
  rationale: string;
  /** The SafetyGuard decision that allowed this proposal to exist. */
  safetyDecision: SafetyDecision;
  /** The receipt written when this proposal was created. */
  receiptId: string;
  requiresHumanApproval: true;
  applied: false;
  createdAt: string;
}

export interface ProposalRefusal {
  refusalId: string;
  targetRelativePath: string;
  /** Machine-readable reason, e.g. "outside-project-root", "protected-path". */
  reasonCode: string;
  receiptId: string;
  refusedAt: string;
}

export interface ProposalQueueItem {
  proposal: CodeProposal;
  status: ProposalStatus;
  enqueuedAt: string;
}

/**
 * Runtime re-verification of the two literal-typed invariants, for callers
 * that receive proposals from untrusted construction paths (casts can
 * defeat literal types). Shared by ProposalQueue, ProposalReviewer, and
 * CommitProposalFactory; call-site-specific extras (e.g. the queue's
 * safety-decision check) stay at the call sites.
 */
export function holdsCoreProposalInvariants(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.applied === false && candidate.requiresHumanApproval === true;
}
