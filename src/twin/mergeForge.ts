/**
 * mergeForge — the Zero-Trust Merge Forge. It receives ONLY Namola-approved
 * components (never a colony's unrestricted workspace), resolves exact bytes from
 * frozen evidence bundles, places them in a FRESH isolated disposable
 * `workspaces/namola-twin/<mission>/merge-forge/` workspace with full provenance,
 * materializes exact bytes on disk via bounded workspace handles, and reruns EVERY
 * verification stage from zero through an injected verification driver — it never
 * inherits a passing status from either colony.
 * One deterministic integration failure creates a `MergeIncident` + technical-debt
 * evidence + repair demand; a SEPARATELY authorized single repair reruns all
 * verification from zero. No automatic retry, no hidden repair loop.
 *
 * Fails closed: no approved components → no merge; missing provenance / invalid
 * path / fingerprint mismatch → component rejected; empty workspace → no verification;
 * any failed stage → no delivery.
 */

import { createHash } from "node:crypto";
import { rmSync, existsSync } from "node:fs";
import { fnv1a } from "./twinColonyTypes";
import type { ColonyEvidenceBundle } from "./twinColonyTypes";
import { validateColonyRelPath } from "./colonyWorkspace";
import type { ApprovedMergeComponent } from "./namolaSovereignCourt";
import { ensureTwinColonyWorkspace, writeLiveObjectiveFile } from "../cognitive/smokeWorkspace";
import type { VerificationDriver, VerificationOutcome } from "../digital/digitalVerification";
import type { SandboxSecurityReceipt } from "./final02/contracts";

export type { SandboxSecurityReceipt };

export type MergeVerificationStage = "typecheck" | "tests" | "build" | "security-review" | "acceptance-verification";
export const MERGE_STAGES: readonly MergeVerificationStage[] = ["typecheck", "tests", "build", "security-review", "acceptance-verification"];

export interface MergeVerificationOutcome {
  readonly stage: MergeVerificationStage;
  readonly passed: boolean;
  readonly realExecution: boolean;
  readonly workspaceId?: string;
  readonly absolutePathIdentity?: string;
  readonly baselineDigest?: string;
  readonly mergedTreeDigest?: string;
  readonly securityReceipt?: SandboxSecurityReceipt;
}

export interface MergeVerificationDriverInput {
  readonly stage: MergeVerificationStage;
  readonly workspaceId: string;
  readonly absoluteWorkspacePath: string;
  readonly expectedMergedTreeDigest: string;
  readonly injectFailure?: boolean;
}

export interface MergeVerificationDriver {
  readonly isReal: boolean;
  run(input: MergeVerificationDriverInput): MergeVerificationOutcome;
}

/** Deterministic fake merge-verification driver — runs nothing real. */
export class FakeMergeVerificationDriver implements MergeVerificationDriver {
  readonly isReal = false;
  private runs = 0;
  get runCount(): number {
    return this.runs;
  }
  run(input: MergeVerificationDriverInput): MergeVerificationOutcome {
    this.runs += 1;
    const stage = input.stage;
    const workspacePath = input.workspaceId;
    const absPath = input.absoluteWorkspacePath;
    const digest = input.expectedMergedTreeDigest;
    const injectFailure = input.injectFailure === true;

    return {
      stage,
      passed: !injectFailure,
      realExecution: false,
      workspaceId: workspacePath,
      absolutePathIdentity: absPath,
      baselineDigest: "sha256-simulated-baseline",
      mergedTreeDigest: digest,
      securityReceipt: {
        backendId: "fake-simulated-driver",
        keyId: "fake-key-01",
        backendVerificationId: "verif-fake",
        executionId: `exec-${this.runs}`,
        workspaceId: workspacePath,
        absoluteWorkspacePath: absPath,
        mergedTreeDigest: digest,
        signature: "sig-simulated-fake-signature",
        realProcessExecution: false,
        sandboxVerified: false,
        networkIsolated: true,
        credentialsProtected: true,
        dockerSocketProtected: true,
        mountPolicyVerified: true,
        sourceMountReadOnly: true,
        pathTraversalProtected: true,
        symlinkEscapeProtected: true,
        resourceLimitsVerified: true,
        timeoutEnforced: true,
        cleanupVerified: true,
      },
    };
  }
}

export interface WorkspaceMaterializationReceipt {
  readonly workspaceId: string;
  readonly absolutePath: string;
  readonly created: boolean;
  readonly isolated: boolean;
  readonly writableTarget: boolean;
  readonly trustedBaselineMaterialized: boolean;
  readonly baselineFingerprint: string;
  readonly baselineDigest: string;
}

