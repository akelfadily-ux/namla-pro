/**
 * ColonySimulation: the first full colony run — entirely in memory.
 *
 * One run wires the existing phases together as data: the mission is
 * safety-gated (Guard), decomposed into dependency-ordered tasks (Queen /
 * Planner path via the Phase 2 engine), each task is assigned to an ant by
 * the deterministic scheduler (Scout/Builder/Tester/Auditor/Messenger by
 * role), pheromones are emitted and decay on virtual ticks, optional
 * injected Phase 3/4 capabilities let builders produce placeholder
 * CodeProposals and auditors review them, a lesson is written to
 * ColonyMemory (Memory), and everything is receipted.
 *
 * What a simulation step is NOT: it executes no command, writes no file,
 * runs no test, touches no network, applies no proposal. A step is a
 * bookkeeping update to in-memory objects, and steps happen only while a
 * human-run script is inside run(). When run() returns, nothing continues.
 */

import { randomUUID } from "crypto";
import type { ColonyMission } from "../types/missionTypes";
import type { ColonyTask } from "../types/taskTypes";
import type { ProjectSnapshot } from "../inspector/inspectorTypes";
import type { CodeProposal } from "../generation/codeProposal";
import { SafetyGuard } from "../core/safetyGuard";
import { ReceiptLog } from "../core/receiptLog";
import { PheromoneBus } from "../core/pheromoneBus";
import { ColonyMemory } from "../core/colonyMemory";
import { DecompositionEngine } from "../planner/decompositionEngine";
import { ProposalFactory } from "../generation/proposalFactory";
import { ProposalReviewer } from "../review/proposalReviewer";
import type { AntState } from "../types/antTypes";
import type { PheromoneAttentionSnapshot } from "../pheromones/pheromoneAttentionSnapshot";
import { createPheromoneAttentionSnapshot } from "../pheromones/pheromoneAttentionSnapshot";
import { SimulationClock } from "./simulationClock";
import { AntScheduler } from "./antScheduler";
import type { AdapterRegistry } from "../adapters/adapterRegistry";
import type { AgentKind, AgentRequest } from "../adapters/agentAdapterTypes";

export type SimulationStatus = "completed" | "halted-budget" | "refused";

export type SimulationHaltReason = "step-budget-reached";

export interface SimulationEvent {
  tick: number;
  kind:
    | "task-processed"
    | "task-skipped"
    | "proposal-created"
    | "proposal-reviewed"
    | "agent-exchange"
    | "halt"
    | "refusal";
  taskId?: string;
  antId?: string;
  note: string;
}

export interface SimulationRunOptions {
  /** May only tighten the hard cap from AutonomousLoopPolicy, never raise it. */
  maxSteps?: number;
}

export interface SimulationCapabilities {
  /** Injected Phase 3 factory: builders produce placeholder proposals. */
  proposalFactory?: ProposalFactory;
  /** Injected Phase 4 reviewer: auditors review what builders produced. */
  proposalReviewer?: ProposalReviewer;
  /**
   * Injected Phase 7 registry: simulated agent adapters supply builder
   * output instead of the bare placeholder. Every response is simulated.
   */
  adapterRegistry?: AdapterRegistry;
  /** Which simulated agent fulfills build tasks; defaults to claude-code. */
  preferredAgentKind?: AgentKind;
}

export interface SimulationReport {
  simulationId: string;
  status: SimulationStatus;
  haltReason?: SimulationHaltReason;
  ticksUsed: number;
  schedulerStepsUsed: number;
  tasksProcessed: number;
  tasksSkipped: number;
  tasksBlockedBySafety: number;
  proposalsCreatedIds: string[];
  allProposalsUnapplied: boolean;
  activePheromoneCount: number;
  /**
   * AH2 Step 4D: the read side of the pheromone system — a safe aggregate
   * (counts, types, strength buckets) of the bus at run end. Report-only;
   * scheduling never reads it.
   */
  finalAttentionSnapshot: PheromoneAttentionSnapshot;
  events: SimulationEvent[];
  memoryEntryId?: string;
}

export class ColonySimulation {
  private readonly safetyGuard: SafetyGuard;
  private readonly receiptLog: ReceiptLog;
  private readonly pheromoneBus: PheromoneBus;
  private readonly colonyMemory: ColonyMemory;
  private readonly engine: DecompositionEngine;

  constructor(deps: {
    safetyGuard?: SafetyGuard;
    receiptLog?: ReceiptLog;
    pheromoneBus?: PheromoneBus;
    colonyMemory?: ColonyMemory;
  } = {}) {
    this.safetyGuard = deps.safetyGuard ?? new SafetyGuard();
    this.receiptLog = deps.receiptLog ?? new ReceiptLog();
    this.pheromoneBus = deps.pheromoneBus ?? new PheromoneBus();
    this.colonyMemory = deps.colonyMemory ?? new ColonyMemory();
    this.engine = new DecompositionEngine(this.safetyGuard, this.receiptLog);
  }

  get receipts(): ReceiptLog {
    return this.receiptLog;
  }

