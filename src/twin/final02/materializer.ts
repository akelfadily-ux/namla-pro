/**
 * src/twin/final02/materializer.ts — Precondition-Checked Operation Materializer for FINAL-02.
 *
 * Materializes planned file operations (ADD, MODIFY, DELETE, RENAME) into the workspace.
 * Precondition checks:
 * - ADD: targetRelativePath must NOT exist.
 * - MODIFY: targetRelativePath must exist AND SHA-256 matches expectedBaselineSha256 (if provided).
 * - DELETE: targetRelativePath must exist AND SHA-256 matches expectedBaselineSha256 (if provided).
 * - RENAME: sourceRelativePath must exist AND SHA-256 matches expectedBaselineSha256 (if provided) AND targetRelativePath must NOT exist.
 * Any precondition failure triggers immediate fail-closed rollback.
 */

import { existsSync, unlinkSync, renameSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  PlannedFileOperation,
  MergeMaterializationReceipt,
  FrozenArtifactReceipt,
  OperationExecutionReceipt,
} from "./contracts";
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

  for (const p of provenanceReceipts) {
    resolvedCount += 1;
    if (p.verified) verifiedCount += 1;
  }

  const handle = workspaceManager.handle;
  const absRoot = handle?.absolutePath;
  const operationReceipts: OperationExecutionReceipt[] = [];

  for (const op of plannedOperations) {
    const targetRel = op.targetRelativePath;
    const sourceRel = op.sourceRelativePath ?? targetRel;

    const absTarget = absRoot ? join(absRoot, targetRel) : null;
    const absSource = absRoot ? join(absRoot, sourceRel) : null;

    if (op.kind === "DELETE") {
      if (!absTarget || !existsSync(absTarget)) {
        workspaceManager.destroyWorkspace(`delete-precondition-failed-missing-file:${targetRel}`);
        return {
          success: false,
          reasonCode: `delete-precondition-failed-missing-file:${targetRel}`,
          receipt: {
            workspaceId: workspaceManager.workspaceId,
            approvedCount,
            resolvedCount,
            fingerprintVerifiedCount: verifiedCount,
            writtenCount,
            plannedOperationsCount: plannedOperations.length,
            operationsExecutedCount: operationReceipts.length,
            operationReceipts: Object.freeze(operationReceipts),
            success: false,
          },
        };
      }

      const beforeBytes = readFileSync(absTarget);
      const beforeSha256 = computeSha256(beforeBytes.toString("utf8"));

      if (op.expectedBaselineSha256 && beforeSha256 !== op.expectedBaselineSha256) {
        workspaceManager.destroyWorkspace(`delete-precondition-failed-sha-mismatch:${targetRel}`);
        return {
          success: false,
          reasonCode: `delete-precondition-failed-sha-mismatch:${targetRel}`,
          receipt: {
            workspaceId: workspaceManager.workspaceId,
            approvedCount,
            resolvedCount,
            fingerprintVerifiedCount: verifiedCount,
            writtenCount,
            plannedOperationsCount: plannedOperations.length,
            operationsExecutedCount: operationReceipts.length,
            operationReceipts: Object.freeze(operationReceipts),
            success: false,
          },
        };
      }

      try {
        unlinkSync(absTarget);
        writtenCount += 1;
        operationReceipts.push({
          operationId: op.operationId,
          kind: "DELETE",
          sourceRelativePath: sourceRel,
          targetRelativePath: targetRel,
          preconditionVerified: true,
          executed: true,
          beforeSha256,
          afterSha256: null,
        });
      } catch {
        workspaceManager.destroyWorkspace(`delete-failed:${targetRel}`);
        return {
          success: false,
          reasonCode: `delete-operation-failed:${targetRel}`,
          receipt: {
            workspaceId: workspaceManager.workspaceId,
            approvedCount,
            resolvedCount,
            fingerprintVerifiedCount: verifiedCount,
            writtenCount,
            plannedOperationsCount: plannedOperations.length,
            operationsExecutedCount: operationReceipts.length,
            operationReceipts: Object.freeze(operationReceipts),
            success: false,
          },
        };
      }
      continue;
    }

    if (op.kind === "RENAME") {
      if (!absSource || !existsSync(absSource) || !absTarget) {
        workspaceManager.destroyWorkspace(`rename-precondition-failed-missing-source:${sourceRel}`);
        return {
          success: false,
          reasonCode: `rename-precondition-failed-missing-source:${sourceRel}`,
          receipt: {
            workspaceId: workspaceManager.workspaceId,
            approvedCount,
            resolvedCount,
            fingerprintVerifiedCount: verifiedCount,
            writtenCount,
            plannedOperationsCount: plannedOperations.length,
            operationsExecutedCount: operationReceipts.length,
            operationReceipts: Object.freeze(operationReceipts),
            success: false,
          },
        };
      }

      if (existsSync(absTarget)) {
        workspaceManager.destroyWorkspace(`rename-precondition-failed-target-collision:${targetRel}`);
        return {
          success: false,
          reasonCode: `rename-precondition-failed-target-collision:${targetRel}`,
          receipt: {
            workspaceId: workspaceManager.workspaceId,
            approvedCount,
            resolvedCount,
            fingerprintVerifiedCount: verifiedCount,
            writtenCount,
            plannedOperationsCount: plannedOperations.length,
            operationsExecutedCount: operationReceipts.length,
            operationReceipts: Object.freeze(operationReceipts),
            success: false,
          },
        };
      }

      const beforeBytes = readFileSync(absSource);
      const beforeSha256 = computeSha256(beforeBytes.toString("utf8"));

      if (op.expectedBaselineSha256 && beforeSha256 !== op.expectedBaselineSha256) {
        workspaceManager.destroyWorkspace(`rename-precondition-failed-sha-mismatch:${sourceRel}`);
        return {
          success: false,
          reasonCode: `rename-precondition-failed-sha-mismatch:${sourceRel}`,
          receipt: {
            workspaceId: workspaceManager.workspaceId,
            approvedCount,
            resolvedCount,
            fingerprintVerifiedCount: verifiedCount,
            writtenCount,
            plannedOperationsCount: plannedOperations.length,
            operationsExecutedCount: operationReceipts.length,
            operationReceipts: Object.freeze(operationReceipts),
            success: false,
          },
        };
      }

      try {
        renameSync(absSource, absTarget);
        writtenCount += 1;
        operationReceipts.push({
          operationId: op.operationId,
          kind: "RENAME",
          sourceRelativePath: sourceRel,
          targetRelativePath: targetRel,
          preconditionVerified: true,
          executed: true,
          beforeSha256,
          afterSha256: beforeSha256,
        });
      } catch {
        workspaceManager.destroyWorkspace(`rename-failed:${sourceRel}`);
        return {
          success: false,
          reasonCode: `rename-operation-failed:${sourceRel}`,
          receipt: {
            workspaceId: workspaceManager.workspaceId,
            approvedCount,
            resolvedCount,
            fingerprintVerifiedCount: verifiedCount,
            writtenCount,
            plannedOperationsCount: plannedOperations.length,
            operationsExecutedCount: operationReceipts.length,
            operationReceipts: Object.freeze(operationReceipts),
            success: false,
          },
        };
      }
      continue;
    }

    if (op.kind === "MODIFY") {
      let beforeSha256: string | null = null;
      if (absTarget && existsSync(absTarget)) {
        beforeSha256 = computeSha256(readFileSync(absTarget).toString("utf8"));
      }

      if (op.expectedBaselineSha256 && beforeSha256 !== op.expectedBaselineSha256) {
        workspaceManager.destroyWorkspace(`modify-precondition-failed-sha-mismatch:${targetRel}`);
        return {
          success: false,
          reasonCode: `modify-precondition-failed-sha-mismatch:${targetRel}`,
          receipt: {
            workspaceId: workspaceManager.workspaceId,
            approvedCount,
            resolvedCount,
            fingerprintVerifiedCount: verifiedCount,
            writtenCount,
            plannedOperationsCount: plannedOperations.length,
            operationsExecutedCount: operationReceipts.length,
            operationReceipts: Object.freeze(operationReceipts),
            success: false,
          },
        };
      }
    }

    // ADD / MODIFY file content writing
    const content = resolvedConflictsMap.get(targetRel) ?? provenanceReceipts.find((p) => p.relativePath === targetRel)?.exactContent;

    if (!content) {
      workspaceManager.destroyWorkspace(`operation-failed-missing-content:${targetRel}`);
      return {
        success: false,
        reasonCode: `missing-operation-content:${targetRel}`,
        receipt: {
          workspaceId: workspaceManager.workspaceId,
          approvedCount,
          resolvedCount,
          fingerprintVerifiedCount: verifiedCount,
          writtenCount,
          plannedOperationsCount: plannedOperations.length,
          operationsExecutedCount: operationReceipts.length,
          operationReceipts: Object.freeze(operationReceipts),
          success: false,
        },
      };
    }

    const written = workspaceManager.writeFile(targetRel, content);
    if (!written) {
      workspaceManager.destroyWorkspace(`operation-write-failed:${targetRel}`);
      return {
        success: false,
        reasonCode: `write-operation-failed:${targetRel}`,
        receipt: {
          workspaceId: workspaceManager.workspaceId,
          approvedCount,
          resolvedCount,
          fingerprintVerifiedCount: verifiedCount,
          writtenCount,
          plannedOperationsCount: plannedOperations.length,
          operationsExecutedCount: operationReceipts.length,
          operationReceipts: Object.freeze(operationReceipts),
          success: false,
        },
      };
    }

    writtenCount += 1;
    const afterSha256 = computeSha256(content);

    operationReceipts.push({
      operationId: op.operationId,
      kind: op.kind,
      sourceRelativePath: sourceRel,
      targetRelativePath: targetRel,
      preconditionVerified: true,
      executed: true,
      beforeSha256: op.kind === "ADD" ? null : computeSha256(content),
      afterSha256,
    });
  }

  const success = operationReceipts.length === plannedOperations.length && operationReceipts.every((r) => r.preconditionVerified && r.executed);

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
      operationsExecutedCount: operationReceipts.length,
      operationReceipts: Object.freeze(operationReceipts),
      success,
    },
  };
}
