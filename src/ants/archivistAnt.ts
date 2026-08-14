/**
 * ArchivistAnt proposes archiving completed mission data into long-term
 * colony memory. Phase 0: it only proposes the archive action, it does not
 * move or delete anything.
 *
 * Phase 5: an ArchivistAnt can additionally assemble a GitCommitProposal —
 * a commit described as data — through an injected CommitProposalFactory.
 * The ant has no git, filesystem, network, or command authority of its own;
 * the proposal it assembles is unapplied, unpushed, and awaiting human
 * approval by construction.
 */

import type { AntIdentity } from "../types/antTypes";
import type { CommitProposalFactory, CommitProposalRequest, CommitProposalResult } from "../git/commitProposalFactory";
import type { AntFacadeTrace } from "./antFacadeTrace";
import { createFacadeTrace } from "./antFacadeTrace";

export class ArchivistAnt {
  readonly identity: AntIdentity;

  constructor(antId: string) {
    this.identity = {
      antId,
      role: "archivist",
      displayName: "Archivist Ant",
      generation: 0,
      trustLevel: "trusted",
      capabilities: [
        { name: "propose-archive", description: "Propose archiving a completed mission's data.", requiresApproval: true },
      ],
      createdAt: new Date().toISOString(),
    };
  }

  proposeArchive(missionId: string): AntFacadeTrace {
    return createFacadeTrace({
      role: "archivist",
      action: "propose-archive",
      status: "completed",
      noteCode: "proposal-only",
      createdBy: this.identity.antId,
      details: { missionId },
    });
  }

  /**
   * Phase 5: assemble a commit proposal through an injected factory. The
   * factory runs all gates and writes the REAL (redacted) receipts; the
   * archivist returns a façade trace referencing them (Step 4C semantics).
   */
  assembleCommitProposal(
    factory: CommitProposalFactory,
    request: CommitProposalRequest
  ): { result: CommitProposalResult; trace: AntFacadeTrace } {
    const result = factory.create(request);

    return {
      result,
      trace: createFacadeTrace({
        role: "archivist",
        action: "assemble-commit-proposal",
        status: result.ok ? "completed" : "refused",
        noteCode: result.ok ? "commit-proposal-unapplied" : result.refusal.reasonCode,
        createdBy: this.identity.antId,
        relatedReceiptIds: [result.receipt.receiptId],
        details: result.ok
          ? {
              proposalId: result.proposal.proposalId,
              applied: result.proposal.applied,
              pushIntent: result.proposal.pushIntent,
            }
          : { refusalId: result.refusal.refusalId },
      }),
    };
  }
}
