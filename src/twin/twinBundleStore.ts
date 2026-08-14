/**
 * twinBundleStore — the persistence CONTRACT for a colony's frozen bundle or
 * failed attempt, so a later `twin:resume` process (a separate CLI invocation)
 * can reload the successful colony's evidence and the failed colony's safe
 * attempt summary without rerunning anything or fabricating evidence.
 *
 * This module is pure: an interface, an in-memory fake (used by automated
 * tests), and validation logic only. The REAL disk-backed implementation lives
 * in `src/cognitive/twinBundleRealStore.ts` (human-only, wired through the
 * already-authorized `smokeWorkspace` read/write boundary) — never imported by
 * any demo or test.
 *
 * Persisted content is the bundle/attempt itself (the colony's own work product
 * and safe diagnostics) — never credentials, prompts, raw provider stdout, or
 * environment values.
 *
 * No fs, no child_process, no network, no wall clock.
 */

import type { ColonyEvidenceBundle, ColonyId } from "./twinColonyTypes";
import { fnv1a, bundleCanonicalProjection } from "./twinColonyTypes";
import type { TwinProviderDiagnostic } from "./twinColonyLiveRunner";
import { redactedText } from "../cognitive/safeRedactor";

export const BUNDLE_RECORD_FILE = "bundle.json" as const;
export const ATTEMPT_RECORD_FILE = "attempt.json" as const;
/** Bounded read/write cap for a persisted colony record. */
export const MAX_RECORD_BYTES = 262144 as const;

/** The safe, persistable shape of a FAILED (or not-yet-frozen) colony attempt. */
export interface PersistedAttempt {
  readonly colonyId: ColonyId;
  readonly missionId: string;
  readonly ok: boolean;
  readonly failureReason: string | null;
  readonly reviewSkippedReason: string | null;
  readonly completedRoles: readonly string[];
  readonly providerCalls: number;
  readonly artifactsApplied: number;
  readonly diagnostics: readonly TwinProviderDiagnostic[];
  readonly architecturePlan: readonly string[];
  readonly recordFingerprint: string;
}

export function buildPersistedAttempt(input: { readonly colonyId: ColonyId; readonly missionId: string; readonly ok: boolean; readonly failureReason: string | null; readonly reviewSkippedReason: string | null; readonly completedRoles: readonly string[]; readonly providerCalls: number; readonly artifactsApplied: number; readonly diagnostics: readonly TwinProviderDiagnostic[]; readonly architecturePlan: readonly string[] }): PersistedAttempt {
  // Fail-closed: redact the provider-derived free text HERE, so a caller that
  // forgets cannot leak a secret into a persisted attempt. Redaction is
  // idempotent (markers are never re-redacted), so an already-safe caller is
  // unaffected. The fingerprint is computed over the REDACTED reason only.
  const failureReason = input.failureReason === null ? null : redactedText(input.failureReason, 2000);
  const reviewSkippedReason = input.reviewSkippedReason === null ? null : redactedText(input.reviewSkippedReason, 500);
  const diagnostics = input.diagnostics.map((d) => ({ ...d, failureCategory: redactedText(d.failureCategory, 500) }));
  const recordFingerprint = fnv1a(`${input.missionId}|${input.colonyId}|${failureReason ?? "none"}|${input.completedRoles.join(",")}|${input.providerCalls}`);
  return { ...input, failureReason, reviewSkippedReason, diagnostics, recordFingerprint };
}

export type StoreWriteResult = { readonly ok: boolean; readonly reasonCode: string };
export type StoreReadResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reasonCode: string };

/** The persistence contract. `workspaceId` is always the colony's OWN root (never the competitor's, never a repair area). */
export interface TwinBundleStore {
  writeBundle(workspaceId: string, bundle: ColonyEvidenceBundle): StoreWriteResult;
  writeAttempt(workspaceId: string, attempt: PersistedAttempt): StoreWriteResult;
  readBundle(workspaceId: string): StoreReadResult<ColonyEvidenceBundle>;
  readAttempt(workspaceId: string): StoreReadResult<PersistedAttempt>;
}

/**
 * Derive the colony that OWNS a workspace root, including a `/repair-N` area.
 * A record may only ever be stored under its own colony's root — this is what
 * makes cross-colony substitution impossible at the STORE layer, before any
 * read-side validation.
 */
export function colonyOfWorkspaceId(workspaceId: string): ColonyId | null {
  if (/\/claude-forge(\/repair-\d+)?$/.test(workspaceId)) return "claude-forge";
  if (/\/codex-crucible(\/repair-\d+)?$/.test(workspaceId)) return "codex-crucible";
  return null;
}

/** The mission segment of a twin workspace id, or null when it is not a twin root. */
export function missionOfWorkspaceId(workspaceId: string): string | null {
  const m = workspaceId.match(/^workspaces\/namola-twin\/([a-z0-9-]{1,64})\/(?:claude-forge|codex-crucible)(?:\/repair-\d+)?$/);
  return m ? m[1] : null;
}

/**
 * The WRITE-side guard every store must apply: the record's own colony/mission
 * must match the workspace root it is being written to, and a bundle must be
 * genuinely frozen with a digest that still recomputes. This refuses a Codex
 * bundle written under a Claude root even before it could ever be read back.
 */
