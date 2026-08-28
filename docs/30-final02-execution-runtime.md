# 30. FINAL-02 Production Integration Runtime Architecture

## Executive Summary

`FINAL-02` (`final02ExecutionRuntime.ts`) is the production integration and execution runtime for the Namola Twin Empire. It operates downstream of the Sovereign Court decision rendered by `FINAL-01` (`twinPostColonyPipeline.ts`).

The runtime consumes court-rendered `NamolaDecisionReceipt` contracts, resolves exact artifact content directly from authoritative frozen evidence bundles (`claude` and `codex`), verifies FNV and SHA-256 fingerprints matching `sourceFingerprint`, materializes exact bytes into a disposable `ZeroTrustMergeForge` workspace on disk (`workspaces/namola-twin/<missionId>/merge-forge`), classifies merge conflicts across 12 deterministic conflict classes with explicit file operations (`ADD`, `MODIFY`, `DELETE`, `RENAME`), drives 5 zero-trust verification stages from scratch (`typecheck`, `tests`, `build`, `security-review`, `acceptance-verification`), manages bounded repair loops with concrete file modifications, evaluates `SandboxSecurityReceipt`s and `RegressionReceipt`s, and emits an immutable `Final02Result`.

---

## Strict Production Acceptance Invariant

`READY` and `deliveryReady === true` are strictly evidence-honest and fail-closed:

```text
READY
  ⇒ exact court-approved artifact bytes were merged
  ⇒ all artifact fingerprints matched frozen evidence
  ⇒ trusted baseline was really materialized (WorkspaceMaterializationReceipt)
  ⇒ real disposable workspace existed on disk
  ⇒ all selected operations were materially applied
  ⇒ merged-tree fingerprint was computed (mergedTreeDigest)
  ⇒ verification ran against that exact merged tree
  ⇒ authoritative SandboxSecurityReceipt passed
  ⇒ all mandatory security invariants === true
  ⇒ real regression suite passed (RegressionReceipt)
  ⇒ rollback behavior was proven (RollbackReceipt on failure)
  ⇒ deliveryResult.ok === true
```

A fake, simulated, mocked, unverified, or caller-spoofed driver (`isReal: true` without matching `sandboxVerified: true` receipts) MUST NEVER produce `READY` or `SECURITY_VERIFIED`. Missing execution backends or fake drivers yield `BLOCKED` or `UNVERIFIED`.

---

## Architectural Pipeline Overview

```
                        [ NamolaDecisionReceipt (FINAL-01) ]
                                         │
                                         ▼
                        ┌─────────────────────────────────┐
                        │  Court Decision Execution Gate  │
                        └─────────────────────────────────┘
                                         │
                                         ▼
                        ┌─────────────────────────────────┐
                        │   Execution Plan Construction   │
                        │  (12-Class Conflict Taxonomy)   │
                        └─────────────────────────────────┘
                                         │
                                         ▼
                        ┌─────────────────────────────────┐
                        │  Disposable ZeroTrustMergeForge │
                        │  (Exact Bytes Materialized)     │
                        └─────────────────────────────────┘
                                         │
                                         ▼
                        ┌─────────────────────────────────┐
                        │ Zero-Trust 5-Stage Verification  │
                        │  (Rebuilt & Verified From Zero) │
                        └─────────────────────────────────┘
                                         │
                    ┌────────────────────┴────────────────────┐
              (Verification Fail)                       (Verification Pass)
                    │                                         │
                    ▼                                         ▼
    ┌───────────────────────────────┐         ┌───────────────────────────────┐
    │  Rollback Workspace & Clear   │         │    Security & Sandbox Gate    │
    │ (RollbackReceipt Disk Removal)│         │   (SandboxSecurityReceipt)    │
    └───────────────────────────────┘         └───────────────────────────────┘
                    │                                         │
                    ▼                                         ▼
    ┌───────────────────────────────┐         ┌───────────────────────────────┐
    │ Bounded Single Authorized     │         │  Regression & Witness Gate    │
    │ Repair (Concrete File Mods)   │         │     (RegressionReceipt)       │
    └───────────────────────────────┘         └───────────────────────────────┘
                                                              │
                                                              ▼
                                              ┌───────────────────────────────┐
                                              │    Customer Delivery Gate     │
                                              │   (Delivery Readiness Flag)   │
                                              └───────────────────────────────┘
                                                              │
                                                              ▼
                                                      [ Final02Result ]
```

---

## 12 Conflict Class Taxonomy

When components are received from different colonies, `FINAL-02` analyzes target workspace paths and classifies merge conflicts into 12 explicit categories (`classifyConflict()`):

1. **FILE_ADD_ADD**: Both colonies produced new files at the identical relative path.
2. **FILE_DELETE_MODIFY**: One colony deleted a target path while the other modified it.
3. **TEXTUAL_CONFLICT**: Discrepancies in line-by-line textual content.
4. **API_CONTRACT_CONFLICT**: Incompatible function signatures, parameters, or return types.
5. **TYPE_CONFLICT**: Discrepancies in TypeScript interface or type definitions (`.d.ts`, `types/`).
6. **DEPENDENCY_CONFLICT**: Conflicting package requirements (`package.json`, `.lock`). Resolved via strict manifest intersection.
7. **CONFIG_CONFLICT**: Discrepancies in build or compiler configuration (`tsconfig.json`, `.eslintrc`). Resolved via strictest compiler settings.
8. **TEST_CONFLICT**: Divergent test suites targeting identical features (`test/`, `.spec.ts`). Resolved via unified non-duplicative suite.
9. **DATABASE_SCHEMA_CONFLICT**: Conflicting migration scripts or data models (`schema.prisma`, `migration.sql`). Fails closed as unresolved.
10. **SECURITY_POLICY_CONFLICT**: Divergent security controls or permission rules (`securityPolicy.ts`). Fails closed as unresolved.
11. **SEMANTIC_CONFLICT**: Behaviorally contradictory implementations with matching signatures. Fails closed as unresolved.
12. **UNKNOWN_CONFLICT**: Unmapped or path traversal relative paths (`../escape`). Fails closed as unresolved.

