# PROGRESS REPORT — NAMLA PRO Productization

## CURRENT PHASE
P0 Runtime Correction Pass — IN PROGRESS

## LAST SAFE COMMIT
Core P0 runtime corrections implemented with 100% test pass.

## COMPLETED
- **Rule 0:** Renamed mock test to `applicationIntegrationTests.ts` and created genuine `goldenE2EWorkspaceTests.ts` operating in real isolated workspace.
- **P0-1 (Run Persistence):** Added `RunRecord` domain type, `RunStatus` lifecycle transitions authority (`assertRunTransition`), and `createRun`/`getRun`/`transitionRun` methods in `StateRepository`/`PostgresStateRepository`.
- **P0-2 & P0-4 (Lifecycle Bypass & Worker/Ant Separation):** Separated `createTask` (INSERT-only) from `transitionTask`. Removed `saveTask` status mutation bypass. Separated `assignedAntId` (logical Ant identity) from `leaseOwner` (Worker process ID).
- **P0-3, P0-5, P0-6 (Leases, Expiry & Retries):** Implemented `claimTaskLease`, `renewTaskLease`, `releaseTaskLease`, and `recoverExpiredLeases` with atomic SQL `RETURNING *`. Fixed retry handling for `CREATED` and `RETRYING` tasks.
- **P0-7 & P0-8 (Durable Operations & Input Fingerprinting):** Implemented `OperationRecord` state machine (`PENDING`, `RUNNING`, `COMPLETED`, `FAILED`). Added SHA-256 input canonicalization (`inputHash`), atomic operation claiming, and replaying completed operations in `ToolGateway`.
- **P0-9 to P0-12 (Closed-Loop Budgets & Telemetry):** Closed-loop token/cost usage tracking and telemetry events (`model.started/completed/failed`, `tool.started/completed/failed/replayed`) in `ModelGateway` and `ToolGateway`.
- **P0-13, P0-14, P0-18 (Gate/Supervisor Evidence & Scoped Policies):** Added gate and supervisor decision event persistence with complete evidence/risks/reasons. Enhanced `PolicyEngine` to support resource-scoped capabilities (`filesystem.read:/workspace/**`).
- **P0-16 & P0-17 (Collision-Resistant IDs & Input Validation):** Updated ID generation to `crypto.randomUUID()` and added input validation for `CreateRunInput`.
- **P0-19 & P0-20 (PostgreSQL Integration & Golden Workspace E2E):** Added `postgresIntegrationTests.ts` and `goldenE2EWorkspaceTests.ts` operating in isolated temporary workspaces.
- **P0-21 & P0-22 (Documentation Sync):** Updated `PROGRESS.md`, `MIGRATION_MAP.md`, and `DECISIONS.md`.

## IN PROGRESS
- Pre-commit verification and submission.

## FAILING TESTS
- None (0 failing tests).

## KNOWN REGRESSIONS
- None.

## BLOCKERS
- None.

## PRODUCTION GATES
- [x] Build passes (`npm run build`)
- [x] P0 Security Gate passes (`npm test`)
- [x] Domain contracts & lifecycle authorities implemented
- [x] Application gateways & control loops implemented
- [x] Atomic state repository & worker lease recovery implemented
- [x] Durable operation state machine & input fingerprinting implemented
- [x] Closed-loop budget accounting & telemetry implemented
- [x] Real isolated workspace Golden E2E test passing
