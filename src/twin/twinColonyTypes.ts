/**
 * twinColonyTypes — shared types for the NAMOLA TWIN EMPIRE foundation milestone.
 * Two isolated competing colonies (Claude Forge, Codex Crucible) each produce an
 * independent, frozen evidence bundle; a Silent Witness observes receipts for
 * cross-colony leakage; and the Namola Court renders one evidence-based decision.
 *
 * This foundation reuses existing settlement identities/districts/determinism and
 * runs entirely in memory: no fs, no child_process, no network, no wall clock.
 * Provider cognition is NOT connected here — bundles are produced by deterministic
 * colony forges so the isolation, freeze, witness, and court mechanics can be
 * proven with zero real action.
 */

export type ColonyId = "claude-forge" | "codex-crucible";
export type ColonyCulture = "architecture-first" | "implementation-first";

export interface ColonyArchitectureProposal {
  readonly architectureSummary: string;
  readonly filePlan: readonly string[];
  readonly acceptanceMapping: readonly string[];
  readonly interfaceDecisions: readonly string[];
  readonly risks: readonly string[];
}

export interface ColonyArtifactProposal {
  readonly relativePath: string;
  readonly content: string;
  readonly purpose: string;
  readonly acceptanceCriteriaCovered: readonly string[];
}

export interface ColonyReview {
  readonly reviewerAntId: string;
  readonly authorAntId: string;
  readonly decision: "approve" | "reject" | "repair";
  readonly findings: readonly string[];
  readonly securityFindings: readonly string[];
  /** True only if reviewer === author. Must remain false — self-review is refused. */
  readonly selfReview: boolean;
}

/** One entry in the frozen artifact manifest — path + size + per-artifact fingerprint. */
export interface ArtifactManifestEntry {
  readonly relativePath: string;
  readonly bytes: number;
  readonly fingerprint: string;
}

export interface SecurityEvidence {
  readonly findings: readonly string[];
  readonly passed: boolean;
}

export interface PerformanceEvidenceEntry {
  readonly check: string;
  readonly observed: number;
  readonly budget: number;
  readonly withinBudget: boolean;
}

/** A safe, bounded receipt of one provider call. Zero real calls in this milestone. */
export interface ColonyProviderReceipt {
  readonly antId: string;
  readonly providerId: string;
  readonly role: string;
  readonly ok: boolean;
  readonly real: false;
}

export interface ColonyEvidenceBundle {
  readonly colonyId: ColonyId;
  readonly missionId: string;
  readonly culture: ColonyCulture;
  readonly workspacePath: string;
  readonly architecture: ColonyArchitectureProposal;
  readonly artifacts: readonly ColonyArtifactProposal[];
  readonly artifactManifest: readonly ArtifactManifestEntry[];
  readonly reviews: readonly ColonyReview[];
  readonly testEvidence: { readonly testsProposed: number; readonly independentReviews: number; readonly artifactCount: number };
  readonly securityEvidence: SecurityEvidence;
  readonly performanceEvidence: readonly PerformanceEvidenceEntry[];
  readonly riskRegister: readonly string[];
  readonly failureRegister: readonly string[];
  readonly uncertaintyRegister: readonly string[];
  readonly minorityReports: readonly string[];
  readonly providerReceipts: readonly ColonyProviderReceipt[];
  readonly costReport: { readonly providerCalls: number; readonly realProviderCalls: 0 };
  readonly reproductionInstructions: readonly string[];
  /** Immutable digest computed at freeze over the bundle's canonical projection. */
  readonly fingerprint: string;
  readonly frozen: boolean;
}

export type NamolaDecision = "SELECT_CLAUDE" | "SELECT_CODEX" | "MERGE" | "REJECT_BOTH";

/** FNV-1a fingerprint (non-reversible) over a canonical string — never the raw content. */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `tw-${h.toString(16).padStart(8, "0")}-${input.length}`;
}

/** Canonical projection used for the COMPLETE bundle fingerprint (excludes the fingerprint itself). */
export function bundleCanonicalProjection(bundle: Omit<ColonyEvidenceBundle, "fingerprint" | "frozen">): string {
  return JSON.stringify({
    colonyId: bundle.colonyId,
    missionId: bundle.missionId,
    culture: bundle.culture,
    workspacePath: bundle.workspacePath,
    filePlan: bundle.architecture.filePlan,
    artifacts: bundle.artifacts.map((a) => ({ p: a.relativePath, c: a.content.length })),
    manifest: bundle.artifactManifest.map((m) => ({ p: m.relativePath, b: m.bytes, f: m.fingerprint })),
    reviews: bundle.reviews.map((r) => ({ d: r.decision, self: r.selfReview })),
    security: { passed: bundle.securityEvidence.passed, findings: bundle.securityEvidence.findings.length },
    performance: bundle.performanceEvidence.map((p) => ({ c: p.check, ok: p.withinBudget })),
    risk: bundle.riskRegister.length,
    uncertainty: bundle.uncertaintyRegister.length,
    reproduction: bundle.reproductionInstructions,
    artifactCount: bundle.artifacts.length,
  });
}
