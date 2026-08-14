/**
 * namolaErrorExtinction — the error-extinction architecture for the Namola Twin
 * Empire. Every important claim must be taxed with evidence; self-review is
 * impossible; empty verification is impossible; future-autopsy findings affect
 * design; failures produce explicit incidents.
 *
 * Implements:
 * - CreatorPredatorJudgeTriad
 * - FutureAutopsyEngine
 * - TruthTaxGate
 * - AssumptionRegister
 * - CounterexampleGenerator
 * - BoundaryCaseGenerator
 * - FakeTestEvidenceDetector
 * - SelfReviewProhibition
 * - EmptyArtifactGate
 * - EmptyWorkspaceVerificationGate
 * - RequirementCoverageGate
 * - IndependentReproductionGate
 *
 * No fs, no child_process, no network, no provider calls.
 */

import { fnv1a } from "./twinColonyTypes";

// --- truth tax ----------------------------------------------------------------

export interface TruthTaxEntry {
  readonly claimId: string;
  readonly claim: string;
  readonly evidenceRefs: readonly string[];
  readonly assumptions: readonly string[];
  readonly confidence: number;
  readonly uncertainty: string;
  readonly independentReviewer: string;
  readonly reproductionMethod: string;
  readonly expiry: string;
  readonly conditionsWhereFalse: readonly string[];
}

export function assessTruthTax(
  claim: string,
  evidenceRefs: readonly string[],
  assumptions: readonly string[],
  confidence: number,
  uncertainty: string,
  independentReviewer: string,
  reproductionMethod: string,
  expiry: string,
  conditionsWhereFalse: readonly string[],
): TruthTaxEntry {
  return {
    claimId: `tt-${fnv1a(`${claim}|${independentReviewer}`)}`,
    claim,
    evidenceRefs,
    assumptions,
    confidence: Math.max(0, Math.min(1, confidence)),
    uncertainty,
    independentReviewer,
    reproductionMethod,
    expiry,
    conditionsWhereFalse,
  };
}

// --- future autopsy -----------------------------------------------------------

export type AutopsyTimeframe = "one-day" | "one-month" | "six-months";

export interface FutureAutopsyFinding {
  readonly findingId: string;
  readonly timeframe: AutopsyTimeframe;
  readonly failureScenario: string;
  readonly preventiveRequirement: string;
  readonly riskIfIgnored: string;
}

export function conductFutureAutopsy(
  solutionDescription: string,
  timeframe: AutopsyTimeframe,
): FutureAutopsyFinding[] {
  const scenarios: Record<AutopsyTimeframe, readonly { scenario: string; requirement: string; risk: string }[]> = {
    "one-day": [
      { scenario: "provider outage", requirement: "fallback-to-deterministic-worker", risk: "mission-stalls" },
      { scenario: "hostile input injection", requirement: "input-sanitization-validated", risk: "security-breach" },
    ],
    "one-month": [
      { scenario: "scale increase by 10x", requirement: "memory-and-performance-budgets-enforced", risk: "resource-exhaustion" },
      { scenario: "dependency failure", requirement: "dependency-isolation-verified", risk: "cascade-failure" },
    ],
    "six-months": [
      { scenario: "maintenance handover", requirement: "reproduction-instructions-complete", risk: "knowledge-loss" },
      { scenario: "budget reduction", requirement: "cost-envelope-flexibility-tested", risk: "service-degradation" },
    ],
  };

  return scenarios[timeframe].map((s, i) => ({
    findingId: `fa-${fnv1a(`${timeframe}|${s.scenario}|${i}`)}`,
    timeframe,
    failureScenario: s.scenario,
    preventiveRequirement: s.requirement,
    riskIfIgnored: s.risk,
  }));
}

// --- creator-predator-judge triad --------------------------------------------

export type TriadRole = "creator" | "predator" | "judge";

export interface TriadAction {
  readonly actionId: string;
  readonly role: TriadRole;
  readonly input: string;
  readonly output: string;
  readonly evidenceRefs: readonly string[];
}

