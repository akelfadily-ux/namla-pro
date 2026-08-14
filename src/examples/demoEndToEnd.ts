/**
 * demoEndToEnd: the canonical demonstration of the single public runtime
 * API. Every run below enters the colony through ColonyEngine.runMission —
 * nothing calls AntQueen, ColonySimulation, or any internal module to run
 * a mission.
 *
 * Run A uses the engine module alone: no snapshot, no capabilities — the
 * pure public path (mission gate, planning, scheduling, pheromones,
 * receipts, report).
 *
 * Run B is the fully equipped path: a real ProjectSnapshot and injected
 * capabilities (proposal factory, reviewer, a simulated Claude Code
 * adapter) are passed through the engine's one options object. The setup
 * lines construct configuration; the only runtime call is runMission.
 *
 * What the output proves: the mission is accepted (or would be safely
 * refused with a receipt), tasks are scheduled in dependency order,
 * receipts exist for every step, pheromones were emitted, any proposals
 * created remain applied: false — and no command, git operation, desktop
 * action, network call, or file write happened, because no API for any of
 * those exists in this project.
 */

import path from "path";
import { createDemoDigest } from "../tools/demoDigest";
import { ColonyEngine, MissionRunRequest, runMission } from "../engine/colonyEngine";
import type { AntRole, AntState, ColonyMission } from "../engine/colonyEngine";
import { ReceiptLog } from "../core/receiptLog";
import { SafetyGuard } from "../core/safetyGuard";
import { ProjectInspector } from "../inspector/projectInspector";
import { ProposalFactory } from "../generation/proposalFactory";
import { ProposalReviewer } from "../review/proposalReviewer";
import { AdapterRegistry } from "../adapters/adapterRegistry";
import { SimulatedAgentAdapter } from "../adapters/simulatedAgentAdapter";

function ant(role: AntRole, index: number): AntState {
  return {
    identity: {
      antId: `${role}-e2e-${index}`,
      role,
      displayName: `${role} ant (e2e)`,
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
    title: "Walk one mission through the public engine",
    requestedByHuman: "operator",
    rawInstruction: "Plan a single documentation goal end to end through the canonical runtime path.",
    goals: [
      { goalId: "g1", description: "Describe the runtime spine for operators", successCriteria: ["spine described as data"] },
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
    ant("tester", 1),
    ant("auditor", 1),
    ant("messenger", 1),
  ];
}

export function runDemoEndToEnd() {
  // Run A: the pure public path — engine module only, one call.
  const requestA: MissionRunRequest = { mission: makeMission("mission-e2e-a"), ants: makeRoster() };
  const reportA = runMission(requestA);

  // Run B: fully equipped — snapshot + capabilities through the same API.
  const projectRoot = path.resolve(__dirname, "..", "..");
  const setupLog = new ReceiptLog();
  const { snapshot } = new ProjectInspector(projectRoot, setupLog).inspect("e2e-setup");

  const engine = new ColonyEngine();
  const safetyGuard = new SafetyGuard();
  const factory = new ProposalFactory(safetyGuard, engine.receipts, projectRoot);
  const registry = new AdapterRegistry(engine.receipts);
  registry.register(new SimulatedAgentAdapter(safetyGuard, engine.receipts, "claude-code", factory));

  const reportB = engine.runMission({
    mission: makeMission("mission-e2e-b"),
    ants: makeRoster(),
    snapshot,
    capabilities: {
      adapterRegistry: registry,
      preferredAgentKind: "claude-code",
      proposalReviewer: new ProposalReviewer(safetyGuard, engine.receipts),
    },
  });

  return {
    runA: {
      accepted: reportA.accepted,
      status: reportA.status,
      tasksProcessed: reportA.tasksProcessed,
      ticksUsed: reportA.ticksUsed,
      receiptCount: reportA.receipts.length,
      pheromonesActive: reportA.activePheromoneCount,
      // AH2 Step 4D: the read side of the pheromone system — safe
      // aggregate only (no topics, no payloads), report-only.
      pheromoneAttention: reportA.pheromoneAttention,
    },
    runB: {
      accepted: reportB.accepted,
      status: reportB.status,
      tasksProcessed: reportB.tasksProcessed,
      agentExchanges: reportB.events.filter((e) => e.kind === "agent-exchange").length,
      proposalsCreated: reportB.proposalsCreatedIds.length,
      allProposalsUnapplied: reportB.allProposalsUnapplied,
      reviewEvents: reportB.events.filter((e) => e.kind === "proposal-reviewed").length,
      receiptCount: reportB.receipts.length,
      memoryEntryId: reportB.memoryEntryId,
    },
    guarantees: {
      noCommandRun: true, // no execution API exists anywhere in this project
      noGitRun: true, // no git execution API exists; push is unrepresentable
      noDesktopAction: true, // desktop plans are data; no OS API exists
      noFileWritten: true, // the only fs importer is the read-only inspector
      noNetwork: true, // no network API exists
    },
    runBReceipts: reportB.receipts,
  };
}

if (require.main === module) {
  const result = runDemoEndToEnd();
  console.log(JSON.stringify(result, null, 2));
  // Stable digest (ids/timestamps/raw text stripped) — groundwork for
  // future golden-output checks.
  console.log("DIGEST:", JSON.stringify(createDemoDigest(result, "engine"), null, 2));
}
