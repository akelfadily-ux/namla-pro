// Role façade (future-facing; see antRoleRegistry.ts). The canonical
// runtime scheduler is AntScheduler through ColonySimulation; this class
// remains for compatibility and role-specific capability packaging.
/**
 * NurseAnt monitors the health and energy state of other ants and reports
 * concerns. Phase 0: read-only monitoring, no ability to change ant state.
 */

import { randomUUID } from "crypto";
import type { AntIdentity, AntState } from "../types/antTypes";
import type { AntFacadeTrace } from "./antFacadeTrace";
import { createFacadeTrace } from "./antFacadeTrace";

export class NurseAnt {
  readonly identity: AntIdentity;

  constructor(antId: string) {
    this.identity = {
      antId,
      role: "nurse",
      displayName: "Nurse Ant",
      generation: 0,
      trustLevel: "trusted",
      capabilities: [
        { name: "check-ant-health", description: "Observe another ant's energy state, read-only.", requiresApproval: false },
      ],
      createdAt: new Date().toISOString(),
    };
  }

  checkAntHealth(antState: AntState): AntFacadeTrace {
    const concern = antState.energy === "tired" || antState.energy === "offline";

    return createFacadeTrace({
      role: "nurse",
      action: "check-ant-health",
      status: "completed",
      noteCode: concern ? "rest-suggested" : "no-concern",
      createdBy: this.identity.antId,
      details: { observedAntId: antState.identity.antId, energy: antState.energy },
    });
  }
}
