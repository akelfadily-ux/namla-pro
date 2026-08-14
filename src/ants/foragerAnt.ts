// Role façade (future-facing; see antRoleRegistry.ts). The canonical
// runtime scheduler is AntScheduler through ColonySimulation; this class
// remains for compatibility and role-specific capability packaging.
/**
 * ForagerAnt gathers external information or resources for the colony.
 * Phase 0: foraging is simulated — no real network call is made.
 */

import { randomUUID } from "crypto";
import type { AntIdentity } from "../types/antTypes";
import type { AntFacadeTrace } from "./antFacadeTrace";
import { createFacadeTrace } from "./antFacadeTrace";

export class ForagerAnt {
  readonly identity: AntIdentity;

  constructor(antId: string) {
    this.identity = {
      antId,
      role: "forager",
      displayName: "Forager Ant",
      generation: 0,
      trustLevel: "probationary",
      capabilities: [
        { name: "forage-topic", description: "Gather information on a topic (simulated, no network access).", requiresApproval: true },
      ],
      createdAt: new Date().toISOString(),
    };
  }

  forage(topic: string): AntFacadeTrace {
    return createFacadeTrace({
      role: "forager",
      action: "forage-topic",
      status: "completed",
      noteCode: "simulated-only",
      createdBy: this.identity.antId,
      details: { topicLength: topic.length },
    });
  }
}
