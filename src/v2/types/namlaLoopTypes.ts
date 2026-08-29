/**
 * V2 NAMLA LOOP Gate & Recovery Contracts (§05, §06).
 */

import { ArtifactIdentity, EnvironmentIdentity } from "./evidence";

export interface LoopBudget {
  readonly maxTicks: number;
  readonly remainingTicks: number;
  readonly maxFixAttempts: number;
  readonly remainingFixAttempts: number;
  readonly maxProviderCalls: number;
  readonly remainingProviderCalls: number;
}

export interface GateInputBase {
  readonly missionId: string;
  readonly workPackageId?: string;
  readonly workPackageExecutionId?: string;
  readonly stageId: string;
  readonly artifactIdentity: ArtifactIdentity;
  readonly policyVersions: readonly string[];
  readonly environmentIdentity: EnvironmentIdentity;
  readonly requiredAttestations: readonly string[];
  readonly requiredAssessments: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly budget: LoopBudget;
}

export type GateInput =
  | (GateInputBase & {
      readonly phase: "PRE_CONTRACT";
      readonly contractVersion?: never;
    })
  | (GateInputBase & {
      readonly phase: "CONTRACT_BOUND";
      readonly contractVersion: string;
    });

export interface VerdictDetails {
  readonly reasonCodes: readonly string[];
  readonly staleEvidenceRefs: readonly string[];
  readonly missingEvidence: readonly string[];
  readonly failedCriteria: readonly string[];
}

export type GateVerdict =
  | (VerdictDetails & { readonly status: "PASS"; readonly nextAction: "NEXT" })
  | (VerdictDetails & {
      readonly status: "FAIL";
      readonly nextAction: "FIX" | "REWORK_AB" | "REPLAN" | "FAIL_CLOSED" | "HUMAN_REQUIRED";
    })
  | (VerdictDetails & { readonly status: "HUMAN_REQUIRED"; readonly nextAction: "HUMAN_REQUIRED" });

export interface StageRecoveryPolicy {
  readonly stageId: string;
  readonly allowedActions: readonly ("FIX" | "REWORK_AB" | "REPLAN" | "FAIL_CLOSED" | "HUMAN_REQUIRED")[];
  readonly maxRetriesPerStage: number;
}
