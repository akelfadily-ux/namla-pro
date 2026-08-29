# FOUNDATION QUALITY BOARD — QUALITY_GATES.md

| Subsystem       | Architecture | Correctness | Concurrency | Failure Recovery | Security | Real Integration | Maintainability | Evidence Classification Tier | Evidence |
| --------------- | -----------: | ----------: | ----------: | ---------------: | -------: | ---------------: | --------------: | ---------------------------- | -------- |
| Layer isolation | UNIT TESTED | UNIT TESTED | UNIT TESTED | UNIT TESTED | UNIT TESTED | UNIT TESTED | UNIT TESTED | UNIT | `src/domain/types.ts`, `src/tools/architectureLayerTests.ts` |
| Run lifecycle   | UNIT TESTED | UNIT TESTED | MOCK TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | UNIT TESTED | UNIT | `src/domain/lifecycle.ts`, `src/tools/domainLifecycleTests.ts` |
| Task lifecycle  | UNIT TESTED | UNIT TESTED | MOCK TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | UNIT TESTED | UNIT | `src/domain/lifecycle.ts`, `src/tools/domainLifecycleTests.ts` |
| PostgreSQL      | UNIT TESTED | UNIT TESTED | PGLITE TESTED | PGLITE TESTED | UNIT TESTED | PGLITE TESTED | UNIT TESTED | PGlite PostgreSQL-engine compatibility | `src/infrastructure/persistence/postgresStateRepository.ts`, `src/tools/pglitePostgresEngineTests.ts` |
| PostgreSQL DB   | UNIT TESTED | UNIT TESTED | PG SERVER TESTED | PG SERVER TESTED | UNIT TESTED | PG SERVER TESTED | UNIT TESTED | NOT RUN (REQUIRES DATABASE_URL) | `src/tools/actualPostgresServerIntegrationTests.ts` |
| UnitOfWork      | UNIT TESTED | UNIT TESTED | PGLITE TESTED | PGLITE TESTED | UNIT TESTED | PGLITE TESTED | UNIT TESTED | PGlite PostgreSQL-engine compatibility | `src/infrastructure/persistence/postgresUnitOfWork.ts` |
| CAS             | UNIT TESTED | UNIT TESTED | PGLITE TESTED | PGLITE TESTED | UNIT TESTED | PGLITE TESTED | UNIT TESTED | PGlite PostgreSQL-engine compatibility | `src/infrastructure/persistence/postgresStateRepository.ts` |
| Task leasing    | UNIT TESTED | UNIT TESTED | PGLITE TESTED | PGLITE TESTED | UNIT TESTED | PGLITE TESTED | UNIT TESTED | PGlite PostgreSQL-engine compatibility | `src/infrastructure/persistence/postgresStateRepository.ts` |
| Fencing         | UNIT TESTED | UNIT TESTED | PGLITE TESTED | PGLITE TESTED | UNIT TESTED | PGLITE TESTED | UNIT TESTED | PGlite PostgreSQL-engine compatibility | `src/application/namla-loop.ts`, `src/application/tool-gateway.ts` |
| Operations      | UNIT TESTED | UNIT TESTED | PGLITE TESTED | PGLITE TESTED | UNIT TESTED | PGLITE TESTED | UNIT TESTED | PGlite PostgreSQL-engine compatibility | `src/application/tool-gateway.ts` |
| Budget          | UNIT TESTED | UNIT TESTED | PGLITE TESTED | PGLITE TESTED | UNIT TESTED | PGLITE TESTED | UNIT TESTED | PGlite PostgreSQL-engine compatibility | `src/application/budget-controller.ts`, `src/application/model-gateway.ts` |
| ModelGateway    | UNIT TESTED | UNIT TESTED | MOCK TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | UNIT TESTED | MOCK | `src/application/model-gateway.ts` |
| ToolGateway     | UNIT TESTED | UNIT TESTED | MOCK TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | UNIT TESTED | MOCK | `src/application/tool-gateway.ts` |
| PolicyEngine    | UNIT TESTED | UNIT TESTED | MOCK TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | UNIT TESTED | UNIT | `src/application/policy-engine.ts` |
| Sandbox         | UNIT TESTED | UNIT TESTED | MOCK TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | UNIT TESTED | MOCK | `src/cognitive/sandboxPolicy.ts` |
| Scheduler       | UNIT TESTED | UNIT TESTED | MOCK TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | UNIT TESTED | UNIT | `src/application/scheduler.ts` |
| NamlaLoop       | UNIT TESTED | UNIT TESTED | MOCK TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | UNIT TESTED | UNIT | `src/application/namla-loop.ts` |
| Golden E2E      | UNIT TESTED | UNIT TESTED | PGLITE TESTED | PGLITE TESTED | UNIT TESTED | PGLITE TESTED | UNIT TESTED | Golden emulator | `src/tools/goldenRuntimeE2ETests.ts` |
| Security        | UNIT TESTED | UNIT TESTED | MOCK TESTED | MOCK TESTED | UNIT TESTED | MOCK TESTED | UNIT TESTED | UNIT | `src/tools/extremeQualityTests.ts` |

---
*Note: Unproven manually assigned 10/10 PASS scores have been reset to explicit evidence-driven statuses. A cell requires machine-verifiable real integration or concurrency proof files before upgrade.*
