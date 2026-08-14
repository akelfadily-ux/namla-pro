/**
 * twinResumeState — the safe, resumable record for a PARTIALLY successful twin
 * empire run: one colony froze its bundle, the other failed mid-flight. The
 * record lets the human resume ONLY the failed colony, reusing the failed
 * colony's already-completed roles and PRESERVING the successful colony's frozen
 * bundle untouched (no rerun, no workspace change, no new provider calls for it).
 *
 * It carries safe scalars only — ids, roles, categories, counts, fingerprints —
 * never credentials, prompts, raw provider output, or environment values.
 *
 * No fs, no child_process, no network, no wall clock.
 */

import type { ColonyEvidenceBundle } from "./twinColonyTypes";
import { fnv1a } from "./twinColonyTypes";
import { verifyBundleImmutable, validateFrozenBundle } from "./frozenBundleValidator";
import type { TwinColonyId } from "../cognitive/twinEmpireLivePermit";
import type { TwinColonyLiveResult } from "./twinColonyLiveRunner";
import type { PersistedAttempt } from "./twinBundleStore";

/** Repair runs get their own numbered area so earlier output is never overwritten. */
export const REPAIR_AREA_PREFIX = "repair" as const;
/** The repair implementation call may run longer than a first-attempt call. */
export const MAX_REPAIR_IMPLEMENTATION_TIMEOUT_MS = 900000 as const;
/** A resume may spend at most one implementation + one review call. */
export const MAX_RESUME_ADDITIONAL_CALLS = 2 as const;

export type ResumeStatus = "resumable" | "not-resumable" | "already-complete";

export interface TwinProviderReceiptSummary {
  readonly role: string;
  readonly providerId: string;
  readonly ok: boolean;
  readonly failureCategory: string;
  readonly timeoutMs: number;
  readonly durationMs: number;
  readonly requestBytes: number;
  readonly responseBytes: number;
}

export interface TwinResumeRecord {
  readonly missionId: string;
  readonly failedColony: TwinColonyId;
  readonly successfulColony: TwinColonyId;
  readonly successfulBundleFingerprint: string;
  readonly completedRoles: readonly string[];
  readonly failedRole: string;
  readonly failureCategory: string;
  readonly remainingCallBudget: number;
  readonly workspaceFingerprints: { readonly failedColony: string; readonly successfulColony: string };
  readonly providerReceipts: readonly TwinProviderReceiptSummary[];
  readonly resumeStatus: ResumeStatus;
  readonly repairArea: string;
  readonly recordFingerprint: string;
}

/**
 * The minimal SAFE shape both callers (a live in-process run, or a record
 * reloaded from disk in a SEPARATE later CLI invocation) can supply. Building
 * the resume record from this common core means the two callers below can never
 * diverge in their resumeStatus/failedRole/fingerprint logic.
 */
interface ResumeRecordCoreInput {
  readonly missionId: string;
  readonly failedColony: TwinColonyId;
  readonly successfulColony: TwinColonyId;
  readonly successfulOk: boolean;
  readonly successfulBundleFingerprint: string;
  readonly successfulProviderCalls: number;
  readonly failedOk: boolean;
  readonly failedCompletedRoles: readonly string[];
  readonly failedDiagnostics: readonly TwinProviderReceiptSummary[];
  readonly failedFailureReason: string | null;
  readonly failedReviewSkippedReason: string | null;
  readonly failedProviderCalls: number;
  readonly failedArtifactsApplied: number;
  readonly totalCallBudget: number;
  readonly repairAttempt?: number;
}

function buildResumeRecordCore(input: ResumeRecordCoreInput): TwinResumeRecord {
  const { missionId, successfulBundleFingerprint } = input;
  const spent = input.failedProviderCalls + input.successfulProviderCalls;
  const remainingCallBudget = Math.max(0, input.totalCallBudget - spent);
  // The failed role is the first role whose provider call did not succeed; if all
  // calls succeeded the failure came from normalization/review gating.
  const failedDiag = input.failedDiagnostics.find((d) => !d.ok);
  const failedRole = failedDiag ? failedDiag.role : input.failedReviewSkippedReason ? "implementation" : "unknown";
  const failureCategory = input.failedFailureReason ?? failedDiag?.failureCategory ?? "unknown";
  const resumeStatus: ResumeStatus =
    input.successfulOk && successfulBundleFingerprint.length > 0 && !input.failedOk && remainingCallBudget >= MAX_RESUME_ADDITIONAL_CALLS ? "resumable" : input.successfulOk && input.failedOk ? "already-complete" : "not-resumable";
  const repairArea = `${REPAIR_AREA_PREFIX}-${Math.max(1, Math.floor(input.repairAttempt ?? 1))}`;
  const workspaceFingerprints = {
    failedColony: fnv1a(`${missionId}|${input.failedColony}|artifacts=${input.failedArtifactsApplied}`),
    successfulColony: fnv1a(`${missionId}|${input.successfulColony}|${successfulBundleFingerprint}`),
  };
  const recordFingerprint = fnv1a(`${missionId}|${input.failedColony}|${failureCategory}|${successfulBundleFingerprint}|${repairArea}`);
  return {
    missionId,
    failedColony: input.failedColony,
    successfulColony: input.successfulColony,
    successfulBundleFingerprint,
    completedRoles: [...input.failedCompletedRoles],
    failedRole,
    failureCategory,
    remainingCallBudget,
    workspaceFingerprints,
    providerReceipts: [...input.failedDiagnostics],
    resumeStatus,
    repairArea,
    recordFingerprint,
  };
}

