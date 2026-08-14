// Role façade (future-facing; see antRoleRegistry.ts). The canonical
// runtime scheduler is AntScheduler through ColonySimulation; this class
// remains for compatibility and role-specific capability packaging.
/**
 * ArchitectAnt proposes structural/architecture decisions and emits an
 * ArchitecturePheromone-worthy note. Phase 0: it returns a proposal only —
 * emitting the actual pheromone is left to the caller via PheromoneBus.
 */

import type { AntIdentity } from "../types/antTypes";
import type { AntFacadeTrace } from "./antFacadeTrace";
import { createFacadeTrace } from "./antFacadeTrace";

export class ArchitectAnt {
  readonly identity: AntIdentity;

  constructor(antId: string) {
    this.identity = {
      antId,
      role: "architect",
      displayName: "Architect Ant",
      generation: 0,
      trustLevel: "trusted",
      capabilities: [
        { name: "propose-architecture", description: "Propose a structural or architecture decision.", requiresApproval: true },
      ],
      createdAt: new Date().toISOString(),
    };
  }

  proposeArchitecture(topic: string): AntFacadeTrace {
    return createFacadeTrace({
      role: "architect",
      action: "propose-architecture",
      status: "completed",
      noteCode: "proposal-only",
      createdBy: this.identity.antId,
      details: { topicLength: topic.length },
    });
  }
}
