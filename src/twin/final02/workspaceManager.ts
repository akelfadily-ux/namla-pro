/**
 * src/twin/final02/workspaceManager.ts — Workspace Lifecycle & Rollback Manager for FINAL-02.
 *
 * Manages creation of disposable execution-specific merge workspaces under authorized root
 * (workspaces/namola-twin/<missionId>/merge-forge/<executionId>),
 * enforces path security, guarantees stale file cleanup prior to materialization,
 * computes canonical full-tree disk digests, and executes real disk rollback.
 */

import { rmSync, existsSync, mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { ensureTwinColonyWorkspace, writeLiveObjectiveFile } from "../../cognitive/smokeWorkspace";
import type { RollbackReceipt, TreeDigestReceipt } from "./contracts";
import { calculateTreeDigestFromDisk } from "./treeDigest";

export class DisposableWorkspaceManager {
  private diskHandle: { workspaceId: string; absolutePath: string } | null = null;
  private readonly files = new Map<string, string>();
  private rolledBack = false;

  constructor(readonly workspaceId: string) {}

  get fileMap(): ReadonlyMap<string, string> {
    return this.files;
  }
  get isRolledBack(): boolean {
    return this.rolledBack;
  }
  get handle(): { workspaceId: string; absolutePath: string } | null {
    return this.diskHandle;
  }

  /**
   * Static factory ensuring a clean, execution-scoped workspace without stale files.
   */
  static createFresh(missionId: string, executionId: string): DisposableWorkspaceManager {
    const workspaceId = `workspaces/namola-twin/${missionId}/merge-forge/${executionId}`;
    const mgr = new DisposableWorkspaceManager(workspaceId);
    mgr.initializeFresh();
    return mgr;
  }

  /**
   * Initializes real disposable workspace directory on disk, purging any pre-existing stale contents.
   */
  initializeFresh(): { readonly ok: true; readonly handle: { workspaceId: string; absolutePath: string } } | { readonly ok: false; readonly reasonCode: string } {
    const ensured = ensureTwinColonyWorkspace(this.workspaceId);
    if (!ensured.ok || !ensured.handle) {
      return { ok: false, reasonCode: ensured.ok ? "no-handle" : ensured.reasonCode };
    }

    this.diskHandle = ensured.handle;

    // Purge stale contents inside workspace directory to guarantee clean slate
    if (existsSync(this.diskHandle.absolutePath)) {
      try {
        rmSync(this.diskHandle.absolutePath, { recursive: true, force: true });
        mkdirSync(this.diskHandle.absolutePath, { recursive: true });
      } catch {
        return { ok: false, reasonCode: "stale-workspace-purge-failed" };
      }
    }

    // Symlink root node_modules into workspace for offline local toolchain execution
    const rootNodeModules = join(process.cwd(), "node_modules");
    const wsNodeModules = join(this.diskHandle.absolutePath, "node_modules");
    if (existsSync(rootNodeModules) && !existsSync(wsNodeModules)) {
      try {
        symlinkSync(rootNodeModules, wsNodeModules, "dir");
      } catch {
        // ignore if non-symlinkable
      }
    }

    return { ok: true, handle: ensured.handle };
  }

  /**
   * Writes file content to memory and disk.
   */
  writeFile(relPath: string, content: string): boolean {
    if (this.rolledBack) return false;
    this.files.set(relPath, content);
    if (this.diskHandle) {
      const res = writeLiveObjectiveFile(this.diskHandle, relPath, content, 100000, { allowOverwrite: true });
      return res.ok;
    }
    return true;
  }

  /**
   * Computes the current canonical SHA-256 tree digest by walking the actual disk tree.
   */
  computeTreeDigest(): TreeDigestReceipt {
    if (!this.diskHandle) {
      return Object.freeze({
        workspaceId: this.workspaceId,
        fileCount: 0,
        canonicalTreeDigest: "sha256-empty-tree",
      });
    }

    return calculateTreeDigestFromDisk(this.workspaceId, this.diskHandle.absolutePath);
  }

  /**
   * Destroys disposable workspace directory on disk and invalidates state.
   */
  destroyWorkspace(reason = "verification-or-security-failure"): RollbackReceipt {
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

    return Object.freeze({
      requested: true,
      workspaceInvalidated: true,
      diskWorkspaceRemoved: diskRemoved,
      removalVerified,
      reason,
    });
  }
}
