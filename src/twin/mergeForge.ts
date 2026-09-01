/**
 * mergeForge — the Zero-Trust Merge Forge. It receives ONLY Namola-approved
 * components (never a colony's unrestricted workspace), places them in a FRESH
 * isolated in-memory `workspaces/namola-twin/<mission>/merge-forge/` workspace
 * with full provenance, and reruns EVERY verification stage from zero through an
 * injected fake driver — it never inherits a passing status from either colony.
 * One deterministic integration failure creates a `MergeIncident` + technical-debt
 * evidence + repair demand; a SEPARATELY authorized single fake repair reruns all
 * verification from zero. No automatic retry, no hidden repair loop.
 *
 * Fails closed: no approved components → no merge; missing provenance / invalid
 * path → component rejected; empty workspace → no verification; any failed stage →
 * no delivery. No fs, no child_process, no network, no provider calls.
 */

import { fnv1a } from "./twinColonyTypes";
import { validateColonyRelPath } from "./colonyWorkspace";
import type { ApprovedMergeComponent } from "./namolaSovereignCourt";

export type MergeVerificationStage = "typecheck" | "tests" | "build" | "security-review" | "acceptance-verification";
export const MERGE_STAGES: readonly MergeVerificationStage[] = ["typecheck", "tests", "build", "security-review", "acceptance-verification"];

export interface MergeVerificationOutcome {
  readonly stage: MergeVerificationStage;
  readonly passed: boolean;
  readonly realExecution: false;
}

export interface MergeVerificationDriver {
  readonly isReal: boolean;
  run(stage: MergeVerificationStage, injectFailure: boolean): MergeVerificationOutcome;
}

/** Deterministic fake merge-verification driver — runs nothing real. */
export class FakeMergeVerificationDriver implements MergeVerificationDriver {
  readonly isReal = false;
  private runs = 0;
  get runCount(): number {
    return this.runs;
  }
  run(stage: MergeVerificationStage, injectFailure: boolean): MergeVerificationOutcome {
    this.runs += 1;
    return { stage, passed: !injectFailure, realExecution: false };
  }
}

export interface MergeProvenanceRecord {
  readonly relativePath: string;
  readonly sourceColony: string;
  readonly sourceArtifactId: string;
  readonly originalFingerprint: string;
  readonly mergeFingerprint: string;
  readonly reasonSelected: string;
  readonly requirementsCovered: readonly string[];
  readonly verificationRequired: readonly string[];
}

export interface MergeIncident {
  readonly incidentId: string;
  readonly stage: MergeVerificationStage;
  readonly category: "integration-failure";
  readonly detail: string;
  readonly technicalDebtCreated: number;
  readonly repairDemandPublished: true;
}

export interface MergeRepairReceipt {
  readonly repairId: string;
  readonly authorized: boolean;
  readonly ran: boolean;
  readonly resolvedIncidentId: string | null;
  readonly realExecution: false;
}

export interface MergeVerificationRun {
  readonly fromZero: true;
  readonly outcomes: readonly MergeVerificationOutcome[];
  readonly passed: boolean;
}

export type ComponentAdmission = { readonly ok: true; readonly relativePath: string } | { readonly ok: false; readonly reasonCode: string; readonly componentId: string };

/** The zero-trust merge forge — a fresh in-memory workspace, provenance-first. */
export class ZeroTrustMergeForge {
  readonly mergeWorkspacePath: string;
  private readonly files = new Map<string, string>();
  private readonly provenance: MergeProvenanceRecord[] = [];
  private readonly rejected: ComponentAdmission[] = [];
  private readonly incidents: MergeIncident[] = [];
  private readonly runs: MergeVerificationRun[] = [];
  private repairReceipt: MergeRepairReceipt | null = null;
  /** Structural: the forge never copies a colony "passed" flag. */
  readonly inheritedPassingStatus = false as const;
  private failedStage: MergeVerificationStage | null = null;

  constructor(missionId: string, private readonly driver: MergeVerificationDriver) {
    this.mergeWorkspacePath = `workspaces/namola-twin/${missionId}/merge-forge`;
  }

