/**
 * crossExamination — Black Mirror adversarial cross-examination for the twin
 * empire. After BOTH bundles are frozen and validated, each colony may read the
 * competitor's frozen bundle (only) and produce EXACTLY ONE attack report and ONE
 * rebuttal — no more. Every attack finding must reference a real artifact +
 * requirement + evidence and propose a discriminating test; unsupported
 * accusations are rejected; each colony must acknowledge ≥1 genuine competitor
 * strength; unresolved contradictions, minority reports, and accepted/rejected
 * findings are preserved. Frozen bundles are never modified. No provider calls,
 * no fs, no child_process, no network.
 */

import type { ColonyEvidenceBundle, ColonyId } from "./twinColonyTypes";
import { fnv1a } from "./twinColonyTypes";
import { validateFrozenBundle } from "./frozenBundleValidator";
import type { SilentWitness } from "./silentWitness";

export type FindingCategory =
  | "requirement-gap"
  | "architecture-risk"
  | "implementation-defect"
  | "security-risk"
  | "performance-risk"
  | "maintainability-risk"
  | "insufficient-evidence"
  | "invalid-test-evidence"
  | "reproduction-gap";

export interface DecisiveTestProposal {
  readonly testId: string;
  readonly forFindingId: string;
  readonly discriminatingObservable: string;
  readonly bounded: true;
}

export interface AttackFinding {
  readonly findingId: string;
  readonly attackerColony: ColonyId;
  readonly targetColony: ColonyId;
  readonly artifactId: string;
  readonly requirementId: string;
  readonly evidenceRefs: readonly string[];
  readonly findingCategory: FindingCategory;
  readonly risk: number;
  readonly impact: number;
  readonly confidence: number;
  readonly proposedDiscriminatingTest: string;
}

export interface CompetitorStrengthAcknowledgement {
  readonly attackerColony: ColonyId;
  readonly targetColony: ColonyId;
  readonly artifactId: string;
  readonly requirementId: string;
  readonly evidenceRefs: readonly string[];
  readonly reasonItIsStronger: string;
  readonly possibleReuseValue: number;
}

export interface AttackReport {
  readonly attackerColony: ColonyId;
  readonly targetColony: ColonyId;
  readonly findings: readonly AttackFinding[];
  readonly strengthsAcknowledged: readonly CompetitorStrengthAcknowledgement[];
}

export type RebuttalDisposition = "accept" | "reject-with-evidence" | "narrow" | "request-decisive-test";

export interface RebuttalResponse {
  readonly findingId: string;
  readonly disposition: RebuttalDisposition;
  readonly evidenceRefs: readonly string[];
  readonly note: string;
}

export interface RebuttalReport {
  readonly rebuttingColony: ColonyId;
  readonly responses: readonly RebuttalResponse[];
}

export interface UnresolvedContradiction {
  readonly contradictionId: string;
  readonly findingId: string;
  readonly claudeClaim: string;
  readonly codexClaim: string;
  readonly discriminatingTestId: string | null;
  readonly unresolved: true;
}

export type CrossExamOutcome = { readonly ok: true } | { readonly ok: false; readonly reasonCode: string };

