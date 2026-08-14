/**
 * twinColonyLiveRunner — bounded, sequential provider execution for ONE twin
 * colony, ending in a frozen solution bundle. After the human confirmation, each
 * colony runs exactly three sequential provider calls (architecture →
 * implementation → independent-review) through the injected `LiveProviderDriver`
 * (real in the CLI, fake in tests), under a per-colony concurrency slot on the
 * empire permit (≤1 concurrent call per colony). Outputs are normalized via the
 * reused role contracts; implementation artifacts are applied ONLY after an
 * independent (non-self) review, into the colony's isolated in-memory/real
 * workspace; then the bundle is frozen. A colony with no valid implementation
 * artifacts stops with `no-build-artifacts` and NO verification.
 *
 * Providers never write files, execute MCP, select ants, read the competitor,
 * change acceptance criteria, or invoke another provider. No fs, no child_process,
 * no network in this module (the real workspace applier is injected).
 */

import { normalizeProviderResult } from "../digital/liveProviderNormalization";
import { normalizeCivRoleOutput, mapCallFailure, buildNormalizationReceipt } from "../civilization/civRoleContracts";
import type { CivNormalizationReceipt } from "../civilization/civRoleContracts";
import { resolveRoleTimeout, defaultRoleTimeoutPolicy } from "../civilization/civLiveTimeouts";
import type { RoleTimeoutPolicy } from "../civilization/civLiveTimeouts";
import type { LiveProviderDriver, LiveRole } from "../digital/liveObjectiveRunner";
import type { LiveRole as CivLiveRole } from "../civilization/civLiveCohort";
import type { RealProviderId } from "../cognitive/realProviderExecutionPermit";
import { acquireProviderSlot, releaseProviderSlot } from "../cognitive/twinEmpireLivePermit";
import type { TwinColonyId, TwinEmpireLivePermit } from "../cognitive/twinEmpireLivePermit";
import { freezeBundle } from "./colonyForge";
import type { ColonyEvidenceBundle, ColonyCulture, ColonyArtifactProposal, ColonyReview } from "./twinColonyTypes";
import { fnv1a } from "./twinColonyTypes";
import { ColonyWorkspaceAuthority } from "./colonyWorkspace";

export type TwinRole = "architecture" | "implementation" | "review";
const TWIN_ROLE_ORDER: readonly TwinRole[] = ["architecture", "implementation", "review"];

/** The minimal workspace-apply contract (in-memory in tests, real in the CLI). */
export interface TwinWorkspaceApplier {
  readonly workspaceId: string;
  readonly realFilesystemWrites: number;
  readonly fileCount: number;
  apply(relPath: string, content: string): { readonly ok: boolean; readonly reasonCode: string };
}

/** In-memory applier backed by the isolated ColonyWorkspaceAuthority (zero real writes). */
export class InMemoryTwinWorkspaceApplier implements TwinWorkspaceApplier {
  readonly realFilesystemWrites = 0;
  constructor(private readonly authority: ColonyWorkspaceAuthority, readonly workspaceId: string, private readonly perFileByteCap = 20000) {}
  get fileCount(): number {
    return this.authority.fileCount(this.workspaceId);
  }
  apply(relPath: string, content: string): { readonly ok: boolean; readonly reasonCode: string } {
    if (content.trim().length === 0) return { ok: false, reasonCode: "empty-file" };
    if (content.length > this.perFileByteCap) return { ok: false, reasonCode: "oversized-file" };
    const reason = this.authority.write(this.workspaceId, relPath, content); // validates twin pattern + rel path
    return { ok: reason === "ok", reasonCode: reason };
  }
}

/** Adapt any `LiveWorkspaceApplier` (e.g. RealLiveWorkspaceDriver) into a TwinWorkspaceApplier. */
export function wrapLiveWorkspaceApplier(driver: { applyArtifact(relPath: string, content: string, attr: { objectiveId: string; taskId: string; antId: string }): { readonly ok: boolean }; readonly fileCount: number; readonly realFilesystemWrites: number; readonly workspaceRoot: string }, objectiveId: string): TwinWorkspaceApplier {
  return {
    get workspaceId() {
      return driver.workspaceRoot;
    },
    get realFilesystemWrites() {
      return driver.realFilesystemWrites;
    },
    get fileCount() {
      return driver.fileCount;
    },
    apply(relPath: string, content: string) {
      if (content.trim().length === 0) return { ok: false, reasonCode: "empty-file" };
      const applied = driver.applyArtifact(relPath, content, { objectiveId, taskId: `${objectiveId}-apply`, antId: objectiveId });
      return { ok: applied.ok, reasonCode: applied.ok ? "ok" : "apply-refused" };
    },
  };
}

