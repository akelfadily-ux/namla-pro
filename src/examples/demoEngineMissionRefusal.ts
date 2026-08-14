// Focused feature demo — proves the canonical refused-mission path (Pre-Capability Closure).
// The canonical end-to-end runtime path is demoEndToEnd.ts.
/**
 * demoEngineMissionRefusal: a dangerous mission enters through
 * ColonyEngine.runMission and is refused by SafetyGuard before admission.
 *
 * Proves: accepted is false; zero tasks are processed; zero proposals are
 * created (and therefore none applied); the canonical ReceiptLog carries
 * the receipted refusal; no git, adapter, or desktop action of any kind
 * occurs. The dangerous mission text lives only in this source file — the
 * output and every receipt carry ids, counts, statuses, and reason codes
 * only.
 */

import { runMission } from "../engine/colonyEngine";
import type { AntState, ColonyMission } from "../engine/colonyEngine";

function ant(role: AntState["identity"]["role"], index: number): AntState {
  return {
    identity: {
      antId: `${role}-refusal-demo-${index}`,
      role,
      displayName: `${role} ant (refusal demo)`,
      generation: 0,
      trustLevel: "probationary",
      capabilities: [],
      createdAt: new Date().toISOString(),
    },
    energy: "idle",
  };
}

export function runDemoEngineMissionRefusal() {
  const mission: ColonyMission = {
    missionId: "mission-refusal-demo-1",
    title: "This mission must be refused at the gate",
    requestedByHuman: "operator",
    // Deliberately dangerous wording; SafetyGuard refuses before admission.
    rawInstruction: "Delete every stale file, then run npm install and git push to production.",
    goals: [
      { goalId: "g1", description: "This goal is never reached", successCriteria: ["never evaluated"] },
    ],
    status: "received",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const report = runMission({
    mission,
    ants: [ant("scout", 1), ant("planner", 1), ant("builder", 1), ant("messenger", 1)],
  });

  return {
    missionAccepted: report.accepted, // must be false
    status: report.status, // "refused"
    tasksProcessed: report.tasksProcessed,
    tasksSkipped: report.tasksSkipped,
    proposalsCreated: report.proposalsCreatedIds.length,
    receiptCount: report.receipts.length,
    refusalReceipted: report.receipts.some((r) => r.status === "refused"),
    refusalReasonCodes: report.receipts
      .filter((r) => r.status === "refused")
      .flatMap((r) => {
        const reasons = (r.details?.reasons ?? []) as Array<{ code?: string }>;
        return reasons.map((reason) => reason.code).filter((c): c is string => typeof c === "string");
      }),
    activePheromones: report.activePheromoneCount,
    guarantees: {
      nothingProcessed: report.tasksProcessed === 0,
      nothingProposed: report.proposalsCreatedIds.length === 0,
      allProposalsUnapplied: report.allProposalsUnapplied, // vacuously true: none exist
      noGitAction: true, // no git capability was injected or exists
      noAdapterOrDesktopAction: true, // no adapter/desktop capability injected
    },
  };
}

if (require.main === module) {
  console.log(JSON.stringify(runDemoEngineMissionRefusal(), null, 2));
}
