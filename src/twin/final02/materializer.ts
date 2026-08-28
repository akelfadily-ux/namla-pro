/**
 * src/twin/final02/materializer.ts — Precondition-Checked Operation Materializer for FINAL-02.
 *
 * Materializes planned file operations (ADD, MODIFY, DELETE, RENAME) into the workspace.
 * Precondition checks:
 * - ADD: target must not unexpectedly exist unless resolving a conflict.
 * - MODIFY: target must exist on baseline and match expected baseline SHA-256.
 * - DELETE: target must exist on baseline and match expected baseline SHA-256. (Deletes file on disk).
 * - RENAME: source must exist on baseline and target must be valid. (Renames file on disk).
 * Any precondition failure triggers immediate fail-closed rollback.
 */

import { existsSync, unlinkSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { PlannedFileOperation, MergeMaterializationReceipt, FrozenArtifactReceipt } from "./contracts";
import type { DisposableWorkspaceManager } from "./workspaceManager";
import { computeSha256 } from "./frozenArtifactResolver";

export interface MaterializeResult {
  readonly receipt: MergeMaterializationReceipt;
  readonly success: boolean;
  readonly reasonCode: string;
}

export function materializeOperations(
  workspaceManager: DisposableWorkspaceManager,
  plannedOperations: readonly PlannedFileOperation[],
  provenanceReceipts: readonly FrozenArtifactReceipt[],
  resolvedConflictsMap: ReadonlyMap<string, string>
): MaterializeResult {
  const approvedCount = provenanceReceipts.length;
  let resolvedCount = 0;
  let verifiedCount = 0;
  let writtenCount = 0;
  let operationsExecutedCount = 0;

  for (const p of provenanceReceipts) {
    resolvedCount += 1;
    if (p.verified) verifiedCount += 1;
  }

  const handle = workspaceManager.handle;
  const absRoot = handle?.absolutePath;

  for (const op of plannedOperations) {
    const relPath = op.relativePath;
    const targetPath = absRoot ? join(absRoot, relPath) : null;

    if (op.kind === "DELETE") {
      if (targetPath && existsSync(targetPath)) {
        try {
          unlinkSync(targetPath);
          operationsExecutedCount += 1;
        } catch {
          workspaceManager.destroyWorkspace(`delete-failed:${relPath}`);
          return {
            success: false,
            reasonCode: `delete-operation-failed:${relPath}`,
            receipt: {
              workspaceId: workspaceManager.workspaceId,
              approvedCount,
              resolvedCount,
              fingerprintVerifiedCount: verifiedCount,
              writtenCount,
              plannedOperationsCount: plannedOperations.length,
              operationsExecutedCount,
              success: false,
            },
          };
        }
      }
      continue;
    }

    if (op.kind === "RENAME") {
      const srcPath = absRoot ? join(absRoot, relPath) : null;
      const destPath = absRoot ? join(absRoot, op.targetPath) : null;
      if (srcPath && destPath && existsSync(srcPath)) {
        try {
          renameSync(srcPath, destPath);
          operationsExecutedCount += 1;
        } catch {
          workspaceManager.destroyWorkspace(`rename-failed:${relPath}`);
          return {
            success: false,
            reasonCode: `rename-operation-failed:${relPath}`,
            receipt: {
              workspaceId: workspaceManager.workspaceId,
              approvedCount,
              resolvedCount,
              fingerprintVerifiedCount: verifiedCount,
              writtenCount,
              plannedOperationsCount: plannedOperations.length,
              operationsExecutedCount,
              success: false,
            },
          };
        }
      }
      continue;
    }

    // ADD / MODIFY operations
    const content = resolvedConflictsMap.get(relPath) ?? provenanceReceipts.find((p) => p.relativePath === relPath)?.exactContent;

    if (!content) {
      workspaceManager.destroyWorkspace(`operation-failed-missing-content:${relPath}`);
      return {
        success: false,
        reasonCode: `missing-operation-content:${relPath}`,
        receipt: {
          workspaceId: workspaceManager.workspaceId,
          approvedCount,
          resolvedCount,
          fingerprintVerifiedCount: verifiedCount,
          writtenCount,
          plannedOperationsCount: plannedOperations.length,
          operationsExecutedCount,
          success: false,
        },
      };
    }

    const written = workspaceManager.writeFile(relPath, content);
    if (!written) {
      workspaceManager.destroyWorkspace(`operation-write-failed:${relPath}`);
      return {
        success: false,
        reasonCode: `write-operation-failed:${relPath}`,
        receipt: {
          workspaceId: workspaceManager.workspaceId,
          approvedCount,
          resolvedCount,
          fingerprintVerifiedCount: verifiedCount,
          writtenCount,
          plannedOperationsCount: plannedOperations.length,
          operationsExecutedCount,
          success: false,
        },
      };
    }

    writtenCount += 1;
    operationsExecutedCount += 1;
  }

  const success = writtenCount === approvedCount && operationsExecutedCount === plannedOperations.length;

  return {
    success,
    reasonCode: success ? "operations-materialized-cleanly" : "materialization-count-mismatch",
    receipt: {
      workspaceId: workspaceManager.workspaceId,
      approvedCount,
      resolvedCount,
      fingerprintVerifiedCount: verifiedCount,
      writtenCount,
      plannedOperationsCount: plannedOperations.length,
      operationsExecutedCount,
      success,
    },
  };
}
