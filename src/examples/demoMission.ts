// Focused feature demo — proves the AntQueen legacy mission path (Phase 0).
// The canonical end-to-end runtime path is demoEndToEnd.ts.
/**
 * demoMission: walks a small, safe mission through the AntQueen end to end.
 * This is illustrative only — run it with a TypeScript runner if you want to
 * see it execute; it is not wired into any build or start script.
 */

import { AntQueen } from "../core/antQueen";
import type { AntState } from "../types/antTypes";
import type { ColonyMission } from "../types/missionTypes";

function makePlannerAnt(): AntState {
  return {
    identity: {
      antId: "planner-demo-1",
      role: "planner",
      displayName: "Planner Ant (demo)",
      generation: 0,
      trustLevel: "trusted",
      capabilities: [],
      createdAt: new Date().toISOString(),
    },
    energy: "idle",
  };
}

export function runDemoMission() {
  const queen = new AntQueen();
  const ants = [makePlannerAnt()];

  const mission: ColonyMission = {
    missionId: "mission-demo-1",
    title: "Document the colony's own architecture",
    requestedByHuman: "operator",
    rawInstruction: "Write documentation describing how the colony works.",
    goals: [
      { goalId: "goal-1", description: "Explain ant roles", successCriteria: ["docs/ant-roles.md exists"] },
      { goalId: "goal-2", description: "Explain safety model", successCriteria: ["docs/safety-model.md exists"] },
    ],
    status: "received",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const finalReceipt = queen.acceptMission(mission, ants);

  return {
    finalReceipt,
    allReceipts: queen.receipts.list(),
    pheromones: queen.pheromones.list(),
  };
}

if (require.main === module) {
  console.log(JSON.stringify(runDemoMission(), null, 2));
}
