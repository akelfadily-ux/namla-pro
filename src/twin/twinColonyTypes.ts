/**
 * twinColonyTypes — shared types for the NAMOLA TWIN EMPIRE foundation milestone.
 * Two isolated competing colonies (Claude Forge, Codex Crucible) each produce an
 * independent, frozen evidence bundle; a Silent Witness observes receipts for
 * cross-colony leakage; and the Namola Court renders one evidence-based decision.
 *
 * THIS MODULE is types and pure helpers only: no fs, no child_process, no
 * network, no wall clock, and no provider call happens in this file.
 *
 * That is a statement about this module, NOT about who produces the bundles it
 * describes. Two producers exist. The deterministic colony forge builds bundles
 * in memory with zero real action, which is how the isolation, freeze, witness
 * and court mechanics are proven. The LIVE twin runner also builds them, from
 * real provider processes and real workspace writes. An earlier version of this
 * comment said provider cognition was "NOT connected" and that bundles came from
 * the forge; that stopped being true when the live path was wired, and it is why
 * `ColonyProviderReceipt.real` is now a boolean each producer must state rather
 * than the literal `false` it used to be.
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

/**
 * A safe, bounded receipt of one provider call.
 *
 * `real` was previously the literal type `false`, which was true of the
 * deterministic forge but became a FALSE STATEMENT the moment the live twin CLI
 * began spawning actual provider processes: a run that really called Claude
 * recorded that it had not. It is now a boolean each producer must state, set
 * from whether the driver's real-execution counter actually advanced across that
 * one call. The deterministic forge still records `false`, and says so itself.
 */
export interface ColonyProviderReceipt {
  readonly antId: string;
  readonly providerId: string;
  readonly role: string;
  readonly ok: boolean;
  readonly real: boolean;
}

/**
 * The verification evidence a LIVE candidate carries (evidence version 2).
 *
 * A frozen bundle used to mean only "files were generated". This states what
 * actually happened to those files: whether they were compiled, built and tested,
 * how many repair rounds it took, and - when nothing could be checked - that
 * nothing could be checked. `VERIFICATION_BLOCKED` is a distinct terminal value
 * precisely so it can never be read as either a pass or a code failure.
 */
export interface TwinCandidateVerificationEvidence {
  readonly finalStatus: "VERIFIED" | "FAILED" | "VERIFICATION_BLOCKED";
  readonly verificationRounds: number;
  readonly repairAttempts: number;
  readonly filesAppliedByRepair: number;
  readonly sandboxBackendId: string;
  readonly sandboxVerified: boolean;
  readonly stopReason: string | null;
  /** Bounded per-stage receipts; counts and closed-vocabulary codes only. */
  readonly stageReceipts: readonly {
    readonly attempt: number;
    readonly stage: string;
    readonly commandId: string;
    readonly status: string;
    readonly safeReasonCode: string | null;
    readonly outputLineCount: number;
    readonly realProcessExecutions: number;
  }[];
  /** One entry per repair provider call actually made. */
  readonly repairReceipts: readonly {
    readonly attempt: number;
    readonly antId: string;
    readonly ok: boolean;
    readonly realProcessExecution: boolean;
    readonly filesProposed: number;
    readonly filesApplied: number;
  }[];
  /**
   * A PATH-SET identity for the applied candidate: the sorted relative paths plus
   * the file count. It is NOT a content digest and proves nothing about the bytes
   * on disk - two candidates with identical paths and different contents produce
   * the same value. Nothing may use it as evidence that files were unchanged.
   */
  readonly workspaceFingerprint: string;
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
  /**
   * `realProviderCalls` was the literal type `0`. That was an invariant of the
   * deterministic forge, not of a bundle, and it made a live run record zero real
   * calls while it was spawning real provider processes. It is now a count each
   * producer must state truthfully; a v1 forge bundle still states 0.
   */
  readonly costReport: { readonly providerCalls: number; readonly realProviderCalls: number };
  readonly reproductionInstructions: readonly string[];
  /**
   * Evidence schema version. ABSENT means a version-1 bundle produced by a path
   * that performs no verification (the deterministic colony forge). Present and
   * equal to 2 means the live build/verify/repair loop produced this bundle and
   * `verification` below is populated. Old fields are unchanged and are never
   * reinterpreted - v2 only ADDS.
   */
  readonly evidenceVersion?: 2;
  /**
   * Present only on evidence version 2. Absence is never "verified": read it
   * through `isVerifiedCandidate` rather than testing the field directly.
   */
  readonly verification?: TwinCandidateVerificationEvidence;
  /** Immutable digest computed at freeze over the bundle's canonical projection. */
  readonly fingerprint: string;
  readonly frozen: boolean;
}

/**
 * The ONLY sanctioned way to ask whether a candidate is verified.
 *
 * A bundle with no verification evidence is not verified - it is unexamined -
 * and a v1 bundle must therefore never satisfy this. Reading `finalStatus`
 * directly at a call site would let `undefined` drift into a truthy-ish check;
 * this states the rule once.
 */
export function isVerifiedCandidate(bundle: Pick<ColonyEvidenceBundle, "evidenceVersion" | "verification">): boolean {
  return bundle.evidenceVersion === 2 && bundle.verification?.finalStatus === "VERIFIED";
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
