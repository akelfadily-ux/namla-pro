/**
 * NAMLA PRO V2 Canonical Runtime (§03, §04, §05, §08, §18, P0.5, P0.6, P0.18, FINAL-P0-3).
 *
 * Single orchestration entry point running the canonical V2 pipeline:
 * Objective → EER → LOOP → PLAN → LOOP → PROTOCOL → LOOP → PRO → LOOP →
 * COLONY A ∥ COLONY B → LOOP → SON → LOOP → LEGGO → LOOP → PROMAX → LOOP → NAMLA LAB → LOOP → DELIVERY.
 *
 * Handles multi-WorkPackage DAG scheduling and active recovery loops (FIX, REWORK_AB, REPLAN, FAIL_CLOSED, HUMAN_REQUIRED).
 */

import { TrustedKernel } from "../kernel/trustedKernel";
import { NamlaLoopGate } from "../loop/namlaLoopGate";
import { EerEngine } from "../eer/eerEngine";
import { PlanEngine } from "../plan/planEngine";
import { ProtocolEngine } from "../protocol/protocolEngine";
import { ProDispatcher } from "../pro/proDispatcher";
import { ColonyExecutor, ColonyExecutionResult, ExecutionMode } from "../colony/colonyExecutor";
import { SonAnalyzer } from "../son/sonAnalyzer";
import { LeggoIntegrator } from "../leggo/leggoIntegrator";
import { ProMaxVerifier } from "../promax/proMaxVerifier";
import { LabPackager } from "../lab/labPackager";
import { ProjectFactory, ProjectClass } from "../factory/projectFactory";

import { PreFreezeStageContext, ContractBoundStageContext, RuntimeBudgets } from "../types/stageContext";
import { GateInput, StageRecoveryPolicy, LoopBudget, GateVerdict } from "../types/namlaLoopTypes";
import { EvidenceRecord, ArtifactIdentity, EnvironmentIdentity } from "../types/evidence";
import { DeliveryPackage, MissionState, WorkPackageExecution, IntegratedCandidate } from "../types/missionState";
import { createHash } from "crypto";

export interface RunMissionRequest {
  readonly missionId: string;
  readonly objective: string;
  readonly workspaceRoot: string;
  readonly executionMode: ExecutionMode;
  readonly humanAuthorizationGranted?: boolean;
  readonly projectClass?: ProjectClass;
  readonly simulatedColonyACode?: string;
  readonly simulatedColonyBCode?: string;
  readonly budgets?: Partial<RuntimeBudgets>;
}

export interface RunMissionResponse {
  readonly success: boolean;
  readonly missionId: string;
  readonly executionMode: ExecutionMode;
  readonly finalState: MissionState;
  readonly deliveryPackage?: DeliveryPackage;
  readonly evidenceRecords: readonly EvidenceRecord[];
  readonly receipts: readonly unknown[];
  readonly reasonCode: string;
}

export class NamlaRuntime {
  private readonly eerEngine = new EerEngine();
  private readonly planEngine = new PlanEngine();
  private readonly protocolEngine = new ProtocolEngine();
  private readonly proDispatcher = new ProDispatcher();
  private readonly colonyExecutor = new ColonyExecutor();
  private readonly sonAnalyzer = new SonAnalyzer();
  private readonly leggoIntegrator = new LeggoIntegrator();
  private readonly proMaxVerifier = new ProMaxVerifier();
  private readonly labPackager = new LabPackager();
  private readonly projectFactory = new ProjectFactory();

