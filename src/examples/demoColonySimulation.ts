// Focused feature demo — proves the clock/scheduler/simulation spine (Phase 6).
// The canonical end-to-end runtime path is demoEndToEnd.ts.
/**
 * demoColonySimulation: the first full virtual colony run.
 *
 * Run 1: a two-goal mission simulated against a real ProjectSnapshot with
 * a full ant roster — deterministic ticks, round-robin scheduling (two
 * builders alternate), pheromone emission with per-tick decay, placeholder
 * proposals produced and reviewed via injected Phase 3/4 capabilities, and
 * a completed report with a ColonyMemory lesson.
 *
 * Run 2: the same mission with a deliberately tiny step budget (tightened
 * below the hard cap — it can never be raised above it), halting early with
 * a receipted budget halt.
 *
 * Confirmations: every proposal remains applied === false, no git command
 * or any command runs, nothing is written, nothing is pushed — there is no
 * API in this project capable of any of those.
 */

import path from "path";
import { ReceiptLog } from "../core/receiptLog";
import { SafetyGuard } from "../core/safetyGuard";
import { ProjectInspector } from "../inspector/projectInspector";
import { ProposalFactory } from "../generation/proposalFactory";
import { ProposalReviewer } from "../review/proposalReviewer";
import { ColonySimulation } from "../simulation/colonySimulation";
import type { ColonyMission } from "../types/missionTypes";
import type { AntRole, AntState } from "../types/antTypes";

function ant(role: AntRole, index: number): AntState {
  return {
    identity: {
      antId: `${role}-sim-${index}`,
      role,
      displayName: `${role} ant (sim)`,
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
    missionId: "mission-sim-demo-1",
    title: "Simulate a documentation mission",
    requestedByHuman: "operator",
    rawInstruction: "Walk the colony through planning two documentation goals in virtual time.",
    goals: [
      { goalId: "g1", description: "Explain virtual time in the docs", successCriteria: ["virtual time section exists"] },
      { goalId: "g2", description: "Outline the scheduler design notes", successCriteria: ["scheduler notes outlined"] },
    ],
    status: "received",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeRoster(): AntState[] {
  return [
    ant("scout", 1),
    ant("planner", 1),
    ant("builder", 1),
    ant("builder", 2), // two builders: round-robin alternation is visible
    ant("tester", 1),
    ant("auditor", 1),
    ant("messenger", 1),
    ant("guard", 1),
    ant("memory", 1),
    ant("repair", 1),
    ant("archivist", 1),
  ];
}

export function runDemoColonySimulation() {
  const projectRoot = path.resolve(__dirname, "..", "..");
  const setupReceiptLog = new ReceiptLog();
  const inspector = new ProjectInspector(projectRoot, setupReceiptLog);
  const { snapshot } = inspector.inspect("simulation-demo-setup");

  // Run 1: full budget (the hard cap), full roster, injected capabilities.
  const sim1 = new ColonySimulation();
  const capabilities = {
    proposalFactory: new ProposalFactory(new SafetyGuard(), sim1.receipts, projectRoot),
    proposalReviewer: new ProposalReviewer(new SafetyGuard(), sim1.receipts),
  };
  const report1 = sim1.run({
    mission: makeMission(),
    ants: makeRoster(),
    snapshot,
    capabilities,
  });

  // Run 2: same mission, budget tightened to 3 scheduling steps -> halts.
  const sim2 = new ColonySimulation();
  const report2 = sim2.run({
    mission: makeMission(),
    ants: makeRoster(),
    snapshot,
    options: { maxSteps: 3 },
  });

  const run2HaltReceipt = sim2.receipts
    .list()
    .find((r) => r.details?.haltReason === "step-budget-reached");

  return {
    run1: {
      status: report1.status,
      ticksUsed: report1.ticksUsed,
      tasksProcessed: report1.tasksProcessed,
      builderAlternation: report1.events
        .filter((e) => e.kind === "task-processed" && e.antId?.startsWith("builder"))
        .map((e) => e.antId),
      proposalsCreated: report1.proposalsCreatedIds.length,
      allProposalsUnapplied: report1.allProposalsUnapplied,
      activePheromonesAtEnd: report1.activePheromoneCount,
      attentionSnapshot: report1.finalAttentionSnapshot,
      memoryEntryId: report1.memoryEntryId,
    },
    run2: {
      status: report2.status,
      haltReason: report2.haltReason,
      ticksUsed: report2.ticksUsed,
      haltReceiptSummary: run2HaltReceipt?.summary,
    },
    guarantees: {
      noCommandRun: true, // no execution API exists anywhere in this project
      noFileWritten: true, // no fs write API exists anywhere in this project
      noPush: true, // push is unrepresentable and forbidden by law
      allProposalsUnapplied: report1.allProposalsUnapplied,
    },
    run1Events: report1.events,
    run1Receipts: sim1.receipts.list(),
  };
}

if (require.main === module) {
  console.log(JSON.stringify(runDemoColonySimulation(), null, 2));
}