export function guardRecordForWrite(workspaceId: string, record: { readonly colonyId: ColonyId; readonly missionId: string }, bundle?: ColonyEvidenceBundle): { readonly ok: true } | { readonly ok: false; readonly reasonCode: string } {
  const owner = colonyOfWorkspaceId(workspaceId);
  if (!owner) return { ok: false, reasonCode: "workspace-not-a-twin-colony-root" };
  if (owner !== record.colonyId) return { ok: false, reasonCode: "cross-colony-write-refused" };
  const mission = missionOfWorkspaceId(workspaceId);
  if (mission !== null && mission !== record.missionId) return { ok: false, reasonCode: "cross-mission-write-refused" };
  if (bundle) {
    if (!bundle.frozen) return { ok: false, reasonCode: "bundle-not-frozen" };
    if (fnv1a(bundleCanonicalProjection(bundle)) !== bundle.fingerprint) return { ok: false, reasonCode: "bundle-fingerprint-mismatch" };
  }
  return { ok: true };
}

/**
 * Deterministic in-memory fake — the ONLY store automated tests may use.
 * Mission- and colony-scoped, and it NEVER silently overwrites: a frozen bundle
 * is write-once, matching the real store's exclusive-creation semantics.
 */
export class InMemoryTwinBundleStore implements TwinBundleStore {
  private readonly bundles = new Map<string, ColonyEvidenceBundle>();
  private readonly attempts = new Map<string, PersistedAttempt>();

  writeBundle(workspaceId: string, bundle: ColonyEvidenceBundle): StoreWriteResult {
    const guard = guardRecordForWrite(workspaceId, bundle, bundle);
    if (!guard.ok) return { ok: false, reasonCode: guard.reasonCode };
    if (this.bundles.has(workspaceId)) return { ok: false, reasonCode: "file-exists-refused-overwrite" };
    this.bundles.set(workspaceId, bundle);
    return { ok: true, reasonCode: "ok" };
  }

  writeAttempt(workspaceId: string, attempt: PersistedAttempt): StoreWriteResult {
    const guard = guardRecordForWrite(workspaceId, attempt);
    if (!guard.ok) return { ok: false, reasonCode: guard.reasonCode };
    if (this.attempts.has(workspaceId)) return { ok: false, reasonCode: "file-exists-refused-overwrite" };
    this.attempts.set(workspaceId, attempt);
    return { ok: true, reasonCode: "ok" };
  }

  readBundle(workspaceId: string): StoreReadResult<ColonyEvidenceBundle> {
    const b = this.bundles.get(workspaceId);
    return b ? { ok: true, value: b } : { ok: false, reasonCode: "bundle-not-found" };
  }

  readAttempt(workspaceId: string): StoreReadResult<PersistedAttempt> {
    const a = this.attempts.get(workspaceId);
    return a ? { ok: true, value: a } : { ok: false, reasonCode: "attempt-not-found" };
  }
}

/**
 * Validate a bundle loaded from ANY store (real or fake) against the mission and
 * colony it is being reused for, and recompute its digest — a tampered, stale,
 * or mismatched bundle is refused rather than trusted. Reuse is marked valid
 * ONLY for the exact mission it was frozen under.
 */
export function validateLoadedBundle(bundle: ColonyEvidenceBundle, expectedMissionId: string, expectedColony: ColonyId): { readonly ok: true } | { readonly ok: false; readonly reasonCode: string } {
  if (bundle.missionId !== expectedMissionId) return { ok: false, reasonCode: "bundle-mission-mismatch" };
  if (bundle.colonyId !== expectedColony) return { ok: false, reasonCode: "bundle-colony-mismatch" };
  if (!bundle.frozen) return { ok: false, reasonCode: "bundle-not-frozen" };
  const recomputed = fnv1a(bundleCanonicalProjection(bundle));
  if (recomputed !== bundle.fingerprint) return { ok: false, reasonCode: "bundle-fingerprint-mismatch" };
  return { ok: true };
}

/** Same mission/colony guard for a loaded attempt record. */
export function validateLoadedAttempt(attempt: PersistedAttempt, expectedMissionId: string, expectedColony: ColonyId): { readonly ok: true } | { readonly ok: false; readonly reasonCode: string } {
  if (attempt.missionId !== expectedMissionId) return { ok: false, reasonCode: "attempt-mission-mismatch" };
  if (attempt.colonyId !== expectedColony) return { ok: false, reasonCode: "attempt-colony-mismatch" };
  const recomputed = fnv1a(`${attempt.missionId}|${attempt.colonyId}|${attempt.failureReason ?? "none"}|${attempt.completedRoles.join(",")}|${attempt.providerCalls}`);
  if (recomputed !== attempt.recordFingerprint) return { ok: false, reasonCode: "attempt-fingerprint-mismatch" };
  return { ok: true };
}

/** JSON round-trip helpers used by both the real store and tests. */
export function serializeBundle(bundle: ColonyEvidenceBundle): string {
  return JSON.stringify(bundle);
}
export function deserializeBundle(raw: string): ColonyEvidenceBundle | null {
  try {
    return JSON.parse(raw) as ColonyEvidenceBundle;
  } catch {
    return null;
  }
}
export function serializeAttempt(attempt: PersistedAttempt): string {
  return JSON.stringify(attempt);
}
export function deserializeAttempt(raw: string): PersistedAttempt | null {
  try {
    return JSON.parse(raw) as PersistedAttempt;
  } catch {
    return null;
  }
}
