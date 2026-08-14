/**
 * Phase 5 git-as-data types. Nothing here talks to git: GitRepoState is a
 * *modeled* picture (supplied by a human or a future authorized phase, never
 * read from a real repository in Phase 5), GitReadPlan is a bundle of
 * planned-but-unexecuted actions, and GitCommitProposal is a commit
 * described as data.
 *
 * Literal-type invariants, matching the Phase 3 CodeProposal pattern:
 * - `pushIntent: false` — a proposal that wants to push is unrepresentable.
 *   Push is forbidden by NAMLA_BUILD_LAW regardless of phase.
 * - `applied: false` — no commit proposal can be typed as committed.
 * - `requiresHumanApproval: true` — no proposal can be typed as pre-approved.
 */

import type { SafetyDecision } from "../types/safetyTypes";
import type { PlannedAction } from "../types/bodyTypes";

export interface GitBranchInfo {
  name: string;
  isCurrent: boolean;
  /** Free-text note about the branch's last known state; modeled, not read. */
  lastKnownNote?: string;
}

export interface GitRepoState {
  /** True only if a human or future phase asserted this folder is a repo. */
  isRepoModeled: boolean;
  branches: GitBranchInfo[];
  /** Human/future-phase supplied observations; never output of a git command. */
  notes: string[];
  modeledAt: string;
}

export interface GitReadPlan {
  planId: string;
  /** Every action has executed: false; nothing in Phase 5 can flip it. */
  plannedActions: PlannedAction[];
  createdAt: string;
}

export type GitCommitProposalStatus = "pending" | "refused" | "withdrawn";

export interface GitCommitProposal {
  proposalId: string;
  /** The reviewed CodeProposals this commit would bundle. */
  sourceCodeProposalIds: string[];
  message: string;
  fileList: string[];
  rationale: string;
  safetyDecision: SafetyDecision;
  receiptId: string;
  pushIntent: false;
  applied: false;
  requiresHumanApproval: true;
  createdAt: string;
}

export interface GitCommitProposalRefusal {
  refusalId: string;
  /** Machine-readable reason, e.g. "safety-blocked", "push-intent-refused". */
  reasonCode: string;
  receiptId: string;
  refusedAt: string;
}
