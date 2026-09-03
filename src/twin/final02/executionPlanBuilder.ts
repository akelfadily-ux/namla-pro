/**
 * src/twin/final02/executionPlanBuilder.ts — Immutable Execution Plan Builder for FINAL-02.
 *
 * Constructs byte-identical, canonical Final02ExecutionPlan structures.
 * Explicitly models ADD, MODIFY, DELETE, RENAME file operations.
 * NO filesystem mutations during plan generation.
 */

import type { NamolaSovereignDecision, ApprovedMergeComponent } from "../namolaSovereignCourt";
import { fnv1a } from "../twinColonyTypes";
import { MERGE_STAGES } from "../mergeForge";
import type {
  Final02ExecutionPlan,
  PlannedFileOperation,
  FrozenArtifactReceipt,
  MergeConflictRecord,
} from "./contracts";
import { computeSha256 } from "./frozenArtifactResolver";

export function buildExecutionPlan(
  decision: NamolaSovereignDecision,
  approvedComponents: readonly ApprovedMergeComponent[],
  rejectedComponents: readonly string[],
  provenanceReceipts: readonly FrozenArtifactReceipt[],
  conflictRecords: readonly MergeConflictRecord[],
  missionId: string,
  baselineCommit: string,
  baselineDigest: string,
  acceptanceCriteria: readonly string[],
  rollbackExecuted = false
): Final02ExecutionPlan {
  const targetRelativePaths = [...new Set(provenanceReceipts.map((p) => p.relativePath))];
  const planId = `plan-${fnv1a(`${decision}|${targetRelativePaths.join(",")}`)}`;
  const workspacePath = `workspaces/namola-twin/${missionId}/merge-forge`;

  const plannedOps: PlannedFileOperation[] = [];

  for (const p of provenanceReceipts) {
    const comp = p.component as any;
    if (!comp || !comp.operation) {
      throw new Error("BLOCKED / MISSING_AUTHORITATIVE_FILE_OPERATION");
    }

    const op = comp.operation;

    if (op.kind === "MODIFY" || op.kind === "DELETE" || op.kind === "RENAME") {
      if (!op.expectedBaselineSha256) {
        throw new Error("BLOCKED / MISSING_AUTHORITATIVE_FILE_OPERATION: expectedBaselineSha256 required");
      }
    }

    plannedOps.push({
      operationId: `op-${fnv1a(`${p.sourceColony}|${p.relativePath}|${op.kind}`)}`,
      kind: op.kind,
      sourceRelativePath: op.kind === "RENAME" ? op.sourceRelativePath : p.relativePath,
      targetRelativePath: op.targetRelativePath,
      expectedBaselineSha256: op.kind !== "ADD" ? op.expectedBaselineSha256 : undefined,
      sourceColonies: [p.sourceColony],
      sourceArtifactId: p.sourceArtifactId,
      sourceFingerprint: p.fnvFingerprint,
      sha256Digest: p.sha256Digest,
    });
  }

  const expectedOperations = plannedOps.map(
    (op) => `${op.kind} ${op.targetRelativePath} (from ${op.sourceColonies.join(",")}:${op.sourceArtifactId}) [sha256:${op.sha256Digest.slice(0, 8)}]`
  );

  return Object.freeze({
    planId,
    decision,
    selectedApprovedComponents: Object.freeze([...approvedComponents]),
    rejectedComponents: Object.freeze([...rejectedComponents]),
    componentProvenance: Object.freeze([...provenanceReceipts]),
    plannedFileOperations: Object.freeze(plannedOps),
    expectedFilesystemOperations: Object.freeze(expectedOperations),
    targetPaths: Object.freeze(targetRelativePaths),
    baselineCommit,
    baselineDigest,
    expectedOutputFingerprintStrategy: "sha256-canonical-lexicographical-tree-digest",
    conflictRecords: Object.freeze([...conflictRecords]),
    securityRequirements: Object.freeze([
      "sandbox-isolation",
      "network-isolation",
      "credential-protection",
      "path-traversal-prevention",
    ]),
    verificationStages: MERGE_STAGES,
    acceptanceCriteriaMapping: Object.freeze(acceptanceCriteria.map((a) => `covers: ${a}`)),
    rollbackProcedure: {
      strategy: "discard-merge-workspace" as const,
      cleanupTarget: workspacePath,
      executedOnFailure: rollbackExecuted,
    },
    mandatoryGatePolicy: {
      requireRealDriver: true as const,
      requireSandboxVerification: true as const,
      failClosedOnUnresolvedConflict: true as const,
    },
  });
}