  get pheromones(): PheromoneBus {
    return this.pheromoneBus;
  }

  run(params: {
    mission: ColonyMission;
    ants: AntState[];
    snapshot?: ProjectSnapshot;
    capabilities?: SimulationCapabilities;
    options?: SimulationRunOptions;
  }): SimulationReport {
    const simulationId = `sim-${randomUUID()}`;
    const clock = new SimulationClock();
    const scheduler = new AntScheduler(params.options?.maxSteps);
    for (const ant of params.ants) scheduler.register(ant);

    const events: SimulationEvent[] = [];
    const createdProposals: CodeProposal[] = [];

    this.receiptLog.create({
      summary: `Simulation started: ${params.ants.length} ant(s) registered, ${params.mission.goals.length} goal(s).`,
      status: "approved",
      links: { missionId: params.mission.missionId },
      details: { simulationId, usedSnapshot: Boolean(params.snapshot) },
    });

    // Guard at the gate, exactly like AntQueen.
    const decision = this.safetyGuard.evaluateText(
      `${params.mission.title}\n${params.mission.rawInstruction}`
    );
    if (!decision.allowed) {
      events.push({ tick: clock.currentTick, kind: "refusal", note: "mission failed the safety gate" });
      this.receiptLog.create({
        summary: `Simulation refused: mission failed the safety gate (${decision.level}).`,
        status: "refused",
        links: { missionId: params.mission.missionId },
        details: { simulationId, reasons: decision.reasons },
      });
      return this.buildReport(simulationId, "refused", clock, scheduler, events, createdProposals, 0, 0, 0);
    }

    this.pheromoneBus.emit({
      type: "HumanIntentPheromone",
      emittedByAntId: "simulation-queen",
      topic: params.mission.title,
      missionId: params.mission.missionId,
      strength: 1,
    });

    const decomposition = this.engine.decompose(params.mission, params.snapshot);
    const tasksById = new Map(decomposition.tasks.map((t) => [t.taskId, t]));

    let processed = 0;
    let skipped = 0;
    let halted = false;

    for (const taskId of decomposition.orderedTaskIds) {
      if (scheduler.budgetExhausted) {
        halted = true;
        events.push({ tick: clock.currentTick, kind: "halt", note: "virtual step budget reached" });
        this.receiptLog.create({
          summary: "Simulation halted: virtual step budget reached.",
          status: "blocked",
          links: { missionId: params.mission.missionId },
          details: { simulationId, stepsUsed: scheduler.stepsUsed, haltReason: "step-budget-reached" },
        });
        break;
      }

      const task = tasksById.get(taskId);
      if (!task) continue;

      clock.step();
      const ant = scheduler.nextAntForRole(task.requiredRole);

      if (!ant) {
        skipped += 1;
        events.push({ tick: clock.currentTick, kind: "task-skipped", taskId, note: "no active ant for the required role" });
        this.pheromoneBus.emit({
          type: "NeedHelpPheromone",
          emittedByAntId: "simulation-scheduler",
          topic: "task-skipped",
          payload: { taskId },
          missionId: params.mission.missionId,
          taskId,
        });
        // AH2 Step 4G: an admitted, scheduled task stopped by a runtime
        // boundary (no eligible ant) is "blocked", not "refused".
        this.receiptLog.create({
          summary: `Simulation task skipped: no active ant for the required role.`,
          status: "blocked",
          links: { missionId: params.mission.missionId, taskId },
          details: { simulationId, tick: clock.currentTick, requiredRole: task.requiredRole },
        });
      } else {
        processed += 1;
        events.push({ tick: clock.currentTick, kind: "task-processed", taskId, antId: ant.identity.antId, note: "task simulated" });
        this.pheromoneBus.emit({
          type: "TrailPheromone",
          emittedByAntId: ant.identity.antId,
          topic: task.title,
          missionId: params.mission.missionId,
          taskId,
        });
        this.receiptLog.create({
          summary: "Virtual step processed.",
          status: "completed",
          links: { missionId: params.mission.missionId, taskId, antId: ant.identity.antId },
          details: { simulationId, tick: clock.currentTick },
        });

        this.simulateTaskOutput(task, ant, clock.currentTick, params, events, createdProposals);
      }

      // Virtual time passes; trails fade unless something re-marks them.
      this.pheromoneBus.tickDecay(clock.asDate());
    }

    if (!halted) {
      this.pheromoneBus.emit({
        type: "SuccessPheromone",
        emittedByAntId: "simulation-messenger",
        topic: "simulation-completed",
        missionId: params.mission.missionId,
      });

      this.receiptLog.create({
        summary: `Simulation completed: ${processed} task(s) processed, ${skipped} skipped, ${clock.currentTick} tick(s) used.`,
        status: "completed",
        links: { missionId: params.mission.missionId },
        details: { simulationId, schedulerStepsUsed: scheduler.stepsUsed },
      });
    }

    let memoryEntryId: string | undefined;
    if (!halted) {
      memoryEntryId = this.colonyMemory.remember({
        scope: "colony",
        kind: "lesson-learned",
        content: `Simulation processed ${processed} task(s) in ${clock.currentTick} virtual tick(s).`,
        createdByAntId: "simulation-memory",
        missionId: params.mission.missionId,
      }).memoryId;
    }

    return this.buildReport(
      simulationId,
      halted ? "halted-budget" : "completed",
      clock,
      scheduler,
      events,
      createdProposals,
      processed,
      skipped,
      decomposition.safetyBlocked.length,
      memoryEntryId
    );
  }

