/**
 * ProposalFactory is the only way a CodeProposal comes into existence, and
 * it refuses before it creates. Gates, in order:
 *
 * 1. Target path must be inside the project root (FileBoundaryPolicy).
 * 2. Target path must not name a protected store — every path segment is
 *    checked with the strict secret-name gate from the Phase 1 classifier.
 * 3. The proposal must actually contain something (content or diff).
 * 4. SafetyGuard evaluates path + rationale + content/diff together; RISKY
 *    and FORBIDDEN refuse. This catches dangerous command-like content,
 *    package-manager instructions, git push, delete/remove patterns, and
 *    secret-like content, since all of those are guard indicators.
 *
 * Every outcome — creation or refusal — writes a receipt. Refusal receipts
 * are fully redacted: summaries are reason-coded, and details carry only
 * reason codes, the guard's own matched-indicator vocabulary, and
 * non-reversible path metadata (length + fingerprint). Raw refused paths
 * and proposal content never enter the receipt log. Creation receipts may
 * carry the target path because a created proposal's path has passed every
 * gate.
 *
 * The factory holds no filesystem handle and imports no fs API. It cannot
 * write; it can only describe.
 */

import { randomUUID } from "crypto";
import { fingerprint } from "../core/redaction";
import type { ActionReceipt } from "../types/receiptTypes";
import type { CodeProposal, ProposalChangeKind, ProposalRefusal } from "./codeProposal";
import { SafetyGuard } from "../core/safetyGuard";
import { ReceiptLog } from "../core/receiptLog";
import { isInsideProjectRoot } from "../policies/fileBoundaryPolicy";
import { isSecretLikeFilename } from "../inspector/fileClassifier";

export interface ProposalRequest {
  missionId: string;
  taskId: string;
  targetRelativePath: string;
  changeKind: ProposalChangeKind;
  proposedContent?: string;
  proposedDiff?: string;
  rationale: string;
}

export type ProposalCreationResult =
  | { ok: true; proposal: CodeProposal; receipt: ActionReceipt }
  | { ok: false; refusal: ProposalRefusal; receipt: ActionReceipt };

export class ProposalFactory {
  constructor(
    private readonly safetyGuard: SafetyGuard,
    private readonly receiptLog: ReceiptLog,
    private readonly projectRoot: string
  ) {}

  create(request: ProposalRequest): ProposalCreationResult {
    if (!isInsideProjectRoot(request.targetRelativePath, this.projectRoot)) {
      return this.refuse(request, "outside-project-root", "target path is outside the project root");
    }

    // Check every segment of the path, not just the basename, so a proposal
    // cannot hide a protected name inside a folder segment.
    const segments = request.targetRelativePath.split(/[\\/]+/).filter((s) => s.length > 0);
    if (segments.some((segment) => isSecretLikeFilename(segment))) {
      return this.refuse(request, "protected-path", "target path names a protected store");
    }

    // Both content AND diff are evaluated: `content ?? diff` would let a
    // dangerous diff ride in unexamined behind a safe content field.
    const body = `${request.proposedContent ?? ""}\n${request.proposedDiff ?? ""}`;
    if (body.trim().length === 0) {
      return this.refuse(request, "empty-proposal", "no content or diff was provided");
    }

    const decision = this.safetyGuard.evaluateText(
      `${request.targetRelativePath}\n${request.rationale}\n${body}`
    );
    if (!decision.allowed) {
      return this.refuse(request, "safety-blocked", `blocked by SafetyGuard (${decision.level})`, {
        reasons: decision.reasons,
      });
    }

    const proposalId = `proposal-${randomUUID()}`;

    const receipt = this.receiptLog.create({
      summary: `Code proposal created (pending human approval, not applied).`,
      status: "completed",
      links: { missionId: request.missionId, taskId: request.taskId },
      details: {
        proposalId,
        targetRelativePath: request.targetRelativePath,
        changeKind: request.changeKind,
        safetyLevel: decision.level,
      },
    });

    const proposal: CodeProposal = {
      proposalId,
      missionId: request.missionId,
      taskId: request.taskId,
      targetRelativePath: request.targetRelativePath,
      changeKind: request.changeKind,
      proposedContent: request.proposedContent,
      proposedDiff: request.proposedDiff,
      rationale: request.rationale,
      safetyDecision: decision,
      receiptId: receipt.receiptId,
      requiresHumanApproval: true,
      applied: false,
      createdAt: new Date().toISOString(),
    };

    return { ok: true, proposal, receipt };
  }

  private refuse(
    request: ProposalRequest,
    reasonCode: string,
    reasonText: string,
    extraDetails: Record<string, unknown> = {}
  ): ProposalCreationResult {
    // Redaction rule for refusals: a refused path may itself be secret-like
    // and refused content is by definition dangerous, so the receipt carries
    // only non-reversible metadata (length + short fingerprint) and reason
    // codes — never the raw path or body. The raw path stays in the returned
    // ProposalRefusal object for the caller, not in the audit trail.
    const receipt = this.receiptLog.create({
      summary: `Code proposal refused: ${reasonText}.`,
      status: "refused",
      links: { missionId: request.missionId, taskId: request.taskId },
      details: {
        reasonCode,
        targetPathLength: request.targetRelativePath.length,
        targetPathFingerprint: fingerprint(request.targetRelativePath),
        ...extraDetails,
      },
    });

    const refusal: ProposalRefusal = {
      refusalId: `refusal-${randomUUID()}`,
      targetRelativePath: request.targetRelativePath,
      reasonCode,
      receiptId: receipt.receiptId,
      refusedAt: new Date().toISOString(),
    };

    return { ok: false, refusal, receipt };
  }
}
