/**
 * RepairProposalFlow turns a review finding into a follow-up CodeProposal —
 * a proposal to fix a proposal. The revised content goes through the same
 * ProposalFactory as everything else, so it inherits every gate (boundary,
 * protected paths, SafetyGuard) and the same receipt redaction standard.
 *
 * The chain is: finding -> repair request -> factory-gated proposal. It runs
 * exactly once per explicit call from a human-run script; there is no
 * retry, no recursion, no scheduling, and nothing that could re-invoke it —
 * the "loop" in Audit/Test/Repair Loop is a human turning a crank, not the
 * system spinning.
 *
 * The resulting repair proposal is a CodeProposal like any other:
 * requiresHumanApproval true, applied false, never written to disk.
 */

import type { ActionReceipt } from "../types/receiptTypes";
import type { AuditFinding } from "../types/auditTypes";
import type { CodeProposal } from "../generation/codeProposal";
import { ProposalFactory, ProposalRequest, ProposalCreationResult } from "../generation/proposalFactory";
import { ReceiptLog } from "../core/receiptLog";

export interface RepairRequest {
  finding: AuditFinding;
  originalProposal: CodeProposal;
  /** The corrected proposal fields; mission/task ids come from the original. */
  revision: Omit<ProposalRequest, "missionId" | "taskId">;
  requestedByAntId: string;
}

export interface RepairFlowResult {
  attempted: boolean;
  result?: ProposalCreationResult;
  receipt: ActionReceipt;
}

export class RepairProposalFlow {
  constructor(
    private readonly factory: ProposalFactory,
    private readonly receiptLog: ReceiptLog
  ) {}

  requestRepair(request: RepairRequest): RepairFlowResult {
    // Only defects warrant a repair proposal; info/minor findings are notes
    // for the human, not work orders.
    if (request.finding.severity === "info" || request.finding.severity === "minor") {
      const receipt = this.receiptLog.create({
        summary: `Repair request skipped: finding severity (${request.finding.severity}) is below the repair threshold.`,
        status: "refused",
        links: {
          missionId: request.originalProposal.missionId,
          taskId: request.originalProposal.taskId,
          antId: request.requestedByAntId,
        },
        details: { findingId: request.finding.findingId, originalProposalId: request.originalProposal.proposalId },
      });
      return { attempted: false, receipt };
    }

    // The factory does all gating and its own (redacted) receipting.
    const result = this.factory.create({
      missionId: request.originalProposal.missionId,
      taskId: request.originalProposal.taskId,
      ...request.revision,
    });

    const receipt = this.receiptLog.create({
      summary: result.ok
        ? "Repair proposal created (pending human approval, not applied)."
        : `Repair proposal refused by the factory (${result.refusal.reasonCode}).`,
      status: result.ok ? "completed" : "refused",
      links: {
        missionId: request.originalProposal.missionId,
        taskId: request.originalProposal.taskId,
        antId: request.requestedByAntId,
      },
      details: result.ok
        ? {
            findingId: request.finding.findingId,
            originalProposalId: request.originalProposal.proposalId,
            repairProposalId: result.proposal.proposalId,
          }
        : {
            findingId: request.finding.findingId,
            originalProposalId: request.originalProposal.proposalId,
            reasonCode: result.refusal.reasonCode,
          },
    });

    return { attempted: true, result, receipt };
  }
}
