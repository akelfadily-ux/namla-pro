/**
 * CommitProposalFactory builds GitCommitProposal objects — commits described
 * as data — from reviewed CodeProposals. It stages nothing, runs nothing,
 * writes nothing, and cannot push: pushIntent is the literal type false, and
 * a caller who casts a push intent into the request is refused at runtime.
 *
 * Gates, in order:
 * 1. Push intent smuggled past the type system -> refused.
 * 2. At least one source CodeProposal, each with applied === false and
 *    requiresHumanApproval === true (cast-defense re-check).
 * 3. Every file path re-checked per segment with the strict protected-name
 *    gate (source proposals from ProposalFactory already passed this, but
 *    hand-built ones might not have).
 * 4. SafetyGuard over message + rationale + file list; RISKY/FORBIDDEN
 *    refuse.
 *
 * Receipts follow the established redaction standard, including the
 * reason-literal rule from the Phase 4 verification: refusal summaries are
 * fixed phrases audited against SecretProtectionPolicy indicators; details
 * carry reason codes, counts, lengths, and fingerprints only.
 */

import { randomUUID } from "crypto";
import type { ActionReceipt } from "../types/receiptTypes";
import type { CodeProposal } from "../generation/codeProposal";
import { holdsCoreProposalInvariants } from "../generation/codeProposal";
import type { GitCommitProposal, GitCommitProposalRefusal } from "./gitStateModel";
import { SafetyGuard } from "../core/safetyGuard";
import { ReceiptLog } from "../core/receiptLog";
import { isSecretLikeFilename } from "../inspector/fileClassifier";
import { fingerprint } from "../core/redaction";

export interface CommitProposalRequest {
  sourceProposals: CodeProposal[];
  message: string;
  rationale: string;
}

export type CommitProposalResult =
  | { ok: true; proposal: GitCommitProposal; receipt: ActionReceipt }
  | { ok: false; refusal: GitCommitProposalRefusal; receipt: ActionReceipt };

export class CommitProposalFactory {
  constructor(
    private readonly safetyGuard: SafetyGuard,
    private readonly receiptLog: ReceiptLog
  ) {}

  create(request: CommitProposalRequest): CommitProposalResult {
    // Gate 1: pushIntent is not a field of CommitProposalRequest, so a
    // value here means the caller cast around the type system. Refuse.
    if ((request as unknown as Record<string, unknown>).pushIntent !== undefined) {
      return this.refuse(request, "push-intent-refused", "a push intent is not representable in Phase 5");
    }

    // Gate 2: sources must exist and hold the CodeProposal invariants.
    if (request.sourceProposals.length === 0) {
      return this.refuse(request, "no-source-proposals", "no source proposals were provided");
    }

    const corrupt = request.sourceProposals.some((p) => !holdsCoreProposalInvariants(p));
    if (corrupt) {
      return this.refuse(request, "corrupt-source-proposal", "a source proposal violates core invariants");
    }

    // Gate 3: path-shape re-check over the file list. Factory-created
    // sources passed FileBoundaryPolicy already, but hand-built ones may
    // carry traversal or absolute paths; this factory has no project root
    // to resolve against, so it checks shape: project-relative, no "..".
    const fileList = request.sourceProposals.map((p) => p.targetRelativePath);
    const hasNonRelativePath = fileList.some((filePath) => {
      const segments = filePath.split(/[\\/]+/).filter((segment) => segment.length > 0);
      const isAbsolute = /^([A-Za-z]:|[\\/])/.test(filePath);
      return isAbsolute || segments.length === 0 || segments.some((segment) => segment === "..");
    });
    if (hasNonRelativePath) {
      return this.refuse(request, "non-relative-path-in-file-list", "a file path is not a clean project-relative path");
    }

    // Gate 3b: per-segment protected-name re-check over the file list.
    const hasProtectedPath = fileList.some((filePath) =>
      filePath
        .split(/[\\/]+/)
        .filter((segment) => segment.length > 0)
        .some((segment) => isSecretLikeFilename(segment))
    );
    if (hasProtectedPath) {
      return this.refuse(request, "protected-path-in-file-list", "a file path matches a protected name");
    }

    // Gate 4: SafetyGuard over everything a human would read in the commit.
    const decision = this.safetyGuard.evaluateText(
      `${request.message}\n${request.rationale}\n${fileList.join("\n")}`
    );
    if (!decision.allowed) {
      return this.refuse(request, "safety-blocked", `blocked by SafetyGuard (${decision.level})`);
    }

    const proposalId = `git-proposal-${randomUUID()}`;

    const receipt = this.receiptLog.create({
      summary: "Git commit proposal created (pending human approval, not applied, nothing run).",
      status: "completed",
      links: {},
      details: {
        proposalId,
        sourceProposalCount: request.sourceProposals.length,
        fileCount: fileList.length,
        messageLength: request.message.length,
        safetyLevel: decision.level,
      },
    });

    const proposal: GitCommitProposal = {
      proposalId,
      sourceCodeProposalIds: request.sourceProposals.map((p) => p.proposalId),
      message: request.message,
      fileList,
      rationale: request.rationale,
      safetyDecision: decision,
      receiptId: receipt.receiptId,
      pushIntent: false,
      applied: false,
      requiresHumanApproval: true,
      createdAt: new Date().toISOString(),
    };

    return { ok: true, proposal, receipt };
  }

  private refuse(request: CommitProposalRequest, reasonCode: string, reasonText: string): CommitProposalResult {
    const receipt = this.receiptLog.create({
      summary: `Git commit proposal refused: ${reasonText}.`,
      status: "refused",
      links: {},
      details: {
        reasonCode,
        sourceProposalCount: request.sourceProposals?.length ?? 0,
        messageLength: request.message?.length ?? 0,
        messageFingerprint: fingerprint(request.message ?? ""),
      },
    });

    return {
      ok: false,
      refusal: {
        refusalId: `git-refusal-${randomUUID()}`,
        reasonCode,
        receiptId: receipt.receiptId,
        refusedAt: new Date().toISOString(),
      },
      receipt,
    };
  }
}
