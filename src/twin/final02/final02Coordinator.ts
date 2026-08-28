/**
 * src/twin/final02/final02Coordinator.ts — Pure Orchestrator for FINAL-02.
 *
 * Sequence:
 * validateCourtDecision()
 *   → resolveFrozenArtifacts()
 *   → processConflicts()
 *   → buildExecutionPlan()
 *   → materializeBaseline()
 *   → materializeOperations()
 *   → calculateTreeDigestFromDisk()
 *   → runZeroTrustVerification()
 *   → verifySandboxSecurityReceipts()
 *   → runRegressionSuite()
 *   → optional bounded repair
 *   → determineFinalStatus()
 *
 * Failure anywhere triggers immediate workspace rollback and fail-closed result.
 */

import type { TwinPostColonyPipelineResult, TwinPostColonyPipelineSuccess } from "../twinPostColonyPipeline";
import type { ApprovedMergeComponent } from "../namolaSovereignCourt";
import type { MergeVerificationDriver } from "../mergeForge";
import { CustomerDeliveryComposer } from "../customerDelivery";
import type {
  Final02Result,
  Final02CheckpointEntry,
  Final02ObservabilityMetrics,
  Final02Status,
  SecurityGateStatus,
  FrozenArtifactReceipt,
  BaselineMaterializationReceipt,
  MergeMaterializationReceipt,
  TreeDigestReceipt,
  RollbackReceipt,
  RepairReceipt,
  RegressionReceipt,
} from "./contracts";
import { resolveFrozenArtifact } from "./frozenArtifactResolver";
import { materializeBaseline, TRUSTED_BASELINE_COMMIT } from "./baselineMaterializer";
import { processConflicts } from "./conflictEngine";
import { buildExecutionPlan } from "./executionPlanBuilder";
import { DisposableWorkspaceManager } from "./workspaceManager";
import { materializeOperations } from "./materializer";
import { verifySandboxSecurityReceipts, type TrustedSandboxKeyRegistry } from "./sandboxReceiptVerifier";
import { runZeroTrustVerification } from "./verificationRunner";
import { runRegressionSuite } from "./regressionRunner";
import { executeRepair } from "./repairEngine";
export interface Final02ExecuteInput {
  readonly postColonyResult: TwinPostColonyPipelineResult;
  readonly missionId: string;
  readonly objective: string;
  readonly acceptanceCriteria: readonly string[];
  readonly mergeVerificationDriver?: MergeVerificationDriver | null;
  readonly authorizeMergeRepair?: boolean;
  readonly keyRegistry?: TrustedSandboxKeyRegistry;
}

