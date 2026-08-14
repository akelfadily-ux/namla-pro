// Focused feature demo — proves canonical ReceiptStatus semantics (AH2 Step 4G).
// The canonical end-to-end runtime path is demoEndToEnd.ts.
/**
 * demoReceiptStatusSemantics: the status-semantics matrix plus live
 * representatives.
 *
 * Table section: every ReceiptStatus has documented semantics; approved is
 * admission (not success); refused (policy-rejection) is distinguishable
 * from blocked (boundary-stop); blocked is distinguishable from failed
 * (internal-error); completed is terminal; unknown values are rejected by
 * the runtime guard.
 *
 * Live section: representative real receipts from existing modules —
 * approved (engine run admitted), completed (run finished), refused
 * (inspector protected-name read), blocked (engine budget halt). "failed"
 * is structurally modeled but no runtime path emits it; that is reported
 * honestly rather than manufactured.
 *
 * All inputs are safe fixed data; output carries status names, categories,
 * flags, counts, and case ids only.
 */

import path from "path";
import {
  getReceiptStatusMeaning,
  isKnownReceiptStatus,
  isRefusalReceiptStatus,
  isTerminalReceiptStatus,
  RECEIPT_STATUS_SEMANTICS,
} from "../core/receiptStatusSemantics";
import type { ReceiptStatus } from "../types/receiptTypes";
import { ReceiptLog } from "../core/receiptLog";
import { ProjectInspector } from "../inspector/projectInspector";
import { ColonyEngine } from "../engine/colonyEngine";
import type { AntState, ColonyMission } from "../engine/colonyEngine";

function ant(role: AntState["identity"]["role"], index: number): AntState {
  return {
    identity: {
      antId: `${role}-status-demo-${index}`,
      role,
      displayName: `${role} ant (status demo)`,
      generation: 0,
      trustLevel: "probationary",
      capabilities: [],
      createdAt: new Date().toISOString(),
    },
    energy: "idle",
  };
}

function makeMission(id: string): ColonyMission {
  return {
    missionId: id,
    title: "Status semantics rehearsal",
    requestedByHuman: "operator",
    rawInstruction: "Plan one documentation goal to observe receipt statuses.",
    goals: [
      { goalId: "g1", description: "Describe status semantics for operators", successCriteria: ["described as data"] },
    ],
    status: "received",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function runDemoReceiptStatusSemantics() {
  const mismatchCaseIds: string[] = [];
  const expect = (caseId: string, condition: boolean) => {
    if (!condition) mismatchCaseIds.push(caseId);
  };

  // Table section: semantics assertions.
  const statuses = Object.keys(RECEIPT_STATUS_SEMANTICS) as ReceiptStatus[];
  expect("t01-full-coverage", statuses.length === 5);
  expect("t02-approved-not-success", getReceiptStatusMeaning("approved").category === "admission");
  expect("t03-approved-nonterminal", !isTerminalReceiptStatus("approved"));
  expect(
    "t04-refused-vs-blocked",
    getReceiptStatusMeaning("refused").category !== getReceiptStatusMeaning("blocked").category
  );
  expect(
    "t05-blocked-vs-failed",
    getReceiptStatusMeaning("blocked").category !== getReceiptStatusMeaning("failed").category
  );
  expect("t06-completed-terminal", isTerminalReceiptStatus("completed"));
  expect("t07-refusal-strict", isRefusalReceiptStatus("refused") && !isRefusalReceiptStatus("blocked"));
  expect("t08-unknown-rejected", !isKnownReceiptStatus("exploded") && !isKnownReceiptStatus(42));

  // Live section: representative receipts from real modules.
  const projectRoot = path.resolve(__dirname, "..", "..");

  const engine = new ColonyEngine();
  const roster = [ant("scout", 1), ant("planner", 1), ant("builder", 1), ant("tester", 1), ant("auditor", 1), ant("messenger", 1)];
  const fullRun = engine.runMission({ mission: makeMission("mission-status-a"), ants: roster });
  const liveApproved = fullRun.receipts.find((r) => r.status === "approved");
  const liveCompleted = fullRun.receipts.find((r) => r.status === "completed");
  expect("l01-approved-exists", liveApproved !== undefined);
  expect("l02-completed-exists", liveCompleted !== undefined);

  const haltEngine = new ColonyEngine();
  const haltRun = haltEngine.runMission({
    mission: makeMission("mission-status-b"),
    ants: roster,
    options: { maxSteps: 1 },
  });
  const liveBlocked = haltRun.receipts.find((r) => r.status === "blocked");
  expect("l03-blocked-exists", liveBlocked !== undefined && haltRun.status === "halted-budget");

  const inspectorLog = new ReceiptLog();
  const inspector = new ProjectInspector(projectRoot, inspectorLog);
  const refusedRead = inspector.readSmallTextFile(".env", "status-demo-scout");
  const liveRefused = refusedRead.receipt;
  expect("l04-refused-exists", liveRefused.status === "refused" && refusedRead.content === undefined);

  const failedEmitters = 0; // no runtime path emits "failed"; modeled only.

  let receiptCrashCount = 0;
  try {
    // Prove status reporting itself cannot crash receipt validation.
    inspectorLog.create({
      summary: "Status semantics demo bookkeeping entry.",
      status: "completed",
      links: {},
      details: { tableCases: 8, liveCases: 4 },
    });
  } catch {
    receiptCrashCount += 1;
  }

  return {
    statusTable: statuses.map((status) => {
      const meaning = RECEIPT_STATUS_SEMANTICS[status];
      return { status, category: meaning.category, terminal: meaning.terminal };
    }),
    liveRepresentatives: {
      approved: liveApproved?.status,
      completed: liveCompleted?.status,
      blocked: liveBlocked?.status,
      refused: liveRefused.status,
      failed: failedEmitters === 0 ? "modeled-but-not-emitted" : "emitted",
    },
    totalCases: 12,
    mismatchCaseIds,
    allExpectationsMet: mismatchCaseIds.length === 0,
    receiptCrashCount,
  };
}

if (require.main === module) {
  console.log(JSON.stringify(runDemoReceiptStatusSemantics(), null, 2));
}