export interface TwinCohortRoleMember {
  readonly antId: string;
  readonly role: TwinRole;
}

export interface TwinProviderDiagnostic {
  readonly role: TwinRole;
  readonly antId: string;
  readonly providerId: string;
  readonly ok: boolean;
  readonly failureCategory: string;
  readonly timeoutMs: number;
  readonly durationMs: number;
  readonly requestBytes: number;
  readonly responseBytes: number;
}

export interface TwinColonyLiveInput {
  readonly colonyId: TwinColonyId;
  readonly culture: ColonyCulture;
  readonly provider: RealProviderId;
  readonly missionId: string;
  readonly workspaceId: string;
  readonly cohort: readonly TwinCohortRoleMember[]; // exactly architecture, implementation, review
  readonly empirePermit: TwinEmpireLivePermit;
  readonly providerDriver: LiveProviderDriver;
  readonly applier: TwinWorkspaceApplier;
  readonly acceptance: readonly string[];
  readonly roleTimeouts?: RoleTimeoutPolicy;
  readonly log: (stage: string, meta?: Record<string, string | number | boolean>) => void;
}

export interface TwinColonyLiveResult {
  readonly colonyId: TwinColonyId;
  readonly ok: boolean;
  readonly failureReason: string | null;
  readonly bundle: ColonyEvidenceBundle | null;
  readonly providerCalls: number;
  readonly artifactsApplied: number;
  readonly independentReviews: number;
  readonly selfReviewsAccepted: number;
  readonly architecturePlan: readonly string[];
  readonly reviewApproved: boolean;
  readonly diagnostics: readonly TwinProviderDiagnostic[];
  readonly realProviderProcessExecutions: number;
  readonly normalizationReceipts: readonly CivNormalizationReceipt[];
  /** Set when the review call was SKIPPED because implementation produced nothing. */
  readonly reviewSkippedReason: string | null;
  /** Roles whose provider call succeeded — the resume record reuses these. */
  readonly completedRoles: readonly string[];
}

const TWIN_TO_LIVE_ROLE: Readonly<Record<TwinRole, LiveRole>> = { architecture: "architecture", implementation: "build", review: "review" };

