/**
 * MissionRunner: orchestrates one mission end to end — proposal competition,
 * voluntary claiming, cognitive-budget admission, artifact production,
 * review, verification, and bounded repair. No step here picks a task FOR
 * an ant or a winner FOR a proposal; every choice an ant makes was already
 * submitted voluntarily by that ant (a claim, a proposal, a commitment) —
 * this class sequences and records, exactly like `colonyTickRunner.ts`
 * sequences Colony Genesis's per-tick loop without ever assigning anything
 * itself.
 *
 * `centralTaskAssignments` and `queenTaskAssignments` are literal-zero
 * types on the report this class returns — unrepresentable as nonzero, the
 * same discipline `colonyGenesis.ts` uses for its six authority counters.
 */

import type { AntAgent } from "../colony/antAgent";
import type { ColonyGenesisState } from "../colony/colonyGenesis";
import { CognitiveExecutionBudget } from "./cognitiveExecutionBudget";
import type { CognitiveWorkerRegistry } from "./cognitiveWorkerRegistry";
import { CognitiveWorkerRouter } from "./cognitiveWorkerRouter";
import type { CognitiveProviderName } from "./cognitiveWorkTypes";
import { CommandCenterStateBuilder } from "./commandCenterState";
import type { CommandCenterState } from "./commandCenterState";
import { MissionWorkspace } from "./missionWorkspace";
import { FakeWorkspaceDriver } from "./fakeWorkspaceDriver";
import { generateScoutProposals, runProposalQuorum, selectScouts } from "./proposalCompetition";
import { reviewArtifact } from "./reviewLoop";
import { FakeVerificationRunner } from "./verificationRunner";
import type { VerificationResult } from "./artifactTypes";
import { DEFECT_MARKER } from "./deterministicCognitiveWorker";
import { WORK_CATEGORIES, isEligible, resolveTaskClaims } from "./workDemand";
import type { WorkCategory, WorkTask } from "./workDemand";
import { ReceiptLog } from "../core/receiptLog";
import { SafetyGuard } from "../core/safetyGuard";

export interface MissionRunnerInput {
  readonly missionId: string;
  readonly missionGoal: string;
  readonly genesis: ColonyGenesisState;
  readonly providerName: CognitiveProviderName;
  readonly cognitiveWorkerRegistry: CognitiveWorkerRegistry;
  readonly maxConcurrentCognitiveAnts: number;
  readonly scoutTask: WorkTask;
  readonly scoutCount: number;
  readonly buildTasks: readonly WorkTask[];
  /** Demo-only: after applying this task's artifact, inject a marker defect. */
  readonly injectDefectAfterTaskId?: string;
  readonly maxRepairRounds: number;
  /** Shared with any provider adapters the caller registered, so refusal receipts land in one place. Defaults to a fresh log. */
  readonly receiptLog?: ReceiptLog;
}

export interface MissionRunReport {
  readonly totalPersistentAnts: number;
  readonly queenIdentities: number;
  readonly workerIdentities: number;

  readonly scoutProposalCount: number;
  readonly quorumReached: boolean;
  readonly rejectedProposalCount: number;

  readonly voluntaryTaskClaims: number;
  readonly acceptedTaskClaims: number;
  readonly cognitiveClaims: number;
  readonly cognitiveClaimsAccepted: number;
  readonly cognitiveClaimsRejected: number;
  readonly activeCognitiveAnts: number;
  readonly peakCognitiveAnts: number;

  readonly centralTaskAssignments: 0;
  readonly queenTaskAssignments: 0;

  readonly artifactProposals: number;
  readonly artifactsReviewed: number;
  readonly filesApplied: number;
  readonly verificationRuns: number;
  readonly injectedDefects: number;
  readonly verificationFailures: number;
  readonly repairRounds: number;
  readonly finalVerificationPassed: boolean;
  readonly workspaceBoundaryViolations: number;

  readonly fakeProviderCalls: number;
  readonly realClaudeCalls: 0;
  readonly realCodexCalls: 0;
  readonly realNetworkCalls: 0;

  readonly receiptCount: number;
}

