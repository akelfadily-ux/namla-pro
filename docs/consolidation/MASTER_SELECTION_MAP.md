# NAMLA consolidation - Master Selection Map

Canonical baseline: `8e864e3325d764887d0630610d14702730830721`; tree: `e2095d56f0e4dcdead31451fe8c86c9d51a18113`.
Donor selection is by immutable commit and blob identities, not by branch names.

## Current batch: C2 - budget validation and supervisor contract
Input commit: `82d6b88485099c5c9271f51ba2b22bfee5657345`; input tree: `1dd05a6ac907b6e256865bd749b34405c3a7b994`.
The budget source is adapted, not byte-identical; supervisor is an exact interface-only copy.
Review and limits: [C2_REVIEW.md](C2_REVIEW.md).
Status: C2_SOURCE_SELECTED; typecheck/build/focused/P0 results require the actual C2 receipt.
No provider execution, database reservation, scheduler or canonical runtime wiring is performed.
C1 remains a separate local checkpoint. C2 performs no Git integration, staging, commit or push.

## Completed source batch: C1 - Productization domain dependency closure
Seven donor source/test files are selected unchanged. This batch does not wire a new runtime.
The two donor test suites plus the C1 boundary suite are registered in the existing P0 runner.
Status: C1_SOURCE_CHECKPOINTED at `82d6b88485099c5c9271f51ba2b22bfee5657345`; prior local P0: 1299 passed, 0 failed, 11 platform skips. Runtime wiring was not performed.
A successful file copy alone is not a passed test, merge completion, or production qualification.

### Boundaries and review findings
- src/domain defines donor application records, lifecycle edges, error metadata and ports only.
- StateRepository and UnitOfWork interfaces do not supply a database implementation or execution authority.
- Structural Postgres client interfaces are retained as donor contracts; no pg module is imported here.
- Optional BudgetLimits, optional ToolExecutionContext.authority and broad task patches are not validators or permission grants.
- Existing V2 budgets, checkpoint CAS, frozen contract pins, leases and evidence remain authoritative and unchanged.
- StateConflictError.retryable is metadata: it does not unlock a failed-closed canonical session or authorize replay.
- The lifecycle API accepts typed statuses; it is not an unknown-JSON record validator or proof that gates actually ran.
- C1 tests supplement the donor tests with full typed transition matrices and a static dependency check.
- The static AST check is a module-dependency rule, not a sandbox or complete proof of side-effect freedom.
- Do not import donor application schedulers, gateways, bootstrap, SQL schema or policy engine wholesale.
- Do not replace package.json, its lockfile, tsconfig or existing executable-provenance tests in C1.

### Selected immutable source blobs

| Path | Donor Git blob |
|---|---|
| src/domain/types.ts | 89b61265997379785cbbbd3959a9e5118226a4e1 |
| src/domain/errors.ts | a540cfeae282218eb1b3fbc3d750faacff198bc8 |
| src/domain/lifecycle.ts | 66eb5617238abeb74ca9c6d23657dc1c70ac9df9 |
| src/domain/contracts.ts | 7cca8f1c13fd9007848b5bbe9e104b1cc9532bc4 |
| src/domain/unit-of-work.ts | 84e430fdade515dffe6c1bba37f6feb00e3b5e51 |
| src/tools/domainLifecycleTests.ts | e3a41bcd918587203bd80ee108132ebc8a47f193 |
| src/tools/architectureLayerTests.ts | db870172932b9979f11d4a08bec009c0e54f1758 |

## V2 disposition
Original 72ab84acd4329348a261405c06050b1878d8fa43 is already in baseline history.
HR snapshot 937296c1bbea8f6e03c6c38a46db8c15f6f85e79 has that same old tree. Do not reimport either snapshot.

## Branch identities from the preservation audit