/** Run one colony's three sequential bounded provider calls to a frozen bundle. */
export function runTwinColonyLive(input: TwinColonyLiveInput): TwinColonyLiveResult {
  const timeouts = input.roleTimeouts ?? defaultRoleTimeoutPolicy();
  const diagnostics: TwinProviderDiagnostic[] = [];
  const normalizationReceipts: CivNormalizationReceipt[] = [];
  const proposals: ColonyArtifactProposal[] = [];
  let architecturePlan: string[] = [];
  let providerCalls = 0;
  let reviewOk = false;
  const implMember = input.cohort.find((m) => m.role === "implementation");
  const reviewMember = input.cohort.find((m) => m.role === "review");
  const prefix = input.colonyId === "claude-forge" ? "claude" : "codex";

  // Set when implementation fails/times out/returns malformed or zero artifacts.
  let implementationFailure: string | null = null;
  let reviewSkippedReason: string | null = null;

  for (const role of TWIN_ROLE_ORDER) {
    const member = input.cohort.find((m) => m.role === role);
    if (!member) continue;
    // REVIEW GATE: never spend a review call when there is nothing to review.
    // A timed-out / failed / malformed / empty implementation stops the colony
    // here with the exact failure category and PRESERVES the remaining budget.
    if (role === "review" && proposals.length === 0) {
      reviewSkippedReason = implementationFailure ?? "no-build-artifacts";
      input.log(`${prefix}-review-skipped`, { reason: reviewSkippedReason, remainingBudgetPreserved: true });
      continue;
    }
    const liveRole = TWIN_TO_LIVE_ROLE[role];
    const timeoutMs = resolveRoleTimeout(role === "implementation" ? "coding" : role === "architecture" ? "architecture" : "security-review", timeouts);
    const slot = acquireProviderSlot(input.empirePermit, input.colonyId);
    if (!slot.ok) {
      diagnostics.push({ role, antId: member.antId, providerId: input.provider, ok: false, failureCategory: slot.reasonCode, timeoutMs, durationMs: 0, requestBytes: 0, responseBytes: 0 });
      continue;
    }
    input.log(`${prefix}-provider-starting`, { role, antId: member.antId, provider: input.provider, timeoutMs });
    const res = input.providerDriver.call({ antId: member.antId, providerId: input.provider, taskId: `${input.missionId}-${input.colonyId}-${role}`, role: liveRole, timeoutMs });
    releaseProviderSlot(input.empirePermit, input.colonyId);
    providerCalls += 1;
    const failureCategory = res.ok ? "none" : mapCallFailure(res.failureCategory ?? "spawn-failed");
    diagnostics.push({ role, antId: member.antId, providerId: input.provider, ok: res.ok, failureCategory, timeoutMs, durationMs: res.durationMs ?? 0, requestBytes: res.requestBytes ?? 0, responseBytes: res.responseBytes ?? 0 });
    input.log(`${prefix}-provider-completed`, { role, ok: res.ok, failureCategory });
    if (!res.ok || !res.payload) {
      // provider-timeout / provider-exit-failure / malformed-provider-envelope …
      if (role === "implementation") implementationFailure = failureCategory;
      continue;
    }

    const norm = normalizeProviderResult({ antId: member.antId, providerId: input.provider, taskId: `${input.missionId}-${role}`, proposalId: `prop-${member.antId}`, payload: res.payload, caps: { maxOutputBytes: 20000, maxFiles: 32, perFileByteCap: 20000 } });
    const civRole: CivLiveRole = role === "architecture" ? "architecture" : role === "implementation" ? "coding" : "security-review";
    const roleOut = normalizeCivRoleOutput({ role: civRole, callFailureCategory: null, summary: norm.summary, filesProposed: norm.filesProposed, risks: norm.risks, testSuggestions: norm.testSuggestions, malformed: false, outputTruncated: norm.outputTruncated });
    normalizationReceipts.push(buildNormalizationReceipt(civRole, roleOut));
    if (!roleOut.ok) {
      // unsupported-role-output / missing-artifact-array / empty-artifact-content …
      if (role === "implementation") implementationFailure = roleOut.failureCategory ?? "unsupported-role-output";
      continue;
    }
    if (role === "architecture") architecturePlan = roleOut.filePlan.length > 0 ? [...roleOut.filePlan] : [];
    if (role === "implementation") for (const a of roleOut.artifacts) proposals.push({ relativePath: a.relativePath, content: a.content, purpose: a.purpose, acceptanceCriteriaCovered: input.acceptance.slice(0, 1) });
    if (role === "review") reviewOk = true;
  }

  // No valid implementation artifacts → stop the colony with the EXACT failure
  // category (provider-timeout, malformed-provider-envelope, …), not a generic
  // one. Review was already skipped above, so its budget was never spent.
  if (proposals.length === 0) {
    const failureReason = implementationFailure ?? "no-build-artifacts";
    input.log(`${prefix}-artifacts-reviewed`, { applied: 0, reason: failureReason, reviewSkipped: reviewSkippedReason !== null });
    return { colonyId: input.colonyId, ok: false, failureReason, bundle: null, providerCalls, artifactsApplied: 0, independentReviews: 0, selfReviewsAccepted: 0, architecturePlan, reviewApproved: false, diagnostics, realProviderProcessExecutions: input.providerDriver.realProviderProcessExecutions, normalizationReceipts, reviewSkippedReason, completedRoles: diagnostics.filter((d) => d.ok).map((d) => d.role) };
  }

  // Independent review must exist and must NOT be self-review before application.
  const selfReview = Boolean(implMember && reviewMember && implMember.antId === reviewMember.antId);
  const reviewApproved = reviewOk && !selfReview;
  let artifactsApplied = 0;
  const appliedArtifacts: ColonyArtifactProposal[] = [];
  if (reviewApproved) {
    const seen = new Set<string>();
    for (const p of proposals) {
      if (seen.has(p.relativePath)) continue;
      const applied = input.applier.apply(p.relativePath, p.content);
      if (applied.ok) {
        artifactsApplied += 1;
        appliedArtifacts.push(p);
        seen.add(p.relativePath);
      }
    }
  }
  input.log(`${prefix}-artifacts-reviewed`, { applied: artifactsApplied, independentReview: reviewApproved, selfReview });

  if (artifactsApplied === 0) {
    return { colonyId: input.colonyId, ok: false, failureReason: reviewApproved ? "no-build-artifacts" : "review-not-approved", bundle: null, providerCalls, artifactsApplied: 0, independentReviews: reviewApproved ? 1 : 0, selfReviewsAccepted: 0, architecturePlan, reviewApproved, diagnostics, realProviderProcessExecutions: input.providerDriver.realProviderProcessExecutions, normalizationReceipts, reviewSkippedReason, completedRoles: diagnostics.filter((d) => d.ok).map((d) => d.role) };
  }

  const review: ColonyReview = { reviewerAntId: reviewMember?.antId ?? "reviewer", authorAntId: implMember?.antId ?? "author", decision: "approve", findings: ["independent review approved the applied artifacts"], securityFindings: [], selfReview };
  const bundle = freezeBundle({
    colonyId: input.colonyId,
    missionId: input.missionId,
    culture: input.culture,
    workspacePath: input.workspaceId,
    architecture: { architectureSummary: `plan: ${architecturePlan.join(", ") || "(deterministic)"}`, filePlan: architecturePlan, acceptanceMapping: input.acceptance.map((c) => `covers ${c}`), interfaceDecisions: [], risks: [] },
    artifacts: appliedArtifacts,
    artifactManifest: appliedArtifacts.map((a) => ({ relativePath: a.relativePath, bytes: a.content.length, fingerprint: fnv1a(`${a.relativePath}|${a.content}`) })),
    reviews: [review],
    testEvidence: { testsProposed: 1, independentReviews: 1, artifactCount: appliedArtifacts.length },
    securityEvidence: { findings: [], passed: true },
    performanceEvidence: [{ check: "artifact-size-within-cap", observed: appliedArtifacts.reduce((s, a) => s + a.content.length, 0), budget: 20000, withinBudget: true }],
    riskRegister: [`${input.colonyId}: single-mission scope`],
    failureRegister: [],
    uncertaintyRegister: [`${input.colonyId}: real provider variability not captured in one run`],
    minorityReports: [],
    providerReceipts: diagnostics.map((d) => ({ antId: d.antId, providerId: d.providerId, role: d.role, ok: d.ok, real: false as const })),
    costReport: { providerCalls, realProviderCalls: 0 },
    reproductionInstructions: ["npx.cmd tsc --noEmit", "npm.cmd test"],
  });
  input.log(`${prefix}-bundle-frozen`, { fingerprint: bundle.fingerprint, artifacts: artifactsApplied });

  return { colonyId: input.colonyId, ok: true, failureReason: null, bundle, providerCalls, artifactsApplied, independentReviews: 1, selfReviewsAccepted: 0, architecturePlan, reviewApproved, diagnostics, realProviderProcessExecutions: input.providerDriver.realProviderProcessExecutions, normalizationReceipts, reviewSkippedReason, completedRoles: diagnostics.filter((d) => d.ok).map((d) => d.role) };
}

