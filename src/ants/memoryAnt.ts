// Role façade (legacy-facade; see antRoleRegistry.ts). ColonyMemory in
// src/core is the canonical memory store; the canonical runtime scheduler
// is AntScheduler through ColonySimulation. This class remains for
// compatibility and role-specific capability packaging.
/**
 * MemoryAnt proposes memory entries for the colony to remember. Phase 0: it
 * does not write to ColonyMemory directly — it returns a proposal receipt so
 * a human or ColonyMemory's own secret check remains the actual gate.
 */

import type { AntIdentity } from "../types/antTypes";
import type { AntFacadeTrace } from "./antFacadeTrace";
import { createFacadeTrace } from "./antFacadeTrace";
import { looksLikeSecret } from "../policies/secretProtectionPolicy";

export class MemoryAnt {
  readonly identity: AntIdentity;

  constructor(antId: string) {
    this.identity = {
      antId,
      role: "memory",
      displayName: "Memory Ant",
      generation: 0,
      trustLevel: "trusted",
      capabilities: [
        { name: "propose-memory-entry", description: "Propose a non-secret fact for the colony to remember.", requiresApproval: true },
      ],
      createdAt: new Date().toISOString(),
    };
  }

  proposeMemoryEntry(content: string): AntFacadeTrace {
    const blocked = looksLikeSecret(content);

    // The raw content is never carried in the trace — only its length.
    return createFacadeTrace({
      role: "memory",
      action: "propose-memory-entry",
      status: blocked ? "refused" : "completed",
      noteCode: blocked ? "content-blocked" : "entry-proposed",
      createdBy: this.identity.antId,
      details: { contentLength: content.length },
    });
  }
}