| Reference | Commit | Baseline classification |
|---|---|---|
| refs/heads/final02-hr-clean | d21407ab4034d3210cbcd2a99b66e3241db47d46 | HISTORY_ALREADY_INCLUDED |
| refs/heads/main | d21407ab4034d3210cbcd2a99b66e3241db47d46 | HISTORY_ALREADY_INCLUDED |
| refs/heads/namla-v2-canonical-integration-20260912 | 1565d2f540977e97880aa1bd9d42567509dcf8f5 | HISTORY_ALREADY_INCLUDED |
| refs/heads/namla-v2-full-runtime-5585716749136749177 | 72ab84acd4329348a261405c06050b1878d8fa43 | HISTORY_ALREADY_INCLUDED |
| refs/heads/namla-v2-full-runtime-hr | d020aba617f5d58ff29da95d2cdb6314fbb5afdd | HISTORY_ALREADY_INCLUDED |
| refs/heads/namla-v2-runtime-convergence-20260914 | 8e864e3325d764887d0630610d14702730830721 | CANONICAL_BASE |
| refs/remotes/origin/HEAD | d21407ab4034d3210cbcd2a99b66e3241db47d46 | SYMBOLIC_ALIAS |
| refs/remotes/origin/final02-hr-clean | d21407ab4034d3210cbcd2a99b66e3241db47d46 | HISTORY_ALREADY_INCLUDED |
| refs/remotes/origin/jules-16240871530212441223-75acb491 | 655f9f2c973437fa58ab7e4e99b963988c1c5f7e | DIVERGED_REVIEW |
| refs/remotes/origin/main | d21407ab4034d3210cbcd2a99b66e3241db47d46 | HISTORY_ALREADY_INCLUDED |
| refs/remotes/origin/namla-pro-productization-hr | 44977cf5e6816388a0838d50e4f7eaea0b133224 | DIVERGED_REVIEW |
| refs/remotes/origin/namla-v2-canonical-integration-20260912 | 1565d2f540977e97880aa1bd9d42567509dcf8f5 | HISTORY_ALREADY_INCLUDED |
| refs/remotes/origin/namla-v2-full-runtime-5585716749136749177 | 72ab84acd4329348a261405c06050b1878d8fa43 | HISTORY_ALREADY_INCLUDED |
| refs/remotes/origin/namla-v2-full-runtime-hr | 937296c1bbea8f6e03c6c38a46db8c15f6f85e79 | EXACT_TREE_OF_INCLUDED_COMMIT |
| refs/remotes/origin/namla-v2-runtime-convergence-20260914 | 8e864e3325d764887d0630610d14702730830721 | CANONICAL_BASE |
| refs/remotes/origin/namla-v2-week-checkpoint-20260911 | d020aba617f5d58ff29da95d2cdb6314fbb5afdd | HISTORY_ALREADY_INCLUDED |

## Contribution ledger
The original mechanical classifications are preserved. A new path still needs behavioral and dependency review.
C1_SOURCE_IMPORTED_UNWIRED selects only the source import; it does not claim product integration is complete.
C1_P0_REGISTRATION_ONLY_DONOR_REVIEW_PENDING records a local runner edit, not acceptance of the donor runner.

### Productization

Source: `44977cf5e6816388a0838d50e4f7eaea0b133224`; common ancestor: `50cd4ef8198f4eafb896e17d999050ba60b34a19`.