export function executeFinal02Pipeline(input: Final02ExecuteInput): Final02Result {
  const { postColonyResult, missionId, objective, acceptanceCriteria, authorizeMergeRepair = false } = input;
  const checkpoints: Final02CheckpointEntry[] = [];
  let order = 0;

  const keyRegistry: TrustedSandboxKeyRegistry = input.keyRegistry ?? {
    resolve(_backendId: string, _keyId: string) {
      return null;
    },
  };

  const addCheckpoint = (checkpointId: string, passed: boolean, detail: string) => {
    checkpoints.push(Object.freeze({ checkpointId, passed, order: order++, detail }));
  };

  addCheckpoint("FINAL02_PRE_EXECUTION", true, "initialized FINAL-02 execution runtime");

  // 1. Validate Post-Colony Pipeline Success
  if (postColonyResult.status !== "success") {
    addCheckpoint("FINAL02_PLAN_BUILT", false, `pipeline fail-closed at ${postColonyResult.stage}`);
    const secStatus: SecurityGateStatus = "SECURITY_NOT_RUN";
    const metrics: Final02ObservabilityMetrics = Object.freeze({
      missionId,
      courtDecision: "SAFELY_ABORT",
      approvedComponentCount: 0,
      resolvedComponentCount: 0,
      fingerprintVerifiedCount: 0,
      writtenComponentCount: 0,
      rejectedComponentCount: 0,
      conflictsDetectedCount: 0,
      conflictsAutoResolvedCount: 0,
      mergeVerificationRuns: 0,
      mergeIncidentsCount: 0,
      repairExecuted: false,
      securityGateStatus: secStatus,
      regressionGatePassed: false,
      deliveryReady: false,
      mergePlanned: false,
      workspaceMaterialized: false,
      componentsMaterialized: 0,
      realMergeExecuted: false,
      verificationExecuted: false,
      securityVerified: false,
      regressionVerified: false,
      checkpointCreated: true,
      delivered: false,
    });
    return Object.freeze({
      status: "BLOCKED",
      missionId,
      courtDecision: "SAFELY_ABORT",
      executionPlan: null,
      mergeWorkspacePath: null,
      baselineReceipt: null,
      materializationReceipt: null,
      treeDigestReceipt: null,
      rollbackReceipt: null,
      repairReceipt: null,
      regressionReceipt: null,
      mergeVerificationPassed: false,
      mergeStageOutcomes: [],
      securityGate: { status: secStatus, sandboxVerified: false, networkIsolated: false, credentialProtected: false, pathTraversalProtected: false },
      regressionGate: { passed: false, twinPostColonyPipelineValid: false, witnessIntegrityIntact: false, evidenceVersion: 2 as const },
      checkpoints: Object.freeze(checkpoints),
      metrics,
      deliveryResult: null,
      reasonCode: postColonyResult.reasonCode,
    });
  }

  const successPipeline = postColonyResult as TwinPostColonyPipelineSuccess;
  const courtReceipt = successPipeline.decisionReceipt;
  const decision = courtReceipt.decision;
  const claudeBundle = successPipeline.runResult.claude.bundle;
  const codexBundle = successPipeline.runResult.codex.bundle;

  // 2. Reject-both / Safely-abort decisions -> Fail closed with REJECTED and SECURITY_NOT_RUN
  if (decision === "REJECT_BOTH" || decision === "SAFELY_ABORT") {
    addCheckpoint("FINAL02_PLAN_BUILT", false, `court decision was ${decision}`);
    const secStatus: SecurityGateStatus = "SECURITY_NOT_RUN";
    const witnessIntact = successPipeline.witnessReport.integrityIntact;
    const metrics: Final02ObservabilityMetrics = Object.freeze({
      missionId,
      courtDecision: decision,
      approvedComponentCount: 0,
      resolvedComponentCount: 0,
      fingerprintVerifiedCount: 0,
      writtenComponentCount: 0,
      rejectedComponentCount: courtReceipt.rejectedComponents.length,
      conflictsDetectedCount: 0,
      conflictsAutoResolvedCount: 0,
      mergeVerificationRuns: 0,
      mergeIncidentsCount: 0,
      repairExecuted: false,
      securityGateStatus: secStatus,
      regressionGatePassed: witnessIntact,
      deliveryReady: false,
      mergePlanned: false,
      workspaceMaterialized: false,
      componentsMaterialized: 0,
      realMergeExecuted: false,
      verificationExecuted: false,
      securityVerified: false,
      regressionVerified: witnessIntact,
      checkpointCreated: true,
      delivered: false,
    });
    return Object.freeze({
      status: "REJECTED",
      missionId,
      courtDecision: decision,
      executionPlan: null,
      mergeWorkspacePath: null,
      baselineReceipt: null,
      materializationReceipt: null,
      treeDigestReceipt: null,
      rollbackReceipt: null,
      repairReceipt: null,
      regressionReceipt: null,
      mergeVerificationPassed: false,
      mergeStageOutcomes: [],
      securityGate: { status: secStatus, sandboxVerified: false, networkIsolated: false, credentialProtected: false, pathTraversalProtected: false },
      regressionGate: { passed: witnessIntact, twinPostColonyPipelineValid: true, witnessIntegrityIntact: witnessIntact, evidenceVersion: 2 as const },
      checkpoints: Object.freeze(checkpoints),
      metrics,
      deliveryResult: null,
      reasonCode: courtReceipt.decisionReason,
    });
  }

  // 3. Driver Requirement
  if (!input.mergeVerificationDriver) {
    addCheckpoint("FINAL02_PLAN_BUILT", false, "missing merge verification driver in production entry point");
    const secStatus: SecurityGateStatus = "SECURITY_BLOCKED";
    const metrics: Final02ObservabilityMetrics = Object.freeze({
      missionId,
      courtDecision: decision,
      approvedComponentCount: courtReceipt.approvedComponents.length,
      resolvedComponentCount: 0,
      fingerprintVerifiedCount: 0,
      writtenComponentCount: 0,
      rejectedComponentCount: courtReceipt.rejectedComponents.length,
      conflictsDetectedCount: 0,
      conflictsAutoResolvedCount: 0,
      mergeVerificationRuns: 0,
      mergeIncidentsCount: 0,
      repairExecuted: false,
      securityGateStatus: secStatus,
      regressionGatePassed: false,
      deliveryReady: false,
      mergePlanned: false,
      workspaceMaterialized: false,
      componentsMaterialized: 0,
      realMergeExecuted: false,
      verificationExecuted: false,
      securityVerified: false,
      regressionVerified: false,
      checkpointCreated: true,
      delivered: false,
    });
    return Object.freeze({
      status: "BLOCKED",
      missionId,
      courtDecision: decision,
      executionPlan: null,
      mergeWorkspacePath: null,
      baselineReceipt: null,
      materializationReceipt: null,
      treeDigestReceipt: null,
      rollbackReceipt: null,
      repairReceipt: null,
      regressionReceipt: null,
      mergeVerificationPassed: false,
      mergeStageOutcomes: [],
      securityGate: { status: secStatus, sandboxVerified: false, networkIsolated: false, credentialProtected: false, pathTraversalProtected: false },
      regressionGate: { passed: false, twinPostColonyPipelineValid: true, witnessIntegrityIntact: successPipeline.witnessReport.integrityIntact, evidenceVersion: 2 as const },
      checkpoints: Object.freeze(checkpoints),
      metrics,
      deliveryResult: null,
      reasonCode: "missing-execution-backend",
    });
  }

  const driver = input.mergeVerificationDriver;
  const approvedComponents = courtReceipt.approvedComponents;

  if (approvedComponents.length === 0) {
    addCheckpoint("FINAL02_PLAN_BUILT", false, "no approved components in court decision");
    const secStatus: SecurityGateStatus = "SECURITY_BLOCKED";
    const witnessIntact = successPipeline.witnessReport.integrityIntact;
    const metrics: Final02ObservabilityMetrics = Object.freeze({
      missionId,
      courtDecision: decision,
      approvedComponentCount: 0,
      resolvedComponentCount: 0,
      fingerprintVerifiedCount: 0,
      writtenComponentCount: 0,
      rejectedComponentCount: courtReceipt.rejectedComponents.length,
      conflictsDetectedCount: 0,
      conflictsAutoResolvedCount: 0,
      mergeVerificationRuns: 0,
      mergeIncidentsCount: 0,
      repairExecuted: false,
      securityGateStatus: secStatus,
      regressionGatePassed: witnessIntact,
      deliveryReady: false,
      mergePlanned: false,
      workspaceMaterialized: false,
      componentsMaterialized: 0,
      realMergeExecuted: false,
      verificationExecuted: false,
      securityVerified: false,
      regressionVerified: witnessIntact,
      checkpointCreated: true,
      delivered: false,
    });
    return Object.freeze({
      status: "BLOCKED",
      missionId,
      courtDecision: decision,
      executionPlan: null,
      mergeWorkspacePath: null,
      baselineReceipt: null,
      materializationReceipt: null,
      treeDigestReceipt: null,
      rollbackReceipt: null,
      repairReceipt: null,
      regressionReceipt: null,
      mergeVerificationPassed: false,
      mergeStageOutcomes: [],
      securityGate: { status: secStatus, sandboxVerified: false, networkIsolated: false, credentialProtected: false, pathTraversalProtected: false },
      regressionGate: { passed: witnessIntact, twinPostColonyPipelineValid: true, witnessIntegrityIntact: successPipeline.witnessReport.integrityIntact, evidenceVersion: 2 as const },
      checkpoints: Object.freeze(checkpoints),
      metrics,
      deliveryResult: null,
      reasonCode: "no-approved-components",
    });
  }

  // 4. Resolve Frozen Artifacts
  const provenanceReceipts: FrozenArtifactReceipt[] = [];
  for (const comp of approvedComponents) {
    const res = resolveFrozenArtifact(comp, claudeBundle, codexBundle);
    if (!res.ok) {
      addCheckpoint("FINAL02_PLAN_BUILT", false, `artifact resolution failed: ${res.reasonCode}`);
      const secStatus: SecurityGateStatus = "SECURITY_BLOCKED";
      const metrics: Final02ObservabilityMetrics = Object.freeze({
        missionId,
        courtDecision: decision,
        approvedComponentCount: approvedComponents.length,
        resolvedComponentCount: provenanceReceipts.length,
        fingerprintVerifiedCount: provenanceReceipts.filter((p) => p.verified).length,
        writtenComponentCount: 0,
        rejectedComponentCount: courtReceipt.rejectedComponents.length + 1,
        conflictsDetectedCount: 0,
        conflictsAutoResolvedCount: 0,
        mergeVerificationRuns: 0,
        mergeIncidentsCount: 0,
        repairExecuted: false,
        securityGateStatus: secStatus,
        regressionGatePassed: false,
        deliveryReady: false,
        mergePlanned: false,
        workspaceMaterialized: false,
        componentsMaterialized: 0,
        realMergeExecuted: false,
        verificationExecuted: false,
        securityVerified: false,
        regressionVerified: false,
        checkpointCreated: true,
        delivered: false,
      });
      return Object.freeze({
        status: "BLOCKED",
        missionId,
        courtDecision: decision,
        executionPlan: null,
        mergeWorkspacePath: null,
        baselineReceipt: null,
        materializationReceipt: null,
        treeDigestReceipt: null,
        rollbackReceipt: null,
        repairReceipt: null,
        regressionReceipt: null,
        mergeVerificationPassed: false,
        mergeStageOutcomes: [],
        securityGate: { status: secStatus, sandboxVerified: false, networkIsolated: false, credentialProtected: false, pathTraversalProtected: false },
        regressionGate: { passed: false, twinPostColonyPipelineValid: true, witnessIntegrityIntact: successPipeline.witnessReport.integrityIntact, evidenceVersion: 2 as const },
        checkpoints: Object.freeze(checkpoints),
        metrics,
        deliveryResult: null,
        reasonCode: res.reasonCode,
      });
    }
    provenanceReceipts.push(res.receipt);
  }

  // 5. Conflict Analysis & Resolution (12 Classes)
  const conflictProcessing = processConflicts(provenanceReceipts);
  if (conflictProcessing.hasUnresolvedConflict) {
    const unresolved = conflictProcessing.conflictRecords.filter((c) => !c.resolved);
    addCheckpoint("FINAL02_PLAN_BUILT", false, `unresolved conflicts: ${unresolved.map((c) => c.conflictClass).join(",")}`);
    const secStatus: SecurityGateStatus = "SECURITY_BLOCKED";
    const metrics: Final02ObservabilityMetrics = Object.freeze({
      missionId,
      courtDecision: decision,
      approvedComponentCount: approvedComponents.length,
      resolvedComponentCount: provenanceReceipts.length,
      fingerprintVerifiedCount: provenanceReceipts.filter((p) => p.verified).length,
      writtenComponentCount: 0,
      rejectedComponentCount: courtReceipt.rejectedComponents.length,
      conflictsDetectedCount: conflictProcessing.conflictRecords.length,
      conflictsAutoResolvedCount: conflictProcessing.conflictRecords.filter((c) => c.resolved).length,
      mergeVerificationRuns: 0,
      mergeIncidentsCount: 0,
      repairExecuted: false,
      securityGateStatus: secStatus,
      regressionGatePassed: false,
      deliveryReady: false,
      mergePlanned: true,
      workspaceMaterialized: false,
      componentsMaterialized: 0,
      realMergeExecuted: false,
      verificationExecuted: false,
      securityVerified: false,
      regressionVerified: false,
      checkpointCreated: true,
      delivered: false,
    });
    return Object.freeze({
      status: "BLOCKED",
      missionId,
      courtDecision: decision,
      executionPlan: null,
      mergeWorkspacePath: null,
      baselineReceipt: null,
      materializationReceipt: null,
      treeDigestReceipt: null,
      rollbackReceipt: null,
      repairReceipt: null,
      regressionReceipt: null,
      mergeVerificationPassed: false,
      mergeStageOutcomes: [],
      securityGate: { status: secStatus, sandboxVerified: false, networkIsolated: false, credentialProtected: false, pathTraversalProtected: false },
      regressionGate: { passed: false, twinPostColonyPipelineValid: true, witnessIntegrityIntact: successPipeline.witnessReport.integrityIntact, evidenceVersion: 2 as const },
      checkpoints: Object.freeze(checkpoints),
      metrics,
      deliveryResult: null,
      reasonCode: `unresolved-conflicts:${unresolved.map((c) => c.conflictClass).join(",")}`,
    });
  }

  // 6. Create Workspace & Materialize Baseline
  const workspaceManager = DisposableWorkspaceManager.createFresh(missionId, "exec-101");
  const baseRes = materializeBaseline(missionId, TRUSTED_BASELINE_COMMIT, process.cwd(), workspaceManager.workspaceId);

  if (!baseRes.ok) {
    addCheckpoint("FINAL02_WORKSPACE_CREATED", false, `baseline materialization failed: ${baseRes.reasonCode}`);
    const secStatus: SecurityGateStatus = "SECURITY_BLOCKED";
    const metrics: Final02ObservabilityMetrics = Object.freeze({
      missionId,
      courtDecision: decision,
      approvedComponentCount: approvedComponents.length,
      resolvedComponentCount: provenanceReceipts.length,
      fingerprintVerifiedCount: provenanceReceipts.filter((p) => p.verified).length,
      writtenComponentCount: 0,
      rejectedComponentCount: courtReceipt.rejectedComponents.length,
      conflictsDetectedCount: conflictProcessing.conflictRecords.length,
      conflictsAutoResolvedCount: conflictProcessing.conflictRecords.filter((c) => c.resolved).length,
      mergeVerificationRuns: 0,
      mergeIncidentsCount: 0,
      repairExecuted: false,
      securityGateStatus: secStatus,
      regressionGatePassed: false,
      deliveryReady: false,
      mergePlanned: true,
      workspaceMaterialized: false,
      componentsMaterialized: 0,
      realMergeExecuted: false,
      verificationExecuted: false,
      securityVerified: false,
      regressionVerified: false,
      checkpointCreated: true,
      delivered: false,
    });
    return Object.freeze({
      status: "BLOCKED",
      missionId,
      courtDecision: decision,
      executionPlan: null,
      mergeWorkspacePath: workspaceManager.workspaceId,
      baselineReceipt: null,
      materializationReceipt: null,
      treeDigestReceipt: null,
      rollbackReceipt: null,
      repairReceipt: null,
      regressionReceipt: null,
      mergeVerificationPassed: false,
      mergeStageOutcomes: [],
      securityGate: { status: secStatus, sandboxVerified: false, networkIsolated: false, credentialProtected: false, pathTraversalProtected: false },
      regressionGate: { passed: false, twinPostColonyPipelineValid: true, witnessIntegrityIntact: successPipeline.witnessReport.integrityIntact, evidenceVersion: 2 as const },
      checkpoints: Object.freeze(checkpoints),
      metrics,
      deliveryResult: null,
      reasonCode: baseRes.reasonCode,
    });
  }

  const baselineReceipt = baseRes.receipt;

  const plan = buildExecutionPlan(
    decision,
    approvedComponents,
    courtReceipt.rejectedComponents,
    provenanceReceipts,
    conflictProcessing.conflictRecords,
    missionId,
    baselineReceipt.baselineCommit,
    baselineReceipt.baselineDigest,
    acceptanceCriteria
  );

  addCheckpoint("FINAL02_PLAN_BUILT", true, `built execution plan ${plan.planId}`);
  addCheckpoint("FINAL02_WORKSPACE_CREATED", true, `created workspace ${workspaceManager.workspaceId}`);

  // 7. Materialize Resolved Component Operations
  const matResult = materializeOperations(
    workspaceManager,
    plan.plannedFileOperations,
    provenanceReceipts,
    conflictProcessing.resolvedMap
  );

  if (!matResult.success) {
    const rollbackReceipt = workspaceManager.destroyWorkspace(`materialization-failed:${matResult.reasonCode}`);
    addCheckpoint("FINAL02_COMPONENTS_APPLIED", false, `materialization failed: ${matResult.reasonCode}`);
    const secStatus: SecurityGateStatus = "SECURITY_BLOCKED";
    const metrics: Final02ObservabilityMetrics = Object.freeze({
      missionId,
      courtDecision: decision,
      approvedComponentCount: approvedComponents.length,
      resolvedComponentCount: provenanceReceipts.length,
      fingerprintVerifiedCount: provenanceReceipts.filter((p) => p.verified).length,
      writtenComponentCount: matResult.receipt.writtenCount,
      rejectedComponentCount: courtReceipt.rejectedComponents.length,
      conflictsDetectedCount: conflictProcessing.conflictRecords.length,
      conflictsAutoResolvedCount: conflictProcessing.conflictRecords.filter((c) => c.resolved).length,
      mergeVerificationRuns: 0,
      mergeIncidentsCount: 0,
      repairExecuted: false,
      securityGateStatus: secStatus,
      regressionGatePassed: false,
      deliveryReady: false,
      mergePlanned: true,
      workspaceMaterialized: true,
      componentsMaterialized: matResult.receipt.writtenCount,
      realMergeExecuted: false,
      verificationExecuted: false,
      securityVerified: false,
      regressionVerified: false,
      checkpointCreated: true,
      delivered: false,
    });
    return Object.freeze({
      status: "BLOCKED",
      missionId,
      courtDecision: decision,
      executionPlan: plan,
      mergeWorkspacePath: workspaceManager.workspaceId,
      baselineReceipt,
      materializationReceipt: matResult.receipt,
      treeDigestReceipt: null,
      rollbackReceipt,
      repairReceipt: null,
      regressionReceipt: null,
      mergeVerificationPassed: false,
      mergeStageOutcomes: [],
      securityGate: { status: secStatus, sandboxVerified: false, networkIsolated: false, credentialProtected: false, pathTraversalProtected: false },
      regressionGate: { passed: false, twinPostColonyPipelineValid: true, witnessIntegrityIntact: successPipeline.witnessReport.integrityIntact, evidenceVersion: 2 as const },
      checkpoints: Object.freeze(checkpoints),
      metrics,
      deliveryResult: null,
      reasonCode: matResult.reasonCode,
    });
  }

  addCheckpoint("FINAL02_COMPONENTS_APPLIED", true, `materialized ${matResult.receipt.writtenCount} exact component bytes`);

  // 8. Calculate Merged Tree Digest
  let treeDigestReceipt = workspaceManager.computeTreeDigest();

  // 9. Zero-Trust Verification Run (Run 1)
  const absolutePath = workspaceManager.handle?.absolutePath ?? `/simulated/${workspaceManager.workspaceId}`;

  let vRun = runZeroTrustVerification(
    workspaceManager.workspaceId,
    absolutePath,
    treeDigestReceipt.canonicalTreeDigest,
    driver,
    null
  );
  let mergePassed = vRun.passed;
  let repairReceipt: RepairReceipt | null = null;
  let verificationRunsCount = 1;

  // 10. Bounded Single Authorized Repair Loop
  if (!mergePassed && authorizeMergeRepair) {
    const repairRes = executeRepair({
      workspaceId: workspaceManager.workspaceId,
      diskHandle: workspaceManager.handle,
      filesMap: workspaceManager.fileMap as Map<string, string>,
      incidentId: "mi-repair",
      repairAuthorized: true,
      driver,
      mergedTreeDigest: treeDigestReceipt.canonicalTreeDigest,
    });

    if (!("refused" in repairRes)) {
      repairReceipt = repairRes.repairReceipt;
      vRun = repairRes.verificationReceipt;
      mergePassed = vRun.passed;
      verificationRunsCount += 1;
      treeDigestReceipt = workspaceManager.computeTreeDigest();
    }
  }

  let rollbackReceipt: RollbackReceipt | null = null;
  if (!mergePassed) {
    rollbackReceipt = workspaceManager.destroyWorkspace("verification-stage-failure");
  }

  addCheckpoint("FINAL02_VERIFICATION_PASS", mergePassed, mergePassed ? "all 5 zero-trust verification stages passed" : "verification failed");

  // 11. Security Gate Verification
  const securityReceipts = vRun.stageOutcomes
    .map((o) => o.securityReceipt)
    .filter((r): r is NonNullable<typeof r> => r !== undefined);

  const securityRes = verifySandboxSecurityReceipts(
    securityReceipts,
    workspaceManager.workspaceId,
    absolutePath,
    treeDigestReceipt.canonicalTreeDigest,
    keyRegistry
  );

  let securityStatus: SecurityGateStatus;
  if (!mergePassed) {
    securityStatus = "SECURITY_FAILED";
  } else {
    securityStatus = securityRes.status;
  }

  const securityVerified = securityStatus === "SECURITY_VERIFIED";
  addCheckpoint("FINAL02_SECURITY_PASS", securityVerified, `security status: ${securityStatus}`);

  // 12. Regression Gate Run
  const witnessIntact = successPipeline.witnessReport.integrityIntact;
  const regressionReceipt = runRegressionSuite({
    workspaceId: workspaceManager.workspaceId,
    absoluteWorkspacePath: absolutePath,
    mergedTreeDigest: treeDigestReceipt.canonicalTreeDigest,
    witnessIntegrityIntact: witnessIntact,
    claudeVerified: successPipeline.claudeVerified,
    codexVerified: successPipeline.codexVerified,
    mergeVerificationPassed: mergePassed,
  });

  const regressionPassed = regressionReceipt.passed;
  addCheckpoint("FINAL02_REGRESSION_PASS", regressionPassed, regressionPassed ? "regression suite passed cleanly" : "regression gate failed");

  // 13. Customer Delivery Composition
  const stageResultsRecord: Record<string, boolean> = {
    typecheck: true,
    tests: true,
    build: true,
    "security-review": true,
    "acceptance-verification": true,
  };

  for (const o of vRun.stageOutcomes) {
    stageResultsRecord[o.stage] = o.passed;
  }

  const deliveryComposer = new CustomerDeliveryComposer();
  const deliveryResult = deliveryComposer.compose({
    missionId,
    objective,
    acceptance: acceptanceCriteria,
    namolaReceipt: courtReceipt,
    merge: {
      finalMergePassed: mergePassed,
      provenance: provenanceReceipts.map((p) => ({
        relativePath: p.relativePath,
        sourceColony: p.sourceColony,
        sourceFingerprint: p.fnvFingerprint,
        mergeFingerprint: p.fnvFingerprint,
        requirementsCovered: p.component.requirementsCovered,
      })),
      stageResults: stageResultsRecord as any,
      incidents: mergePassed ? 0 : 1,
      repairRan: repairReceipt?.ran ?? false,
      verificationRuns: verificationRunsCount,
    },
    witnessIntegrity: witnessIntact,
    severeSecurityUnresolved: successPipeline.witnessReport.fakeTestEvidenceDetected > 0,
    unresolvedContamination: successPipeline.witnessReport.fakeTestEvidenceDetected > 0,
    decisiveTestIds: successPipeline.dominanceDecisions.map((d) => d.testId),
    residualUncertainty: successPipeline.residualUncertainty,
    contradictionEnergyBand: successPipeline.witnessReport.fakeTestEvidenceDetected > 0 ? "high" : "low",
    crossExam: {
      attacks: successPipeline.crossExamSummary.attacks,
      rebuttals: successPipeline.crossExamSummary.rebuttals,
      strengths: successPipeline.crossExamSummary.strengthsAcknowledged,
      unresolvedContradictions: successPipeline.crossExamSummary.unresolvedContradictions,
    },
  });

  // STRICT FINAL PRODUCTION ACCEPTANCE INVARIANT (P0-17)
  const baselineValid = baselineReceipt.created && baselineReceipt.materializedEntryCount > 0;
  const completeBaselineMaterialized = baselineValid && baselineReceipt.baselineDigest.length > 0;
  const allOperationsApplied = matResult.success && matResult.receipt.writtenCount === approvedComponents.length;
  const diskTreeDigestComputed = treeDigestReceipt.canonicalTreeDigest.length > 0;
  const verificationBoundToTree = vRun.stageOutcomes.every((o) => o.mergedTreeDigest === treeDigestReceipt.canonicalTreeDigest);

  const realMergeExecuted =
    driver.isReal &&
    baselineValid &&
    completeBaselineMaterialized &&
    allOperationsApplied &&
    diskTreeDigestComputed &&
    verificationBoundToTree;

  const deliveryReady =
    deliveryResult.ok &&
    mergePassed &&
    securityVerified &&
    securityRes.sandboxVerified &&
    realMergeExecuted &&
    regressionPassed;

  addCheckpoint("FINAL02_READY", deliveryReady, deliveryReady ? "FINAL-02 production integration runtime ready" : "delivery gate blocked");

  let finalStatus: Final02Status;
  if (deliveryReady) {
    finalStatus = "READY";
  } else if (!mergePassed || !regressionPassed) {
    finalStatus = "FAILED";
  } else if (!driver.isReal || !securityVerified) {
    finalStatus = "UNVERIFIED";
  } else {
    finalStatus = "FAILED";
  }

  const metrics: Final02ObservabilityMetrics = Object.freeze({
    missionId,
    courtDecision: decision,
    approvedComponentCount: approvedComponents.length,
    resolvedComponentCount: provenanceReceipts.length,
    fingerprintVerifiedCount: provenanceReceipts.filter((p) => p.verified).length,
    writtenComponentCount: matResult.receipt.writtenCount,
    rejectedComponentCount: courtReceipt.rejectedComponents.length,
    conflictsDetectedCount: conflictProcessing.conflictRecords.length,
    conflictsAutoResolvedCount: conflictProcessing.conflictRecords.filter((c) => c.resolved).length,
    mergeVerificationRuns: verificationRunsCount,
    mergeIncidentsCount: mergePassed ? 0 : 1,
    repairExecuted: repairReceipt?.ran ?? false,
    securityGateStatus: securityStatus,
    regressionGatePassed: regressionPassed,
    deliveryReady,
    mergePlanned: true,
    workspaceMaterialized: true,
    componentsMaterialized: matResult.receipt.writtenCount,
    realMergeExecuted,
    verificationExecuted: true,
    securityVerified,
    regressionVerified: regressionPassed,
    checkpointCreated: true,
    delivered: deliveryReady,
  });

  return Object.freeze({
    status: finalStatus,
    missionId,
    courtDecision: decision,
    executionPlan: plan,
    mergeWorkspacePath: workspaceManager.workspaceId,
    baselineReceipt,
    materializationReceipt: matResult.receipt,
    treeDigestReceipt,
    rollbackReceipt,
    repairReceipt,
    regressionReceipt,
    mergeVerificationPassed: mergePassed,
    mergeStageOutcomes: Object.freeze([...vRun.stageOutcomes]),
    securityGate: Object.freeze({
      status: securityStatus,
      sandboxVerified: securityRes.sandboxVerified,
      networkIsolated: securityRes.networkIsolated,
      credentialProtected: securityRes.credentialProtected,
      pathTraversalProtected: securityRes.pathTraversalProtected,
    }),
    regressionGate: Object.freeze({
      passed: regressionPassed,
      twinPostColonyPipelineValid: true,
      witnessIntegrityIntact: witnessIntact,
      evidenceVersion: 2 as const,
    }),
    checkpoints: Object.freeze([...checkpoints]),
    metrics,
    deliveryResult,
    reasonCode: deliveryReady
      ? "final02-execution-runtime-ready"
      : !mergePassed
      ? "merge-verification-failed"
      : !securityVerified
      ? "security-unverified"
      : "delivery-gate-blocked",
  });
}
