/**
 * Tamara–Namla Federation V1 — the bridge (Build Law §20).
 *
 * `FederationBridge.submitObjective` is the ONLY doorway between Tamara and
 * the colony. It validates the objective, then transforms it into local
 * mission demands and runs them through the EXISTING decentralized pipeline
 * (`MissionRunner`: scout proposals → local quorum → voluntary claims →
 * bounded cognitive admission → artifacts → review → verification → repair).
 * Nothing here assigns a task to an ant: Tamara's objective becomes DEMAND,
 * and ants answer it exactly as they answer every other demand.
 *
 * Tamara's controls are strategic only: pause a mission, reduce a provider
 * budget (reduce-only — she can never raise it past what she granted),
 * accept or reject the final evidence. She sees `FederationSafeSummary` —
 * counts, statuses, and outcome evidence — never a private AntMind.
 *
 * Deterministic; automated flows use the deterministic provider only.
 * No fs, no child_process, no network.
 */

import { createColonyGenesis } from "../colony/colonyGenesis";
import { CognitiveWorkerRegistry } from "../colonyMission/cognitiveWorkerRegistry";
import { DeterministicCognitiveWorker } from "../colonyMission/deterministicCognitiveWorker";
import { MissionRunner } from "../colonyMission/missionRunner";
import type { MissionRunReport } from "../colonyMission/missionRunner";
import type { WorkCategory, WorkTask } from "../colonyMission/workDemand";
import { ReceiptLog } from "../core/receiptLog";
import type { TamaraAuthorityRecord, TamaraObjective } from "./tamaraObjective";
import { createTamaraAuthorityRecord, tamaraHoldsNoWorkerAuthority, validateTamaraObjective } from "./tamaraObjective";

export type MissionLifecycle = "running" | "paused" | "completed" | "accepted" | "rejected";

/** What Tamara is allowed to see: counts, statuses, evidence — never minds. */
export interface FederationSafeSummary {
  readonly objectiveId: string;
  readonly missionId: string;
  readonly lifecycle: MissionLifecycle;
  readonly scoutProposalCount: number;
  readonly quorumReached: boolean;
  readonly voluntaryTaskClaims: number;
  readonly acceptedTaskClaims: number;
  readonly artifactProposals: number;
  readonly artifactsReviewed: number;
  readonly verificationRuns: number;
  readonly repairRounds: number;
  readonly finalVerificationPassed: boolean;
  readonly peakCognitiveAnts: number;
  readonly providerBudgetRemaining: number;
}

export interface FederationSubmissionResult {
  readonly accepted: boolean;
  readonly reasonCode: string;
  readonly summary: FederationSafeSummary | null;
  readonly report: MissionRunReport | null;
}

export interface FederationMetrics {
  readonly tamaraObjectivesReceived: number;
  readonly objectivesRefused: number;
  readonly colonyMissionsCreated: number;
  readonly voluntaryClaims: number;
  readonly nonVolunteerAssignments: 0;
  readonly centralTaskAssignments: 0;
  readonly queenTaskAssignments: 0;
  readonly tamaraDirectAntAssignments: 0;
  readonly missionsPaused: number;
  readonly budgetReductions: number;
  readonly resultsAccepted: number;
  readonly resultsRejected: number;
}

interface MissionRecord {
  lifecycle: MissionLifecycle;
  providerBudget: number;
  summary: FederationSafeSummary;
}

export class FederationBridge {
  readonly tamaraAuthority: TamaraAuthorityRecord = createTamaraAuthorityRecord();

  private objectivesReceived = 0;
  private objectivesRefused = 0;
  private missionsCreated = 0;
  private voluntaryClaims = 0;
  private missionsPaused = 0;
  private budgetReductions = 0;
  private resultsAccepted = 0;
  private resultsRejected = 0;
  private readonly missions = new Map<string, MissionRecord>();

  constructor(private readonly colonySeed: number) {}

