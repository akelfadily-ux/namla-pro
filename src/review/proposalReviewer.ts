/**
 * ProposalReviewer is Phase 4's core check: it reviews a CodeProposal (data)
 * against a ProjectSnapshot (data) and produces an AuditReport (data). It
 * runs no tests, applies nothing, and touches no filesystem — the snapshot
 * it consumes was taken by the Phase 1 inspector; the reviewer itself only
 * compares in-memory objects.
 *
 * Receipt discipline: reviewed proposals may be hand-built by callers and so
 * cannot be trusted to have factory-gated paths. Review receipts therefore
 * never carry the proposal's path or content — only ids, counts, severities,
 * and verdicts. Findings reference the proposal by id, not by path.
 */

import { randomUUID } from "crypto";
import type { ActionReceipt } from "../types/receiptTypes";
import type { AuditFinding, AuditReport, AuditSeverity } from "../types/auditTypes";
import type { CodeProposal } from "../generation/codeProposal";
import { holdsCoreProposalInvariants } from "../generation/codeProposal";
import type { ProjectSnapshot } from "../inspector/inspectorTypes";
import { SafetyGuard } from "../core/safetyGuard";
import { ReceiptLog } from "../core/receiptLog";

const DEFAULT_MAX_REVIEW_BODY_CHARS = 262_144; // matches the inspector's read cap

export type ReviewVerdict = "clean" | "defects-found" | "refused";

export interface ProposalReviewOutcome {
  verdict: ReviewVerdict;
  report: AuditReport;
  receipt: ActionReceipt;
}

export interface ProposalReviewerOptions {
  maxBodyChars?: number;
}

export class ProposalReviewer {
  private readonly maxBodyChars: number;

  constructor(
    private readonly safetyGuard: SafetyGuard,
    private readonly receiptLog: ReceiptLog,
    options: ProposalReviewerOptions = {}
  ) {
    this.maxBodyChars = options.maxBodyChars ?? DEFAULT_MAX_REVIEW_BODY_CHARS;
  }

  review(proposal: CodeProposal, snapshot: ProjectSnapshot, reviewerAntId: string): ProposalReviewOutcome {
    const findings: AuditFinding[] = [];

    const finding = (severity: AuditSeverity, summary: string): void => {
      findings.push({
        findingId: `finding-${randomUUID()}`,
        severity,
        summary,
        relatedTaskId: proposal.taskId,
        relatedReceiptId: proposal.receiptId,
      });
    };

    // Gate 0: invariants. A proposal claiming to be applied or pre-approved
    // is corrupt (the literal types forbid it, so it was cast) — refuse
    // review entirely rather than dignify it with a defect list.
    if (!holdsCoreProposalInvariants(proposal)) {
      finding("critical", "Proposal violates core invariants (must be unapplied and human-approval-required); review refused.");
      return this.finish(proposal, findings, "refused", reviewerAntId);
    }

    // Check 1 & 2: target-path coherence against the observed snapshot.
    const targetExists = snapshot.files.some((f) => f.relativePath === proposal.targetRelativePath);

    if (proposal.changeKind === "create" && targetExists) {
      finding("major", "Create-kind proposal targets a path that already exists in the snapshot (collision).");
    }

    if (proposal.changeKind === "modify" && !targetExists) {
      finding("major", "Modify-kind proposal targets a path not present in the snapshot (nothing to modify).");
    }

    // Check 3: size sanity over content and diff combined.
    const bodyLength = (proposal.proposedContent ?? "").length + (proposal.proposedDiff ?? "").length;
    if (bodyLength > this.maxBodyChars) {
      finding("major", `Proposal body exceeds the review size limit (${this.maxBodyChars} chars).`);
    }
    if (bodyLength === 0) {
      finding("major", "Proposal carries no content and no diff.");
    }

    // Check 4: re-run SafetyGuard over everything the factory would have
    // checked. Defends against hand-built proposals that skipped the factory.
    const decision = this.safetyGuard.evaluateText(
      `${proposal.targetRelativePath}\n${proposal.rationale}\n${proposal.proposedContent ?? ""}\n${proposal.proposedDiff ?? ""}`
    );
    if (!decision.allowed) {
      finding("critical", `Proposal fails SafetyGuard re-check (${decision.level}).`);
      return this.finish(proposal, findings, "refused", reviewerAntId);
    }

    const verdict: ReviewVerdict = findings.length === 0 ? "clean" : "defects-found";
    return this.finish(proposal, findings, verdict, reviewerAntId);
  }

  private finish(
    proposal: CodeProposal,
    findings: AuditFinding[],
    verdict: ReviewVerdict,
    reviewerAntId: string
  ): ProposalReviewOutcome {
    const report: AuditReport = {
      auditId: `audit-${randomUUID()}`,
      missionId: proposal.missionId,
      findings,
      generatedByAntId: reviewerAntId,
      generatedAt: new Date().toISOString(),
    };

    const receipt = this.receiptLog.create({
      summary: `Proposal review ${verdict === "refused" ? "refused" : "completed"}: ${findings.length} finding(s), verdict ${verdict}.`,
      status: verdict === "refused" ? "refused" : "completed",
      links: { missionId: proposal.missionId, taskId: proposal.taskId, antId: reviewerAntId },
      details: {
        auditId: report.auditId,
        proposalId: proposal.proposalId,
        verdict,
        severities: findings.map((f) => f.severity),
      },
    });

    return { verdict, report, receipt };
  }
}
