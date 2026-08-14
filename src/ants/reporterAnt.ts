// Role façade (future-facing; see antRoleRegistry.ts). The canonical
// runtime scheduler is AntScheduler through ColonySimulation; this class
// remains for compatibility and role-specific capability packaging.
/**
 * ReporterAnt summarizes mission or colony status for a human. Phase 0: it
 * summarizes receipts it is given — it does not query any live system
 * itself.
 */

import type { AntIdentity } from "../types/antTypes";
import type { ActionReceipt } from "../types/receiptTypes";
import type { AntFacadeTrace } from "./antFacadeTrace";
import { createFacadeTrace } from "./antFacadeTrace";

export class ReporterAnt {
  readonly identity: AntIdentity;

  constructor(antId: string) {
    this.identity = {
      antId,
      role: "reporter",
      displayName: "Reporter Ant",
      generation: 0,
      trustLevel: "trusted",
      capabilities: [
        { name: "report-status", description: "Summarize mission or colony status from given receipts.", requiresApproval: false },
      ],
      createdAt: new Date().toISOString(),
    };
  }

  report(missionId: string, receipts: ActionReceipt[]): AntFacadeTrace {
    const blockedCount = receipts.filter((r) => r.status === "blocked" || r.status === "refused").length;

    // Input receipts are REAL ReceiptLog receipts; the trace references
    // them by id rather than pretending to be one of them.
    return createFacadeTrace({
      role: "reporter",
      action: "report-status",
      status: "completed",
      noteCode: "summary-of-receipts",
      createdBy: this.identity.antId,
      relatedReceiptIds: receipts.map((r) => r.receiptId),
      details: { missionId, receiptCount: receipts.length, blockedCount },
    });
  }
}
