/**
 * V2 Mission & WorkPackage State Models (§10, §11, §12, §27).
 */

import { PlanContract, TaskSpec, AcceptanceCriterion } from "./contracts";
import { ArtifactIdentity, EvidenceRecord } from "./evidence";

export type MissionStage =
  | "EER"
  | "PLAN"
  | "PROTOCOL"
  | "PRO"
  | "COLONY_AB"
  | "SON"
  | "LEGGO"
  | "PROMAX"
  | "NAMLA_LAB"
  | "DELIVERY";

export type MissionState =
  | "CREATED"
  | "INTERPRETING"
  | "PLANNING"
  | "CONTRACT_FREEZE"
  | "DISPATCHING"
  | "EXECUTING_AB"
  | "COMPARING"
  | "INTEGRATING"
  | "VERIFYING"
  | "PACKAGING"
  | "COMPLETED"
  | "RECOVERING"
  | "REPLANNING"
  | "HUMAN_REQUIRED"
  | "RESUMING"
  | "FAILED"
  | "CANCELLED";

export type WorkPackageExecutionState =
  | "READY"
  | "CLAIMED"
  | "EXECUTING"
  | "VERIFYING"
  | "FAILED_FIXABLE"
  | "FAILED_REWORK"
  | "REWORKING"
  | "PASSED"
  | "INTEGRATING"
  | "DONE"
  | "HUMAN_REQUIRED";

export interface WorkPackage {
  readonly id: string;
  readonly missionId: string;
  readonly contractVersion: string;
  readonly taskSpec: TaskSpec;
  readonly acceptanceCriteria: readonly AcceptanceCriterion[];
  readonly inputArtifacts: readonly ArtifactIdentity[];
  readonly readOnly: boolean;
  readonly maxAttempts: number;
}

export interface WorkPackageExecution {
  readonly executionId: string;
  readonly workPackageId: string;
  readonly colonyId: "COLONY_A" | "COLONY_B";
  readonly state: WorkPackageExecutionState;
  readonly stateVersion: number;
  readonly attempts: number;
  readonly outputArtifacts: readonly ArtifactIdentity[];
  readonly evidenceRefs: readonly string[];
  readonly failureReason?: string;
  readonly workspacePath: string;
}

export interface ComparisonAssessment {
  readonly workPackageId: string;
  readonly agreements: readonly string[];
  readonly disagreements: readonly string[];
  readonly missingCriteria: readonly string[];
  readonly contradictoryAssumptions: readonly string[];
  readonly evidenceGaps: readonly string[];
  readonly correlatedFailureRisk: boolean;
  readonly strengthScores: {
    readonly colonyA: number;
    readonly colonyB: number;
  };
  readonly recommendedAction: "MERGE_BOTH" | "SELECT_A" | "SELECT_B" | "REWORK_AB" | "REPLAN";
}

export interface IntegratedCandidate {
  readonly candidateId: string;
  readonly missionId: string;
  readonly integratedArtifacts: readonly ArtifactIdentity[];
  readonly resolvedConflicts: readonly string[];
  readonly sourceTraceability: Readonly<Record<string, "COLONY_A" | "COLONY_B" | "MERGED">>;
  readonly workspacePath: string;
}

export interface ProMaxAssessment {
  readonly candidateId: string;
  readonly contractSatisfied: boolean;
  readonly verifiedCriteria: readonly string[];
  readonly failedCriteria: readonly string[];
  readonly securityCheckPassed: boolean;
  readonly regressionPassed: boolean;
  readonly independentTestsPassed: boolean;
  readonly evidenceFreshnessVerified: boolean;
}

export interface DeliveryPackage {
  readonly deliveryId: string;
  readonly missionId: string;
  readonly contractVersion: string;
  readonly artifacts: readonly ArtifactIdentity[];
  readonly deliveryManifest: {
    readonly checksums: Readonly<Record<string, string>>;
    readonly stageReceipts: readonly string[];
    readonly evidenceRefs: readonly string[];
  };
  readonly timestamp: number;
  readonly verified: boolean;
}

export interface MissionStateRecord {
  readonly missionId: string;
  readonly currentState: MissionState;
  readonly stateVersion: number;
  readonly currentStage: MissionStage;
  readonly frozenContract?: PlanContract;
  readonly activeWorkPackages: readonly WorkPackage[];
  readonly executions: readonly WorkPackageExecution[];
  readonly checkpointStage?: MissionStage;
  readonly failureCount: number;
  readonly livelockCounter: number;
}
