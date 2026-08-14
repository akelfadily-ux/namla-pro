// Focused feature demo — proves the DecompositionEngine planning flow (Phase 2).
// The canonical end-to-end runtime path is demoEndToEnd.ts.
/**
 * demoMissionPlanning: demonstrates the Phase 2 planning flow end to end.
 *
 * A ProjectInspector takes a real read-only snapshot of this project. A
 * PlannerAnt proposes a decomposition of a two-goal mission against that
 * snapshot — one goal is safe, one deliberately contains a forbidden word
 * ("remove") so the demo shows SafetyGuard blocking its whole pipeline,
 * with receipts. Then AntQueen runs the same mission through the full
 * accept-and-route flow using the snapshot path.
 *
 * Nothing is executed, written, installed, or pushed at any point. Planning
 * produces tasks and receipts; the tasks are proposals for roles that
 * themselves only propose.
 */

import path from "path";
import { ReceiptLog } from "../core/receiptLog";
import { SafetyGuard } from "../core/safetyGuard";
import { AntQueen } from "../core/antQueen";
import { ProjectInspector } from "../inspector/projectInspector";
import { DecompositionEngine } from "../planner/decompositionEngine";
import { PlannerAnt } from "../ants/plannerAnt";
import type { AntRole, AntState } from "../types/antTypes";
import type { ColonyMission } from "../types/missionTypes";

function makeAnt(role: AntRole, index: number): AntState {
  return {
    identity: {
      antId: `${role}-demo-${index}`,
      role,
      displayName: `${role} ant (demo)`,
      generation: 0,
      trustLevel: "probationary",
      capabilities: [],
      createdAt: new Date().toISOString(),
    },
    energy: "idle",
  };
}

function makeMission(): ColonyMission {
  return {
    missionId: "mission-planning-demo-1",
    title: "Improve the colony documentation",
    requestedByHuman: "operator",
    rawInstruction: "Deepen the pheromone documentation and tidy the examples.",
    goals: [
      {
        goalId: "goal-1",
        description: "Explain pheromone decay with worked examples",
        successCriteria: ["decay walkthrough exists in docs"],
      },
      {
        // Deliberately contains "remove" so its whole pipeline is
        // safety-blocked — demonstrating receipted refusal, not a failure.
        goalId: "goal-2",
        description: "Remove outdated example files",
        successCriteria: ["stale examples gone"],
      },
    ],
    status: "received",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function runDemoMissionPlanning() {
  const projectRoot = path.resolve(__dirname, "..", "..");

  // Part 1: PlannerAnt proposes a decomposition against a real snapshot.
  const plannerReceiptLog = new ReceiptLog();
  const inspector = new ProjectInspector(projectRoot, plannerReceiptLog);
  const { snapshot } = inspector.inspect("planner-demo-setup");

  const engine = new DecompositionEngine(new SafetyGuard(), plannerReceiptLog);
  const plannerAnt = new PlannerAnt("planner-demo-1");
  const proposal = plannerAnt.proposeDecomposition(makeMission(), engine, snapshot);

  // Part 2: AntQueen runs the same mission through accept-and-route using
  // the snapshot path (its own engine and receipt log).
  const queen = new AntQueen();
  const roster: AntState[] = [
    makeAnt("scout", 1),
    makeAnt("planner", 1),
    makeAnt("builder", 1),
    makeAnt("tester", 1),
    makeAnt("auditor", 1),
    makeAnt("messenger", 1),
  ];
  const queenReceipt = queen.acceptMission(makeMission(), roster, snapshot);

  return {
    plannerProposal: {
      orderedTaskIds: proposal.result.orderedTaskIds,
      safetyBlocked: proposal.result.safetyBlocked.map((b) => b.taskId),
      dependencyBlocked: proposal.result.dependencyBlockedTaskIds,
      tasks: proposal.result.tasks.map((t) => ({
        taskId: t.taskId,
        title: t.title,
        requiredRole: t.requiredRole,
        priority: t.priority,
        status: t.status,
        dependsOnTaskIds: t.dependsOnTaskIds,
      })),
      plannerTrace: proposal.trace,
    },
    plannerSideReceipts: plannerReceiptLog.list(),
    queenFinalReceipt: queenReceipt,
    queenSideReceipts: queen.receipts.list(),
  };
}

if (require.main === module) {
  console.log(JSON.stringify(runDemoMissionPlanning(), null, 2));
}