export class MissionRunner {
  private readonly receiptLog: ReceiptLog;
  private readonly safetyGuard = new SafetyGuard();
  private readonly workspace: MissionWorkspace;
  private readonly router: CognitiveWorkerRouter;
  private readonly budget: CognitiveExecutionBudget;
  private readonly state: CommandCenterStateBuilder;
  private readonly verificationRunner = new FakeVerificationRunner();

  private voluntaryClaimCount = 0;
  private acceptedClaimCount = 0;
  private cognitiveClaimCount = 0;
  private artifactCount = 0;
  private reviewedCount = 0;
  private verificationRunCount = 0;
  private verificationFailureCount = 0;
  private repairRoundCount = 0;
  private injectedDefectCount = 0;
  private fakeProviderCallCount = 0;
  private lastVerification: VerificationResult | null = null;

  constructor(private readonly input: MissionRunnerInput) {
    this.receiptLog = input.receiptLog ?? new ReceiptLog();
    const driver = new FakeWorkspaceDriver();
    this.workspace = new MissionWorkspace(input.missionId, driver, this.receiptLog);
    this.router = new CognitiveWorkerRouter(input.cognitiveWorkerRegistry, this.safetyGuard, this.receiptLog);
    this.budget = new CognitiveExecutionBudget(input.maxConcurrentCognitiveAnts);

    const demandByCategory = {} as Record<WorkCategory, number>;
    for (const category of WORK_CATEGORIES) demandByCategory[category] = 0;
    for (const task of [input.scoutTask, ...input.buildTasks]) demandByCategory[task.category] += 1;

    this.state = new CommandCenterStateBuilder(
      input.missionId,
      input.missionGoal,
      {
        total: input.genesis.allPersistentIdentityIds.length,
        queenIdentities: 1,
        workerIdentities: input.genesis.workers.length,
      },
      demandByCategory
    );
  }

  run(): { report: MissionRunReport; commandCenterState: CommandCenterState } {
    this.runProposalCompetition();

    for (const task of this.input.buildTasks) {
      this.runBuildTask(task);
      // Applied per-task (not batched at the end) so a same-task defect
      // injection below reads the artifact's real, just-applied content.
      this.workspace.applyProposed();
      if (task.taskId === this.input.injectDefectAfterTaskId) {
        this.injectDefect(task);
      }
    }

    this.runVerificationAndRepair();

    const outcome = this.lastVerification?.outcome === "passed" ? "success" : "failed";
    this.state.setFinalOutcome(outcome);

    const commandCenterState = this.state.snapshot(this.receiptLog.list());

    const report: MissionRunReport = {
      totalPersistentAnts: this.input.genesis.allPersistentIdentityIds.length,
      queenIdentities: 1,
      workerIdentities: this.input.genesis.workers.length,

      scoutProposalCount: commandCenterState.scoutProposals.length,
      quorumReached: commandCenterState.quorumReached,
      rejectedProposalCount: commandCenterState.rejectedProposalIds.length,

      voluntaryTaskClaims: this.voluntaryClaimCount,
      acceptedTaskClaims: this.acceptedClaimCount,
      cognitiveClaims: this.cognitiveClaimCount,
      cognitiveClaimsAccepted: this.budget.acceptedCount,
      cognitiveClaimsRejected: this.budget.rejectedCount,
      activeCognitiveAnts: this.budget.activeCount,
      peakCognitiveAnts: this.budget.peakActiveCount,

      centralTaskAssignments: 0,
      queenTaskAssignments: 0,

      artifactProposals: this.artifactCount,
      artifactsReviewed: this.reviewedCount,
      filesApplied: this.workspace.appliedCount,
      verificationRuns: this.verificationRunCount,
      injectedDefects: this.injectedDefectCount,
      verificationFailures: this.verificationFailureCount,
      repairRounds: this.repairRoundCount,
      finalVerificationPassed: this.lastVerification?.outcome === "passed",
      workspaceBoundaryViolations: this.workspace.boundaryViolationCount,

      fakeProviderCalls: this.fakeProviderCallCount,
      realClaudeCalls: 0,
      realCodexCalls: 0,
      realNetworkCalls: 0,

      receiptCount: this.receiptLog.list().length,
    };

    return { report, commandCenterState };
  }