| Path | Donor change | Baseline content classification | Decision |
|---|---|---|---|
| docs/productization/DECISIONS.md | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| docs/productization/MIGRATION_MAP.md | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| docs/productization/PROGRESS.md | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| docs/productization/QUALITY_GATES.md | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| docs/security/EXECUTABLE_THREAT_MODEL.md | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| package-lock.json | MODIFY | BOTH_CHANGED_REVIEW | HUMAN_REVIEW_REQUIRED |
| package.json | MODIFY | BOTH_CHANGED_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/application/ant-allocator.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/application/budget-controller.ts | ADD | NEW_PATH_REVIEW | C2_ADAPTED_VALIDATOR_UNWIRED |
| src/application/gate-engine.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/application/model-gateway.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/application/namla-loop.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/application/namla-service.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/application/operation-fingerprint.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/application/policy-engine.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/application/scheduler.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/application/supervisor.ts | ADD | NEW_PATH_REVIEW | C2_CONTRACT_IMPORTED_UNWIRED |
| src/application/tool-gateway.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/bootstrap/container.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/bootstrap/trustedRecoveryBootstrap.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/domain/contracts.ts | ADD | NEW_PATH_REVIEW | C1_SOURCE_IMPORTED_UNWIRED |
| src/domain/errors.ts | ADD | NEW_PATH_REVIEW | C1_SOURCE_IMPORTED_UNWIRED |
| src/domain/lifecycle.ts | ADD | NEW_PATH_REVIEW | C1_SOURCE_IMPORTED_UNWIRED |
| src/domain/types.ts | ADD | NEW_PATH_REVIEW | C1_SOURCE_IMPORTED_UNWIRED |
| src/domain/unit-of-work.ts | ADD | NEW_PATH_REVIEW | C1_SOURCE_IMPORTED_UNWIRED |
| src/infrastructure/persistence/inMemoryUnitOfWork.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/infrastructure/persistence/migrations.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/infrastructure/persistence/migrations/001_initial_schema.sql | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/infrastructure/persistence/postgresStateRepository.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/infrastructure/persistence/postgresUnitOfWork.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/tools/actualPostgresServerIntegrationTests.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/tools/applicationEngineTests.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/tools/applicationIntegrationTests.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/tools/architectureLayerTests.ts | ADD | NEW_PATH_REVIEW | C1_SOURCE_IMPORTED_UNWIRED |
| src/tools/ciInvariantTests.ts | MODIFY | DONOR_ONLY_CHANGE_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/tools/domainLifecycleTests.ts | ADD | NEW_PATH_REVIEW | C1_SOURCE_IMPORTED_UNWIRED |
| src/tools/executableProvenanceTests.ts | MODIFY | BOTH_CHANGED_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/tools/extremeQualityTests.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/tools/goldenPostgresServerE2ETests.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/tools/goldenRuntimeE2ETests.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/tools/isolatedWorkspaceSmokeTests.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/tools/p0SecurityRunner.ts | MODIFY | BOTH_CHANGED_REVIEW | C1_P0_REGISTRATION_ONLY_DONOR_REVIEW_PENDING |
| src/tools/pgMemIntegrationTests.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/tools/pglitePostgresEngineTests.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/tools/postgresIntegrationTests.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/tools/postgresPoolTransactionMockTests.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/tools/postgresReleaseRunner.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/tools/stateSchedulerTests.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/tools/trustedExecutableTests.ts | MODIFY | BOTH_CHANGED_REVIEW | HUMAN_REVIEW_REQUIRED |
| tsconfig.json | MODIFY | DONOR_ONLY_CHANGE_REVIEW | HUMAN_REVIEW_REQUIRED |

### FINAL-02

Source: `655f9f2c973437fa58ab7e4e99b963988c1c5f7e`; common ancestor: `9e4d0e60ffe4c258d41118adbaed6b412f165a98`.

