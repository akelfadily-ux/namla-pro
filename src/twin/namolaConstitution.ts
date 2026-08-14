/**
 * namolaConstitution — the sovereign constitutional core for the Namola Twin
 * Empire. Namola is not merely another provider: she is a policy-bound sovereign
 * decision kernel that may use an approved provider as temporary cognition.
 *
 * Namola responsibilities:
 * - validate customer objectives;
 * - reject impossible or unsafe objectives;
 * - define acceptance criteria;
 * - define budget envelopes;
 * - create two semantically equivalent sealed mission packets;
 * - ensure both colonies receive the same customer requirements;
 * - prevent either colony from seeing the other;
 * - receive frozen evidence bundles;
 * - request decisive tests;
 * - select one solution;
 * - reject both;
 * - authorize evidence-based merging;
 * - generate professional customer explanations.
 *
 * Namola must never:
 * - select named worker ants;
 * - assign workers directly;
 * - bypass voluntary claims;
 * - bypass councils;
 * - bypass human provider authorization;
 * - execute MCP tools;
 * - write project files directly;
 * - mark success without evidence;
 * - alter safety law automatically;
 * - hide uncertainty from the customer.
 *
 * No fs, no child_process, no network, no provider calls, no clock.
 */

import { fnv1a } from "./twinColonyTypes";
import type { ColonyId } from "./twinColonyTypes";
import type { TwinMissionPacket } from "./colonyForge";

// --- objective constitution ---------------------------------------------------

export type ObjectiveVerdict = "accepted" | "rejected-incomplete" | "rejected-unsafe" | "rejected-impossible" | "rejected-over-budget" | "rejected-ambiguous";

export interface NamolaObjectiveConstitution {
  readonly constitutionId: string;
  readonly version: "1.0";
  readonly requiredFields: readonly string[];
  readonly maxAcceptanceCriteria: number;
  readonly maxObjectiveLength: number;
  readonly prohibitedPatterns: readonly string[];
  readonly requiredConfirmationPhrase: string;
}

export const DEFAULT_CONSTITUTION: NamolaObjectiveConstitution = {
  constitutionId: "namola-constitution-v1",
  version: "1.0",
  requiredFields: ["objective", "acceptanceCriteria", "budgetLimit"],
  maxAcceptanceCriteria: 20,
  maxObjectiveLength: 5000,
  prohibitedPatterns: [
    "exec(",
    "eval(",
    "rm -rf",
    "DROP TABLE",
    "password=",
    "api_key=",
    "token=",
    "-----BEGIN",
  ],
  requiredConfirmationPhrase: "human-confirmed",
};

// --- objective validator ------------------------------------------------------

export interface NamolaObjectiveValidatorInput {
  readonly objective: string;
  readonly acceptanceCriteria: readonly string[];
  readonly budgetLimit: number;
  readonly confirmationPhrase: string;
}

export interface ObjectiveValidationResult {
  readonly verdict: ObjectiveVerdict;
  readonly reason: string;
  readonly objectiveId: string;
}

export function validateNamolaObjective(
  input: NamolaObjectiveValidatorInput,
  constitution: NamolaObjectiveConstitution = DEFAULT_CONSTITUTION,
): ObjectiveValidationResult {
  const objectiveId = `obj-${fnv1a(`${input.objective}|${input.acceptanceCriteria.length}`)}`;

  // Check required fields are present and non-empty
  if (!input.objective || input.objective.trim().length === 0) {
    return { verdict: "rejected-incomplete", reason: "objective-is-empty", objectiveId };
  }
  if (input.acceptanceCriteria.length === 0) {
    return { verdict: "rejected-incomplete", reason: "no-acceptance-criteria", objectiveId };
  }
  if (input.budgetLimit <= 0) {
    return { verdict: "rejected-over-budget", reason: "budget-limit-not-positive", objectiveId };
  }

  // Check objective length
  if (input.objective.length > constitution.maxObjectiveLength) {
    return { verdict: "rejected-impossible", reason: "objective-exceeds-max-length", objectiveId };
  }

  // Check acceptance criteria count
  if (input.acceptanceCriteria.length > constitution.maxAcceptanceCriteria) {
    return { verdict: "rejected-over-budget", reason: "too-many-acceptance-criteria", objectiveId };
  }

  // Check prohibited patterns
  const combined = input.objective + " " + input.acceptanceCriteria.join(" ");
  for (const pattern of constitution.prohibitedPatterns) {
    if (combined.includes(pattern)) {
      return { verdict: "rejected-unsafe", reason: `prohibited-pattern-detected:${pattern}`, objectiveId };
    }
  }

  // Check confirmation phrase
  if (input.confirmationPhrase !== constitution.requiredConfirmationPhrase) {
    return { verdict: "rejected-unsafe", reason: "invalid-confirmation-phrase", objectiveId };
  }

  return { verdict: "accepted", reason: "objective-passes-constitutional-validation", objectiveId };
}

