/**
 * src/twin/final02/workspaceManager.ts — Workspace Lifecycle & Rollback Manager for FINAL-02.
 *
 * Manages creation of disposable merge workspaces under authorized root (workspaces/namola-twin/<missionId>/merge-forge),
 * enforces path security, computes canonical full-tree disk digests, and executes real disk rollback.
 */

import { rmSync, existsSync } from "node:fs";
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
   * Initializes real disposable workspace directory on disk under workspaces/namola-twin/.
   */
  initialize(): { readonly ok: true; readonly handle: { workspaceId: string; absolutePath: string } } | { readonly ok: false; readonly reasonCode: string } {
    const ensured = ensureTwinColonyWorkspace(this.workspaceId);
    if (!ensured.ok || !ensured.handle) {
      return { ok: false, reasonCode: ensured.ok ? "no-handle" : ensured.reasonCode };
    }

    this.diskHandle = ensured.handle;
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
