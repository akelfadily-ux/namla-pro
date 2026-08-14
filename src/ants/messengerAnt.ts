// Role façade (engine-active role, wrapper-only class; see
// antRoleRegistry.ts). The canonical runtime scheduler is AntScheduler
// through ColonySimulation; this class remains for compatibility.
/**
 * MessengerAnt relays a message between ants or between the colony and a
 * human. Phase 0: relaying just means recording a receipt of the message —
 * there is no live transport.
 */

import type { AntIdentity } from "../types/antTypes";
import type { AntFacadeTrace } from "./antFacadeTrace";
import { createFacadeTrace } from "./antFacadeTrace";

export class MessengerAnt {
  readonly identity: AntIdentity;

  constructor(antId: string) {
    this.identity = {
      antId,
      role: "messenger",
      displayName: "Messenger Ant",
      generation: 0,
      trustLevel: "probationary",
      capabilities: [
        { name: "relay-message", description: "Relay a message between ants or to a human.", requiresApproval: false },
      ],
      createdAt: new Date().toISOString(),
    };
  }

  relay(message: string): AntFacadeTrace {
    // The raw message is never carried in the trace — only its length.
    return createFacadeTrace({
      role: "messenger",
      action: "relay-message",
      status: "completed",
      noteCode: "relay-recorded",
      createdBy: this.identity.antId,
      details: { messageLength: message.length },
    });
  }
}