// --- budget envelope ----------------------------------------------------------

export interface NamolaBudgetEnvelope {
  readonly envelopeId: string;
  readonly maxProviderCalls: number;
  readonly maxDeepCognitionAnts: number;
  readonly maxConcurrentProviderRequests: number;
  readonly maxClaudeSubscriptionCalls: number;
  readonly maxCodexSubscriptionCalls: number;
  readonly maxLocallyActiveAnts: number;
  readonly maxCrossExaminationRounds: number;
  readonly maxDecisiveTests: number;
  readonly maxMergeComponents: number;
  readonly maxRepairAttempts: number;
}

export const DEFAULT_BUDGET: NamolaBudgetEnvelope = {
  envelopeId: "budget-v1",
  maxProviderCalls: 10,
  maxDeepCognitionAnts: 30,
  maxConcurrentProviderRequests: 10,
  maxClaudeSubscriptionCalls: 1,
  maxCodexSubscriptionCalls: 1,
  maxLocallyActiveAnts: 300,
  maxCrossExaminationRounds: 2,
  maxDecisiveTests: 5,
  maxMergeComponents: 10,
  maxRepairAttempts: 1,
};

// --- acceptance contract ------------------------------------------------------

export interface NamolaAcceptanceContractV2 {
  readonly contractId: string;
  readonly criteria: readonly string[];
  readonly requireIndependentReview: boolean;
  readonly requireFrozenBundle: boolean;
  readonly requireSecurityEvidence: boolean;
  readonly requirePerformanceEvidence: boolean;
  readonly requireReproducibility: boolean;
  readonly requireDecisiveTestOnHighEnergyContradiction: boolean;
}

export function createAcceptanceContract(criteria: readonly string[]): NamolaAcceptanceContractV2 {
  return {
    contractId: `ac-${fnv1a(criteria.join("|"))}`,
    criteria,
    requireIndependentReview: true,
    requireFrozenBundle: true,
    requireSecurityEvidence: true,
    requirePerformanceEvidence: true,
    requireReproducibility: true,
    requireDecisiveTestOnHighEnergyContradiction: true,
  };
}

// --- mission packet creation --------------------------------------------------

export function createSealedMissionPackets(
  objective: string,
  acceptanceCriteria: readonly string[],
  budgetLimit: number,
  missionSeed: number,
): readonly [TwinMissionPacket, TwinMissionPacket] {
  const missionId = `mis-${fnv1a(`${objective}|${missionSeed}`)}`;
  const packet: TwinMissionPacket = { missionId, objective, acceptanceCriteria, seed: missionSeed };
  // Both colonies receive the SAME packet — semantically equivalent, identical content
  return [packet, packet];
}

// --- decision policy ----------------------------------------------------------

export type NamolaFinalDecision =
  | "SELECT_CLAUDE_COLONY"
  | "SELECT_CODEX_COLONY"
  | "REQUEST_DECISIVE_TEST"
  | "MERGE_APPROVED_COMPONENTS"
  | "REJECT_BOTH"
  | "SAFELY_ABORT";

export interface NamolaDecisionPolicy {
  readonly policyId: string;
  readonly hardRejectionConditions: readonly string[];
  readonly selectionConditions: readonly string[];
  readonly mergeConditions: readonly string[];
  readonly rejectBothConditions: readonly string[];
}

export const DEFAULT_DECISION_POLICY: NamolaDecisionPolicy = {
  policyId: "decision-policy-v1",
  hardRejectionConditions: [
    "no-build-artifacts",
    "no-independent-review",
    "no-reproducible-tests",
    "severe-unresolved-security-violation",
    "source-tree-boundary-violation",
    "credential-exposure",
    "evidence-manipulation",
    "unexplained-resource-creation",
    "failed-acceptance-criteria",
    "corrupted-or-contaminated-bundle",
  ],
  selectionConditions: [
    "one-solution-dominates-on-customer-acceptance",
    "evidence-independently-reproducible",
    "residual-risk-within-policy",
    "no-critical-unresolved-contradiction",
  ],
  mergeConditions: [
    "complementary-components-demonstrably-superior",
    "component-boundaries-clear",
    "provenance-retained",
    "merge-can-be-independently-rebuilt-and-tested",
    "integration-risk-bounded",
  ],
  rejectBothConditions: [
    "both-solutions-fail",
    "evidence-insufficient",
    "severe-manipulation",
    "unsafe-uncertainty",
    "customer-objective-impossible-under-current-limits",
  ],
};

// --- uncertainty register -----------------------------------------------------

export interface NamolaUncertaintyEntry {
  readonly uncertaintyId: string;
  readonly category: string;
  readonly description: string;
  readonly impact: "low" | "medium" | "high" | "critical";
  readonly mitigationAttempted: string;
  readonly residualRisk: string;
  readonly customerDisclosureRequired: boolean;
}

