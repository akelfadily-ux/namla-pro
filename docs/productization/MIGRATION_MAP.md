# MIGRATION MAP

| Old / Existing Location | Target Location | Status | Notes / Plan |
| --- | --- | --- | --- |
| `src/types/taskTypes.ts`, `src/types/antTypes.ts` | `src/domain/types.ts` | DONE | Core RunRecord, TaskRecord, OperationRecord, AntRole, RunStatus, TaskStatus domain types |
| - | `src/domain/lifecycle.ts` | DONE | Single task & run lifecycle transition authority (`assertTaskTransition`, `assertRunTransition`) |
| `src/types/safetyTypes.ts` | `src/domain/errors.ts` | DONE | Domain error taxonomy (NamlaError hierarchy) |
| `src/gateway/providerContracts.ts` | `src/domain/contracts.ts` | DONE | Core ports (StateRepository, ModelAdapter, ToolAdapter, EventPublisher) |
| `src/colonyMission/cognitiveExecutionBudget.ts` | `src/application/budget-controller.ts` | DONE | Central budget controller for costs, tokens, calls, runtime |
| `src/policies/commandSafetyPolicy.ts` | `src/application/policy-engine.ts` | DONE | Central capability permission authority with resource scoping |
| `src/bodies/toolAdapter.ts` | `src/application/tool-gateway.ts` | DONE | Central tool execution gateway with operationId input fingerprinting & replay |
| `src/gateway/providerAdapters.ts` | `src/application/model-gateway.ts` | DONE | Central LLM model gateway with closed-loop usage tracking & telemetry |
| `src/review/proposalReviewer.ts` | `src/application/gate-engine.ts` | DONE | Gate evaluation engine |
| `src/colonyMission/reviewLoop.ts` | `src/application/namla-loop.ts` | DONE | Standard execution -> test -> review -> approve workflow loop with evidence persistence |
| `src/bootstrap/c2WriteAuthorityBootstrap.ts` | `src/bootstrap/container.ts` | DONE | Single composition root / DI container |
| `src/core/colonyState.ts` | `src/infrastructure/persistence/postgresStateRepository.ts` | DONE | Durable state repository with SQL CAS transitions, atomic worker leases & operation fingerprinting |
| - | `src/domain/unit-of-work.ts` | DONE | UnitOfWork interface for transactional operations |
| - | `src/application/operation-fingerprint.ts` | DONE | Recursive deterministic input canonicalization and SHA-256 operation fingerprinting |
| - | `src/tools/goldenRuntimeE2ETests.ts` | DONE | Deterministic Golden Runtime E2E test suite in real isolated workspace |
| - | `src/application/namla-service.ts` | DONE | Thin public application service for run creation and processing |
