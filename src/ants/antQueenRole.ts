// Role façade (duplicate-of-core; see antRoleRegistry.ts). The canonical
// runtime scheduler is AntScheduler through ColonySimulation; this class
// remains for compatibility and role-specific capability packaging.
/**
 * AntQueenRole represents the Queen's identity within the colony roster,
 * distinct from src/core/antQueen.ts (which is the orchestration entry
 * point). This file models the Queen as an ant: her identity and the
 * directives she issues, expressed as receipts.
 */

import type { AntIdentity } from "../types/antTypes";
import type { AntFacadeTrace } from "./antFacadeTrace";
import { createFacadeTrace } from "./antFacadeTrace";

export class AntQueenRole {
  readonly identity: AntIdentity;

  constructor(antId = "queen-001") {
    this.identity = {
      antId,
      role: "queen",
      displayName: "The Queen",
      generation: 0,
      trustLevel: "core",
      capabilities: [
        { name: "issue-directive", description: "Accept missions and issue directives to the colony.", requiresApproval: false },
      ],
      createdAt: new Date().toISOString(),
    };
  }

  issueDirective(missionTitle: string): AntFacadeTrace {
    return createFacadeTrace({
      role: "queen",
      action: "issue-directive",
      status: "completed",
      noteCode: "directive-recorded",
      createdBy: this.identity.antId,
      details: { missionTitleLength: missionTitle.length },
    });
  }
}
