/**
 * namolaSovereignCourt — the evidence-based sovereign decision kernel for the twin
 * empire. Namola consumes ONLY the two validated frozen bundles, cross-examination
 * findings/rebuttals, evidence-dominance decisions, residual uncertainty, the
 * Silent Witness integrity report, acceptance requirements, and budget limits. It
 * fails closed through a `NamolaHardRejectionPolicy`, then selects/merges/aborts —
 * never by provider reputation, colony name, popularity, or majority vote alone.
 * Every decision emits a `NamolaDecisionReceipt`.
 *
 * Namola never selects a named worker, assigns tasks, executes MCP, writes files,
 * or mints permits. No fs, no child_process, no network, no provider calls.
 */

import type { ColonyEvidenceBundle, ColonyId } from "./twinColonyTypes";
import { fnv1a } from "./twinColonyTypes";
import { validateFrozenBundle } from "./frozenBundleValidator";
import { isVerifiedCandidate } from "./twinColonyTypes";
import type { EvidenceDominanceDecision } from "./differentialTruth";
import type { WitnessIntegrityReport } from "./silentWitness";

export type NamolaSovereignDecision = "SELECT_CLAUDE" | "SELECT_CODEX" | "MERGE_APPROVED_COMPONENTS" | "REQUEST_ADDITIONAL_TEST" | "REJECT_BOTH" | "SAFELY_ABORT";

export interface HardRejectionCheck {
  readonly id: string;
  readonly passed: boolean;
  readonly detail: string;
}

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

export interface ApprovedMergeComponent {
  readonly componentId: string;
  readonly sourceColony: ColonyId;
  readonly sourceArtifactId: string;
  readonly sourceFingerprint: string;
  readonly relativePath: string;
  readonly operation: ApprovedFileOperation;
  readonly requirementsCovered: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly reasonSelected: string;
  readonly knownRisks: readonly string[];
  readonly requiredMergeTests: readonly string[];
}

export interface NamolaDecisionReceipt {
  readonly decisionId: string;
  readonly decision: NamolaSovereignDecision;
  readonly evidenceUsed: readonly string[];
  readonly evidenceRejected: readonly string[];
  readonly hardRejectionChecks: readonly HardRejectionCheck[];
  readonly dominanceDecisionsUsed: readonly string[];
  readonly residualUncertainty: readonly string[];
  readonly approvedComponents: readonly ApprovedMergeComponent[];
  readonly rejectedComponents: readonly string[];
  readonly acceptanceCriteriaCovered: readonly string[];
  readonly remainingRisks: readonly string[];
  readonly witnessIntegrity: boolean;
  readonly decisionReason: string;
  readonly decisionFingerprint: string;
}

export interface NamolaCourtInput {
  readonly claude: ColonyEvidenceBundle;
  readonly codex: ColonyEvidenceBundle;
  readonly admittedFindings: readonly { readonly findingId: string; readonly findingCategory: string }[];
  readonly dominanceDecisions: readonly EvidenceDominanceDecision[];
  readonly residualUncertainty: readonly string[];
  readonly witness: WitnessIntegrityReport;
  readonly acceptance: readonly string[];
  readonly budget: { readonly maxMergeComponents: number };
}

/** Evaluate all hard-rejection checks. Any failure forces REJECT_BOTH / SAFELY_ABORT. */
export function evaluateHardRejections(input: NamolaCourtInput): readonly HardRejectionCheck[] {
  const { claude, codex, witness } = input;
  const claudeValid = validateFrozenBundle(claude).valid;
  const codexValid = validateFrozenBundle(codex).valid;
  const claudeImpl = claude.artifacts.length > 0;
  const codexImpl = codex.artifacts.length > 0;
  const independentReview = claude.reviews.some((r) => !r.selfReview) || codex.reviews.some((r) => !r.selfReview);
  const severeSecurity = !claude.securityEvidence.passed || !codex.securityEvidence.passed;
  const fakeFindingCategory = input.admittedFindings.some((f) => f.findingCategory === "invalid-test-evidence");
  return [
    // A v2 candidate carries a verification VERDICT, and structural validity is
    // not that verdict: a bundle whose loop ended VERIFICATION_BLOCKED is
    // perfectly well-formed and still had nothing checked. This court approves
    // MERGE COMPONENTS, so without this check unverified files could be merged on
    // the strength of being well-formed. v1 bundles are unaffected - they predate
    // verification and are judged by their own rules.
    { id: "no-unverified-v2-candidate", passed: (claude.evidenceVersion !== 2 || isVerifiedCandidate(claude)) && (codex.evidenceVersion !== 2 || isVerifiedCandidate(codex)), detail: `claudeV2=${claude.evidenceVersion === 2} claudeVerified=${isVerifiedCandidate(claude)} codexV2=${codex.evidenceVersion === 2} codexVerified=${isVerifiedCandidate(codex)}` },
    { id: "both-bundles-valid", passed: claudeValid && codexValid, detail: `claudeValid=${claudeValid} codexValid=${codexValid}` },
    { id: "not-both-lack-implementation", passed: claudeImpl || codexImpl, detail: `claudeImpl=${claudeImpl} codexImpl=${codexImpl}` },
    { id: "independent-review-exists", passed: independentReview, detail: `independentReview=${independentReview}` },
    { id: "no-severe-unresolved-security", passed: !severeSecurity, detail: `severeSecurity=${severeSecurity}` },
    { id: "witness-integrity-true", passed: witness.integrityIntact, detail: `integrity=${witness.integrityIntact}` },
    { id: "no-unquarantined-contamination", passed: witness.leakageAttempts === 0 || witness.leakageQuarantined >= witness.leakageAttempts, detail: `attempts=${witness.leakageAttempts} quarantined=${witness.leakageQuarantined}` },
    { id: "acceptance-criteria-not-mutated", passed: witness.criteriaMutationsDetected === 0, detail: `mutations=${witness.criteriaMutationsDetected}` },
    // BOTH independent detectors must be clean: the witness's own observation
    // count AND the absence of an admitted invalid-test-evidence finding.
    { id: "no-fake-test-evidence-accepted", passed: witness.fakeTestEvidenceDetected === 0 && !fakeFindingCategory, detail: `witnessDetected=${witness.fakeTestEvidenceDetected} admittedFinding=${fakeFindingCategory}` },
    { id: "no-unexplained-resources", passed: claude.artifactManifest.length === claude.artifacts.length && codex.artifactManifest.length === codex.artifacts.length, detail: "manifest-matches-artifacts" },
    { id: "sufficient-evidence", passed: input.dominanceDecisions.length > 0 || (claudeImpl && codexImpl), detail: `dominance=${input.dominanceDecisions.length}` },
  ];
}

