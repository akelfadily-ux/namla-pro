# FOUNDATION QUALITY BOARD — QUALITY_GATES.md

| Subsystem       | Architecture | Correctness | Concurrency | Failure Recovery | Security | Real Integration | Maintainability | Status | Evidence |
| --------------- | -----------: | ----------: | ----------: | ---------------: | -------: | ---------------: | --------------: | ------ | -------- |
| Layer isolation | UNIT TESTED | UNIT TESTED | UNIT TESTED | UNIT TESTED | UNIT TESTED | UNIT TESTED | UNIT TESTED | UNIT TESTED | `src/domain/types.ts`, `src/tools/architectureLayerTests.ts` |
| Run lifecycle   | UNIT TESTED | UNIT TESTED | MOCK TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | `src/domain/lifecycle.ts`, `src/tools/domainLifecycleTests.ts` |
| Task lifecycle  | UNIT TESTED | UNIT TESTED | MOCK TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | `src/domain/lifecycle.ts`, `src/tools/domainLifecycleTests.ts` |
| PostgreSQL      | UNIT TESTED | UNIT TESTED | MOCK TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | `src/infrastructure/persistence/postgresStateRepository.ts`, `src/tools/postgresIntegrationTests.ts` |
| UnitOfWork      | UNIT TESTED | UNIT TESTED | MOCK TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | `src/infrastructure/persistence/postgresUnitOfWork.ts` |
| CAS             | UNIT TESTED | UNIT TESTED | MOCK TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | `src/infrastructure/persistence/postgresStateRepository.ts` |
| Task leasing    | UNIT TESTED | UNIT TESTED | MOCK TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | `src/infrastructure/persistence/postgresStateRepository.ts` |
| Fencing         | UNIT TESTED | UNIT TESTED | MOCK TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | `src/application/namla-loop.ts`, `src/application/tool-gateway.ts` |
| Crash recovery  | UNIT TESTED | UNIT TESTED | MOCK TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | `src/infrastructure/persistence/postgresStateRepository.ts` |
| Operations      | UNIT TESTED | UNIT TESTED | MOCK TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | `src/application/tool-gateway.ts` |
| Budget          | UNIT TESTED | UNIT TESTED | MOCK TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | `src/application/budget-controller.ts`, `src/application/model-gateway.ts` |
| ModelGateway    | UNIT TESTED | UNIT TESTED | MOCK TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | `src/application/model-gateway.ts` |
| ToolGateway     | UNIT TESTED | UNIT TESTED | MOCK TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | `src/application/tool-gateway.ts` |
| PolicyEngine    | UNIT TESTED | UNIT TESTED | MOCK TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | `src/application/policy-engine.ts` |
| Sandbox         | UNIT TESTED | UNIT TESTED | MOCK TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | `src/cognitive/sandboxPolicy.ts` |
| Scheduler       | UNIT TESTED | UNIT TESTED | MOCK TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | `src/application/scheduler.ts` |
| NamlaLoop       | UNIT TESTED | UNIT TESTED | MOCK TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | `src/application/namla-loop.ts` |
| Supervisor      | UNIT TESTED | UNIT TESTED | MOCK TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | `src/application/supervisor.ts` |
| Artifacts       | UNIT TESTED | UNIT TESTED | MOCK TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | `src/infrastructure/persistence/postgresStateRepository.ts` |
| Observability   | UNIT TESTED | UNIT TESTED | MOCK TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | `src/application/tool-gateway.ts` |
| Golden E2E      | UNIT TESTED | UNIT TESTED | MOCK TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | `src/tools/goldenRuntimeE2ETests.js` |
| Security        | UNIT TESTED | UNIT TESTED | MOCK TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | `src/tools/extremeQualityTests.ts` |

---
*Note: Unproven manually assigned 10/10 PASS scores have been reset to explicit evidence-driven statuses. A cell requires machine-verifiable real integration or concurrency proof files before upgrade.*