/** Build a deterministic, well-formed attack report from the competitor's frozen bundle. */
export function buildAttackReport(attacker: ColonyEvidenceBundle, target: ColonyEvidenceBundle, opts: { readonly includeUnsupported?: boolean } = {}): AttackReport {
  const attackerColony = attacker.colonyId;
  const targetColony = target.colonyId;
  const targetArtifact = target.artifactManifest[0]?.relativePath ?? target.artifacts[0]?.relativePath ?? "unknown";
  const targetFp = target.artifactManifest[0]?.fingerprint ?? target.fingerprint;

  // Culture-specific critique: architecture-first attacks execution gaps; the
  // implementation-first colony attacks abstraction/evidence gaps.
  const category: FindingCategory = attacker.culture === "architecture-first" ? "maintainability-risk" : "insufficient-evidence";
  const requirementId = attacker.culture === "architecture-first" ? "in-memory storage" : "unit tests present";
  const proposedDiscriminatingTest = attacker.culture === "architecture-first" ? "swap the in-memory store for a persistent store without changing the public API" : "run the test suite and observe whether an executable test artifact exists and passes";

  const findings: AttackFinding[] = [
    {
      findingId: `f-${fnv1a(`${attackerColony}|${targetArtifact}|${category}`)}`,
      attackerColony,
      targetColony,
      artifactId: targetArtifact,
      requirementId,
      evidenceRefs: [targetFp],
      findingCategory: category,
      risk: 0.5,
      impact: 0.6,
      confidence: 0.7,
      proposedDiscriminatingTest,
    },
  ];
  if (opts.includeUnsupported) {
    // An unsupported accusation: no evidence + a non-existent artifact. Must be rejected.
    findings.push({
      findingId: `f-unsupported-${attackerColony}`,
      attackerColony,
      targetColony,
      artifactId: "src/ghost-file-that-does-not-exist.ts",
      requirementId: "in-memory storage",
      evidenceRefs: [],
      findingCategory: "implementation-defect",
      risk: 0.9,
      impact: 0.9,
      confidence: 0.2,
      proposedDiscriminatingTest: "",
    });
  }

  const strengthArtifact = target.artifactManifest[0]?.relativePath ?? "unknown";
  const strengths: CompetitorStrengthAcknowledgement[] = [
    {
      attackerColony,
      targetColony,
      artifactId: strengthArtifact,
      requirementId: attacker.culture === "architecture-first" ? "unit tests present" : "in-memory storage",
      evidenceRefs: [targetFp],
      reasonItIsStronger: attacker.culture === "architecture-first" ? "delivered a working, test-backed vertical slice sooner" : "isolated storage behind a clean boundary, aiding maintainability",
      possibleReuseValue: 0.7,
    },
  ];

  return { attackerColony, targetColony, findings, strengthsAcknowledged: strengths };
}

/** The bounded cross-examination session — starts only after both bundles are frozen + valid. */
export class CrossExaminationSession {
  private started = false;
  private readonly attackedBy = new Set<ColonyId>();
  private readonly rebuttedBy = new Set<ColonyId>();
  private readonly admitted: AttackFinding[] = [];
  private readonly rejectedUnsupported: AttackFinding[] = [];
  private readonly strengths: CompetitorStrengthAcknowledgement[] = [];
  private readonly decisiveTests: DecisiveTestProposal[] = [];
  private readonly contradictions: UnresolvedContradiction[] = [];
  private readonly rebuttals: RebuttalReport[] = [];
  private readonly minorityPreserved: string[] = [];

  constructor(private readonly claude: ColonyEvidenceBundle, private readonly codex: ColonyEvidenceBundle, private readonly acceptance: readonly string[], private readonly witness?: SilentWitness) {}

  private bundleOf(colony: ColonyId): ColonyEvidenceBundle {
    return colony === "claude-forge" ? this.claude : this.codex;
  }

  /** Start requires BOTH bundles frozen and independently valid; else fails closed. */
  start(): CrossExamOutcome {
    if (!this.claude.frozen || !this.codex.frozen) return { ok: false, reasonCode: "bundles-not-frozen" };
    if (!validateFrozenBundle(this.claude).valid || !validateFrozenBundle(this.codex).valid) return { ok: false, reasonCode: "bundles-not-valid" };
    this.started = true;
    // Preserve every minority report from both frozen bundles.
    this.minorityPreserved.push(...this.claude.minorityReports, ...this.codex.minorityReports);
    return { ok: true };
  }

