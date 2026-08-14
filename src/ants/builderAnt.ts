/**
 * BuilderAnt proposes how code or structure would be constructed. Phase 0:
 * it never writes a real file — it returns a build proposal only.
 *
 * Phase 3: a BuilderAnt can additionally produce a structured CodeProposal
 * — but only through a human-composed ProposalFactory handed to it. The ant
 * has no filesystem authority of its own and no way to apply a proposal;
 * everything it produces is data marked unapplied and awaiting human
 * approval.
 */

import type { AntIdentity } from "../types/antTypes";
import type { ProposalFactory, ProposalRequest, ProposalCreationResult } from "../generation/proposalFactory";
import type { AntFacadeTrace } from "./antFacadeTrace";
import { createFacadeTrace } from "./antFacadeTrace";

export class BuilderAnt {
  readonly identity: AntIdentity;

  constructor(antId: string) {
    this.identity = {
      antId,
      role: "builder",
      displayName: "Builder Ant",
      generation: 0,
      trustLevel: "probationary",
      capabilities: [
        { name: "propose-build", description: "Propose how something would be built, without building it.", requiresApproval: true },
        { name: "propose-code", description: "Produce a CodeProposal data object via an injected factory; never applied by the ant.", requiresApproval: true },
      ],
      createdAt: new Date().toISOString(),
    };
  }

  proposeBuild(taskDescription: string): AntFacadeTrace {
    return createFacadeTrace({
      role: "builder",
      action: "propose-build",
      status: "completed",
      noteCode: "plan-only",
      createdBy: this.identity.antId,
      details: { taskDescriptionLength: taskDescription.length },
    });
  }

  /**
   * Phase 3: produce a CodeProposal through an injected factory. The
   * factory runs the boundary/secret/safety gates and writes the REAL
   * receipts; the builder returns a façade trace referencing them by id
   * (Step 4C semantics), with the proposal (or refusal) alongside.
   */
  proposeCode(
    factory: ProposalFactory,
    request: ProposalRequest
  ): { result: ProposalCreationResult; trace: AntFacadeTrace } {
    const result = factory.create(request);

    return {
      result,
      trace: createFacadeTrace({
        role: "builder",
        action: "propose-code",
        status: result.ok ? "completed" : "refused",
        noteCode: result.ok ? "proposal-created-unapplied" : result.refusal.reasonCode,
        createdBy: this.identity.antId,
        relatedReceiptIds: [result.receipt.receiptId],
        details: result.ok
          ? { missionId: request.missionId, taskId: request.taskId, proposalId: result.proposal.proposalId, applied: result.proposal.applied }
          : { missionId: request.missionId, taskId: request.taskId, refusalId: result.refusal.refusalId },
      }),
    };
  }
}
