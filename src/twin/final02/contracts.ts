/**
 * src/twin/final02/contracts.ts — Immutable production contracts for FINAL-02.
 *
 * Contains types and interfaces for receipts, status models, plans, and metrics.
 * NO filesystem operations, NO subprocesses, NO policy decisions.
 */

import type { ApprovedMergeComponent, NamolaSovereignDecision } from "../namolaSovereignCourt";
import type { ColonyId } from "../twinColonyTypes";
import type { MergeVerificationStage } from "../mergeForge";
import type { CustomerDeliveryResult } from "../customerDelivery";
import type { TwinPostColonyPipelineResult } from "../twinPostColonyPipeline";

export type Final02Status = "READY" | "REJECTED" | "BLOCKED" | "FAILED" | "UNVERIFIED";

export type SecurityGateStatus = "SECURITY_VERIFIED" | "SECURITY_BLOCKED" | "SECURITY_FAILED" | "SECURITY_UNVERIFIED" | "SECURITY_NOT_RUN";

export type FileOperationKind = "ADD" | "MODIFY" | "DELETE" | "RENAME";

export type ApprovedFileOperation =
  | {
      readonly kind: "ADD";
      readonly targetRelativePath: string;
      readonly sourceArtifactSha256: string;
    }
  | {
      readonly kind: "MODIFY";
      readonly targetRelativePath: string;
      readonly expectedBaselineSha256: string;
      readonly sourceArtifactSha256: string;
    }
  | {
      readonly kind: "DELETE";
      readonly targetRelativePath: string;
      readonly expectedBaselineSha256: string;
    }
  | {
      readonly kind: "RENAME";
      readonly sourceRelativePath: string;
      readonly targetRelativePath: string;
      readonly expectedBaselineSha256: string;
    };

export interface PlannedFileOperation {
  readonly operationId: string;
  readonly kind: FileOperationKind;
  readonly sourceRelativePath?: string;
  readonly targetRelativePath: string;
  readonly expectedBaselineSha256?: string;
  readonly sourceColonies: readonly ColonyId[];
  readonly sourceArtifactId: string;
  readonly sourceFingerprint: string;
  readonly sha256Digest: string;
}

export interface OperationExecutionReceipt {
  readonly operationId: string;
  readonly kind: FileOperationKind;
  readonly sourceRelativePath?: string;
  readonly targetRelativePath: string;
  readonly preconditionVerified: boolean;
  readonly executed: boolean;
  readonly beforeSha256: string | null;
  readonly afterSha256: string | null;
}

export type MergeConflictClass =
  | "FILE_ADD_ADD"
  | "FILE_DELETE_MODIFY"
  | "TEXTUAL_CONFLICT"
  | "API_CONTRACT_CONFLICT"
  | "TYPE_CONFLICT"
  | "DEPENDENCY_CONFLICT"
  | "CONFIG_CONFLICT"
  | "TEST_CONFLICT"
  | "DATABASE_SCHEMA_CONFLICT"
  | "SECURITY_POLICY_CONFLICT"
  | "SEMANTIC_CONFLICT"
  | "UNKNOWN_CONFLICT";

export interface MergeConflictRecord {
  readonly conflictId: string;
  readonly relativePath: string;
  readonly conflictClass: MergeConflictClass;
  readonly sourceColonies: readonly ColonyId[];
  readonly autoResolvable: boolean;
  readonly resolved: boolean;
  readonly resolutionStrategy: string | null;
  readonly resultFingerprint: string | null;
  readonly detail: string;
}

export interface FrozenArtifactReceipt {
  readonly component: ApprovedMergeComponent;
  readonly sourceColony: ColonyId;
  readonly sourceArtifactId: string;
  readonly relativePath: string;
  readonly exactContent: string;
  readonly fnvFingerprint: string;
  readonly sha256Digest: string;
  readonly frozenBundleVersion: 2;
  readonly verified: boolean;
}

