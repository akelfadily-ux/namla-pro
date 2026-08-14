// Role façade (legacy-facade; see antRoleRegistry.ts). SafetyGuard in
// src/core is the canonical safety gate; the canonical runtime scheduler
// is AntScheduler through ColonySimulation. This class remains for
// compatibility and role-specific capability packaging.
/**
 * GuardAnt is the colony's distributed safety presence: it runs SafetyGuard
 * checks on behalf of any ant that wants a second opinion before acting.
 */

import type { AntIdentity } from "../types/antTypes";
import type { AntFacadeTrace } from "./antFacadeTrace";
import { createFacadeTrace } from "./antFacadeTrace";
import { SafetyGuard } from "../core/safetyGuard";

export class GuardAnt {
  readonly identity: AntIdentity;
  private readonly safetyGuard: SafetyGuard;

  constructor(antId: string, safetyGuard: SafetyGuard = new SafetyGuard()) {
    this.identity = {
      antId,
      role: "guard",
      displayName: "Guard Ant",
      generation: 0,
      trustLevel: "core",
      capabilities: [
        { name: "check-safety", description: "Classify text or planned actions for danger.", requiresApproval: false },
      ],
      createdAt: new Date().toISOString(),
    };
    this.safetyGuard = safetyGuard;
  }

  guard(text: string): AntFacadeTrace {
    const decision = this.safetyGuard.evaluateText(text);

    return createFacadeTrace({
      role: "guard",
      action: "check-safety",
      status: decision.allowed ? "completed" : "refused",
      noteCode: decision.allowed ? "allowed" : "blocked",
      createdBy: this.identity.antId,
      details: { level: decision.level, reasons: decision.reasons, textLength: text.length },
    });
  }
}
