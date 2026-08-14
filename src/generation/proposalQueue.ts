/**
 * ProposalQueue holds created CodeProposals in memory while they await
 * human review. It stores, lists, links to receipts, and refuses — that is
 * the complete capability list.
 *
 * There is deliberately NO apply method on this class. The strongest
 * guarantee that proposals cannot reach disk is the absence of any code
 * path that could take them there — not a method that refuses, which would
 * still be a method a future change could quietly un-refuse. Applying a
 * proposal remains forbidden until a future phase adds it behind explicit
 * human authorization in NAMLA_BUILD_LAW.md.
 *
 * enqueue() re-verifies the proposal's invariants at runtime (applied must
 * be false, requiresHumanApproval must be true, the safety decision must
 * have allowed it) as defense in depth against a caller that bypassed the
 * type system.
 */

import type { ActionReceipt } from "../types/receiptTypes";
import type { CodeProposal, ProposalQueueItem } from "./codeProposal";
import { holdsCoreProposalInvariants } from "./codeProposal";
import { ReceiptLog } from "../core/receiptLog";

export class ProposalQueue {
  private readonly items: ProposalQueueItem[] = [];

  constructor(private readonly receiptLog: ReceiptLog) {}

  enqueue(proposal: CodeProposal): { accepted: boolean; receipt: ActionReceipt } {
    // Runtime re-verification of the literal-typed invariants: a caller
    // using casts could hand us a corrupted object; refuse it loudly.
    const invariantsHold =
      holdsCoreProposalInvariants(proposal) && proposal.safetyDecision.allowed === true;

    if (!invariantsHold) {
      const receipt = this.receiptLog.create({
        summary: "Proposal enqueue refused: invariants do not hold (must be unapplied, human-approval-required, and safety-allowed).",
        status: "refused",
        links: {},
        details: { proposalId: proposal.proposalId },
      });
      return { accepted: false, receipt };
    }

    if (this.items.some((item) => item.proposal.proposalId === proposal.proposalId)) {
      const receipt = this.receiptLog.create({
        summary: "Proposal enqueue refused: duplicate proposal id.",
        status: "refused",
        links: { missionId: proposal.missionId, taskId: proposal.taskId },
        details: { proposalId: proposal.proposalId },
      });
      return { accepted: false, receipt };
    }

    this.items.push({
      proposal,
      status: "pending",
      enqueuedAt: new Date().toISOString(),
    });

    const receipt = this.receiptLog.create({
      summary: "Proposal enqueued (pending human review, not applied).",
      status: "completed",
      links: { missionId: proposal.missionId, taskId: proposal.taskId },
      details: { proposalId: proposal.proposalId },
    });

    return { accepted: true, receipt };
  }

  list(): ProposalQueueItem[] {
    return [...this.items];
  }

  listPending(): ProposalQueueItem[] {
    return this.items.filter((item) => item.status === "pending");
  }

  get(proposalId: string): ProposalQueueItem | undefined {
    return this.items.find((item) => item.proposal.proposalId === proposalId);
  }

  /** Mark a pending proposal refused (e.g. after human review), with a receipt. */
  refuse(proposalId: string, reasonCode: string): { refused: boolean; receipt: ActionReceipt } {
    const item = this.items.find((i) => i.proposal.proposalId === proposalId);

    if (!item || item.status !== "pending") {
      const receipt = this.receiptLog.create({
        summary: "Proposal refusal skipped: no pending proposal with that id.",
        status: "refused",
        links: {},
        details: { proposalId, reasonCode },
      });
      return { refused: false, receipt };
    }

    item.status = "refused";

    const receipt = this.receiptLog.create({
      summary: "Proposal marked refused after review.",
      status: "completed",
      links: { missionId: item.proposal.missionId, taskId: item.proposal.taskId },
      details: { proposalId, reasonCode },
    });

    return { refused: true, receipt };
  }
}