/** Build the resume record from two LIVE, in-process colony results. Safe fields only. */
export function buildTwinResumeRecord(input: {
  readonly missionId: string;
  readonly failed: TwinColonyLiveResult;
  readonly successful: TwinColonyLiveResult;
  readonly totalCallBudget: number;
  readonly repairAttempt?: number;
}): TwinResumeRecord {
  const { missionId, failed, successful } = input;
  return buildResumeRecordCore({
    missionId,
    failedColony: failed.colonyId,
    successfulColony: successful.colonyId,
    successfulOk: successful.ok,
    successfulBundleFingerprint: successful.bundle?.fingerprint ?? "",
    successfulProviderCalls: successful.providerCalls,
    failedOk: failed.ok,
    failedCompletedRoles: failed.completedRoles,
    failedDiagnostics: failed.diagnostics.map((d) => ({ role: d.role, providerId: d.providerId, ok: d.ok, failureCategory: d.failureCategory, timeoutMs: d.timeoutMs, durationMs: d.durationMs, requestBytes: d.requestBytes, responseBytes: d.responseBytes })),
    failedFailureReason: failed.failureReason,
    failedReviewSkippedReason: failed.reviewSkippedReason,
    failedProviderCalls: failed.providerCalls,
    failedArtifactsApplied: failed.artifactsApplied,
    totalCallBudget: input.totalCallBudget,
    repairAttempt: input.repairAttempt,
  });
}

/**
 * Build the resume record from PERSISTED records reloaded in a SEPARATE, later
 * CLI invocation (the first live run already exited). The successful colony's
 * bundle and the failed colony's attempt summary are both loaded from a
 * `TwinBundleStore` — never fabricated. Callers MUST validate each record with
 * `validateLoadedBundle` / `validateLoadedAttempt` before calling this.
 */
export function buildTwinResumeRecordFromPersisted(input: {
  readonly missionId: string;
  readonly failedColony: TwinColonyId;
  readonly successfulColony: TwinColonyId;
  readonly successfulBundle: ColonyEvidenceBundle;
  readonly failedAttempt: PersistedAttempt;
  readonly totalCallBudget: number;
  readonly repairAttempt?: number;
}): TwinResumeRecord {
  return buildResumeRecordCore({
    missionId: input.missionId,
    failedColony: input.failedColony,
    successfulColony: input.successfulColony,
    successfulOk: true,
    successfulBundleFingerprint: input.successfulBundle.fingerprint,
    successfulProviderCalls: input.successfulBundle.costReport.providerCalls,
    failedOk: input.failedAttempt.ok,
    failedCompletedRoles: input.failedAttempt.completedRoles,
    failedDiagnostics: input.failedAttempt.diagnostics.map((d) => ({ role: d.role, providerId: d.providerId, ok: d.ok, failureCategory: d.failureCategory, timeoutMs: d.timeoutMs, durationMs: d.durationMs, requestBytes: d.requestBytes, responseBytes: d.responseBytes })),
    failedFailureReason: input.failedAttempt.failureReason,
    failedReviewSkippedReason: input.failedAttempt.reviewSkippedReason,
    failedProviderCalls: input.failedAttempt.providerCalls,
    failedArtifactsApplied: input.failedAttempt.artifactsApplied,
    totalCallBudget: input.totalCallBudget,
    repairAttempt: input.repairAttempt,
  });
}

export type PreservationVerdict = { readonly ok: true } | { readonly ok: false; readonly reasonCode: string };

/**
 * Verify the successful colony's frozen bundle is unchanged and reusable for THIS
 * mission only. A mismatched mission, a mutated digest, or an invalid bundle
 * refuses reuse — the resume must fail closed rather than trust stale evidence.
 */
export function verifyPreservedBundle(bundle: ColonyEvidenceBundle | null, record: TwinResumeRecord): PreservationVerdict {
  if (!bundle) return { ok: false, reasonCode: "preserved-bundle-missing" };
  if (bundle.missionId !== record.missionId) return { ok: false, reasonCode: "preserved-bundle-mission-mismatch" };
  if (bundle.colonyId !== record.successfulColony) return { ok: false, reasonCode: "preserved-bundle-colony-mismatch" };
  if (bundle.fingerprint !== record.successfulBundleFingerprint) return { ok: false, reasonCode: "preserved-bundle-fingerprint-mismatch" };
  if (!bundle.frozen) return { ok: false, reasonCode: "preserved-bundle-not-frozen" };
  if (!verifyBundleImmutable(bundle)) return { ok: false, reasonCode: "preserved-bundle-mutated" };
  if (!validateFrozenBundle(bundle).valid) return { ok: false, reasonCode: "preserved-bundle-invalid" };
  return { ok: true };
}

/** The isolated repair workspace for a resumed colony — never the original area. */
export function repairWorkspaceId(missionId: string, colony: TwinColonyId, repairArea: string): string {
  return `workspaces/namola-twin/${missionId}/${colony}/${repairArea}`;
}