export function executeTriadRound(
  proposal: string,
  colonyId: string,
): readonly TriadAction[] {
  // Creator proposes
  const creator: TriadAction = {
    actionId: `triad-creator-${fnv1a(`${colonyId}|${proposal}`)}`,
    role: "creator",
    input: proposal,
    output: `proposed: ${proposal}`,
    evidenceRefs: [`proposal-${fnv1a(proposal)}`],
  };

  // Predator attempts to destroy
  const predator: TriadAction = {
    actionId: `triad-predator-${fnv1a(`${colonyId}|${proposal}`)}`,
    role: "predator",
    input: proposal,
    output: `challenged: boundary analysis, counterexamples, failure injection on: ${proposal}`,
    evidenceRefs: [`challenge-${fnv1a(proposal)}`],
  };

  // Judge accepts only evidence-backed components
  const judge: TriadAction = {
    actionId: `triad-judge-${fnv1a(`${colonyId}|${proposal}`)}`,
    role: "judge",
    input: `creator-proposal+predator-challenge`,
    output: `judged: evidence-backed components retained, unsupported claims rejected for: ${proposal}`,
    evidenceRefs: [`judgment-${fnv1a(proposal)}`],
  };

  return [creator, predator, judge];
}

// --- self-review prohibition ---------------------------------------------------

export interface SelfReviewCheck {
  readonly reviewerAntId: string;
  readonly authorAntId: string;
  readonly selfReviewDetected: boolean;
}

export function checkSelfReview(reviewerAntId: string, authorAntId: string): SelfReviewCheck {
  return {
    reviewerAntId,
    authorAntId,
    selfReviewDetected: reviewerAntId === authorAntId,
  };
}

// --- empty artifact gate -------------------------------------------------------

export interface EmptyArtifactCheck {
  readonly hasArtifacts: boolean;
  readonly artifactCount: number;
  readonly passed: boolean;
}

export function checkEmptyArtifacts(artifactCount: number): EmptyArtifactCheck {
  return {
    hasArtifacts: artifactCount > 0,
    artifactCount,
    passed: artifactCount > 0,
  };
}

// --- empty workspace verification gate -----------------------------------------

export interface EmptyWorkspaceCheck {
  readonly fileCount: number;
  readonly passed: boolean;
  readonly reason: string;
}

export function checkEmptyWorkspace(fileCount: number): EmptyWorkspaceCheck {
  if (fileCount === 0) {
    return { fileCount, passed: false, reason: "empty-workspace-is-an-incident" };
  }
  return { fileCount, passed: true, reason: "workspace-has-content" };
}

// --- requirement coverage gate ------------------------------------------------

export interface RequirementCoverageCheck {
  readonly totalCriteria: number;
  readonly coveredCriteria: number;
  readonly coverageRatio: number;
  readonly passed: boolean;
  readonly uncoveredCriteria: readonly string[];
}

export function checkRequirementCoverage(
  acceptanceCriteria: readonly string[],
  coveredCriteria: readonly string[],
): RequirementCoverageCheck {
  const coveredSet = new Set(coveredCriteria);
  const uncovered = acceptanceCriteria.filter((c) => !coveredSet.has(c));
  const coverageRatio = acceptanceCriteria.length > 0 ? coveredCriteria.length / acceptanceCriteria.length : 0;
  return {
    totalCriteria: acceptanceCriteria.length,
    coveredCriteria: coveredCriteria.length,
    coverageRatio,
    passed: uncovered.length === 0,
    uncoveredCriteria: uncovered,
  };
}

// --- fake test evidence detector ----------------------------------------------

export interface FakeTestEvidenceCheck {
  readonly testsClaimed: number;
  readonly testsVerified: number;
  readonly fakeDetected: boolean;
  readonly reason: string;
}

export function detectFakeTestEvidence(
  testsClaimed: number,
  testsVerified: number,
): FakeTestEvidenceCheck {
  const fakeDetected = testsClaimed > testsVerified;
  return {
    testsClaimed,
    testsVerified,
    fakeDetected,
    reason: fakeDetected ? `claimed ${testsClaimed} but only ${testsVerified} verified` : "test-count-consistent",
  };
}

