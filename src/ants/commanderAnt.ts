// Role façade (legacy-facade; see antRoleRegistry.ts). The canonical
// runtime scheduler is AntScheduler through ColonySimulation; this class
// remains for compatibility and role-specific capability packaging.
/**
 * CommanderAnt coordinates a group of tasks under a mission on the Queen's
 * behalf. Phase 0: it only records a coordination receipt — it does not
 * itself execute or reassign anything.
 */

import type { AntIdentity } from "../types/antTypes";
import type { AntFacadeTrace } from "./antFacadeTrace";
import { createFacadeTrace } from "./antFacadeTrace";

export class CommanderAnt {
  readonly identity: AntIdentity;

  constructor(antId: string) {
    this.identity = {
      antId,
      role: "commander",
      displayName: "Commander Ant",
      generation: 0,
      trustLevel: "trusted",
      capabilities: [
        { name: "coordinate-tasks", description: "Coordinate a group of tasks toward a mission goal.", requiresApproval: false },
      ],
      createdAt: new Date().toISOString(),
    };
  }

  coordinate(taskIds: string[]): AntFacadeTrace {
    return createFacadeTrace({
      role: "commander",
      action: "coordinate-tasks",
      status: "completed",
      noteCode: "coordination-recorded",
      createdBy: this.identity.antId,
      details: { taskCount: taskIds.length, taskIds },
    });
  }
}