export function registerUncertainty(
  category: string,
  description: string,
  impact: "low" | "medium" | "high" | "critical",
  mitigationAttempted: string,
  residualRisk: string,
): NamolaUncertaintyEntry {
  return {
    uncertaintyId: `unc-${fnv1a(`${category}|${description}`)}`,
    category,
    description,
    impact,
    mitigationAttempted,
    residualRisk,
    customerDisclosureRequired: impact === "high" || impact === "critical",
  };
}

// --- customer explanation -----------------------------------------------------

export interface NamolaCustomerExplanation {
  readonly explanationId: string;
  readonly whatWasRequested: string;
  readonly whatWasDelivered: string;
  readonly finalDecision: NamolaFinalDecision;
  readonly decisionReason: string;
  readonly evidenceUsed: readonly string[];
  readonly evidenceRejected: readonly string[];
  readonly unresolvedContradictions: readonly string[];
  readonly residualRisk: readonly string[];
  readonly budgetImpact: string;
  readonly customerAcceptanceMapping: readonly { readonly criterion: string; readonly status: string }[];
  readonly requiredFollowUp: readonly string[];
  readonly decisionFingerprint: string;
}

export function generateCustomerExplanation(
  objective: string,
  decision: NamolaFinalDecision,
  decisionReason: string,
  evidenceUsed: readonly string[],
  evidenceRejected: readonly string[],
  unresolvedContradictions: readonly string[],
  residualRisk: readonly string[],
  budgetImpact: string,
  acceptanceMapping: readonly { readonly criterion: string; readonly status: string }[],
  requiredFollowUp: readonly string[],
): NamolaCustomerExplanation {
  return {
    explanationId: `exp-${fnv1a(`${decision}|${decisionReason}`)}`,
    whatWasRequested: objective,
    whatWasDelivered: decision === "REJECT_BOTH" || decision === "SAFELY_ABORT" ? "no-deliverable" : "solution-from-twin-empire",
    finalDecision: decision,
    decisionReason,
    evidenceUsed,
    evidenceRejected,
    unresolvedContradictions,
    residualRisk,
    budgetImpact,
    customerAcceptanceMapping: acceptanceMapping,
    requiredFollowUp,
    decisionFingerprint: fnv1a(`${decision}|${decisionReason}|${evidenceUsed.length}`),
  };
}

// --- stop conditions ----------------------------------------------------------

export interface NamolaStopCondition {
  readonly conditionId: string;
  readonly trigger: string;
  readonly action: "pause-and-request-human" | "reject-objective" | "abort-run" | "continue";
  readonly reason: string;
}

export function evaluateStopConditions(
  objectiveValid: boolean,
  budgetExceeded: boolean,
  providerFailed: boolean,
  contaminationDetected: boolean,
  humanAuthorizationRequired: boolean,
): readonly NamolaStopCondition[] {
  const conditions: NamolaStopCondition[] = [];
  if (!objectiveValid) conditions.push({ conditionId: "stop-01", trigger: "objective-validation-failed", action: "reject-objective", reason: "customer-objective-fails-constitutional-validation" });
  if (budgetExceeded) conditions.push({ conditionId: "stop-02", trigger: "budget-exceeded", action: "pause-and-request-human", reason: "budget-envelope-exceeded" });
  if (providerFailed) conditions.push({ conditionId: "stop-03", trigger: "provider-failure", action: "pause-and-request-human", reason: "provider-cognitive-service-unavailable" });
  if (contaminationDetected) conditions.push({ conditionId: "stop-04", trigger: "contamination-detected", action: "abort-run", reason: "cross-colony-contamination-breaches-isolation" });
  if (humanAuthorizationRequired) conditions.push({ conditionId: "stop-05", trigger: "human-authorization-required", action: "pause-and-request-human", reason: "real-provider-execution-requires-human-confirmation" });
  return conditions;
}

// --- provider cognition policy ------------------------------------------------

export interface NamolaProviderCognitionPolicy {
  readonly policyId: string;
  readonly allowedProviders: readonly string[];
  readonly maxCognitionSessions: number;
  readonly requireBoundedInput: boolean;
  readonly requireBoundedOutput: boolean;
  readonly requireTimeout: boolean;
  readonly noAutomaticRetry: boolean;
  readonly noCredentialExtraction: boolean;
  readonly noBrowserCookieAccess: boolean;
  readonly noProviderToProviderCalls: boolean;
}

export const DEFAULT_PROVIDER_COGNITION_POLICY: NamolaProviderCognitionPolicy = {
  policyId: "provider-cognition-v1",
  allowedProviders: ["claude-code", "codex", "deepseek-reasoner", "qwen-builder", "local-independent-critic"],
  maxCognitionSessions: 2,
  requireBoundedInput: true,
  requireBoundedOutput: true,
  requireTimeout: true,
  noAutomaticRetry: true,
  noCredentialExtraction: true,
  noBrowserCookieAccess: true,
  noProviderToProviderCalls: true,
};