  private eligibleWorkers(task: WorkTask): readonly AntAgent[] {
    return this.input.genesis.workers.filter((ant) => isEligible(ant, task));
  }

  private admitCognitive(antIds: readonly string[]): ReadonlySet<string> {
    const claims = antIds.map((antId) => ({ antId, claimScore: this.claimScoreFor(antId) }));
    this.cognitiveClaimCount += claims.length;
    const admitted = this.budget.resolve(claims);
    for (const antId of admitted) this.state.recordCognitiveAdmission(antId, this.budget.activeCount);
    return admitted;
  }

  private claimScoreFor(antId: string): number {
    const ant = this.input.genesis.workers.find((a) => a.antId === antId);
    return ant ? Math.round(ant.reliability * 1000) / 1000 : 0;
  }

  private runProposalCompetition(): void {
    const scoutTask = this.input.scoutTask;
    const scoutCandidates = this.eligibleWorkers(scoutTask);
    const scouts = selectScouts(scoutCandidates.length > 0 ? scoutCandidates : this.input.genesis.workers, this.input.scoutCount);

    const admitted = this.admitCognitive(scouts.map((s) => s.antId));
    const admittedScouts = scouts.filter((s) => admitted.has(s.antId));

    const proposals = generateScoutProposals(admittedScouts, scoutTask, this.router, this.input.providerName);
    this.fakeProviderCallCount += proposals.length;
    for (const scout of admittedScouts) {
      this.state.recordProviderCall({ antId: scout.antId, providerName: this.input.providerName, behavioralRole: "scout", status: "completed" });
      this.budget.release(scout.antId);
    }

    this.state.recordProposals(proposals);

    const assessorPool = this.input.genesis.workers.slice(0, 20);
    const quorumResult = runProposalQuorum(proposals, assessorPool);
    this.state.recordQuorum(quorumResult.winningProposalId, quorumResult.quorumReached, quorumResult.rejectedProposalIds);
  }

  private runBuildTask(task: WorkTask): void {
    const eligible = this.eligibleWorkers(task);
    const { voluntaryClaims, acceptedClaim } = resolveTaskClaims(eligible, task);
    this.voluntaryClaimCount += voluntaryClaims.length;
    this.state.recordClaims(voluntaryClaims);

    if (!acceptedClaim) return;
    this.acceptedClaimCount += 1;
    this.state.recordAcceptedClaim(acceptedClaim);

    const admitted = this.admitCognitive([acceptedClaim.antId]);
    if (!admitted.has(acceptedClaim.antId)) return;

    const builderAnt = this.input.genesis.workers.find((a) => a.antId === acceptedClaim.antId);
    if (!builderAnt) {
      this.budget.release(acceptedClaim.antId);
      return;
    }

    const result = this.router.route({
      requestId: `build-req-${task.taskId}-${builderAnt.antId}`,
      missionId: this.input.missionId,
      taskId: task.taskId,
      antId: builderAnt.antId,
      behavioralRole: "builder",
      taskDescription: task.description,
      relevantContext: `Acceptance criteria: ${task.acceptanceCriteria.join("; ")}`,
      acceptanceCriteria: task.acceptanceCriteria,
      allowedWorkspacePaths: [`workspaces/${this.input.missionId}/${task.taskId}.ts`],
      maxResponseSize: 4000,
      maxAttempts: 1,
      providerName: this.input.providerName,
      safeMetadata: { role: "builder" },
    });
    this.fakeProviderCallCount += 1;
    this.state.recordProviderCall({
      antId: builderAnt.antId,
      providerName: this.input.providerName,
      behavioralRole: "builder",
      status: result.ok ? "completed" : "refused",
    });
    this.budget.release(builderAnt.antId);

    if (!result.ok) return;

    for (const artifact of result.response.artifactProposals) {
      this.artifactCount += 1;
      this.state.recordArtifact(artifact);

      const reviewerCandidates = this.eligibleWorkers({ ...task, category: "review" });
      const reviewer = reviewerCandidates[0] ?? builderAnt;
      const review = reviewArtifact(artifact, task, reviewer.antId);
      this.reviewedCount += 1;
      this.state.recordReview(review);

      if (review.verdict === "adequate") {
        this.workspace.propose({
          targetRelativePath: artifact.targetRelativePath,
          content: artifact.content,
          changeKind: "create",
          antId: builderAnt.antId,
        });
      }
    }
  }

