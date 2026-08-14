/**
 * ColonyEngine: the single public runtime entry point of Namla Pro.
 *
 * Everything a caller needs is here: one request shape, one report shape,
 * one class, one convenience function. Internally the engine delegates to
 * the proven ColonySimulation path — it duplicates no logic and adds no
 * capability. The runtime spine is:
 *
 *   Human mission
 *     -> ColonyEngine.runMission
 *     -> SafetyGuard (mission gate)
 *     -> DecompositionEngine (per-goal pipelines, dependency order)
 *     -> AntScheduler (deterministic, budget-capped)
 *     -> ColonySimulation (virtual ticks; injected capabilities:
 *        proposals, review, simulated agent adapters)
 *     -> ReceiptLog + PheromoneBus + ColonyMemory
 *     -> MissionRunReport
 *
 * See docs/runtime-spine.md. The older AntQueen.acceptMission path remains
 * as a compatibility/legacy entry until a later hardening step; new code
 * should enter through this module only.
 *
 * All Phase 0-8 guarantees hold by construction, because the engine only
 * composes existing gated components: no command execution, no writes, no
 * network, no git execution, no proposal application, no desktop
 * automation, no autonomous loop, and receipts for everything including
 * refusals.
 */

import type { ColonyMission } from "../types/missionTypes";
import type { ProjectSnapshot } from "../inspector/inspectorTypes";
import type { ActionReceipt } from "../types/receiptTypes";
import type { AntState } from "../types/antTypes";
import type { PheromoneAttentionSnapshot } from "../pheromones/pheromoneAttentionSnapshot";
import type {
  SimulationCapabilities,
  SimulationEvent,
  SimulationHaltReason,
  SimulationRunOptions,
  SimulationStatus,
} from "../simulation/colonySimulation";
import { ColonySimulation } from "../simulation/colonySimulation";
import { SafetyGuard } from "../core/safetyGuard";
import { ReceiptLog } from "../core/receiptLog";
import { PheromoneBus } from "../core/pheromoneBus";
import { ColonyMemory } from "../core/colonyMemory";

/** One options object: mission data, roster, and optional context. */
export interface MissionRunRequest {
  mission: ColonyMission;
  /** The ants available for scheduling: canonical AntState (role + energy). */
  ants: AntState[];
  /** Optional Phase 1 snapshot; planning is snapshot-aware when present. */
  snapshot?: ProjectSnapshot;
  /** Optional injected capabilities (proposal factory, reviewer, adapters). */
  capabilities?: SimulationCapabilities;
  /** Optional run options (budget may only be tightened, never raised). */
  options?: SimulationRunOptions;
}

/** The normalized public result of one mission run. */
export interface MissionRunReport {
  missionId: string;
  /** False when the mission was refused at the safety gate. */
  accepted: boolean;
  status: SimulationStatus;
  haltReason?: SimulationHaltReason;
  simulationId: string;
  ticksUsed: number;
  schedulerStepsUsed: number;
  tasksProcessed: number;
  tasksSkipped: number;
  tasksBlockedBySafety: number;
  proposalsCreatedIds: string[];
  /** Always true in every current phase; proposals are never applied. */
  allProposalsUnapplied: boolean;
  activePheromoneCount: number;
  /**
   * Safe aggregate of the pheromone bus at run end (counts, types,
   * strength buckets — no topics or payloads). Report-only observability;
   * scheduling remains independent of pheromone strength.
   */
  pheromoneAttention: PheromoneAttentionSnapshot;
  events: SimulationEvent[];
  /** The full receipt trail of this run, including refusals. */
  receipts: ActionReceipt[];
  memoryEntryId?: string;
}

export interface ColonyEngineDeps {
  safetyGuard?: SafetyGuard;
  receiptLog?: ReceiptLog;
  pheromoneBus?: PheromoneBus;
  colonyMemory?: ColonyMemory;
}

export class ColonyEngine {
  private readonly simulation: ColonySimulation;

  constructor(deps: ColonyEngineDeps = {}) {
    this.simulation = new ColonySimulation(deps);
  }

  /** The engine's receipt log (shared with the underlying run). */
  get receipts(): ReceiptLog {
    return this.simulation.receipts;
  }

  /** The engine's pheromone bus (shared with the underlying run). */
  get pheromones(): PheromoneBus {
    return this.simulation.pheromones;
  }

  runMission(request: MissionRunRequest): MissionRunReport {
    const report = this.simulation.run({
      mission: request.mission,
      ants: request.ants,
      snapshot: request.snapshot,
      capabilities: request.capabilities,
      options: request.options,
    });

    return {
      missionId: request.mission.missionId,
      accepted: report.status !== "refused",
      status: report.status,
      haltReason: report.haltReason,
      simulationId: report.simulationId,
      ticksUsed: report.ticksUsed,
      schedulerStepsUsed: report.schedulerStepsUsed,
      tasksProcessed: report.tasksProcessed,
      tasksSkipped: report.tasksSkipped,
      tasksBlockedBySafety: report.tasksBlockedBySafety,
      proposalsCreatedIds: report.proposalsCreatedIds,
      allProposalsUnapplied: report.allProposalsUnapplied,
      activePheromoneCount: report.activePheromoneCount,
      pheromoneAttention: report.finalAttentionSnapshot,
      events: report.events,
      receipts: this.simulation.receipts.list(),
      memoryEntryId: report.memoryEntryId,
    };
  }
}

/** Convenience one-shot entry point with default (fresh) colony services. */
export function runMission(request: MissionRunRequest): MissionRunReport {
  return new ColonyEngine().runMission(request);
}

// Re-exported so public-API callers import from one module only.
// AntState is the canonical roster type since AH2 Step 4B;
// SimulationAntState remains as a deprecated alias of it.
export type { AntState, AntRole } from "../types/antTypes";
export type { SimulationAntState } from "../simulation/antScheduler";
export type {
  SimulationCapabilities,
  SimulationEvent,
  SimulationHaltReason,
  SimulationRunOptions,
  SimulationStatus,
} from "../simulation/colonySimulation";
export type { ColonyMission } from "../types/missionTypes";
export type { ProjectSnapshot } from "../inspector/inspectorTypes";
export type {
  PheromoneAttentionSnapshot,
  PheromoneAttentionEntry,
} from "../pheromones/pheromoneAttentionSnapshot";