| Path | Donor change | Baseline content classification | Decision |
|---|---|---|---|
| FINAL02_CLEAN_HANDOFF.zip | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| FINAL02_PRODUCTION_INTEGRATION_RUNTIME.patch | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| README.md | MODIFY | BOTH_CHANGED_REVIEW | HUMAN_REVIEW_REQUIRED |
| docs/30-final02-execution-runtime.md | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/cognitive/containerSandboxBackend.ts | MODIFY | EXACT_IN_BASE | NO_COPY_NEEDED |
| src/cognitive/dockerStageBisection.ts | MODIFY | EXACT_IN_BASE | NO_COPY_NEEDED |
| src/cognitive/sandboxPolicy.ts | MODIFY | EXACT_IN_BASE | NO_COPY_NEEDED |
| src/cognitive/smokeWorkspace.ts | MODIFY | DONOR_ONLY_CHANGE_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/examples/demoNamolaTwinEmpireV1.ts | MODIFY | DONOR_ONLY_CHANGE_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/examples/demoTwinColonyFoundation.ts | MODIFY | DONOR_ONLY_CHANGE_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/tools/containerIsolationProbe.ts | MODIFY | EXACT_IN_BASE | NO_COPY_NEEDED |
| src/tools/containerSandboxTests.ts | MODIFY | EXACT_IN_BASE | NO_COPY_NEEDED |
| src/tools/executableProvenanceTests.ts | MODIFY | BOTH_CHANGED_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/tools/final02AssertionInvariantsTests.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/tools/final02AutomatedAcceptanceGateTests.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/tools/final02BaselineParity.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/tools/final02ExecutionRuntimeTests.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/tools/frozenEvidenceIntegrityTests.ts | MODIFY | DONOR_ONLY_CHANGE_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/tools/generateP05ValidationEvidence.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/tools/hostMountClaimTests.ts | ADD | EXACT_IN_BASE | NO_COPY_NEEDED |
| src/tools/p0SecurityRunner.ts | MODIFY | BOTH_CHANGED_REVIEW | C1_P0_REGISTRATION_ONLY_DONOR_REVIEW_PENDING |
| src/tools/probeTimeoutTruthTests.ts | MODIFY | EXACT_IN_BASE | NO_COPY_NEEDED |
| src/tools/readOnlySourceMountTests.ts | ADD | EXACT_IN_BASE | NO_COPY_NEEDED |
| src/tools/testFixtures/final02SandboxSigner.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/tools/trustedExecutableTests.ts | MODIFY | BOTH_CHANGED_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/tools/twinBuildLoopTests.ts | MODIFY | DONOR_ONLY_CHANGE_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/tools/twinRunMetricsTests.ts | ADD | EXACT_IN_BASE | NO_COPY_NEEDED |
| src/tools/verificationSandboxTests.ts | MODIFY | BOTH_CHANGED_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/tools/windowsContainerIdentityTests.ts | ADD | EXACT_IN_BASE | NO_COPY_NEEDED |
| src/tools/windowsDockerTrustPinTests.ts | ADD | EXACT_IN_BASE | NO_COPY_NEEDED |
| src/tools/windowsEnvFilePolicyTests.ts | ADD | EXACT_IN_BASE | NO_COPY_NEEDED |
| src/twin/colonyForge.ts | MODIFY | DONOR_ONLY_CHANGE_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/twin/final02/baselineMaterializer.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/twin/final02/conflictEngine.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/twin/final02/contracts.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/twin/final02/executionPlanBuilder.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/twin/final02/final02Coordinator.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/twin/final02/frozenArtifactResolver.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/twin/final02/materializer.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/twin/final02/productionTrustStore.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/twin/final02/regressionRunner.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/twin/final02/repairEngine.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/twin/final02/sandboxReceiptVerifier.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/twin/final02/treeDigest.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/twin/final02/verificationRunner.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/twin/final02/workspaceManager.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/twin/final02ExecutionRuntime.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/twin/frozenBundleValidator.ts | MODIFY | DONOR_ONLY_CHANGE_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/twin/mergeForge.ts | MODIFY | DONOR_ONLY_CHANGE_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/twin/namolaSovereignCourt.ts | MODIFY | DONOR_ONLY_CHANGE_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/twin/twinColonyLiveRunner.ts | MODIFY | DONOR_ONLY_CHANGE_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/twin/twinColonyTypes.ts | MODIFY | DONOR_ONLY_CHANGE_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/twin/twinPostColonyPipeline.ts | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/twin/twinResumeRunner.ts | MODIFY | DONOR_ONLY_CHANGE_REVIEW | HUMAN_REVIEW_REQUIRED |
| src/twin/twinRunMetrics.ts | ADD | EXACT_IN_BASE | NO_COPY_NEEDED |
| validation-report.json | ADD | NEW_PATH_REVIEW | HUMAN_REVIEW_REQUIRED |

## Completion accounting and next work
Productization: 9 of 50 donor paths selected across C1/C2 (8 exact source copies and 1 adapted validator); 41 donor paths still require decisions, including donor runner changes.
FINAL-02: 13 of 56 paths already identical to baseline; 43 still require review. No FINAL-02 source imported by C1.
Next: reconcile remaining gateway and application-service capabilities with the single canonical V2 effect/authority boundary. No donor scheduler or old database authority is implicitly selected.
No parallel active scheduler, second authority system or silent budget reset is accepted by this source batch.

## Preservation and release limits
Existing audit bundle SHA-256: `a667fe3819af53a166db2f8fb0f0297e47a77d685ef4f5888c0d49a4ef815ab9`.
Bundle refs and header were checked; restoration into a fresh repository has not been tested.
Ignored/untracked data, unrelated repositories and database contents are outside this bundle.
No branch, worktree, ignored file or database deletion is approved.
Factory/orchestrator replay and database-server restart qualification remain outside the evidence of C1.
No commit or push is created by the C1 application script.