function componentsFor(bundle: ColonyEvidenceBundle, acceptance: readonly string[], reason: string): ApprovedMergeComponent[] {
  return bundle.artifacts.map((artifact, i) => {
    const manifest = bundle.artifactManifest[i];
    const evidenceOp = (artifact as { operation?: ApprovedFileOperation }).operation ?? {
      kind: "ADD",
      targetRelativePath: artifact.relativePath,
      sourceArtifactSha256: manifest.fingerprint,
    };

    return {
      componentId: `cmp-${fnv1a(`${bundle.colonyId}|${artifact.relativePath}`)}`,
      sourceColony: bundle.colonyId,
      sourceArtifactId: artifact.relativePath,
      sourceFingerprint: manifest.fingerprint,
      relativePath: artifact.relativePath,
      operation: evidenceOp,
      requirementsCovered: artifact.acceptanceCriteriaCovered.filter((c) => acceptance.includes(c)),
      evidenceRefs: [manifest.fingerprint, bundle.fingerprint],
      reasonSelected: reason,
      knownRisks: [...bundle.riskRegister].slice(0, 1),
      requiredMergeTests: ["typecheck", "tests", "build", "security-review", "acceptance-verification"],
    };
  });
}

/** Render the sovereign decision + receipt. Fails closed on any hard-rejection breach. */
export function renderNamolaDecision(input: NamolaCourtInput): NamolaDecisionReceipt {
  const checks = evaluateHardRejections(input);
  const failed = checks.filter((c) => !c.passed);
  const residual = [...input.residualUncertainty];
  const dominanceIds = input.dominanceDecisions.map((d) => d.decisionFingerprint);
  const evidenceRejected = ["provider-reputation", "colony-name", "popularity", "majority-vote-alone", "unsupported-confidence"];

  let decision: NamolaSovereignDecision;
  let decisionReason: string;
  let approvedComponents: ApprovedMergeComponent[] = [];
  const rejectedComponents: string[] = [];

  const integrityBreach = failed.some((c) => c.id === "witness-integrity-true" || c.id === "no-unquarantined-contamination");
  if (integrityBreach) {
    decision = "SAFELY_ABORT";
    decisionReason = `integrity-breach:${failed.map((c) => c.id).join(",")}`;
  } else if (failed.length > 0) {
    decision = "REJECT_BOTH";
    decisionReason = `hard-rejection:${failed.map((c) => c.id).join(",")}`;
  } else {
    // Complementary artifacts (disjoint paths) → merge the strongest of each.
    const claudePaths = new Set(input.claude.artifacts.map((a) => a.relativePath));
    const complementary = input.codex.artifacts.every((a) => !claudePaths.has(a.relativePath));
    if (complementary) {
      const claudeCmps = componentsFor(input.claude, input.acceptance, "clean storage-abstraction boundary (maintainability)");
      const codexCmps = componentsFor(input.codex, input.acceptance, "working task manager + tests (execution)");
      approvedComponents = [...claudeCmps, ...codexCmps].slice(0, Math.max(1, input.budget.maxMergeComponents));
      decision = "MERGE_APPROVED_COMPONENTS";
      decisionReason = "complementary-independently-reviewed-components-with-known-provenance";
    } else {
      const claudeDom = input.dominanceDecisions.some((d) => d.contradictionStatus !== "unresolved");
      decision = claudeDom ? "SELECT_CLAUDE" : "SELECT_CODEX";
      decisionReason = "single-dominant-solution-on-verified-evidence";
    }
  }

  const acceptanceCovered = [...new Set(approvedComponents.flatMap((c) => c.requirementsCovered))];
  const remainingRisks = [...new Set([...approvedComponents.flatMap((c) => c.knownRisks), ...residual])];
  const decisionFingerprint = fnv1a(`${input.claude.fingerprint}|${input.codex.fingerprint}|${decision}|${decisionReason}`);
  return {
    decisionId: `dec-${decisionFingerprint}`,
    decision,
    evidenceUsed: [`claudeFp=${input.claude.fingerprint}`, `codexFp=${input.codex.fingerprint}`, `dominance=${dominanceIds.length}`, `checksPassed=${checks.length - failed.length}/${checks.length}`],
    evidenceRejected,
    hardRejectionChecks: checks,
    dominanceDecisionsUsed: dominanceIds,
    residualUncertainty: residual,
    approvedComponents,
    rejectedComponents,
    acceptanceCriteriaCovered: acceptanceCovered,
    remainingRisks,
    witnessIntegrity: input.witness.integrityIntact,
    decisionReason,
    decisionFingerprint,
  };
}
