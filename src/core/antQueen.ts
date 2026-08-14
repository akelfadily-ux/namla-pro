/**
 * COMPATIBILITY FAÇADE (since the Pre-Capability Closure pass).
 *
 * AntQueen no longer operates a mission-processing spine of its own: it
 * delegates every mission to the canonical ColonyEngine
 * (src/engine/colonyEngine.ts), which runs the one gate, one decomposition
 * path, one scheduler, and one report model the whole project shares.
 * The former parallel path (MissionPlanner one-task-per-goal fallback +
 * ColonyOrchestrator + TaskRouter) is no longer reachable from here;
 * those modules remain only as deprecated compatibility artifacts.
 *
 * What this façade preserves for legacy callers:
 * - the AntQueen constructor and its AntQueenDeps shape (the deprecated
 *   missionPlanner/taskRouter fields are accepted and ignored);
 * - acceptMission(mission, ants, snapshot?) returning a single final
 *   ActionReceipt;
 * - the receipts / pheromones getters, now backed by the engine's log
 *   and bus.
 *
 * The legacy result mapping: the engine returns a MissionRunReport; this
 * façade records exactly one mission-level compatibility receipt in the
 * SHARED engine log (accepted -> "approved" admission receipt with the
 * legacy summary shape; refused -> id-based "refused" receipt per the
 * receipt-status model) and returns it. No planning or routing logic is
 * rebuilt here.
 */

import type { AntState } from "../types/antTypes";
import type { ColonyMission } from "../types/missionTypes";
import type { ActionReceipt } from "../types/receiptTypes";
import type { ProjectSnapshot } from "../inspector/inspectorTypes";
import type { MissionRunReport } from "../engine/colonyEngine";
import { ColonyEngine } from "../engine/colonyEngine";
import { SafetyGuard } from "./safetyGuard";
import { ReceiptLog } from "./receiptLog";
import { PheromoneBus } from "./pheromoneBus";
import type { MissionPlanner } from "./missionPlanner";
import type { TaskRouter } from "./taskRouter";

export interface AntQueenDeps {
  safetyGuard?: SafetyGuard;
  receiptLog?: ReceiptLog;
  pheromoneBus?: PheromoneBus;
  /** @deprecated Ignored since the Queen fold-in; the engine plans. */
  missionPlanner?: MissionPlanner;
  /** @deprecated Ignored since the Queen fold-in; the engine schedules. */
  taskRouter?: TaskRouter;
}

export class AntQueen {
  private readonly engine: ColonyEngine;

  constructor(deps: AntQueenDeps = {}) {
    this.engine = new ColonyEngine({
      safetyGuard: deps.safetyGuard,
      receiptLog: deps.receiptLog,
      pheromoneBus: deps.pheromoneBus,
    });
  }

  acceptMission(mission: ColonyMission, availableAnts: AntState[], snapshot?: ProjectSnapshot): ActionReceipt {
    const report = this.engine.runMission({ mission, ants: availableAnts, snapshot });
    return this.recordLegacyMissionReceipt(mission, report, snapshot);
  }

  /**
   * Narrow compatibility mapper: one mission-level receipt in the shared
   * log, shaped like the pre-fold Queen's final receipt. Refusal summaries
   * are id-based (the mission's own text failed the gate and must not be
   * echoed); accepted summaries may carry the gated title.
   */
  private recordLegacyMissionReceipt(
    mission: ColonyMission,
    report: MissionRunReport,
    snapshot?: ProjectSnapshot
  ): ActionReceipt {
    if (!report.accepted) {
      return this.engine.receipts.create({
        summary: `Mission ${mission.missionId} rejected by SafetyGuard.`,
        status: "refused",
        links: { missionId: mission.missionId },
        details: { simulationId: report.simulationId, usedDecompositionEngine: true },
      });
    }

    return this.engine.receipts.create({
      summary:
        `Mission "${mission.title}" accepted. ${report.tasksProcessed} task(s) processed, ` +
        `${report.tasksSkipped + report.tasksBlockedBySafety} blocked or skipped.`,
      status: "approved",
      links: { missionId: mission.missionId },
      details: {
        simulationId: report.simulationId,
        usedDecompositionEngine: true,
        usedSnapshot: Boolean(snapshot),
      },
    });
  }

  get receipts(): ReceiptLog {
    return this.engine.receipts;
  }

  get pheromones(): PheromoneBus {
    return this.engine.pheromones;
  }
}
