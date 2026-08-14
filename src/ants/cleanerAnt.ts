// Role façade (future-facing; see antRoleRegistry.ts). The canonical
// runtime scheduler is AntScheduler through ColonySimulation; this class
// remains for compatibility and role-specific capability packaging.
/**
 * CleanerAnt proposes cleanup of stale tasks, receipts, or pheromones.
 * Phase 0: it never deletes anything — it only proposes what could be
 * cleaned up for a human to review.
 */

import type { AntIdentity } from "../types/antTypes";
import type { AntFacadeTrace } from "./antFacadeTrace";
import { createFacadeTrace } from "./antFacadeTrace";

export class CleanerAnt {
  readonly identity: AntIdentity;

  constructor(antId: string) {
    this.identity = {
      antId,
      role: "cleaner",
      displayName: "Cleaner Ant",
      generation: 0,
      trustLevel: "probationary",
      capabilities: [
        { name: "propose-cleanup", description: "Propose cleanup of stale colony state, without deleting anything.", requiresApproval: true },
      ],
      createdAt: new Date().toISOString(),
    };
  }

  proposeCleanup(targetDescription: string): AntFacadeTrace {
    return createFacadeTrace({
      role: "cleaner",
      action: "propose-cleanup",
      status: "completed",
      noteCode: "proposal-only",
      createdBy: this.identity.antId,
      details: { targetDescriptionLength: targetDescription.length },
    });
  }
}
