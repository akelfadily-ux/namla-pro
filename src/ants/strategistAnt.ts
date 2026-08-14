// Role façade (future-facing; see antRoleRegistry.ts). The canonical
// runtime scheduler is AntScheduler through ColonySimulation; this class
// remains for compatibility and role-specific capability packaging.
/**
 * StrategistAnt proposes a high-level approach for a mission goal. Phase 0:
 * it returns a text proposal only — it does not commit the colony to
 * anything.
 */

import type { AntIdentity } from "../types/antTypes";
import type { AntFacadeTrace } from "./antFacadeTrace";
import { createFacadeTrace } from "./antFacadeTrace";

export class StrategistAnt {
  readonly identity: AntIdentity;

  constructor(antId: string) {
    this.identity = {
      antId,
      role: "strategist",
      displayName: "Strategist Ant",
      generation: 0,
      trustLevel: "trusted",
      capabilities: [
        { name: "propose-strategy", description: "Propose a high-level approach for a mission goal.", requiresApproval: true },
      ],
      createdAt: new Date().toISOString(),
    };
  }

  proposeStrategy(missionGoal: string): AntFacadeTrace {
    return createFacadeTrace({
      role: "strategist",
      action: "propose-strategy",
      status: "completed",
      noteCode: "proposal-only",
      createdBy: this.identity.antId,
      details: { missionGoalLength: missionGoal.length },
    });
  }
}