export interface BaselineMaterializationReceipt {
  readonly baselineCommit: string;
  readonly workspaceId: string;
  readonly absolutePath: string;
  readonly gitTreeEntryCount: number;
  readonly materializedEntryCount: number;
  readonly modeVerifiedCount: number;
  readonly baselineDigest: string;
  readonly durationMs: number;
  readonly created: boolean;
}

export interface MergeMaterializationReceipt {
  readonly workspaceId: string;
  readonly approvedCount: number;
  readonly resolvedCount: number;
  readonly fingerprintVerifiedCount: number;
  readonly writtenCount: number;
  readonly plannedOperationsCount: number;
  readonly operationsExecutedCount: number;
  readonly operationReceipts: readonly OperationExecutionReceipt[];
  readonly success: boolean;
}

export interface TreeDigestReceipt {
  readonly workspaceId: string;
  readonly fileCount: number;
  readonly canonicalTreeDigest: string;
}

export interface SandboxSecurityReceipt {
  readonly backendId: string;
  readonly keyId: string;
  readonly backendVerificationId: string;
  readonly executionId: string;
  readonly workspaceId: string;
  readonly absoluteWorkspacePath: string;
  readonly mergedTreeDigest: string;
  readonly signature: string;
  readonly realProcessExecution: boolean;
  readonly sandboxVerified: boolean;
  readonly networkIsolated: boolean;
  readonly credentialsProtected: boolean;
  readonly dockerSocketProtected: boolean;
  readonly mountPolicyVerified: boolean;
  readonly sourceMountReadOnly: boolean;
  readonly pathTraversalProtected: boolean;
  readonly symlinkEscapeProtected: boolean;
  readonly resourceLimitsVerified: boolean;
  readonly timeoutEnforced: boolean;
  readonly cleanupVerified: boolean;
}

export interface MergeVerificationOutcome {
  readonly stage: MergeVerificationStage;
  readonly passed: boolean;
  readonly realExecution: boolean;
  readonly workspaceId?: string;
  readonly absolutePathIdentity?: string;
  readonly baselineDigest?: string;
  readonly mergedTreeDigest?: string;
  readonly stdoutDigest?: string;
  readonly stderrDigest?: string;
  readonly durationMs?: number;
  readonly securityReceipt?: SandboxSecurityReceipt;
}

export interface VerificationReceipt {
  readonly fromZero: true;
  readonly workspaceId: string;
  readonly mergedTreeDigest: string;
  readonly stageOutcomes: readonly MergeVerificationOutcome[];
  readonly passed: boolean;
}

export interface CommandExecutionReceipt {
  readonly commandId: string;
  readonly executable: string;
  readonly argv: readonly string[];
  readonly workspaceId: string;
  readonly absoluteWorkspacePath: string;
  readonly mergedTreeDigest: string;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly timedOut: boolean;
  readonly stdoutSha256: string;
  readonly stderrSha256: string;
  readonly passed: boolean;
}

export interface RegressionReceipt {
  readonly ran: boolean;
  readonly suiteName: string;
  readonly workspaceId: string;
  readonly absoluteWorkspacePath: string;
  readonly mergedTreeDigest: string;
  readonly passed: boolean;
  readonly commandReceipts: readonly CommandExecutionReceipt[];
  readonly totalTests: number | null;
  readonly passedTests: number | null;
  readonly failedTests: number | null;
  readonly witnessIntegrityIntact: boolean;
}

export interface RepairReceipt {
  readonly repairId: string;
  readonly authorized: boolean;
  readonly ran: boolean;
  readonly resolvedIncidentId: string | null;
  readonly realExecution: boolean;
  readonly filesModified: readonly string[];
  readonly beforeFingerprints: readonly string[];
  readonly afterFingerprints: readonly string[];
}

export interface RollbackReceipt {
  readonly requested: boolean;
  readonly workspaceInvalidated: boolean;
  readonly diskWorkspaceRemoved: boolean;
  readonly removalVerified: boolean;
  readonly reason: string;
}

