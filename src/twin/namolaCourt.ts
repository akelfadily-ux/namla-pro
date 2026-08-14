/**
 * namolaCourt — the sovereign evidence-based decision kernel for the twin-empire
 * foundation. Namola receives the two FROZEN bundles + the Silent Witness report
 * and returns exactly one decision: SELECT_CLAUDE, SELECT_CODEX, MERGE, or
 * REJECT_BOTH. The decision is EVIDENCE-based — never provider reputation.
 *
 * Namola never selects a named worker ant, never assigns tasks, never executes
 * MCP, never writes files, never mints permits, and never declares success
 * without evidence. It only evaluates bundles and records a receipt.
 *
 * No fs, no child_process, no network, no wall clock.
 */

import { fnv1a } from "./twinColonyTypes";
import type { ColonyEvidenceBundle, NamolaDecision } from "./twinColonyTypes";
import type { WitnessIntegrityReport } from "./silentWitness";

export interface NamolaAcceptanceContract {
  readonly criteria: readonly string[];
  readonly requireIndependentReview: true;
  readonly requireFrozenBundle: true;
}

export interface BundleEvidenceScore {
  readonly colonyId: string;
  readonly valid: boolean;
  readonly disqualifiers: readonly string[];
  readonly artifactCount: number;
  readonly independentReviews: number;
  readonly score: number;
}

export interface NamolaCourtDecision {
  readonly decision: NamolaDecision;
  readonly reason: string;
  readonly evidenceUsed: readonly string[];
  readonly evidenceRejected: readonly string[];
  readonly claudeScore: BundleEvidenceScore;
  readonly codexScore: BundleEvidenceScore;
  readonly residualRisk: number;
  readonly decisionFingerprint: string;
  /** Literal-0 authority counters — Namola never touches a worker. */
  readonly namolaDirectAntAssignments: 0;
  readonly queenTaskAssignments: 0;
}

/** Score one bundle strictly on independently verifiable evidence (never on which model produced it). */
function scoreBundle(bundle: ColonyEvidenceBundle, contract: NamolaAcceptanceContract): BundleEvidenceScore {
  const disqualifiers: string[] = [];
  if (!bundle.frozen) disqualifiers.push("bundle-not-frozen");
  if (bundle.artifacts.length === 0) disqualifiers.push("no-artifacts");
  const independentReviews = bundle.reviews.filter((r) => !r.selfReview && r.decision === "approve").length;
  if (contract.requireIndependentReview && independentReviews === 0) disqualifiers.push("no-independent-review");
  if (bundle.costReport.realProviderCalls !== 0) disqualifiers.push("unexpected-real-provider-call");
  const valid = disqualifiers.length === 0;
  const acceptanceCovered = new Set(bundle.artifacts.flatMap((a) => a.acceptanceCriteriaCovered)).size;
  const score = valid ? bundle.artifacts.length * 2 + independentReviews * 2 + acceptanceCovered - bundle.riskRegister.length * 0.25 : 0;
  return { colonyId: bundle.colonyId, valid, disqualifiers, artifactCount: bundle.artifacts.length, independentReviews, score: Math.round(score * 1000) / 1000 };
}

/**
 * Render the sovereign decision. Reject-both fails closed on any integrity breach
 * or when neither bundle is valid; merge when both are valid and their artifacts
 * are COMPLEMENTARY (disjoint file plans); otherwise select the stronger evidence.
 */
export function judgeTwinBundles(claude: ColonyEvidenceBundle, codex: ColonyEvidenceBundle, witness: WitnessIntegrityReport, contract: NamolaAcceptanceContract): NamolaCourtDecision {
  const claudeScore = scoreBundle(claude, contract);
  const codexScore = scoreBundle(codex, contract);
  const evidenceUsed: string[] = [`claude:score=${claudeScore.score}`, `codex:score=${codexScore.score}`, `witness:integrity=${witness.integrityIntact}`];
  const evidenceRejected: string[] = [...claudeScore.disqualifiers.map((d) => `claude:${d}`), ...codexScore.disqualifiers.map((d) => `codex:${d}`)];

  let decision: NamolaDecision;
  let reason: string;
  if (!witness.integrityIntact) {
    decision = "REJECT_BOTH";
    reason = "process-integrity-breach";
  } else if (!claudeScore.valid && !codexScore.valid) {
    decision = "REJECT_BOTH";
    reason = "both-bundles-invalid";
  } else if (claudeScore.valid && codexScore.valid) {
    const claudePaths = new Set(claude.artifacts.map((a) => a.relativePath));
    const complementary = codex.artifacts.every((a) => !claudePaths.has(a.relativePath));
    if (complementary) {
      decision = "MERGE";
      reason = "both-valid-and-complementary-components";
    } else if (claudeScore.score >= codexScore.score) {
      decision = "SELECT_CLAUDE";
      reason = "claude-dominates-on-verified-evidence";
    } else {
      decision = "SELECT_CODEX";
      reason = "codex-dominates-on-verified-evidence";
    }
  } else if (claudeScore.valid) {
    decision = "SELECT_CLAUDE";
    reason = "only-claude-bundle-valid";
  } else {
    decision = "SELECT_CODEX";
    reason = "only-codex-bundle-valid";
  }

  const residualRisk = Math.round((claude.riskRegister.length + codex.riskRegister.length) * 0.1 * 1000) / 1000;
  const decisionFingerprint = fnv1a(`${claude.fingerprint}|${codex.fingerprint}|${decision}|${reason}`);
  return { decision, reason, evidenceUsed, evidenceRejected, claudeScore, codexScore, residualRisk, decisionFingerprint, namolaDirectAntAssignments: 0, queenTaskAssignments: 0 };
}
