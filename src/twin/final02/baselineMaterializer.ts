/**
 * src/twin/final02/baselineMaterializer.ts — Read-Only Exact Byte-for-Byte Git Baseline Materializer for FINAL-02.
 *
 * Materializes the trusted Git commit (50cd4ef8198f4eafb896e17d999050ba60b34a19) into
 * an isolated disposable workspace directory using read-only object inspection (`git ls-tree -r -z` / `git cat-file blob`).
 * Materializes ALL normal blobs (binary + text) as exact Buffers.
 * NO synthetic fallback (fails closed if unreadable).
 * NO git pull, NO git merge, NO working-tree mutations.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { ensureTwinColonyWorkspace } from "../../cognitive/smokeWorkspace";
import type { BaselineMaterializationReceipt } from "./contracts";

export const TRUSTED_BASELINE_COMMIT = "50cd4ef8198f4eafb896e17d999050ba60b34a19";

export function computeSha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

export type BaselineMaterializeResult =
  | { readonly ok: true; readonly receipt: BaselineMaterializationReceipt }
  | { readonly ok: false; readonly reasonCode: string };

interface GitTreeEntry {
  readonly mode: string;
  readonly type: string;
  readonly sha: string;
  readonly path: string;
}

/**
 * Parses git ls-tree -z output into structured entries.
 */
function parseGitLsTreeZ(outputBuffer: Buffer): GitTreeEntry[] {
  const entries: GitTreeEntry[] = [];
  let offset = 0;

  while (offset < outputBuffer.length) {
    const tabIndex = outputBuffer.indexOf(0x09, offset); // tab separator
    if (tabIndex === -1) break;

    const meta = outputBuffer.toString("utf8", offset, tabIndex); // "mode type sha"
    const parts = meta.split(" ");
    if (parts.length < 3) break;

    const mode = parts[0];
    const type = parts[1];
    const sha = parts[2];

    const nulIndex = outputBuffer.indexOf(0x00, tabIndex + 1); // null byte terminator
    if (nulIndex === -1) break;

    const path = outputBuffer.toString("utf8", tabIndex + 1, nulIndex);
    entries.push({ mode, type, sha, path });

    offset = nulIndex + 1;
  }

  return entries;
}

/**
 * Materializes the exact Git baseline commit byte-for-byte into a disposable merge workspace.
 */
export function materializeBaseline(
  missionId: string,
  baselineCommit: string = TRUSTED_BASELINE_COMMIT
): BaselineMaterializeResult {
  const startTime = Date.now();
  const workspaceId = `workspaces/namola-twin/${missionId}/merge-forge`;

  const ensured = ensureTwinColonyWorkspace(workspaceId);
  if (!ensured.ok || !ensured.handle) {
    return { ok: false, reasonCode: `workspace-creation-failed:${ensured.ok ? "no-handle" : ensured.reasonCode}` };
  }

  const handle = ensured.handle;
  let fileCount = 0;
  const digestBuilder = createHash("sha256");

  let rawLsTreeBuffer: Buffer;
  try {
    rawLsTreeBuffer = execFileSync("git", ["ls-tree", "-r", "-z", baselineCommit], {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 10000,
    });
  } catch {
    // FAIL CLOSED: No synthetic fallback!
    return { ok: false, reasonCode: "git-baseline-unreadable" };
  }

  const entries = parseGitLsTreeZ(rawLsTreeBuffer);
  if (entries.length === 0) {
    return { ok: false, reasonCode: "git-baseline-tree-empty" };
  }

  // Materialize every blob
  for (const entry of entries) {
    // Check path traversal
    if (entry.path.includes("..") || entry.path.startsWith("/") || entry.path.split("/").includes(".git")) {
      return { ok: false, reasonCode: `path-traversal-in-baseline:${entry.path}` };
    }

    // Fail closed on symlinks (120000) or submodules (160000)
    if (entry.mode === "120000") {
      return { ok: false, reasonCode: `unsupported-symlink-in-baseline:${entry.path}` };
    }
    if (entry.mode === "160000") {
      return { ok: false, reasonCode: `unsupported-submodule-in-baseline:${entry.path}` };
    }

    if (entry.type !== "blob") continue;

    let blobBuffer: Buffer;
    try {
      blobBuffer = execFileSync("git", ["cat-file", "blob", entry.sha], {
        maxBuffer: 50 * 1024 * 1024,
        timeout: 10000,
      });
    } catch {
      return { ok: false, reasonCode: `baseline-blob-read-failed:${entry.path}` };
    }

    // Write exact bytes to target workspace
    const absoluteTarget = join(handle.absolutePath, entry.path);
    const targetDir = dirname(absoluteTarget);

    try {
      if (!handle.absolutePath) return { ok: false, reasonCode: "invalid-handle" };
      mkdirSync(targetDir, { recursive: true });
      writeFileSync(absoluteTarget, blobBuffer);
      fileCount += 1;
      digestBuilder.update(`${entry.path}:${entry.mode}:${computeSha256(blobBuffer)}\n`);
    } catch {
      return { ok: false, reasonCode: `baseline-file-write-failed:${entry.path}` };
    }
  }

  const baselineDigest = digestBuilder.digest("hex");
  const durationMs = Date.now() - startTime;

  const receipt: BaselineMaterializationReceipt = Object.freeze({
    baselineCommit,
    workspaceId,
    absolutePath: handle.absolutePath,
    materializedFileCount: fileCount,
    baselineDigest,
    durationMs,
    created: true,
  });

  return { ok: true, receipt };
}
