/**
 * differentialTruth — the Differential Truth Engine for the twin empire. It
 * resolves important contradictions by EVIDENCE, never by model/colony reputation:
 * it scores each unresolved contradiction's ContradictionEnergy, authorizes a
 * bounded decisive test (validated against strict reason codes), runs it exactly
 * once through an INJECTED test driver (fake in all automated tests), compares the
 * observed evidence, and emits an EvidenceDominanceDecision plus a preserved
 * ResidualUncertainty. The original contradiction is never deleted — it is marked
 * resolved-by-test / partially-resolved / unresolved.
 *
 * No fs, no child_process, no network, no provider calls, no MCP execution.
 */

import type { ColonyEvidenceBundle } from "./twinColonyTypes";
import { fnv1a } from "./twinColonyTypes";
import { validateFrozenBundle } from "./frozenBundleValidator";
import type { UnresolvedContradiction, DecisiveTestProposal } from "./crossExamination";

// --- contradiction energy ----------------------------------------------------

export type EnergyBand = "low" | "medium" | "high" | "critical";

export interface EnergyFactorBreakdown {
  readonly customerImpact: number;
  readonly securityImpact: number;
  readonly evidenceStrengthClaude: number;
  readonly evidenceStrengthCodex: number;
  readonly uncertainty: number;
  readonly reversibility: number;
  readonly costOfBeingWrong: number;
  readonly downstreamBlocking: number;
  readonly missionCriticality: number;
}