export interface Final02ExecutionPlan {
  readonly planId: string;
  readonly decision: NamolaSovereignDecision;
  readonly selectedApprovedComponents: readonly ApprovedMergeComponent[];
  readonly rejectedComponents: readonly string[];
  readonly componentProvenance: readonly FrozenArtifactReceipt[];
  readonly plannedFileOperations: readonly PlannedFileOperation[];
  readonly expectedFilesystemOperations: readonly string[];
  readonly targetPaths: readonly string[];
  readonly baselineCommit: string;
  readonly baselineDigest: string;
  readonly expectedOutputFingerprintStrategy: string;
  readonly conflictRecords: readonly MergeConflictRecord[];
  readonly securityRequirements: readonly string[];
  readonly verificationStages: readonly MergeVerificationStage[];
  readonly acceptanceCriteriaMapping: readonly string[];
  readonly rollbackProcedure: {
    readonly strategy: "discard-merge-workspace";
    readonly cleanupTarget: string;
    readonly executedOnFailure: boolean;
  };
  readonly mandatoryGatePolicy: {
    readonly requireRealDriver: true;
    readonly requireSandboxVerification: true;
    readonly failClosedOnUnresolvedConflict: true;
  };
}

export interface Final02ObservabilityMetrics {
  readonly missionId: string;
  readonly courtDecision: NamolaSovereignDecision;
  readonly approvedComponentCount: number;
  readonly resolvedComponentCount: number;
  readonly fingerprintVerifiedCount: number;
  readonly writtenComponentCount: number;
  readonly rejectedComponentCount: number;
  readonly conflictsDetectedCount: number;
  readonly conflictsAutoResolvedCount: number;
  readonly mergeVerificationRuns: number;
  readonly mergeIncidentsCount: number;
  readonly repairExecuted: boolean;
  readonly securityGateStatus: SecurityGateStatus;
  readonly regressionGatePassed: boolean;
  readonly deliveryReady: boolean;

  readonly mergePlanned: boolean;
  readonly workspaceMaterialized: boolean;
  readonly componentsMaterialized: number;
  readonly realMergeExecuted: boolean;
  readonly verificationExecuted: boolean;
  readonly securityVerified: boolean;
  readonly regressionVerified: boolean;
  readonly checkpointCreated: boolean;
  readonly delivered: boolean;
}

export interface Final02CheckpointEntry {
  readonly checkpointId: string;
  readonly passed: boolean;
  readonly order: number;
  readonly detail: string;
}

export interface Final02Result {
  readonly status: Final02Status;
  readonly missionId: string;
  readonly courtDecision: NamolaSovereignDecision;
  readonly executionPlan: Final02ExecutionPlan | null;
  readonly mergeWorkspacePath: string | null;
  readonly baselineReceipt: BaselineMaterializationReceipt | null;
  readonly materializationReceipt: MergeMaterializationReceipt | null;
  readonly treeDigestReceipt: TreeDigestReceipt | null;
  readonly rollbackReceipt: RollbackReceipt | null;
  readonly repairReceipt: RepairReceipt | null;
  readonly regressionReceipt: RegressionReceipt | null;
  readonly mergeVerificationPassed: boolean;
  readonly mergeStageOutcomes: readonly MergeVerificationOutcome[];
  readonly securityGate: {
    readonly status: SecurityGateStatus;
    readonly sandboxVerified: boolean;
    readonly networkIsolated: boolean;
    readonly credentialProtected: boolean;
    readonly pathTraversalProtected: boolean;
  };
  readonly regressionGate: {
    readonly passed: boolean;
    readonly twinPostColonyPipelineValid: boolean;
    readonly witnessIntegrityIntact: boolean;
    readonly evidenceVersion: 2;
  };
  readonly checkpoints: readonly Final02CheckpointEntry[];
  readonly metrics: Final02ObservabilityMetrics;
  readonly deliveryResult: CustomerDeliveryResult | null;
  readonly reasonCode: string;
}

export interface Final02RuntimeInput {
  readonly postColonyResult: TwinPostColonyPipelineResult;
  readonly missionId: string;
  readonly objective: string;
  readonly acceptanceCriteria: readonly string[];
  readonly mergeVerificationDriver?: any | null;
  readonly authorizeMergeRepair?: boolean;
}
