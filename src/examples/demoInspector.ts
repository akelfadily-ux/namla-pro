// Focused feature demo — proves the read-only ProjectInspector (Phase 1).
// The canonical end-to-end runtime path is demoEndToEnd.ts.
/**
 * demoInspector: demonstrates the Phase 1 read-only inspection flow.
 *
 * What this demo does when run: a ScoutAnt asks an injected ProjectInspector
 * to walk this project's own tree (read-only: readdir + lstat only), then
 * feeds the resulting ProjectSnapshot into visionSense and touchSense as
 * real perception context. Every step produces a receipt.
 *
 * What this demo never does: write a file, execute a command, follow a
 * symlink, open a secret-like file, install anything, or push anything.
 */

import path from "path";
import { ReceiptLog } from "../core/receiptLog";
import { ProjectInspector } from "../inspector/projectInspector";
import { ScoutAnt } from "../ants/scoutAnt";
import { see } from "../senses/visionSense";
import { touch } from "../senses/touchSense";
import type { SenseInput } from "../types/senseTypes";

export function runDemoInspector() {
  // src/examples -> project root, two levels up.
  const projectRoot = path.resolve(__dirname, "..", "..");

  const receiptLog = new ReceiptLog();
  const inspector = new ProjectInspector(projectRoot, receiptLog);
  const scout = new ScoutAnt("scout-inspector-1");

  const { snapshot, trace: scoutTrace } = scout.inspectProject(inspector);

  const senseInput = (context: Record<string, unknown>): SenseInput => ({
    senseType: "vision",
    context,
    requestedByAntId: scout.identity.antId,
    requestedAt: new Date().toISOString(),
  });

  const vision = see(senseInput({ snapshot }));
  const touchReading = touch(senseInput({ snapshot }));

  // Also demonstrate a receipted refusal: asking to read a secret-like
  // filename is refused before the filesystem is ever touched.
  const refusedRead = inspector.readSmallTextFile(".env", scout.identity.antId);

  return {
    summary: snapshot.summary,
    skipped: snapshot.skipped,
    risks: snapshot.risks,
    scoutTrace,
    visionSummary: vision.summary,
    touchSummary: touchReading.summary,
    refusedReadReceipt: refusedRead.receipt,
    allReceipts: receiptLog.list(),
  };
}

if (require.main === module) {
  const result = runDemoInspector();
  // Keep console output readable: counts and receipts, not the full file list.
  console.log(JSON.stringify(result, null, 2));
}