  get fileCount(): number {
    return this.files.size;
  }
  get provenanceRecords(): readonly MergeProvenanceRecord[] {
    return this.provenance;
  }
  get rejectedComponents(): readonly ComponentAdmission[] {
    return this.rejected;
  }
  get mergeIncidents(): readonly MergeIncident[] {
    return this.incidents;
  }
  get verificationRuns(): readonly MergeVerificationRun[] {
    return this.runs;
  }
  get repair(): MergeRepairReceipt | null {
    return this.repairReceipt;
  }
  get finalMergeVerificationPassed(): boolean {
    return this.runs.length > 0 && this.runs[this.runs.length - 1].passed;
  }

  /** Admit only approved components with provenance + a valid relative path. */
  receiveComponents(components: readonly ApprovedMergeComponent[]): { readonly accepted: number; readonly rejected: number } {
    let accepted = 0;
    for (const c of components) {
      if (!c.sourceFingerprint || c.sourceFingerprint.length === 0 || !c.sourceColony) {
        this.rejected.push({ ok: false, reasonCode: "missing-provenance", componentId: c.componentId });
        continue;
      }
      if (validateColonyRelPath(c.relativePath) !== "ok") {
        this.rejected.push({ ok: false, reasonCode: "invalid-path", componentId: c.componentId });
        continue;
      }
      this.files.set(c.relativePath, `// merged from ${c.sourceColony}:${c.sourceArtifactId}`);
      const mergeFingerprint = fnv1a(`${this.mergeWorkspacePath}|${c.relativePath}|${c.sourceFingerprint}`);
      this.provenance.push({ relativePath: c.relativePath, sourceColony: c.sourceColony, sourceArtifactId: c.sourceArtifactId, originalFingerprint: c.sourceFingerprint, mergeFingerprint, reasonSelected: c.reasonSelected, requirementsCovered: c.requirementsCovered, verificationRequired: c.requiredMergeTests });
      accepted += 1;
    }
    return { accepted, rejected: this.rejected.length };
  }

  /** Run ALL stages from zero. Empty workspace → no verification. An injected failure fails closed. */
  runVerification(injectFailureStage: MergeVerificationStage | null = null): MergeVerificationRun | { readonly refused: true; readonly reasonCode: string } {
    if (this.files.size === 0) return { refused: true, reasonCode: "empty-merge-workspace" };
    const outcomes = MERGE_STAGES.map((s) => this.driver.run(s, s === injectFailureStage));
    const passed = outcomes.every((o) => o.passed);
    const run: MergeVerificationRun = { fromZero: true, outcomes, passed };
    this.runs.push(run);
    if (!passed) {
      this.failedStage = injectFailureStage;
      const stage = injectFailureStage ?? "typecheck";
      this.incidents.push({ incidentId: `mi-${fnv1a(`${this.mergeWorkspacePath}|${stage}`)}`, stage, category: "integration-failure", detail: `stage ${stage} failed during zero-trust merge verification`, technicalDebtCreated: 0.4, repairDemandPublished: true });
    }
    return run;
  }

  /** Exactly one repair, gated on a SEPARATE authorization flag. Reruns all verification from zero. */
  authorizeAndRepair(repairAuthorized: boolean): MergeRepairReceipt | { readonly refused: true; readonly reasonCode: string } {
    if (this.repairReceipt) return { refused: true, reasonCode: "no-automatic-second-repair" };
    if (this.incidents.length === 0) return { refused: true, reasonCode: "no-incident-to-repair" };
    if (!repairAuthorized) {
      this.repairReceipt = { repairId: "repair-declined", authorized: false, ran: false, resolvedIncidentId: null, realExecution: false };
      return this.repairReceipt;
    }
    const incident = this.incidents[this.incidents.length - 1];
    // The repair fixes the integration failure; the next verification runs clean.
    this.failedStage = null;
    this.repairReceipt = { repairId: `repair-${fnv1a(incident.incidentId)}`, authorized: true, ran: true, resolvedIncidentId: incident.incidentId, realExecution: false };
    // Rerun EVERY verification stage from zero (no inherited status, no auto-retry loop).
    this.runVerification(null);
    return this.repairReceipt;
  }
}