  private injectDefect(task: WorkTask): void {
    const path = `workspaces/${this.input.missionId}/${task.taskId}.ts`;
    const current = this.workspace.read(path);
    if (current === undefined) return;
    this.workspace.propose({
      targetRelativePath: path,
      content: `${current}\n// ${DEFECT_MARKER}\n`,
      changeKind: "modify",
      antId: "demo-defect-injector",
    });
    this.workspace.applyProposed();
    this.injectedDefectCount += 1;
  }

  private runVerificationAndRepair(): void {
    let outcome = this.runOneVerification();

    let round = 0;
    while (outcome.outcome === "failed" && round < this.input.maxRepairRounds) {
      round += 1;
      this.repairRoundCount += 1;
      this.state.recordRepairRound();

      const repairTask: WorkTask = {
        taskId: `repair-${round}`,
        missionId: this.input.missionId,
        category: "repair",
        description: "Repair the artifact verification flagged as defective.",
        acceptanceCriteria: ["Verification must pass after repair."],
      };
      const eligible = this.eligibleWorkers(repairTask);
      const { voluntaryClaims, acceptedClaim } = resolveTaskClaims(
        eligible.length > 0 ? eligible : this.input.genesis.workers,
        repairTask
      );
      this.voluntaryClaimCount += voluntaryClaims.length;
      this.state.recordClaims(voluntaryClaims);
      if (!acceptedClaim) break;
      this.acceptedClaimCount += 1;
      this.state.recordAcceptedClaim(acceptedClaim);

      const admitted = this.admitCognitive([acceptedClaim.antId]);
      if (!admitted.has(acceptedClaim.antId)) break;

      const defectivePath = [...this.workspace.snapshotFiles().entries()].find(([, content]) => content.includes(DEFECT_MARKER));
      if (!defectivePath) {
        this.budget.release(acceptedClaim.antId);
        break;
      }
      const [targetPath, brokenContent] = defectivePath;

      const result = this.router.route({
        requestId: `repair-req-${round}-${acceptedClaim.antId}`,
        missionId: this.input.missionId,
        taskId: repairTask.taskId,
        antId: acceptedClaim.antId,
        behavioralRole: "repair",
        taskDescription: repairTask.description,
        relevantContext: brokenContent,
        acceptanceCriteria: repairTask.acceptanceCriteria,
        allowedWorkspacePaths: [targetPath],
        maxResponseSize: 4000,
        maxAttempts: 1,
        providerName: this.input.providerName,
        safeMetadata: { role: "repair" },
      });
      this.fakeProviderCallCount += 1;
      this.state.recordProviderCall({
        antId: acceptedClaim.antId,
        providerName: this.input.providerName,
        behavioralRole: "repair",
        status: result.ok ? "completed" : "refused",
      });
      this.budget.release(acceptedClaim.antId);

      if (result.ok) {
        for (const artifact of result.response.artifactProposals) {
          this.artifactCount += 1;
          this.state.recordArtifact(artifact);
          this.workspace.propose({
            targetRelativePath: artifact.targetRelativePath,
            content: artifact.content,
            changeKind: "modify",
            antId: acceptedClaim.antId,
          });
        }
        this.workspace.applyProposed();
      }

      outcome = this.runOneVerification();
    }
  }

  private runOneVerification(): VerificationResult {
    const result = this.verificationRunner.run(this.input.missionId, "npx tsc --noEmit", this.workspace.snapshotFiles());
    this.verificationRunCount += 1;
    if (result.outcome === "failed") this.verificationFailureCount += 1;
    this.state.recordVerification(result);
    this.lastVerification = result;
    return result;
  }
}