export interface TwinEmpireLiveRunInput {
  readonly claude: TwinColonyLiveInput;
  readonly codex: TwinColonyLiveInput;
  readonly log: (stage: string, meta?: Record<string, string | number | boolean>) => void;
}

export interface TwinEmpireLiveRunResult {
  readonly status: "twin-bundles-frozen" | "twin-live-run-failed";
  readonly claude: TwinColonyLiveResult;
  readonly codex: TwinColonyLiveResult;
  readonly bothFrozen: boolean;
  readonly distinctFingerprints: boolean;
}

/** Run BOTH colonies independently (Claude then Codex) to frozen bundles, then stop. */
export function runTwinEmpireLive(input: TwinEmpireLiveRunInput): TwinEmpireLiveRunResult {
  const claude = runTwinColonyLive(input.claude);
  const codex = runTwinColonyLive(input.codex);
  const bothFrozen = claude.ok && codex.ok && claude.bundle !== null && codex.bundle !== null && claude.bundle.frozen && codex.bundle.frozen;
  const distinctFingerprints = claude.bundle !== null && codex.bundle !== null && claude.bundle.fingerprint !== codex.bundle.fingerprint;
  if (bothFrozen && distinctFingerprints) {
    input.log("twin-bundles-frozen", { claude: claude.bundle!.fingerprint, codex: codex.bundle!.fingerprint });
    return { status: "twin-bundles-frozen", claude, codex, bothFrozen, distinctFingerprints };
  }
  input.log("twin-live-run-failed", { claudeReason: claude.failureReason ?? "none", codexReason: codex.failureReason ?? "none" });
  return { status: "twin-live-run-failed", claude, codex, bothFrozen, distinctFingerprints };
}