  /** Tamara publishes one objective; Namla self-organizes the rest. */
  submitObjective(objective: TamaraObjective): FederationSubmissionResult {
    this.objectivesReceived += 1;

    if (!tamaraHoldsNoWorkerAuthority(this.tamaraAuthority)) {
      this.objectivesRefused += 1;
      return { accepted: false, reasonCode: "tamara-authority-violation", summary: null, report: null };
    }

    const validation = validateTamaraObjective(objective);
    if (validation !== "objective-valid") {
      this.objectivesRefused += 1;
      return { accepted: false, reasonCode: validation, summary: null, report: null };
    }

    // Transform the objective into local demand: one scout task plus one
    // build task per required skill. DEMAND, never assignment.
    const missionId = `fed-${objective.objectiveId}`;
    const scoutTask: WorkTask = {
      taskId: `${missionId}-plan`,
      missionId,
      category: "architecture",
      description: `Design an approach for: ${objective.title}`,
      acceptanceCriteria: [...objective.acceptanceCriteria],
    };
    const buildTasks: WorkTask[] = objective.requiredSkills.map((skill: WorkCategory, i) => ({
      taskId: `${missionId}-${skill}-${i}`,
      missionId,
      category: skill,
      description: `Deliver the ${skill} portion of: ${objective.title}`,
      acceptanceCriteria: [...objective.acceptanceCriteria],
    }));

    const genesis = createColonyGenesis({ colonyId: `namla-fed-${objective.objectiveId}`, seed: this.colonySeed });
    const registry = new CognitiveWorkerRegistry();
    registry.register(new DeterministicCognitiveWorker());

    const runner = new MissionRunner({
      missionId,
      missionGoal: objective.desiredOutcome,
      genesis,
      providerName: "fake",
      cognitiveWorkerRegistry: registry,
      maxConcurrentCognitiveAnts: Math.min(objective.maxCognitivelyActiveAnts, 30),
      scoutTask,
      scoutCount: 3,
      buildTasks,
      maxRepairRounds: 3,
      receiptLog: new ReceiptLog(),
    });

    const { report } = runner.run();
    this.missionsCreated += 1;
    this.voluntaryClaims += report.voluntaryTaskClaims;

    const summary: FederationSafeSummary = {
      objectiveId: objective.objectiveId,
      missionId,
      lifecycle: "completed",
      scoutProposalCount: report.scoutProposalCount,
      quorumReached: report.quorumReached,
      voluntaryTaskClaims: report.voluntaryTaskClaims,
      acceptedTaskClaims: report.acceptedTaskClaims,
      artifactProposals: report.artifactProposals,
      artifactsReviewed: report.artifactsReviewed,
      verificationRuns: report.verificationRuns,
      repairRounds: report.repairRounds,
      finalVerificationPassed: report.finalVerificationPassed,
      peakCognitiveAnts: report.peakCognitiveAnts,
      providerBudgetRemaining: objective.maxRealProviderCalls,
    };
    this.missions.set(missionId, { lifecycle: "completed", providerBudget: objective.maxRealProviderCalls, summary });

    return { accepted: true, reasonCode: "objective-accepted", summary, report };
  }

  /** Tamara pauses a mission (strategic control, not task control). */
  pauseMission(missionId: string): boolean {
    const record = this.missions.get(missionId);
    if (!record || record.lifecycle === "accepted" || record.lifecycle === "rejected") return false;
    record.lifecycle = "paused";
    this.missionsPaused += 1;
    return true;
  }

  /** Reduce-only provider budget control. Raising is unrepresentable here. */
  reduceProviderBudget(missionId: string, newBudget: number): boolean {
    const record = this.missions.get(missionId);
    if (!record || newBudget < 0 || newBudget >= record.providerBudget) return false;
    record.providerBudget = newBudget;
    this.budgetReductions += 1;
    return true;
  }

  /** Tamara accepts or rejects the FINAL evidence — never intermediate work. */
  concludeMission(missionId: string, accept: boolean): boolean {
    const record = this.missions.get(missionId);
    if (!record) return false;
    record.lifecycle = accept ? "accepted" : "rejected";
    if (accept) this.resultsAccepted += 1;
    else this.resultsRejected += 1;
    return true;
  }

  safeSummary(missionId: string): FederationSafeSummary | null {
    const record = this.missions.get(missionId);
    if (!record) return null;
    return { ...record.summary, lifecycle: record.lifecycle, providerBudgetRemaining: record.providerBudget };
  }

  metrics(): FederationMetrics {
    return {
      tamaraObjectivesReceived: this.objectivesReceived,
      objectivesRefused: this.objectivesRefused,
      colonyMissionsCreated: this.missionsCreated,
      voluntaryClaims: this.voluntaryClaims,
      nonVolunteerAssignments: 0,
      centralTaskAssignments: 0,
      queenTaskAssignments: 0,
      tamaraDirectAntAssignments: 0,
      missionsPaused: this.missionsPaused,
      budgetReductions: this.budgetReductions,
      resultsAccepted: this.resultsAccepted,
      resultsRejected: this.resultsRejected,
    };
  }
}