export interface ContradictionEnergy {
  readonly contradictionId: string;
  readonly totalEnergy: number;
  readonly energyBand: EnergyBand;
  readonly factorBreakdown: EnergyFactorBreakdown;
  readonly escalationReason: string;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Deterministic energy from impact/uncertainty/reversibility only. Evidence
 * strengths contribute a symmetric "contestedness" term (balanced evidence → more
 * energy); neither colony/provider identity nor reputation adds any advantage.
 */
export function computeContradictionEnergy(contradiction: UnresolvedContradiction, factors: EnergyFactorBreakdown): ContradictionEnergy {
  const f = factors;
  const contestedness = 1 - Math.abs(clamp01(f.evidenceStrengthClaude) - clamp01(f.evidenceStrengthCodex));
  const irreversibility = 1 - clamp01(f.reversibility);
  const total =
    clamp01(f.customerImpact) * 0.2 +
    clamp01(f.securityImpact) * 0.15 +
    clamp01(f.uncertainty) * 0.13 +
    clamp01(f.costOfBeingWrong) * 0.13 +
    clamp01(f.downstreamBlocking) * 0.1 +
    clamp01(f.missionCriticality) * 0.12 +
    irreversibility * 0.09 +
    contestedness * 0.08;
  const totalEnergy = Math.round(total * 1000) / 1000;
  const energyBand: EnergyBand = totalEnergy >= 0.8 ? "critical" : totalEnergy >= 0.6 ? "high" : totalEnergy >= 0.35 ? "medium" : "low";
  const escalationReason = energyBand === "critical" || energyBand === "high" ? "high-impact-contested-contradiction-warrants-a-decisive-test" : "low-energy-contradiction-may-be-disclosed-without-a-test";
  return { contradictionId: contradiction.contradictionId, totalEnergy, energyBand, factorBreakdown: f, escalationReason };
}

// --- decisive test types + driver -------------------------------------------

export type DecisiveTestType =
  | "requirement-coverage-comparison"
  | "reproduction-evidence-comparison"
  | "security-evidence-comparison"
  | "performance-evidence-comparison"
  | "maintainability-evidence-comparison"
  | "test-authenticity-comparison";

export const ALLOWED_TEST_TYPES: readonly DecisiveTestType[] = ["requirement-coverage-comparison", "reproduction-evidence-comparison", "security-evidence-comparison", "performance-evidence-comparison", "maintainability-evidence-comparison", "test-authenticity-comparison"];

export interface DecisiveTestInput {
  readonly testId: string;
  readonly contradictionId: string;
  readonly testType: DecisiveTestType;
  /** Bounded evidence SAMPLES extracted from the FROZEN bundles only (numbers, not content). */
  readonly claudeEvidenceSample: number;
  readonly codexEvidenceSample: number;
  readonly claudeEvidenceRefs: readonly string[];
  readonly codexEvidenceRefs: readonly string[];
  readonly expectedObservation: string;
  readonly boundedCost: number;
  /** A malicious flag the demo can set to prove mutation attempts are refused. */
  readonly attemptsMutation?: boolean;
}

export interface DecisiveTestOutcome {
  readonly observedClaudeEvidence: number;
  readonly observedCodexEvidence: number;
  readonly testPassed: boolean;
  readonly executionReceipt: string;
  readonly boundedCost: number;
  readonly realExecution: false;
}

export interface DecisiveTestDriver {
  readonly isReal: boolean;
  run(input: DecisiveTestInput): DecisiveTestOutcome;
}

/** Deterministic fake driver — observes the passed frozen-evidence samples, runs nothing real. */
export class FakeDecisiveTestDriver implements DecisiveTestDriver {
  readonly isReal = false;
  private runs = 0;
  get runCount(): number {
    return this.runs;
  }
  run(input: DecisiveTestInput): DecisiveTestOutcome {
    this.runs += 1;
    const observedClaudeEvidence = Math.round(clamp01(input.claudeEvidenceSample) * 1000) / 1000;
    const observedCodexEvidence = Math.round(clamp01(input.codexEvidenceSample) * 1000) / 1000;
    return {
      observedClaudeEvidence,
      observedCodexEvidence,
      testPassed: true,
      executionReceipt: `dtx-${fnv1a(`${input.testId}|${observedClaudeEvidence}|${observedCodexEvidence}`)}`,
      boundedCost: Math.min(input.boundedCost, 1),
      realExecution: false,
    };
  }
}

// --- validation --------------------------------------------------------------

export type DecisiveTestValidation = "ok" | "contradiction-not-found" | "proposal-mismatch" | "invalid-evidence-reference" | "unmeasurable-test" | "unbounded-test" | "mutation-attempt" | "unsupported-test-type";

export const MAX_DECISIVE_TEST_COST = 1 as const;

/** Validate a decisive test before it may run. Fails closed with an explicit reason code. */
export function validateDecisiveTest(input: DecisiveTestInput, contradiction: UnresolvedContradiction | undefined, proposal: DecisiveTestProposal | undefined, claude: ColonyEvidenceBundle, codex: ColonyEvidenceBundle): DecisiveTestValidation {
  if (!contradiction) return "contradiction-not-found";
  if (!proposal || proposal.testId !== input.testId || input.contradictionId !== contradiction.contradictionId || proposal.forFindingId !== contradiction.findingId) return "proposal-mismatch";
  if (!ALLOWED_TEST_TYPES.includes(input.testType)) return "unsupported-test-type";
  if (input.attemptsMutation) return "mutation-attempt";
  const frozenRefs = new Set<string>([claude.fingerprint, codex.fingerprint, ...claude.artifactManifest.map((m) => m.fingerprint), ...codex.artifactManifest.map((m) => m.fingerprint)]);
  const allRefsFrozen = [...input.claudeEvidenceRefs, ...input.codexEvidenceRefs].every((r) => frozenRefs.has(r));
  if (input.claudeEvidenceRefs.length === 0 || input.codexEvidenceRefs.length === 0 || !allRefsFrozen) return "invalid-evidence-reference";
  if (input.expectedObservation.trim().length === 0) return "unmeasurable-test";
  if (!(input.boundedCost > 0 && input.boundedCost <= MAX_DECISIVE_TEST_COST)) return "unbounded-test";
  return "ok";
}

// --- evidence comparison + decision -----------------------------------------

export type EvidenceDominance = "CLAUDE_EVIDENCE_DOMINATES" | "CODEX_EVIDENCE_DOMINATES" | "EVIDENCE_EQUIVALENT" | "INCONCLUSIVE";
export type ContradictionStatus = "resolved-by-test" | "partially-resolved" | "unresolved";

export interface TestResultComparison {
  readonly testId: string;
  readonly contradictionId: string;
  readonly observedClaudeEvidence: number;
  readonly observedCodexEvidence: number;
  readonly dominance: EvidenceDominance;
  readonly margin: number;
}

export interface ResidualUncertainty {
  readonly untestedDimensions: readonly string[];
  readonly weakEvidence: readonly string[];
  readonly assumptions: readonly string[];
  readonly conditionsThatCouldReverseDecision: readonly string[];
  readonly additionalTestRecommended: boolean;
  readonly customerDisclosureRequired: boolean;
}

export interface EvidenceDominanceDecision {
  readonly contradictionId: string;
  readonly testId: string;
  readonly evidenceUsed: readonly string[];
  readonly evidenceRejected: readonly string[];
  readonly dominanceReason: string;
  readonly confidence: number;
  readonly residualUncertainty: ResidualUncertainty;
  readonly minorityEvidencePreserved: readonly string[];
  readonly decisionFingerprint: string;
  readonly contradictionStatus: ContradictionStatus;
  /** Structural guarantees — the decision never used reputation. */
  readonly basedOnObservedEvidenceOnly: true;
  readonly usedProviderReputation: false;
}

export interface DecisiveTestExecution {
  readonly input: DecisiveTestInput;
  readonly outcome: DecisiveTestOutcome;
  readonly comparison: TestResultComparison;
}

const EVIDENCE_EPSILON = 0.05;

export function compareEvidence(input: DecisiveTestInput, outcome: DecisiveTestOutcome): TestResultComparison {
  const margin = Math.round((outcome.observedClaudeEvidence - outcome.observedCodexEvidence) * 1000) / 1000;
  let dominance: EvidenceDominance;
  if (!outcome.testPassed) dominance = "INCONCLUSIVE";
  else if (Math.abs(margin) < EVIDENCE_EPSILON) dominance = "EVIDENCE_EQUIVALENT";
  else if (margin > 0) dominance = "CLAUDE_EVIDENCE_DOMINATES";
  else dominance = "CODEX_EVIDENCE_DOMINATES";
  return { testId: input.testId, contradictionId: input.contradictionId, observedClaudeEvidence: outcome.observedClaudeEvidence, observedCodexEvidence: outcome.observedCodexEvidence, dominance, margin };
}

/** Build the evidence-based decision + residual uncertainty (contradiction preserved, only re-marked). */
export function decideDominance(comparison: TestResultComparison, minorityEvidence: readonly string[], untestedDimensions: readonly string[]): EvidenceDominanceDecision {
  const decisive = comparison.dominance === "CLAUDE_EVIDENCE_DOMINATES" || comparison.dominance === "CODEX_EVIDENCE_DOMINATES";
  const contradictionStatus: ContradictionStatus = decisive ? (Math.abs(comparison.margin) >= 0.25 ? "resolved-by-test" : "partially-resolved") : "unresolved";
  const residualUncertainty: ResidualUncertainty = {
    untestedDimensions: untestedDimensions.length > 0 ? untestedDimensions : ["scale-up behavior", "long-term maintenance cost"],
    weakEvidence: [`margin=${comparison.margin} is a single bounded observation`],
    assumptions: ["frozen evidence samples are representative", "one decisive test is sufficient signal"],
    conditionsThatCouldReverseDecision: ["larger requirement set", "adversarial inputs", "different performance budget"],
    additionalTestRecommended: contradictionStatus !== "resolved-by-test",
    customerDisclosureRequired: true,
  };
  const confidence = Math.round(clamp01(0.5 + Math.abs(comparison.margin)) * 1000) / 1000;
  const dominanceReason = decisive ? `observed evidence ${comparison.observedClaudeEvidence} vs ${comparison.observedCodexEvidence} (margin ${comparison.margin})` : `no dominant side (${comparison.dominance})`;
  const decisionFingerprint = fnv1a(`${comparison.contradictionId}|${comparison.testId}|${comparison.dominance}|${comparison.margin}`);
  return {
    contradictionId: comparison.contradictionId,
    testId: comparison.testId,
    evidenceUsed: [`observedClaude=${comparison.observedClaudeEvidence}`, `observedCodex=${comparison.observedCodexEvidence}`],
    evidenceRejected: ["provider-reputation", "colony-size", "majority-vote-alone"],
    dominanceReason,
    confidence,
    residualUncertainty,
    minorityEvidencePreserved: [...minorityEvidence],
    decisionFingerprint,
    contradictionStatus,
    basedOnObservedEvidenceOnly: true,
    usedProviderReputation: false,
  };
}