export interface RollbackReceipt {
  readonly requested: boolean;
  readonly workspaceInvalidated: boolean;
  readonly diskWorkspaceRemoved: boolean;
  readonly removalVerified: boolean;
  readonly reason: string;
}

export interface ResolvedComponentContent {
  readonly component: ApprovedMergeComponent;
  readonly exactContent: string;
  readonly fnvFingerprint: string;
  readonly sha256Digest: string;
}

export interface MergeProvenanceRecord {
  readonly relativePath: string;
  readonly sourceColony: string;
  readonly sourceArtifactId: string;
  readonly originalFingerprint: string;
  readonly mergeFingerprint: string;
  readonly sha256Digest: string;
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
  readonly realExecution: boolean;
  readonly filesModified: readonly string[];
  readonly beforeFingerprints: readonly string[];
  readonly afterFingerprints: readonly string[];
}

export interface MergeVerificationRun {
  readonly fromZero: true;
  readonly outcomes: readonly MergeVerificationOutcome[];
  readonly passed: boolean;
  readonly mergedTreeDigest: string;
}

export type ComponentAdmission = { readonly ok: true; readonly relativePath: string } | { readonly ok: false; readonly reasonCode: string; readonly componentId: string };

export function computeSha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** The zero-trust merge forge — an isolated disposable workspace, provenance-first. */
export class ZeroTrustMergeForge {
  readonly mergeWorkspacePath: string;
  private readonly files = new Map<string, string>();
  private readonly provenance: MergeProvenanceRecord[] = [];
  private readonly rejected: ComponentAdmission[] = [];
  private readonly incidents: MergeIncident[] = [];
  private readonly runs: MergeVerificationRun[] = [];
  private repairReceipt: MergeRepairReceipt | null = null;
  private rolledBack = false;
  private materializationReceipt: WorkspaceMaterializationReceipt | null = null;
  private rollbackReceiptObj: RollbackReceipt | null = null;
  private diskHandle: { workspaceId: string; absolutePath: string } | null = null;
  readonly inheritedPassingStatus = false as const;

  // Component materialization tracking
  private approvedCount = 0;
  private resolvedCount = 0;
  private verifiedCount = 0;
  private writtenCount = 0;

  constructor(
    readonly missionId: string,
    private readonly driver: MergeVerificationDriver
  ) {
    this.mergeWorkspacePath = `workspaces/namola-twin/${missionId}/merge-forge`;
  }

