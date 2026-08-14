/**
 * AuditorAnt reviews receipts after the fact and produces findings. Phase 0:
 * a minimal, purely additive review — it never changes what it reviews.
 *
 * Phase 4: an AuditorAnt can additionally review a CodeProposal against a
 * ProjectSnapshot through an injected ProposalReviewer. Review is analysis
 * over data; nothing is applied or run.
 */

import { randomUUID } from "crypto";
import type { AntIdentity } from "../types/antTypes";
import type { AuditFinding, AuditReport } from "../types/auditTypes";
import type { ActionReceipt } from "../types/receiptTypes";
import type { ProposalReviewer, ProposalReviewOutcome } from "../review/proposalReviewer";
import type { CodeProposal } from "../generation/codeProposal";
import type { ProjectSnapshot } from "../inspector/inspectorTypes";
import type { AntFacadeTrace } from "./antFacadeTrace";
import { createFacadeTrace } from "./antFacadeTrace";

export class AuditorAnt {
  readonly identity: AntIdentity;

  constructor(antId: string) {
    this.identity = {
      antId,
      role: "auditor",
      displayName: "Auditor Ant",
      generation: 0,
      trustLevel: "trusted",
      capabilities: [
        { name: "audit-receipts", description: "Review receipts and produce findings.", requiresApproval: false },
      ],
      createdAt: new Date().toISOString(),
    };
  }

  audit(receipts: ActionReceipt[]): AuditReport {
    const findings: AuditFinding[] = receipts
      .filter((r) => r.status === "blocked" || r.status === "failed" || r.status === "refused")
      .map((r) => ({
        findingId: `finding-${randomUUID()}`,
        severity: "minor",
        summary: `Receipt "${r.summary}" ended in status ${r.status}.`,
        relatedReceiptId: r.receiptId,
      }));

    return {
      auditId: `audit-${randomUUID()}`,
      findings,
      generatedByAntId: this.identity.antId,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Phase 4: review a proposal through an injected reviewer. The reviewer
   * writes the REAL (redacted) receipt; the auditor returns a façade trace
   * referencing it (Step 4C semantics), alongside the review outcome.
   */
  reviewProposal(
    reviewer: ProposalReviewer,
    proposal: CodeProposal,
    snapshot: ProjectSnapshot
  ): { outcome: ProposalReviewOutcome; trace: AntFacadeTrace } {
    const outcome = reviewer.review(proposal, snapshot, this.identity.antId);

    return {
      outcome,
      trace: createFacadeTrace({
        role: "auditor",
        action: "review-proposal",
        status: outcome.verdict === "refused" ? "refused" : "completed",
        noteCode: `verdict-${outcome.verdict}`,
        createdBy: this.identity.antId,
        relatedReceiptIds: [outcome.receipt.receiptId],
        details: {
          auditId: outcome.report.auditId,
          proposalId: proposal.proposalId,
          findingCount: outcome.report.findings.length,
        },
      }),
    };
  }
}
