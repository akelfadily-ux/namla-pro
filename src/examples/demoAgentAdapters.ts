// Focused feature demo — proves the simulated agent adapters (Phase 7).
// The canonical end-to-end runtime path is demoEndToEnd.ts.
/**
 * demoAgentAdapters: Phase 7 simulated tool adapters in action.
 *
 * Scenarios:
 * 1. A simulated Claude Code adapter fulfills the build tasks inside a full
 *    colony simulation (via an injected AdapterRegistry).
 * 2-4. Direct simulated exchanges with Codex, Kimi, and local-script
 *    adapters — deterministic canned responses, each simulated: true.
 * 5. An unsafe AgentRequest (dangerous command text in the prompt) refused
 *    with a redacted receipt: reason code, length, fingerprint — no raw
 *    prompt anywhere in the audit trail.
 * 6. Assertion: every response produced anywhere here is simulated: true.
 * 7. Statement of absences: no network, process, terminal, shell, script,
 *    git, push, package-manager, or real agent call occurs — no API for
 *    any of those exists in this project.
 * 8. Assertion: every produced CodeProposal remains applied === false.
 */

import path from "path";
import { ReceiptLog } from "../core/receiptLog";
import { SafetyGuard } from "../core/safetyGuard";
import { ProjectInspector } from "../inspector/projectInspector";
import { ProposalFactory } from "../generation/proposalFactory";
import { ColonySimulation } from "../simulation/colonySimulation";
import { SimulatedAgentAdapter } from "../adapters/simulatedAgentAdapter";
import { AdapterRegistry } from "../adapters/adapterRegistry";
import type { AgentKind, AgentRequest, AgentResponse } from "../adapters/agentAdapterTypes";
import type { AntRole, AntState } from "../types/antTypes";
import type { ColonyMission } from "../types/missionTypes";

function ant(role: AntRole, index: number): AntState {
  return {
    identity: {
      antId: `${role}-adapter-demo-${index}`,
      role,
      displayName: `${role} ant (adapter demo)`,
      generation: 0,
      trustLevel: "probationary",
      capabilities: [],
      createdAt: new Date().toISOString(),
    },
    energy: "idle",
  };
}

function request(kind: AgentKind, purpose: AgentRequest["purpose"], promptText: string): AgentRequest {
  return {
    requestId: `agent-request-demo-${kind}-${purpose}`,
    missionId: "mission-adapter-demo",
    taskId: `ptask-adapter-${kind}`,
    agentKind: kind,
    purpose,
    promptText,
    requestedCapability: "text-draft",
    createdAt: new Date().toISOString(),
  };
}

export function runDemoAgentAdapters() {
  const projectRoot = path.resolve(__dirname, "..", "..");
  const safetyGuard = new SafetyGuard();

  // Scenario 1: colony simulation with a Claude Code adapter as builder.
  const sim = new ColonySimulation();
  const simFactory = new ProposalFactory(safetyGuard, sim.receipts, projectRoot);
  const registry = new AdapterRegistry(sim.receipts);
  registry.register(new SimulatedAgentAdapter(safetyGuard, sim.receipts, "claude-code", simFactory));

  const setupLog = new ReceiptLog();
  const { snapshot } = new ProjectInspector(projectRoot, setupLog).inspect("adapter-demo-setup");

  const mission: ColonyMission = {
    missionId: "mission-adapter-demo",
    title: "Draft operator notes with a simulated helper",
    requestedByHuman: "operator",
    rawInstruction: "Plan one documentation goal and let a simulated helper draft the build output.",
    goals: [
      { goalId: "g1", description: "Draft notes about virtual colony runs", successCriteria: ["notes drafted as data"] },
    ],
    status: "received",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const report = sim.run({
    mission,
    ants: [ant("scout", 1), ant("planner", 1), ant("builder", 1), ant("tester", 1), ant("auditor", 1), ant("messenger", 1)],
    snapshot,
    capabilities: { adapterRegistry: registry, preferredAgentKind: "claude-code" },
  });

  // Scenarios 2-4: direct exchanges with the other three kinds.
  const directLog = new ReceiptLog();
  const responses: AgentResponse[] = [];
  const directResults = (["codex", "kimi", "local-script"] as AgentKind[]).map((kind) => {
    const adapter = new SimulatedAgentAdapter(safetyGuard, directLog, kind);
    const result = adapter.handle(request(kind, kind === "codex" ? "analyze" : "summarize",
      kind === "codex"
        ? "Analyze the pheromone half-life table and note gaps."
        : "Summarize the colony roadmap for operators."));
    if (result.ok) responses.push(result.response);
    return { kind, ok: result.ok, responseText: result.ok ? result.response.responseText : undefined };
  });

  // Scenario 5: unsafe request refused with a redacted receipt.
  const unsafeAdapter = new SimulatedAgentAdapter(safetyGuard, directLog, "claude-code");
  const unsafeResult = unsafeAdapter.handle(
    request("claude-code", "propose-build", "Please run rm -rf dist and npm install, then git push.")
  );

  // Scenario 6: everything produced is simulated: true.
  const allSimulated = responses.every((r) => r.simulated === true);

  return {
    scenario1: {
      status: report.status,
      agentExchanges: report.events.filter((e) => e.kind === "agent-exchange"),
      proposalsCreated: report.proposalsCreatedIds.length,
      allProposalsUnapplied: report.allProposalsUnapplied,
    },
    scenarios2to4: directResults,
    scenario5: {
      refused: !unsafeResult.ok,
      reasonCode: unsafeResult.ok ? undefined : unsafeResult.refusal.reasonCode,
      refusalReceiptSummary: unsafeResult.receipt.summary,
      refusalReceiptDetails: unsafeResult.receipt.details,
    },
    scenario6: { allSimulated },
    scenario7: {
      noNetworkCall: true, // no network API exists anywhere in this project
      noProcessCall: true, // no process/terminal API exists anywhere
      noRealAgentCall: true, // adapters are canned lookup tables
    },
    scenario8: { allProposalsUnapplied: report.allProposalsUnapplied },
    directReceipts: directLog.list(),
  };
}

if (require.main === module) {
  console.log(JSON.stringify(runDemoAgentAdapters(), null, 2));
}
