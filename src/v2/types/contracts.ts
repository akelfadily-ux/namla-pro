/**
 * V2 PlanContract & Engineering Types (§04, §09).
 */

export type RiskClass = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface AcceptanceCriterion {
  readonly id: string;
  readonly description: string;
  readonly verificationMethod: "TEST" | "INVARIANT" | "INSPECTION" | "SECURITY_CHECK";
  readonly required: boolean;
}

export interface Constraint {
  readonly id: string;
  readonly type: "RESOURCE" | "SECURITY" | "ARCHITECTURAL" | "ENVIRONMENT";
  readonly description: string;
  readonly strict: boolean;
}

export interface TaskSpec {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly targetFiles: readonly string[];
  readonly dependencies: readonly string[];
  readonly capabilityRequirements: readonly string[];
}

export interface Dependency {
  readonly taskId: string;
  readonly dependsOnTaskId: string;
}

export interface CapabilityScope {
  readonly capability: string;
  readonly target: string;
  readonly readOnly: boolean;
}

export interface TestRequirement {
  readonly id: string;
  readonly name: string;
  readonly command: string;
  readonly expectedExitCode: number;
}

export interface SecurityRequirement {
  readonly id: string;
  readonly rule: string;
  readonly failClosed: boolean;
}

export interface ArtifactRequirement {
  readonly path: string;
  readonly description: string;
  readonly optional: boolean;
}

export interface EvidenceRequirement {
  readonly type: string;
  readonly requiredProducer: string;
}

export interface CompletionCondition {
  readonly id: string;
  readonly predicate: string;
}

export interface DraftPlan {
  readonly draftId: string;
  readonly objective: string;
  readonly tasks: readonly TaskSpec[];
  readonly acceptanceCriteria: readonly AcceptanceCriterion[];
  readonly riskClassification: RiskClass;
  readonly estimatedBudgets: {
    readonly maxVirtualTicks: number;
    readonly maxProviderCalls: number;
    readonly maxFixAttempts: number;
  };
}

export interface PlanContract {
  readonly contractId: string;
  readonly version: string;
  readonly contractHash: string;
  readonly objective: string;
  readonly acceptanceCriteria: readonly AcceptanceCriterion[];
  readonly constraints: readonly Constraint[];
  readonly tasks: readonly TaskSpec[];
  readonly dependencies: readonly Dependency[];
  readonly allowedCapabilities: readonly CapabilityScope[];
  readonly requiredTests: readonly TestRequirement[];
  readonly securityRequirements: readonly SecurityRequirement[];
  readonly expectedArtifacts: readonly ArtifactRequirement[];
  readonly evidenceRequirements: readonly EvidenceRequirement[];
  readonly riskClassification: RiskClass;
  readonly completionConditions: readonly CompletionCondition[];
  readonly frozenAt: number;
}
