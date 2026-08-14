/**
 * twinBundleRealStore — the REAL, disk-backed `TwinBundleStore`, human-only and
 * NEVER imported by any automated demo or test (those use
 * `InMemoryTwinBundleStore`). It delegates every real read/write to the
 * already-authorized `smokeWorkspace` boundary (`writeLiveObjectiveFile` /
 * `readLiveObjectiveFile`) — this module adds NO new fs importer.
 *
 * It persists exactly two file names per colony workspace root:
 *   bundle.json  — the colony's frozen evidence bundle (once it exists, it is
 *                  the single source of truth; a second write would require a
 *                  fresh mission, never an in-place overwrite of a DIFFERENT
 *                  mission's bundle — enforced by `validateLoadedBundle` on read).
 *   attempt.json — the colony's safe attempt summary when it did NOT freeze.
 */

import { writeLiveObjectiveFile, readLiveObjectiveFile } from "./smokeWorkspace";
import type { SmokeWorkspaceHandle } from "./smokeWorkspace";
import { BUNDLE_RECORD_FILE, ATTEMPT_RECORD_FILE, MAX_RECORD_BYTES, serializeBundle, deserializeBundle, serializeAttempt, deserializeAttempt, guardRecordForWrite } from "../twin/twinBundleStore";
import type { TwinBundleStore, PersistedAttempt, StoreWriteResult, StoreReadResult } from "../twin/twinBundleStore";
import type { ColonyEvidenceBundle } from "../twin/twinColonyTypes";

export class RealTwinBundleStore implements TwinBundleStore {
  /** `workspaceId` -> its already-validated absolute path (from `ensureTwinColonyWorkspace`). */
  private readonly handles = new Map<string, SmokeWorkspaceHandle>();

  /** Register the handle for a colony root once (obtained from `ensureTwinColonyWorkspace`). */
  registerHandle(handle: SmokeWorkspaceHandle): void {
    this.handles.set(handle.workspaceId, handle);
  }

  private handleFor(workspaceId: string): SmokeWorkspaceHandle | null {
    return this.handles.get(workspaceId) ?? null;
  }

  writeBundle(workspaceId: string, bundle: ColonyEvidenceBundle): StoreWriteResult {
    const handle = this.handleFor(workspaceId);
    if (!handle) return { ok: false, reasonCode: "workspace-handle-not-registered" };
    // Colony/mission identity + frozen-digest guard BEFORE any disk contact.
    const guard = guardRecordForWrite(workspaceId, bundle, bundle);
    if (!guard.ok) return { ok: false, reasonCode: guard.reasonCode };
    // No `allowOverwrite`: exclusive creation refuses to clobber an existing
    // bundle, and the write goes through SafeWorkspacePathResolver (symlink /
    // junction / traversal checks + real UTF-8 byte cap).
    const written = writeLiveObjectiveFile(handle, BUNDLE_RECORD_FILE, serializeBundle(bundle), MAX_RECORD_BYTES);
    return { ok: written.ok, reasonCode: written.reasonCode };
  }

  writeAttempt(workspaceId: string, attempt: PersistedAttempt): StoreWriteResult {
    const handle = this.handleFor(workspaceId);
    if (!handle) return { ok: false, reasonCode: "workspace-handle-not-registered" };
    const guard = guardRecordForWrite(workspaceId, attempt);
    if (!guard.ok) return { ok: false, reasonCode: guard.reasonCode };
    const written = writeLiveObjectiveFile(handle, ATTEMPT_RECORD_FILE, serializeAttempt(attempt), MAX_RECORD_BYTES);
    return { ok: written.ok, reasonCode: written.reasonCode };
  }

  readBundle(workspaceId: string): StoreReadResult<ColonyEvidenceBundle> {
    const handle = this.handleFor(workspaceId);
    if (!handle) return { ok: false, reasonCode: "workspace-handle-not-registered" };
    const read = readLiveObjectiveFile(handle, BUNDLE_RECORD_FILE, MAX_RECORD_BYTES);
    if (!read.ok) return { ok: false, reasonCode: read.reasonCode };
    const bundle = deserializeBundle(read.content);
    if (!bundle) return { ok: false, reasonCode: "bundle-parse-failed" };
    return { ok: true, value: bundle };
  }

  readAttempt(workspaceId: string): StoreReadResult<PersistedAttempt> {
    const handle = this.handleFor(workspaceId);
    if (!handle) return { ok: false, reasonCode: "workspace-handle-not-registered" };
    const read = readLiveObjectiveFile(handle, ATTEMPT_RECORD_FILE, MAX_RECORD_BYTES);
    if (!read.ok) return { ok: false, reasonCode: read.reasonCode };
    const attempt = deserializeAttempt(read.content);
    if (!attempt) return { ok: false, reasonCode: "attempt-parse-failed" };
    return { ok: true, value: attempt };
  }
}
