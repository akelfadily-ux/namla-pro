// Focused feature demo — proves per-instance receipt identity (AH2 Step 4F).
// The canonical end-to-end runtime path is demoEndToEnd.ts.
/**
 * demoReceiptIsolation: two independent ReceiptLogs, each owning its own
 * deterministic sequence.
 *
 * Proves: log A and log B both start at "receipt-1"; writing to A never
 * advances B; creation order is preserved within each log; no receipt
 * validation crash occurs; and AntFacadeTrace remains a separate identity
 * domain (traceIds, never receiptIds).
 *
 * All case texts are fixed harmless phrases; output carries counts, the
 * deterministic ids themselves, and boolean flags only.
 */

import { ReceiptLog } from "../core/receiptLog";
import { createFacadeTrace } from "../ants/antFacadeTrace";

export function runDemoReceiptIsolation() {
  const logA = new ReceiptLog();
  const logB = new ReceiptLog();

  let crashCount = 0;
  const write = (log: ReceiptLog, label: string) => {
    try {
      return log.create({
        summary: `Isolation demo entry ${label}.`,
        status: "completed",
        links: {},
        details: { label },
      });
    } catch {
      crashCount += 1;
      return undefined;
    }
  };

  const a1 = write(logA, "a-first");
  const a2 = write(logA, "a-second");
  const b1 = write(logB, "b-first");
  const b2 = write(logB, "b-second");

  // Extra writes to A must not advance B's next id.
  write(logA, "a-third");
  const b3 = write(logB, "b-third");

  const aIds = logA.list().map((r) => r.receiptId);
  const bIds = logB.list().map((r) => r.receiptId);

  const trace = createFacadeTrace({
    role: "scout",
    action: "isolation-check",
    status: "completed",
    noteCode: "trace-domain-check",
    createdBy: "scout-isolation-demo",
  });

  const flags = {
    aStartsDeterministically: a1?.receiptId === "receipt-1",
    bStartsDeterministically: b1?.receiptId === "receipt-1",
    aDoesNotAdvanceB: b3?.receiptId === "receipt-3", // would be higher if A's writes bled in
    aOrderPreserved: aIds.join(",") === "receipt-1,receipt-2,receipt-3",
    bOrderPreserved: bIds.join(",") === "receipt-1,receipt-2,receipt-3",
    secondIdsDistinctWithinLogs: a1?.receiptId !== a2?.receiptId && b1?.receiptId !== b2?.receiptId,
    traceIsNotAReceipt:
      trace.traceKind === "ant-facade-trace" &&
      trace.traceId.startsWith("trace-") &&
      !("receiptId" in trace),
    noCrash: crashCount === 0,
  };

  return {
    logACount: logA.list().length,
    logBCount: logB.list().length,
    aIds,
    bIds,
    flags,
    crashCount,
    allExpectationsMet: Object.values(flags).every((flag) => flag === true),
  };
}

if (require.main === module) {
  console.log(JSON.stringify(runDemoReceiptIsolation(), null, 2));
}
