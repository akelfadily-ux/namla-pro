/**
 * ScoutAnt explores and reports back — a read-only observer role. Phase 0:
 * it never modifies anything; it only produces an observation receipt.
 *
 * Phase 1: a ScoutAnt can additionally run a real read-only inspection of
 * the project tree — but only when a human-composed ProjectInspector is
 * handed to it. The ant has no ambient filesystem authority of its own; the
 * capability must be injected.
 */

import type { AntIdentity } from "../types/antTypes";
import type { ProjectInspector } from "../inspector/projectInspector";
import type { ProjectSnapshot } from "../inspector/inspectorTypes";
import type { AntFacadeTrace } from "./antFacadeTrace";
import { createFacadeTrace } from "./antFacadeTrace";

export class ScoutAnt {
  readonly identity: AntIdentity;

  constructor(antId: string) {
    this.identity = {
      antId,
      role: "scout",
      displayName: "Scout Ant",
      generation: 0,
      trustLevel: "probationary",
      capabilities: [
        { name: "scout-target", description: "Explore and report on a target, read-only.", requiresApproval: false },
      ],
      createdAt: new Date().toISOString(),
    };
  }

  scout(targetDescription: string): AntFacadeTrace {
    return createFacadeTrace({
      role: "scout",
      action: "scout",
      status: "completed",
      noteCode: "simulated-observation",
      createdBy: this.identity.antId,
      details: { targetDescriptionLength: targetDescription.length },
    });
  }

  /**
   * Phase 1: run a read-only inspection through an injected inspector.
   * The inspector writes the REAL receipt into its ReceiptLog; the scout
   * returns a façade trace that references it by id (Step 4C semantics).
   */
  inspectProject(inspector: ProjectInspector): { snapshot: ProjectSnapshot; trace: AntFacadeTrace } {
    const { snapshot, receipt } = inspector.inspect(this.identity.antId);

    return {
      snapshot,
      trace: createFacadeTrace({
        role: "scout",
        action: "inspect-project",
        status: "completed",
        noteCode: "read-only-snapshot",
        createdBy: this.identity.antId,
        relatedReceiptIds: [receipt.receiptId],
        details: {
          snapshotId: snapshot.snapshotId,
          totalFolders: snapshot.summary.totalFolders,
          totalFiles: snapshot.summary.totalFiles,
          totalSkipped: snapshot.summary.totalSkipped,
          riskCount: snapshot.risks.length,
        },
      }),
    };
  }
}
