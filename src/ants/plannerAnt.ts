/**
 * PlannerAnt breaks a goal into candidate sub-tasks. Phase 0: it returns a
 * list of proposed titles only — actual ColonyTask creation still goes
 * through MissionPlanner and SafetyGuard.
 *
 * Phase 2: a PlannerAnt can additionally propose a full mission
 * decomposition — but only when a human-composed DecompositionEngine is
 * handed to it. Like ScoutAnt's inspector, the capability is injected, never
 * ambient.
 */

import type { AntIdentity } from "../types/antTypes";
import type { ColonyMission } from "../types/missionTypes";
import type { ProjectSnapshot } from "../inspector/inspectorTypes";
import type { DecompositionEngine, DecompositionResult } from "../planner/decompositionEngine";
import type { AntFacadeTrace } from "./antFacadeTrace";
import { createFacadeTrace } from "./antFacadeTrace";

export class PlannerAnt {
  readonly identity: AntIdentity;

  constructor(antId: string) {
    this.identity = {
      antId,
      role: "planner",
      displayName: "Planner Ant",
      generation: 0,
      trustLevel: "trusted",
      capabilities: [
        { name: "plan-subtasks", description: "Break a goal into candidate sub-tasks.", requiresApproval: true },
      ],
      createdAt: new Date().toISOString(),
    };
  }

  planSubtasks(goalDescription: string): AntFacadeTrace {
    return createFacadeTrace({
      role: "planner",
      action: "plan-subtasks",
      status: "completed",
      noteCode: "proposal-only",
      createdBy: this.identity.antId,
      details: { goalDescriptionLength: goalDescription.length },
    });
  }

  /**
   * Phase 2: propose a full decomposition through an injected engine. The
   * engine writes the REAL receipts (including per-task safety blocks);
   * the planner returns a façade trace referencing the engine's summary
   * receipt by id (Step 4C semantics).
   */
  proposeDecomposition(
    mission: ColonyMission,
    engine: DecompositionEngine,
    snapshot?: ProjectSnapshot
  ): { result: DecompositionResult; trace: AntFacadeTrace } {
    const result = engine.decompose(mission, snapshot);

    return {
      result,
      trace: createFacadeTrace({
        role: "planner",
        action: "propose-decomposition",
        status: "completed",
        noteCode: "decomposition-proposed",
        createdBy: this.identity.antId,
        relatedReceiptIds: [result.receipt.receiptId],
        details: {
          missionId: mission.missionId,
          orderedCount: result.orderedTaskIds.length,
          safetyBlockedCount: result.safetyBlocked.length,
          dependencyBlockedCount: result.dependencyBlockedTaskIds.length,
          orderedTaskIds: result.orderedTaskIds,
        },
      }),
    };
  }
}