  /** Submit one colony's single attack report. A second attack by the same colony hits the round limit. */
  submitAttack(report: AttackReport): CrossExamOutcome {
    if (!this.started) return { ok: false, reasonCode: "not-started" };
    if (this.attackedBy.has(report.attackerColony)) return { ok: false, reasonCode: "cross-examination-round-limit" };
    if (report.attackerColony === report.targetColony) return { ok: false, reasonCode: "self-attack-forbidden" };
    if (report.strengthsAcknowledged.length < 1) return { ok: false, reasonCode: "no-strength-acknowledged" };

    const target = this.bundleOf(report.targetColony);
    const manifestPaths = new Set(target.artifactManifest.map((m) => m.relativePath));
    for (const f of report.findings) {
      const supported = f.evidenceRefs.length >= 1 && manifestPaths.has(f.artifactId) && this.acceptance.includes(f.requirementId) && f.proposedDiscriminatingTest.trim().length > 0;
      if (!supported) {
        this.rejectedUnsupported.push(f);
        continue;
      }
      this.admitted.push(f);
      this.decisiveTests.push({ testId: `dt-${fnv1a(f.findingId)}`, forFindingId: f.findingId, discriminatingObservable: f.proposedDiscriminatingTest, bounded: true });
    }
    for (const s of report.strengthsAcknowledged) this.strengths.push(s);
    this.attackedBy.add(report.attackerColony);
    this.witness?.observeCrossExamRound("attack", report.attackerColony);
    return { ok: true };
  }

  /** Submit one colony's single rebuttal. A second rebuttal by the same colony hits the round limit. */
  submitRebuttal(report: RebuttalReport): CrossExamOutcome {
    if (!this.started) return { ok: false, reasonCode: "not-started" };
    if (this.attackedBy.size < 2) return { ok: false, reasonCode: "attacks-incomplete" };
    if (this.rebuttedBy.has(report.rebuttingColony)) return { ok: false, reasonCode: "cross-examination-round-limit" };

    for (const resp of report.responses) {
      const finding = this.admitted.find((f) => f.findingId === resp.findingId);
      if (!finding) continue; // cannot rebut a non-admitted finding — it never modifies bundles
      if ((resp.disposition === "narrow" || resp.disposition === "request-decisive-test" || resp.disposition === "reject-with-evidence") && resp.evidenceRefs.length >= 1) {
        // The attacker holds the finding; the rebutter contests it → an UNRESOLVED contradiction.
        const dt = this.decisiveTests.find((t) => t.forFindingId === finding.findingId) ?? null;
        this.contradictions.push({
          contradictionId: `c-${fnv1a(`${finding.findingId}|${report.rebuttingColony}`)}`,
          findingId: finding.findingId,
          claudeClaim: finding.attackerColony === "claude-forge" ? `claude asserts ${finding.findingCategory} on ${finding.artifactId}` : `claude rebuts: ${resp.note}`,
          codexClaim: finding.attackerColony === "codex-crucible" ? `codex asserts ${finding.findingCategory} on ${finding.artifactId}` : `codex rebuts: ${resp.note}`,
          discriminatingTestId: dt ? dt.testId : null,
          unresolved: true,
        });
      }
    }
    this.rebuttals.push(report);
    this.rebuttedBy.add(report.rebuttingColony);
    this.witness?.observeCrossExamRound("rebuttal", report.rebuttingColony);
    return { ok: true };
  }

  getUnresolvedContradictions(): readonly UnresolvedContradiction[] {
    return this.contradictions;
  }
  getDecisiveTests(): readonly DecisiveTestProposal[] {
    return this.decisiveTests;
  }
  getAdmittedFindings(): readonly AttackFinding[] {
    return this.admitted;
  }

  summary() {
    return {
      started: this.started,
      attacks: this.attackedBy.size,
      rebuttals: this.rebuttedBy.size,
      admittedFindings: this.admitted.length,
      rejectedUnsupportedFindings: this.rejectedUnsupported.length,
      strengthsAcknowledged: this.strengths.length,
      decisiveTestsProposed: this.decisiveTests.length,
      unresolvedContradictions: this.contradictions.length,
      minorityReportsPreserved: this.minorityPreserved.length,
      bundlesUnchanged: this.claude.frozen && this.codex.frozen,
    };
  }
}