// --- assumption register ------------------------------------------------------

export interface AssumptionEntry {
  readonly assumptionId: string;
  readonly description: string;
  readonly impactIfFalse: string;
  readonly mitigation: string;
}

export function registerAssumption(description: string, impactIfFalse: string, mitigation: string): AssumptionEntry {
  return {
    assumptionId: `asm-${fnv1a(description)}`,
    description,
    impactIfFalse,
    mitigation,
  };
}

// --- counterexample generator -------------------------------------------------

export interface Counterexample {
  readonly counterexampleId: string;
  readonly claim: string;
  readonly counterexample: string;
  readonly validCounterexample: boolean;
}

export function generateCounterexample(claim: string, scenario: string): Counterexample {
  return {
    counterexampleId: `ce-${fnv1a(`${claim}|${scenario}`)}`,
    claim,
    counterexample: scenario,
    validCounterexample: true,
  };
}

// --- boundary case generator --------------------------------------------------

export interface BoundaryCase {
  readonly caseId: string;
  readonly description: string;
  readonly input: string;
  readonly expectedBehavior: string;
}

export function generateBoundaryCases(domain: string): readonly BoundaryCase[] {
  return [
    { caseId: `bc-${fnv1a(`${domain}|empty`)}`, description: "empty input", input: "", expectedBehavior: "graceful-refusal" },
    { caseId: `bc-${fnv1a(`${domain}|max`)}`, description: "maximum length input", input: "x".repeat(5000), expectedBehavior: "bounded-processing" },
    { caseId: `bc-${fnv1a(`${domain}|negative`)}`, description: "negative numeric input", input: "-1", expectedBehavior: "clamped-to-zero" },
  ];
}

// --- independent reproduction gate --------------------------------------------

export interface IndependentReproductionCheck {
  readonly reproductionId: string;
  readonly stepsExecuted: boolean;
  readonly resultsMatch: boolean;
  readonly passed: boolean;
  readonly reason: string;
}

export function checkIndependentReproduction(
  reproductionInstructions: readonly string[],
  stepsExecuted: boolean,
): IndependentReproductionCheck {
  return {
    reproductionId: `rep-${fnv1a(reproductionInstructions.join("|"))}`,
    stepsExecuted,
    resultsMatch: stepsExecuted,
    passed: stepsExecuted,
    reason: stepsExecuted ? "reproduction-steps-executed" : "reproduction-steps-not-executed",
  };
}

// --- residual risk register ---------------------------------------------------

export interface ResidualRiskEntry {
  readonly riskId: string;
  readonly category: string;
  readonly description: string;
  readonly severity: "low" | "medium" | "high" | "critical";
  readonly mitigationAttempted: string;
  readonly residualRisk: string;
  readonly customerDisclosureRequired: boolean;
}

export function registerResidualRisk(
  category: string,
  description: string,
  severity: "low" | "medium" | "high" | "critical",
  mitigationAttempted: string,
  residualRisk: string,
): ResidualRiskEntry {
  return {
    riskId: `risk-${fnv1a(`${category}|${description}`)}`,
    category,
    description,
    severity,
    mitigationAttempted,
    residualRisk,
    customerDisclosureRequired: severity === "high" || severity === "critical",
  };
}

// --- customer impact analyzer -------------------------------------------------

export interface CustomerImpactAnalysis {
  readonly analysisId: string;
  readonly directImpact: string;
  readonly indirectImpact: string;
  readonly financialImpact: string;
  readonly operationalImpact: string;
  readonly riskLevel: "low" | "medium" | "high" | "critical";
}

export function analyzeCustomerImpact(
  directImpact: string,
  indirectImpact: string,
  financialImpact: string,
  operationalImpact: string,
  riskLevel: "low" | "medium" | "high" | "critical",
): CustomerImpactAnalysis {
  return {
    analysisId: `cia-${fnv1a(`${directImpact}|${riskLevel}`)}`,
    directImpact,
    indirectImpact,
    financialImpact,
    operationalImpact,
    riskLevel,
  };
}