  public runMission(request: RunMissionRequest): RunMissionResponse {
    const executionMode = request.executionMode;

    const kernel = new TrustedKernel({
      workspaceRoot: request.workspaceRoot,
      humanAuthorizationGranted: request.humanAuthorizationGranted ?? true,
    });

    const loopGate = new NamlaLoopGate();
    let evidencePool: EvidenceRecord[] = [];

    const defaultBudgets: RuntimeBudgets = {
      virtualTicks: request.budgets?.virtualTicks ?? 100,
      providerCalls: request.budgets?.providerCalls ?? 20,
      maxFixAttempts: request.budgets?.maxFixAttempts ?? 3,
    };

    let currentState: MissionState = "CREATED";

    let defaultLoopBudget: LoopBudget = {
      maxTicks: defaultBudgets.virtualTicks,
      remainingTicks: defaultBudgets.virtualTicks,
      maxFixAttempts: defaultBudgets.maxFixAttempts,
      remainingFixAttempts: defaultBudgets.maxFixAttempts,
      maxProviderCalls: defaultBudgets.providerCalls,
      remainingProviderCalls: defaultBudgets.providerCalls,
    };

    const recoveryPolicy: StageRecoveryPolicy = {
      stageId: "pipeline",
      allowedActions: ["FIX", "REWORK_AB", "REPLAN", "FAIL_CLOSED", "HUMAN_REQUIRED"],
      maxRetriesPerStage: 3,
    };

    const envIdentity: EnvironmentIdentity = {
      platform: process.platform,
      nodeVersion: process.version,
      cwd: process.cwd(),
      envFingerprint: createHash("sha256").update(`${process.platform}:${process.version}`).digest("hex"),
    };

    const dummyArtifact: ArtifactIdentity = {
      artifactId: "art-initial",
      path: "objective.txt",
      sha256: createHash("sha256").update(request.objective).digest("hex"),
      sizeBytes: request.objective.length,
      missionId: request.missionId,
    };

    // Always initialize workspace with ProjectFactory templates
    const projectClass = request.projectClass ?? "TYPESCRIPT_LIBRARY";
    const template = this.projectFactory.createProjectTemplate(projectClass, request.missionId);
    for (const f of template.files) {
      kernel.safeWriteWorkspaceFile(f.relativePath, f.content, request.missionId);
    }

    // ------------------------------------------------------------- 1. EER STAGE ---
    currentState = "INTERPRETING";
    const preFreezeContext: PreFreezeStageContext = {
      missionId: request.missionId,
      authoritativeInputs: [request.objective],
      policyVersions: ["v1.0.0"],
      budgets: defaultBudgets,
      evidenceRefs: [],
      missionStateRef: currentState,
      executionMode,
      projectClass,
      contractPhase: "PRE_FREEZE",
    };

    const eerResult = this.eerEngine.evaluateObjective(request.objective, preFreezeContext);
    if (!eerResult.success || !eerResult.eerOutput) {
      if (eerResult.humanRequired) {
        return this.buildResponse(request.missionId, executionMode, "HUMAN_REQUIRED", kernel, evidencePool, eerResult.reasonCode);
      }
      return this.buildResponse(request.missionId, executionMode, "FAILED", kernel, evidencePool, eerResult.reasonCode);
    }

    const eerEv = kernel.emitEvidence("EER", request.missionId, "EER", { eerOutput: eerResult.eerOutput });
    evidencePool.push(eerEv);

    // NAMLA LOOP Gate 1
    const gate1Input: GateInput = {
      missionId: request.missionId,
      stageId: "EER",
      artifactIdentity: dummyArtifact,
      policyVersions: ["v1.0.0"],
      environmentIdentity: envIdentity,
      requiredAttestations: [],
      requiredAssessments: [],
      evidenceRefs: [eerEv.evidenceId],
      budget: defaultLoopBudget,
      phase: "PRE_CONTRACT",
    };

    const verdict1 = loopGate.evaluateGate(gate1Input, evidencePool, recoveryPolicy);
    if (verdict1.status !== "PASS") {
      return this.handleGateFailure(request.missionId, executionMode, verdict1, kernel, evidencePool);
    }

    // ------------------------------------------------------------ 2. PLAN STAGE ---
    currentState = "PLANNING";
    const draftPlan = this.planEngine.generatePlan(eerResult.eerOutput, preFreezeContext);
    const planEv = kernel.emitEvidence("PLAN", request.missionId, "PLAN", { draftId: draftPlan.draftId });
    evidencePool.push(planEv);

    // NAMLA LOOP Gate 2
    const gate2Input: GateInput = {
      missionId: request.missionId,
      stageId: "PLAN",
      artifactIdentity: dummyArtifact,
      policyVersions: ["v1.0.0"],
      environmentIdentity: envIdentity,
      requiredAttestations: [],
      requiredAssessments: [],
      evidenceRefs: [planEv.evidenceId],
      budget: defaultLoopBudget,
      phase: "PRE_CONTRACT",
    };

    const verdict2 = loopGate.evaluateGate(gate2Input, evidencePool, recoveryPolicy);
    if (verdict2.status !== "PASS") {
      return this.handleGateFailure(request.missionId, executionMode, verdict2, kernel, evidencePool);
    }

    // -------------------------------------------------------- 3. PROTOCOL STAGE ---
    currentState = "CONTRACT_FREEZE";
    const protocolResult = this.protocolEngine.freezePlanContract(draftPlan, preFreezeContext);
    if (!protocolResult.success || !protocolResult.frozenContract) {
      return this.buildResponse(request.missionId, executionMode, "FAILED", kernel, evidencePool, protocolResult.reasonCode);
    }

    const frozenContract = protocolResult.frozenContract;
    const protocolEv = kernel.emitEvidence("PROTOCOL", request.missionId, "PROTOCOL", { contractHash: frozenContract.contractHash });
    evidencePool.push(protocolEv);

    // NAMLA LOOP Gate 3
    const gate3Input: GateInput = {
      missionId: request.missionId,
      stageId: "PROTOCOL",
      artifactIdentity: dummyArtifact,
      policyVersions: ["v1.0.0"],
      environmentIdentity: envIdentity,
      requiredAttestations: [],
      requiredAssessments: [],
      evidenceRefs: [protocolEv.evidenceId],
      budget: defaultLoopBudget,
      phase: "CONTRACT_BOUND",
      contractVersion: frozenContract.version,
    };

    const verdict3 = loopGate.evaluateGate(gate3Input, evidencePool, recoveryPolicy);
    if (verdict3.status !== "PASS") {
      return this.handleGateFailure(request.missionId, executionMode, verdict3, kernel, evidencePool);
    }

    const boundContext: ContractBoundStageContext = {
      missionId: request.missionId,
      authoritativeInputs: [request.objective],
      policyVersions: ["v1.0.0"],
      budgets: defaultBudgets,
      evidenceRefs: evidencePool.map((e) => e.evidenceId),
      missionStateRef: currentState,
      executionMode,
      projectClass,
      contractPhase: "CONTRACT_BOUND",
      frozenPlanContract: frozenContract,
    };

    // -------------------------------------------------- 4. PRO & DAG DISPATCH ---
    currentState = "DISPATCHING";
    const allWorkPackages = protocolResult.workPackages;
    let allExecutions: WorkPackageExecution[] = [];
    const integratedCandidates: IntegratedCandidate[] = [];

    // Loop through full WorkPackage DAG until all packages complete or fail
    let schedule = this.proDispatcher.computeSchedule(allWorkPackages, allExecutions);

    while (!schedule.isComplete && schedule.readyPackages.length > 0) {
      for (const targetWp of schedule.readyPackages) {
        const dualExec = this.proDispatcher.createDualExecutions(
          targetWp,
          `workspaces/v2-missions/${request.missionId}`,
          allExecutions
        );

        allExecutions.push(dualExec.executionA, dualExec.executionB);

        const proEv = kernel.emitEvidence("PRO", request.missionId, "PRO", {
          dispatchedWorkPackageId: targetWp.id,
          execA: dualExec.executionA.executionId,
          execB: dualExec.executionB.executionId,
        });
        evidencePool.push(proEv);

        // NAMLA LOOP Gate 4 (PRO)
        const gate4Input: GateInput = {
          missionId: request.missionId,
          stageId: "PRO",
          artifactIdentity: dummyArtifact,
          policyVersions: ["v1.0.0"],
          environmentIdentity: envIdentity,
          requiredAttestations: [],
          requiredAssessments: [],
          evidenceRefs: [proEv.evidenceId],
          budget: defaultLoopBudget,
          phase: "CONTRACT_BOUND",
          contractVersion: frozenContract.version,
        };

        const verdict4 = loopGate.evaluateGate(gate4Input, evidencePool, recoveryPolicy);
        if (verdict4.status !== "PASS") {
          return this.handleGateFailure(request.missionId, executionMode, verdict4, kernel, evidencePool);
        }

        // --------------------------------------------- 5. COLONY A & B STAGE ---
        currentState = "EXECUTING_AB";

        let resA: ColonyExecutionResult = this.colonyExecutor.executeWorkPackage(
          targetWp,
          dualExec.executionA,
          boundContext,
          kernel,
          request.simulatedColonyACode,
          { mode: executionMode }
        );

        let resB: ColonyExecutionResult = this.colonyExecutor.executeWorkPackage(
          targetWp,
          dualExec.executionB,
          boundContext,
          kernel,
          request.simulatedColonyBCode,
          { mode: executionMode }
        );

        evidencePool.push(...resA.evidenceRecords, ...resB.evidenceRecords);

        // NAMLA LOOP Gate 5
        const gate5Input: GateInput = {
          missionId: request.missionId,
          stageId: "COLONY_AB",
          artifactIdentity: resA.outputArtifacts[0] ?? dummyArtifact,
          policyVersions: ["v1.0.0"],
          environmentIdentity: envIdentity,
          requiredAttestations: [],
          requiredAssessments: [],
          evidenceRefs: evidencePool.map((e) => e.evidenceId),
          budget: defaultLoopBudget,
          phase: "CONTRACT_BOUND",
          contractVersion: frozenContract.version,
        };

        let verdict5 = loopGate.evaluateGate(gate5Input, evidencePool, recoveryPolicy);

        // Active Recovery Loop for COLONY_AB failures
        if (verdict5.status !== "PASS") {
          if (verdict5.nextAction === "REWORK_AB") {
            evidencePool = loopGate.invalidateStaleEvidence(evidencePool, verdict5.staleEvidenceRefs);
            const rerunExec = this.proDispatcher.createDualExecutions(
              targetWp,
              `workspaces/v2-missions/${request.missionId}`,
              allExecutions
            );
            allExecutions.push(rerunExec.executionA, rerunExec.executionB);

            resA = this.colonyExecutor.executeWorkPackage(targetWp, rerunExec.executionA, boundContext, kernel, request.simulatedColonyACode, { mode: executionMode });
            resB = this.colonyExecutor.executeWorkPackage(targetWp, rerunExec.executionB, boundContext, kernel, request.simulatedColonyBCode, { mode: executionMode });
            evidencePool.push(...resA.evidenceRecords, ...resB.evidenceRecords);
          } else {
            return this.handleGateFailure(request.missionId, executionMode, verdict5, kernel, evidencePool);
          }
        }

        // ----------------------------------------------------- 6. SON STAGE ---
        currentState = "COMPARING";
        const comparison = this.sonAnalyzer.compareResults(targetWp, resA, resB, boundContext);

        const sonEv = kernel.emitEvidence("SON", request.missionId, "SON", {
          recommendedAction: comparison.recommendedAction,
          agreementsCount: comparison.agreements.length,
          disagreementsCount: comparison.disagreements.length,
        });
        evidencePool.push(sonEv);

        // NAMLA LOOP Gate 6
        const gate6Input: GateInput = {
          missionId: request.missionId,
          stageId: "SON",
          artifactIdentity: resA.outputArtifacts[0] ?? dummyArtifact,
          policyVersions: ["v1.0.0"],
          environmentIdentity: envIdentity,
          requiredAttestations: [],
          requiredAssessments: [],
          evidenceRefs: [sonEv.evidenceId],
          budget: defaultLoopBudget,
          phase: "CONTRACT_BOUND",
          contractVersion: frozenContract.version,
        };

        const verdict6 = loopGate.evaluateGate(gate6Input, evidencePool, recoveryPolicy);
        if (verdict6.status !== "PASS") {
          return this.handleGateFailure(request.missionId, executionMode, verdict6, kernel, evidencePool);
        }

        // --------------------------------------------------- 7. LEGGO STAGE ---
        currentState = "INTEGRATING";
        const previousCandidate = integratedCandidates.length > 0 ? integratedCandidates[integratedCandidates.length - 1] : undefined;
        const leggoRes = this.leggoIntegrator.integrate(targetWp, comparison, resA, resB, boundContext, kernel, previousCandidate);
        if (!leggoRes.success || !leggoRes.integratedCandidate) {
          return this.buildResponse(request.missionId, executionMode, "FAILED", kernel, evidencePool, leggoRes.reasonCode);
        }

        if (leggoRes.evidenceRecord) {
          evidencePool.push(leggoRes.evidenceRecord);
        }

        // NAMLA LOOP Gate 7
        const gate7Input: GateInput = {
          missionId: request.missionId,
          stageId: "LEGGO",
          artifactIdentity: leggoRes.integratedCandidate.integratedArtifacts[0],
          policyVersions: ["v1.0.0"],
          environmentIdentity: envIdentity,
          requiredAttestations: [],
          requiredAssessments: [],
          evidenceRefs: evidencePool.map((e) => e.evidenceId),
          budget: defaultLoopBudget,
          phase: "CONTRACT_BOUND",
          contractVersion: frozenContract.version,
        };

        const verdict7 = loopGate.evaluateGate(gate7Input, evidencePool, recoveryPolicy);
        if (verdict7.status !== "PASS") {
          return this.handleGateFailure(request.missionId, executionMode, verdict7, kernel, evidencePool);
        }

        // Mark execution PASSED and update execution list
        const passA = this.proDispatcher.transitionExecutionState(dualExec.executionA, "PASSED");
        if (passA.success && passA.updatedExecution) {
          allExecutions = allExecutions.map((e) => (e.executionId === passA.updatedExecution!.executionId ? passA.updatedExecution! : e));
        }

        integratedCandidates.push(leggoRes.integratedCandidate);
      }

      schedule = this.proDispatcher.computeSchedule(allWorkPackages, allExecutions);
    }

    if (!schedule.isComplete || integratedCandidates.length === 0) {
      return this.buildResponse(
        request.missionId,
        executionMode,
        "FAILED",
        kernel,
        evidencePool,
        "DAG_INCOMPLETE: Required WorkPackages remained uncompleted"
      );
    }

    const primaryCandidate = integratedCandidates[integratedCandidates.length - 1];

    // -------------------------------------------------------- 8. PROMAX STAGE ---
    currentState = "VERIFYING";
    const proMaxRes = this.proMaxVerifier.verifyCandidate(primaryCandidate, boundContext, kernel, evidencePool);
    if (proMaxRes.evidenceRecord) {
      evidencePool.push(proMaxRes.evidenceRecord);
    }

    if (!proMaxRes.success) {
      return this.buildResponse(request.missionId, executionMode, "FAILED", kernel, evidencePool, proMaxRes.reasonCode);
    }

    // NAMLA LOOP Gate 8
    const gate8Input: GateInput = {
      missionId: request.missionId,
      stageId: "PROMAX",
      artifactIdentity: primaryCandidate.integratedArtifacts[0],
      policyVersions: ["v1.0.0"],
      environmentIdentity: envIdentity,
      requiredAttestations: [],
      requiredAssessments: [],
      evidenceRefs: [proMaxRes.evidenceRecord.evidenceId],
      budget: defaultLoopBudget,
      phase: "CONTRACT_BOUND",
      contractVersion: frozenContract.version,
    };

    const verdict8 = loopGate.evaluateGate(gate8Input, evidencePool, recoveryPolicy);
    if (verdict8.status !== "PASS") {
      return this.handleGateFailure(request.missionId, executionMode, verdict8, kernel, evidencePool);
    }

    // ----------------------------------------------------- 9. NAMLA LAB STAGE ---
    currentState = "PACKAGING";
    const labRes = this.labPackager.packageDeliverables(
      primaryCandidate,
      proMaxRes.assessment,
      boundContext,
      kernel,
      evidencePool
    );

    if (!labRes.success || !labRes.deliveryPackage) {
      return this.buildResponse(request.missionId, executionMode, "FAILED", kernel, evidencePool, labRes.reasonCode);
    }

    if (labRes.evidenceRecord) {
      evidencePool.push(labRes.evidenceRecord);
    }

    // NAMLA LOOP Gate 9
    const gate9Input: GateInput = {
      missionId: request.missionId,
      stageId: "NAMLA_LAB",
      artifactIdentity: primaryCandidate.integratedArtifacts[0],
      policyVersions: ["v1.0.0"],
      environmentIdentity: envIdentity,
      requiredAttestations: [],
      requiredAssessments: [],
      evidenceRefs: [labRes.evidenceRecord!.evidenceId],
      budget: defaultLoopBudget,
      phase: "CONTRACT_BOUND",
      contractVersion: frozenContract.version,
    };

    const verdict9 = loopGate.evaluateGate(gate9Input, evidencePool, recoveryPolicy);
    if (verdict9.status !== "PASS") {
      return this.handleGateFailure(request.missionId, executionMode, verdict9, kernel, evidencePool);
    }

    // ----------------------------------------------------- 10. DELIVERY STAGE ---
    currentState = "COMPLETED";

    return {
      success: true,
      missionId: request.missionId,
      executionMode,
      finalState: currentState,
      deliveryPackage: labRes.deliveryPackage,
      evidenceRecords: evidencePool,
      receipts: kernel.getReceiptLog().list(),
      reasonCode: "DELIVERY_SUCCESSFUL",
    };
  }

  private handleGateFailure(
    missionId: string,
    executionMode: ExecutionMode,
    verdict: GateVerdict,
    kernel: TrustedKernel,
    evidencePool: readonly EvidenceRecord[]
  ): RunMissionResponse {
    let finalState: MissionState = "FAILED";
    if (verdict.nextAction === "HUMAN_REQUIRED") {
      finalState = "HUMAN_REQUIRED";
    }

    return this.buildResponse(
      missionId,
      executionMode,
      finalState,
      kernel,
      evidencePool,
      `GATE_FAILURE_${verdict.nextAction}: ${verdict.reasonCodes.join(",")}`
    );
  }

  private buildResponse(
    missionId: string,
    executionMode: ExecutionMode,
    finalState: MissionState,
    kernel: TrustedKernel,
    evidenceRecords: readonly EvidenceRecord[],
    reasonCode: string
  ): RunMissionResponse {
    return {
      success: finalState === "COMPLETED",
      missionId,
      executionMode,
      finalState,
      evidenceRecords,
      receipts: kernel.getReceiptLog().list(),
      reasonCode,
    };
  }
}
