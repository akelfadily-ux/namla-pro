/**
 * RepairAnt proposes a fix in response to a BugPheromone. Phase 0: it never
 * applies a fix — it only describes a proposed repair for later approval.
 *
 * Phase 4: a RepairAnt can additionally turn a review finding into a
 * follow-up CodeProposal, through an injected RepairProposalFlow. The
 * repair proposal is factory-gated like any other and is never applied.
 */

import type { AntIdentity } from "../types/antTypes";
import type { RepairProposalFlow, RepairRequest, RepairFlowResult } from "../review/repairProposalFlow";
import type { AntFacadeTrace } from "./antFacadeTrace";
import { createFacadeTrace } from "./antFacadeTrace";

export class RepairAnt {
  readonly identity: AntIdentity;

  constructor(antId: string) {
    this.identity = {
      antId,
      role: "repair",
      displayName: "Repair Ant",
      generation: 0,
      trustLevel: "probationary",
      capabilities: [
        { name: "propose-repair", description: "Propose a fix for a reported bug, without applying it.", requiresApproval: true },
      ],
      createdAt: new Date().toISOString(),
    };
  }

  proposeRepair(bugDescription: string): AntFacadeTrace {
    return createFacadeTrace({
      role: "repair",
      action: "propose-repair",
      status: "completed",
      noteCode: "not-applied",
      createdBy: this.identity.antId,
      details: { bugDescriptionLength: bugDescription.length },
    });
  }

  /**
   * Phase 4: request a repair proposal through an injected flow. The flow
   * and factory write the REAL (redacted) receipts; the ant returns a
   * façade trace referencing the flow receipt (Step 4C semantics).
   */
  requestRepairProposal(
    flow: RepairProposalFlow,
    request: Omit<RepairRequest, "requestedByAntId">
  ): { flowResult: RepairFlowResult; trace: AntFacadeTrace } {
    const flowResult = flow.requestRepair({ ...request, requestedByAntId: this.identity.antId });

    const created = flowResult.attempted && flowResult.result?.ok === true;

    return {
      flowResult,
      trace: createFacadeTrace({
        role: "repair",
        action: "request-repair-proposal",
        status: created ? "completed" : "refused",
        noteCode: created ? "repair-proposal-created" : "skipped-or-refused",
        createdBy: this.identity.antId,
        relatedReceiptIds: [flowResult.receipt.receiptId],
        details: {
          findingId: request.finding.findingId,
          missionId: request.originalProposal.missionId,
          taskId: request.originalProposal.taskId,
        },
      }),
    };
  }
}
