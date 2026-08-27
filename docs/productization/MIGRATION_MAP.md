# MIGRATION MAP

| Old / Existing Location | Target Location | Status | Notes / Plan |
| --- | --- | --- | --- |
| `src/types/taskTypes.ts`, `src/types/antTypes.ts` | `src/domain/types.ts` | IN PROGRESS | Standardize core Run, Task, Ant, Artifact domain types |
| - | `src/domain/lifecycle.ts` | IN PROGRESS | Single task lifecycle transition authority |
| `src/types/safetyTypes.ts` | `src/domain/errors.ts` | IN PROGRESS | Domain error taxonomy (NamlaError hierarchy) |
| `src/gateway/providerContracts.ts` | `src/domain/contracts.ts` | IN PROGRESS | Core ports (StateRepository, ModelAdapter, ToolAdapter, EventPublisher) |
| `src/colonyMission/cognitiveExecutionBudget.ts` | `src/application/budget-controller.ts` | TODO | Central budget controller for costs, tokens, calls, runtime |
| `src/policies/commandSafetyPolicy.ts` | `src/application/policy-engine.ts` | TODO | Central permission authority |
| `src/bodies/toolAdapter.ts` | `src/application/tool-gateway.ts` | TODO | Central tool execution gateway with operationId idempotency |
| `src/gateway/providerAdapters.ts` | `src/application/model-gateway.ts` | TODO | Central LLM model gateway |
| `src/review/proposalReviewer.ts` | `src/application/gate-engine.ts` | TODO | Gate evaluation engine |
| `src/colonyMission/reviewLoop.ts` | `src/application/namla-loop.ts` | TODO | Standard execution -> test -> review -> approve workflow loop |
| `src/bootstrap/c2WriteAuthorityBootstrap.ts` | `src/bootstrap/container.ts` | TODO | Single composition root / DI container |