  /**
   * Phase 3/4 flavor, only when capabilities were injected: a builder task
   * yields a placeholder CodeProposal (factory-gated), which an auditor
   * reviews against the snapshot. Both are data; nothing is applied.
   */
  private simulateTaskOutput(
    task: ColonyTask,
    ant: AntState,
    tick: number,
    params: {
      mission: ColonyMission;
      snapshot?: ProjectSnapshot;
      capabilities?: SimulationCapabilities;
    },
    events: SimulationEvent[],
    createdProposals: CodeProposal[]
  ): void {
    if (task.expectedOutputKind !== "code-proposal") return;

    // Phase 7 path: an injected simulated agent adapter supplies the
    // builder output. Deterministic canned responses; still no execution.
    const registry = params.capabilities?.adapterRegistry;
    if (registry) {
      const kind = params.capabilities?.preferredAgentKind ?? "claude-code";
      const adapter = registry.get(kind);
      if (adapter) {
        const request: AgentRequest = {
          requestId: `agent-request-${randomUUID()}`,
          missionId: params.mission.missionId,
          taskId: task.taskId,
          agentKind: kind,
          purpose: "propose-build",
          promptText: task.description,
          requestedCapability: "code-proposal-draft",
          createdAt: new Date().toISOString(),
        };

        const { result, proposal } = adapter.fulfillBuildTask(request);

        events.push({
          tick,
          kind: "agent-exchange",
          taskId: task.taskId,
          antId: ant.identity.antId,
          note: result.ok
            ? `simulated response received (${kind})`
            : `simulated exchange refused (${result.refusal.reasonCode})`,
        });

        if (proposal) {
          createdProposals.push(proposal);
          events.push({
            tick,
            kind: "proposal-created",
            taskId: task.taskId,
            antId: ant.identity.antId,
            note: "adapter-shaped proposal created (unapplied)",
          });

          const reviewer = params.capabilities?.proposalReviewer;
          if (reviewer && params.snapshot) {
            const outcome = reviewer.review(proposal, params.snapshot, "simulation-auditor");
            events.push({ tick, kind: "proposal-reviewed", taskId: task.taskId, note: `review verdict: ${outcome.verdict}` });
          }
        }
        return;
      }
    }

    // Phase 6 fallback: bare placeholder via the injected factory.
    const factory = params.capabilities?.proposalFactory;
    if (!factory) return;

    const result = factory.create({
      missionId: params.mission.missionId,
      taskId: task.taskId,
      targetRelativePath: `docs/simulated/${task.taskId}.md`,
      changeKind: "create",
      proposedContent: `# Simulated output for ${task.taskId}\n\nPlaceholder produced during a virtual colony run; awaiting human review.\n`,
      rationale: "Simulated builder output for a virtual tick.",
    });

    if (result.ok) {
      createdProposals.push(result.proposal);
      events.push({
        tick,
        kind: "proposal-created",
        taskId: task.taskId,
        antId: ant.identity.antId,
        note: "placeholder proposal created (unapplied)",
      });

      const reviewer = params.capabilities?.proposalReviewer;
      if (reviewer && params.snapshot) {
        const outcome = reviewer.review(result.proposal, params.snapshot, "simulation-auditor");
        events.push({
          tick,
          kind: "proposal-reviewed",
          taskId: task.taskId,
          note: `review verdict: ${outcome.verdict}`,
        });
      }
    }
  }

  private buildReport(
    simulationId: string,
    status: SimulationStatus,
    clock: SimulationClock,
    scheduler: AntScheduler,
    events: SimulationEvent[],
    createdProposals: CodeProposal[],
    processed: number,
    skipped: number,
    blockedBySafety: number,
    memoryEntryId?: string
  ): SimulationReport {
    return {
      simulationId,
      status,
      haltReason: status === "halted-budget" ? "step-budget-reached" : undefined,
      ticksUsed: clock.currentTick,
      schedulerStepsUsed: scheduler.stepsUsed,
      tasksProcessed: processed,
      tasksSkipped: skipped,
      tasksBlockedBySafety: blockedBySafety,
      proposalsCreatedIds: createdProposals.map((p) => p.proposalId),
      allProposalsUnapplied: createdProposals.every((p) => p.applied === false),
      activePheromoneCount: this.pheromoneBus.list().length,
      finalAttentionSnapshot: createPheromoneAttentionSnapshot(
        this.pheromoneBus.list(),
        clock.currentTick
      ),
      events,
      memoryEntryId,
    };
  }
}
