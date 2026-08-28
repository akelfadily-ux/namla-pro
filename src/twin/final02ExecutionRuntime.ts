/**
 * final02ExecutionRuntime.ts — Backward-compatible re-export module for FINAL-02.
 *
 * Delegates to modular components under src/twin/final02/:
 * - contracts.ts
 * - frozenArtifactResolver.ts
 * - baselineMaterializer.ts
 * - treeDigest.ts
 * - executionPlanBuilder.ts
 * - conflictEngine.ts
 * - workspaceManager.ts
 * - materializer.ts
 * - sandboxReceiptVerifier.ts
 * - verificationRunner.ts
 * - regressionRunner.ts
 * - repairEngine.ts
 * - final02Coordinator.ts
 */

import { executeFinal02Pipeline } from "./final02/final02Coordinator";
import type { Final02ExecuteInput } from "./final02/final02Coordinator";
import type { Final02Result } from "./final02/contracts";

export * from "./final02/contracts";
export { classifyConflict, processConflicts } from "./final02/conflictEngine";
export { resolveFrozenArtifact } from "./final02/frozenArtifactResolver";
export { materializeBaseline, TRUSTED_BASELINE_COMMIT } from "./final02/baselineMaterializer";
export { calculateTreeDigestFromDisk as calculateTreeDigest } from "./final02/treeDigest";
export { buildExecutionPlan } from "./final02/executionPlanBuilder";
export { verifySandboxSecurityReceipts, type TrustedSandboxKey, type TrustedSandboxKeyRegistry } from "./final02/sandboxReceiptVerifier";
export { executeFinal02Pipeline } from "./final02/final02Coordinator";

/**
 * Backward-compatible entry point delegating to executeFinal02Pipeline.
 */
export function runFinal02ExecutionRuntime(input: Final02ExecuteInput): Final02Result {
  return executeFinal02Pipeline(input);
}