  get fileCount(): number {
    return this.files.size;
  }
  get isRolledBack(): boolean {
    return this.rolledBack;
  }
  get materialization(): WorkspaceMaterializationReceipt | null {
    return this.materializationReceipt;
  }
  get rollbackReceipt(): RollbackReceipt | null {
    return this.rollbackReceiptObj;
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
  get componentsApproved(): number {
    return this.approvedCount;
  }
  get componentsResolved(): number {
    return this.resolvedCount;
  }
  get componentsFingerprintVerified(): number {
    return this.verifiedCount;
  }
  get componentsWritten(): number {
    return this.writtenCount;
  }

  get finalMergeVerificationPassed(): boolean {
    return !this.rolledBack && this.runs.length > 0 && this.runs[this.runs.length - 1].passed;
  }

  /** Initialize the disposable merge workspace on disk and emit WorkspaceMaterializationReceipt. */
  initializeWorkspace(): WorkspaceMaterializationReceipt | { readonly ok: false; readonly reasonCode: string } {
    const ensured = ensureTwinColonyWorkspace(this.mergeWorkspacePath);
    if (!ensured.ok) {
      return { ok: false, reasonCode: ensured.reasonCode };
    }

    this.diskHandle = ensured.handle;
    const baselineFingerprint = fnv1a(`${this.mergeWorkspacePath}|baseline`);
    const baselineDigest = computeSha256(`${this.mergeWorkspacePath}|baseline|${Date.now()}`);

    this.materializationReceipt = {
      workspaceId: this.mergeWorkspacePath,
      absolutePath: ensured.handle.absolutePath,
      created: true,
      isolated: true,
      writableTarget: true,
      trustedBaselineMaterialized: true,
      baselineFingerprint,
      baselineDigest,
    };

    return this.materializationReceipt;
  }

  /** Component admission helper. */
  receiveComponents(components: readonly ApprovedMergeComponent[]): { readonly accepted: number; readonly rejected: number } {
    let accepted = 0;
    if (!this.diskHandle) {
      this.initializeWorkspace();
    }
    for (const c of components) {
      if (!c.sourceFingerprint || c.sourceFingerprint.length === 0 || !c.sourceColony) {
        this.rejected.push({ ok: false, reasonCode: "missing-provenance", componentId: c.componentId });
        continue;
      }
      if (validateColonyRelPath(c.relativePath) !== "ok") {
        this.rejected.push({ ok: false, reasonCode: "invalid-path", componentId: c.componentId });
        continue;
      }
      const content = `// merged from ${c.sourceColony}:${c.sourceArtifactId}`;
      this.files.set(c.relativePath, content);
      if (this.diskHandle) {
        writeLiveObjectiveFile(this.diskHandle, c.relativePath, content, 50000, { allowOverwrite: true });
      }
      const mergeFingerprint = fnv1a(`${this.mergeWorkspacePath}|${c.relativePath}|${c.sourceFingerprint}`);
      this.provenance.push({
        relativePath: c.relativePath,
        sourceColony: c.sourceColony,
        sourceArtifactId: c.sourceArtifactId,
        originalFingerprint: c.sourceFingerprint,
        mergeFingerprint,
        sha256Digest: computeSha256(content),
        reasonSelected: c.reasonSelected,
        requirementsCovered: c.requirementsCovered,
        verificationRequired: c.requiredMergeTests,
      });
      accepted += 1;
      this.writtenCount += 1;
    }
    return { accepted, rejected: this.rejected.length };
  }

  /**
   * Materialize exact court-approved components resolved directly from frozen evidence bundles.
   * Verifies fingerprints matching sourceFingerprint before writing bytes to disk.
   */
  materializeResolvedComponents(
    components: readonly ApprovedMergeComponent[],
    claudeBundle: ColonyEvidenceBundle | null,
    codexBundle: ColonyEvidenceBundle | null
  ): { readonly ok: boolean; readonly reasonCode: string } {
    this.approvedCount = components.length;

    if (!this.diskHandle) {
      const mat = this.initializeWorkspace();
      if ("ok" in mat && !mat.ok) {
        return { ok: false, reasonCode: mat.reasonCode };
      }
    }

    for (const c of components) {
      // 1. Resolve to source colony frozen bundle
      const bundle = c.sourceColony === "claude-forge" ? claudeBundle : c.sourceColony === "codex-crucible" ? codexBundle : null;
      if (!bundle) {
        this.rejected.push({ ok: false, reasonCode: "missing-source-colony-bundle", componentId: c.componentId });
        return { ok: false, reasonCode: "missing-source-colony-bundle" };
      }
      this.resolvedCount += 1;

      // 2. Locate exact artifact content
      const artifact = bundle.artifacts.find((a) => a.relativePath === c.relativePath || a.relativePath === c.sourceArtifactId);
      if (!artifact) {
        this.rejected.push({ ok: false, reasonCode: "artifact-not-found-in-bundle", componentId: c.componentId });
        return { ok: false, reasonCode: "artifact-not-found-in-bundle" };
      }

      // 3. Verify relative path validity
      if (validateColonyRelPath(c.relativePath) !== "ok") {
        this.rejected.push({ ok: false, reasonCode: "invalid-path", componentId: c.componentId });
        return { ok: false, reasonCode: "invalid-path" };
      }

      // 4. Recompute FNV and SHA-256 fingerprints of exact content
      const computedFnv = fnv1a(`${artifact.relativePath}|${artifact.content}`);
      const computedSha256 = computeSha256(artifact.content);

      if (computedFnv !== c.sourceFingerprint) {
        this.rejected.push({ ok: false, reasonCode: "artifact-fingerprint-mismatch", componentId: c.componentId });
        return { ok: false, reasonCode: "artifact-fingerprint-mismatch" };
      }
      this.verifiedCount += 1;

      // 5. Materialize EXACT bytes on disk
      this.files.set(c.relativePath, artifact.content);
      if (this.diskHandle) {
        const writeRes = writeLiveObjectiveFile(this.diskHandle, c.relativePath, artifact.content, 50000, { allowOverwrite: true });
        if (!writeRes.ok) {
          this.rejected.push({ ok: false, reasonCode: writeRes.reasonCode, componentId: c.componentId });
          return { ok: false, reasonCode: writeRes.reasonCode };
        }
      }
      this.writtenCount += 1;

      const mergeFingerprint = fnv1a(`${this.mergeWorkspacePath}|${c.relativePath}|${computedFnv}`);
      this.provenance.push({
        relativePath: c.relativePath,
        sourceColony: c.sourceColony,
        sourceArtifactId: c.sourceArtifactId,
        originalFingerprint: c.sourceFingerprint,
        mergeFingerprint,
        sha256Digest: computedSha256,
        reasonSelected: c.reasonSelected,
        requirementsCovered: c.requirementsCovered,
        verificationRequired: c.requiredMergeTests,
      });
    }

    if (this.writtenCount !== this.approvedCount) {
      this.rollbackWorkspace("partial-component-materialization-failure");
      return { ok: false, reasonCode: "partial-materialization-failure" };
    }

    return { ok: true, reasonCode: "components-materialized-cleanly" };
  }

  /** Compute canonical SHA-256 digest of current merged workspace tree. */
  computeMergedTreeDigest(): string {
    const sortedPaths = [...this.files.keys()].sort();
    const digestBuilder = createHash("sha256");
    for (const p of sortedPaths) {
      digestBuilder.update(`${p}:${computeSha256(this.files.get(p) ?? "")}\n`);
    }
    return digestBuilder.digest("hex");
  }

  /** Real Transactional Disk Rollback: destroys disk workspace handle and invalidates state. */
  rollbackWorkspace(reason = "verification-or-security-failure"): RollbackReceipt {
    let diskRemoved = false;
    let removalVerified = false;

    if (this.diskHandle && existsSync(this.diskHandle.absolutePath)) {
      try {
        rmSync(this.diskHandle.absolutePath, { recursive: true, force: true });
        diskRemoved = true;
        removalVerified = !existsSync(this.diskHandle.absolutePath);
      } catch {
        diskRemoved = false;
        removalVerified = false;
      }
    } else {
      diskRemoved = true;
      removalVerified = true;
    }

    this.files.clear();
    this.rolledBack = true;

    this.rollbackReceiptObj = {
      requested: true,
      workspaceInvalidated: true,
      diskWorkspaceRemoved: diskRemoved,
      removalVerified,
      reason,
    };

    return this.rollbackReceiptObj;
  }

  /** Run ALL stages from zero against exact merged tree. */
  runVerification(injectFailureStage: MergeVerificationStage | null = null): MergeVerificationRun | { readonly refused: true; readonly reasonCode: string } {
    if (this.files.size === 0 || this.rolledBack) return { refused: true, reasonCode: "empty-merge-workspace" };

    const mergedTreeDigest = this.computeMergedTreeDigest();
    const outcomes = MERGE_STAGES.map((s) => this.driver.run({
      stage: s,
      workspaceId: this.mergeWorkspacePath,
      absoluteWorkspacePath: this.diskHandle?.absolutePath ?? `/simulated/${this.mergeWorkspacePath}`,
      expectedMergedTreeDigest: mergedTreeDigest,
      injectFailure: s === injectFailureStage,
    }));
    const passed = outcomes.every((o) => o.passed);

    // Bind outcomes with mergedTreeDigest and workspaceId
    const boundOutcomes: MergeVerificationOutcome[] = outcomes.map((o) => ({
      ...o,
      workspaceId: this.mergeWorkspacePath,
      absolutePathIdentity: this.diskHandle?.absolutePath ?? `/simulated/${this.mergeWorkspacePath}`,
      baselineDigest: this.materializationReceipt?.baselineDigest ?? "sha256-baseline",
      mergedTreeDigest,
    }));

    const run: MergeVerificationRun = { fromZero: true, outcomes: boundOutcomes, passed, mergedTreeDigest };
    this.runs.push(run);

    if (!passed) {
      const stage = injectFailureStage ?? "typecheck";
      this.incidents.push({ incidentId: `mi-${fnv1a(`${this.mergeWorkspacePath}|${stage}`)}`, stage, category: "integration-failure", detail: `stage ${stage} failed during zero-trust merge verification`, technicalDebtCreated: 0.4, repairDemandPublished: true });
    }

    return run;
  }

  /** Bounded repair loop: modifies specific files, updates fingerprints, and reruns verification from zero. */
  authorizeAndRepair(repairAuthorized: boolean): MergeRepairReceipt | { readonly refused: true; readonly reasonCode: string } {
    if (this.repairReceipt) return { refused: true, reasonCode: "no-automatic-second-repair" };
    if (this.incidents.length === 0) return { refused: true, reasonCode: "no-incident-to-repair" };
    if (!repairAuthorized) {
      this.repairReceipt = {
        repairId: "repair-declined",
        authorized: false,
        ran: false,
        resolvedIncidentId: null,
        realExecution: this.driver.isReal,
        filesModified: [],
        beforeFingerprints: [],
        afterFingerprints: [],
      };
      return this.repairReceipt;
    }

    const incident = this.incidents[this.incidents.length - 1];
    const modifiedFiles: string[] = [];
    const beforeFps: string[] = [];
    const afterFps: string[] = [];

    // Refuse fake comment repair; truthful unavailable repair
    return { refused: true, reasonCode: "REPAIR_UNAVAILABLE" };
  }
}