Any unresolved conflict (`SECURITY_POLICY_CONFLICT`, `DATABASE_SCHEMA_CONFLICT`, `SEMANTIC_CONFLICT`, `UNKNOWN_CONFLICT`) causes execution to fail closed immediately with status `BLOCKED`.

---

## Sandbox Security Receipts & Security Gate Status Model

Security verification is derived strictly from `SandboxSecurityReceipt` evidence:

```ts
export interface SandboxSecurityReceipt {
  readonly backendId: string;
  readonly backendVerificationId: string;
  readonly executionId: string;
  readonly workspaceId: string;
  readonly realProcessExecution: boolean;
  readonly sandboxVerified: boolean;
  readonly networkIsolated: boolean;
  readonly credentialsProtected: boolean;
  readonly dockerSocketProtected: boolean;
  readonly mountPolicyVerified: boolean;
  readonly sourceMountReadOnly: boolean;
  readonly pathTraversalProtected: boolean;
  readonly symlinkEscapeProtected: boolean;
  readonly resourceLimitsVerified: boolean;
  readonly timeoutEnforced: boolean;
  readonly cleanupVerified: boolean;
}
```

- **SECURITY_VERIFIED**: Real verification driver executed inside a verified sandbox (`sandboxVerified === true`, `realExecution === true`, and all mandatory boolean security receipts === true).
- **SECURITY_UNVERIFIED**: Verification passed using fake, simulated, or caller-spoofed drivers. Status is capped at `UNVERIFIED`.
- **SECURITY_FAILED**: Stage verification or security review failed.
- **SECURITY_BLOCKED**: Pre-verification failure, component admission failure, fingerprint mismatch, or unresolved conflict.
- **SECURITY_NOT_RUN**: Decision was `REJECT_BOTH` or `SAFELY_ABORT`, where verification was not executed.

---

## Transactional Checkpoint Hierarchy

`FINAL-02` enforces transactional order through 8 immutable checkpoints recorded sequentially:

1. `FINAL02_PRE_EXECUTION`: Runtime initialization and post-colony input validation.
2. `FINAL02_PLAN_BUILT`: Execution plan constructed with component provenance, explicit file operations, 12-class conflict analysis, and rollback procedure.
3. `FINAL02_WORKSPACE_CREATED`: `ZeroTrustMergeForge` isolated disk workspace initialized (`WorkspaceMaterializationReceipt`).
4. `FINAL02_COMPONENTS_APPLIED`: Court-approved components resolved from frozen evidence and exact bytes materialized on disk.
5. `FINAL02_VERIFICATION_PASS`: All 5 zero-trust verification stages executed and passed against `mergedTreeDigest`.
6. `FINAL02_SECURITY_PASS`: Security gate evaluated. `passed === true` IF AND ONLY IF `securityGate.status === "SECURITY_VERIFIED"`.
7. `FINAL02_REGRESSION_PASS`: Regression suite executed against merged workspace (`RegressionReceipt`).
8. `FINAL02_READY`: Final production delivery readiness gate passed; output package ready for deployment.

---

## Real Execution Evidence Metrics

The runtime records explicit evidence fields in `Final02ObservabilityMetrics`:

- `approvedComponentCount`: Approved components from court receipt.
- `resolvedComponentCount`: Components resolved to frozen evidence bundles.
- `fingerprintVerifiedCount`: Components whose exact bytes matched frozen fingerprints.
- `writtenComponentCount`: Components materialized on disk (`componentsWritten === approvedCount`).
- `mergePlanned`: Execution plan constructed.
- `workspaceMaterialized`: Disposable disk workspace initialized.
- `componentsMaterialized`: Count of components written to disk.
- `realMergeExecuted`: Real filesystem/sandbox merge completed.
- `verificationExecuted`: Zero-trust verification executed.
- `securityVerified`: Security gate verified with real `SandboxSecurityReceipt` evidence.
- `regressionVerified`: Regression gate verified with real `RegressionReceipt`.
- `checkpointCreated`: Transactional checkpoints recorded.
- `deliveryReady`: Strict READY invariant satisfied.
- `delivered`: Customer delivery composed and ready.

---

## Focused Test Suite & Golden Validation

* **Unit & Integration Suite**: `src/tools/final02ExecutionRuntimeTests.ts` (14 test scenarios covering real sandbox driver READY, fake driver UNVERIFIED, caller spoofing protection, SECURITY_NOT_RUN on rejection, 12 conflict classes, security/schema conflict fail-closed, workspace rollback, bounded repair loop with concrete file modifications, checkpoints, RealBackedVerificationDriver integration, and secret-leak checks).
* **Execution Command**:
  ```bash
  npx ts-node src/tools/final02ExecutionRuntimeTests.ts
  ```
* **Golden Demo Suite**:
  ```bash
  npm run test:golden
  ```
