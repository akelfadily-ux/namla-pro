/**
 * AdapterRegistry: a lookup of simulated adapters by AgentKind. Injection
 * only — the registry constructs nothing itself; adapters are built by the
 * human-controlled composition root and registered here. It holds no
 * network, process, filesystem, or git capability, because nothing it
 * stores has any.
 */

import type { ActionReceipt } from "../types/receiptTypes";
import type { AgentCapabilityProfile, AgentKind } from "./agentAdapterTypes";
import { SimulatedAgentAdapter } from "./simulatedAgentAdapter";
import { ReceiptLog } from "../core/receiptLog";

export class AdapterRegistry {
  private readonly adapters = new Map<AgentKind, SimulatedAgentAdapter>();

  constructor(private readonly receiptLog: ReceiptLog) {}

  register(adapter: SimulatedAgentAdapter): void {
    this.adapters.set(adapter.profile.agentKind, adapter);
  }

  list(): AgentCapabilityProfile[] {
    return [...this.adapters.values()].map((adapter) => adapter.profile);
  }

  get(kind: AgentKind): SimulatedAgentAdapter | undefined {
    return this.adapters.get(kind);
  }

  /** Lookup with a receipted refusal when no adapter of the kind exists. */
  getOrRefuse(kind: AgentKind): { adapter?: SimulatedAgentAdapter; receipt?: ActionReceipt } {
    const adapter = this.adapters.get(kind);
    if (adapter) return { adapter };

    const receipt = this.receiptLog.create({
      summary: "Adapter lookup refused: no simulated adapter is registered for the requested kind.",
      status: "refused",
      links: {},
      details: { requestedKind: kind, registeredKinds: [...this.adapters.keys()] },
    });
    return { receipt };
  }
}
