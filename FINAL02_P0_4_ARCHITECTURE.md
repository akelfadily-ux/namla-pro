# FINAL-02 P0-4 ARCHITECTURE DOCUMENTATION

## Overview
FINAL-02 Production Integration & Execution Runtime provides zero-trust, fail-closed component merging and verification across 13 single-responsibility modules under `src/twin/final02/`.

## Modules Summary
1. `contracts.ts`: Immutable data structures and receipts.
2. `frozenArtifactResolver.ts`: FNV1a + SHA-256 verification against frozen FINAL-01 bundles.
3. `baselineMaterializer.ts`: Read-only Git blob materialization (`50cd4ef8`).
4. `treeDigest.ts`: Recursive full-tree SHA-256 disk digest.
5. `executionPlanBuilder.ts`: Authoritative operation intent (ADD, MODIFY, DELETE, RENAME).
6. `conflictEngine.ts`: Hardened 12-class content-aware classifier & deterministic resolvers.
7. `workspaceManager.ts`: Physical disposable workspace lifecycle and disk rollback.
8. `materializer.ts`: Precondition-checked file operation writer.
9. `sandboxReceiptVerifier.ts`: Cryptographic Ed25519 verifier via `TrustedSandboxKeyRegistry` without private signing keys.
10. `verificationRunner.ts`: Mandatory 5-stage zero-trust verification binder.
11. `regressionRunner.ts`: Real subprocess runner producing `CommandExecutionReceipt`s without bypasses.
12. `repairEngine.ts`: Pluggable `RepairStrategy` contract; fails closed with `REPAIR_UNAVAILABLE`.
13. `final02Coordinator.ts`: Pure orchestrator enforcing strict READY invariant.

## Key Invariants
- Verifier holds NO private signing keys.
- TEST-ONLY signer located at `src/tools/testFixtures/final02SandboxSigner.ts`.
- `src/twin/final02/**` never imports test fixtures.
- All real verification receipts mandatorily bind to `workspaceId`, `absoluteWorkspacePath`, and `mergedTreeDigest`.
- Zero Git mutations performed. Human-only authority preserved.
