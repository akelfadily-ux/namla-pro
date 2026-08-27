# ARCHITECTURAL DECISION RECORDS (ADR)

## ADR-001 — POSIX Test Harness Temp Directory Permissions

- **Status:** APPROVED
- **Context:** Test suites (`src/tools/trustedExecutableTests.ts` and `src/tools/executableProvenanceTests.ts`) failed on Linux environments where default umask sets directory modes to 0700 or files to 0664, causing `evaluatePosixProvenance` to reject test fixtures as `untrusted-executable-owner` or `untrusted-executable-parent`.
- **Existing implementation:** `src/tools/trustedExecutableTests.ts`, `src/tools/executableProvenanceTests.ts`.
- **Alternatives considered:** Disabling POSIX provenance checks in test mode (refused: would weaken security guarantees under test).
- **Decision:** Explicitly set permission modes on test directories and binary fixtures created via `mkdtempSync` and `plant` using `chmodSync(path, 0o755)`.
- **Why:** Guarantees test execution is deterministic across varied execution environments without modifying or weakening production security checks.
- **Consequences:** Tests run deterministically on all POSIX environments.
- **Migration impact:** Test files `trustedExecutableTests.ts` and `executableProvenanceTests.ts`.
- **Security impact:** Zero reduction in security rigor; production provenance rules remain strict.
- **Operational impact:** CI test runners on Linux pass 100% (719 passed, 0 failed).
- **Evidence:** `npm test` passes cleanly on POSIX runner.

---

## ADR-002 — Domain Layer Architecture & Interface Contracts

- **Status:** APPROVED
- **Context:** Core domain logic was coupled with infrastructure/provider SDKs across multiple modules, preventing clean testing and modular swapping.
- **Existing implementation:** `src/types/taskTypes.ts`, `src/types/antTypes.ts`, `src/gateway/providerContracts.ts`.
- **Alternatives considered:** Monolithic state management with direct SDK instantiation in agent loops (refused: violates separation of concerns and leads to tight coupling).
- **Decision:** Establish pure domain modules under `src/domain/` (`types.ts`, `lifecycle.ts`, `errors.ts`, `contracts.ts`). Domain code MUST NOT import OpenAI, Anthropic, Docker, Fastify, Express, Postgres, or filesystem concrete implementations.
- **Why:** Enforces the dependency direction APPS -> APPLICATION -> DOMAIN and allows infrastructure implementations to plug into standard interfaces.
- **Consequences:** Clean separation of concerns and pure domain testability.
- **Migration impact:** Legacy type modules migrate toward `src/domain/`.
- **Security impact:** Isolates business logic from external execution side effects.
- **Operational impact:** Enables unit testing without mock infrastructure.
- **Evidence:** Unit test suite `src/tools/domainLifecycleTests.ts` passes 100%.

---

## ADR-003 — Durable State Repository & Atomic Task Transitions

- **Status:** APPROVED
- **Context:** Ad-hoc execution memory lost task state on worker crashes or restarts and suffered from race conditions during concurrent worker dispatch.
- **Existing implementation:** `src/core/colonyState.ts`, in-memory execution state.
- **Alternatives considered:** Process-memory task queues or non-atomic file reads/writes (refused: non-durable and vulnerable to lost updates).
- **Decision:** Implement `PostgresStateRepository` (`src/infrastructure/persistence/postgresStateRepository.ts`) using SQL compare-and-swap state updates (`UPDATE tasks SET status = $1 WHERE id = $7 AND status = $8 RETURNING *`).
- **Why:** Guarantees atomic state transitions, prevents double-claiming, and provides worker lease expiration recovery (`lease_expires_at`).
- **Consequences:** State updates throw `StateConflictError` on optimistic locking failure, enabling safe retry.
- **Migration impact:** Task state queries route through `StateRepository`.
- **Security impact:** Prevents unauthorized concurrent execution of the same task.
- **Operational impact:** Enables process restart recovery and worker lease expiration recovery.
- **Evidence:** `src/tools/stateSchedulerTests.ts` validates atomic CAS transitions and concurrent conflict rejection.

---

## ADR-004 — Central Model Gateway

- **Status:** APPROVED
- **Context:** LLM provider SDK calls were direct and scattered, bypassing central budget enforcement and telemetry.
- **Existing implementation:** Direct SDK instantiation in cognitive workers and CLI adapters.
- **Alternatives considered:** Provider SDK wrappers inside individual agents (refused: inconsistent budget tracking and retries).
- **Decision:** Route all LLM requests through `ModelGateway` (`src/application/model-gateway.ts`) backed by `ModelAdapter` implementations.
- **Why:** Centralizes cost/token budget enforcement (`BudgetController`) before dispatching model generation requests.
- **Consequences:** All model calls pass through budget assertion gates.
- **Migration impact:** Agents call `ModelGateway.generate()` instead of provider SDKs directly.
- **Security impact:** Prevents unmonitored or unlimited model calls.
- **Operational impact:** Provides unified token/cost tracking and adapter interchangeability.
- **Evidence:** `src/tools/applicationEngineTests.ts` and `src/tools/goldenE2ETests.ts`.

---

## ADR-005 — Tool Gateway & Operation Idempotency

- **Status:** APPROVED
- **Context:** Retrying failed or crashed tasks risked executing destructive side-effecting operations (shell, git, filesystem) multiple times.
- **Existing implementation:** Uncached tool calls in `src/bodies/toolAdapter.ts` and `src/policies/bodyExecutionPolicy.ts`.
- **Alternatives considered:** Memory-based deduping (refused: lost across process restarts).
- **Decision:** Execute all tools through `ToolGateway` (`src/application/tool-gateway.ts`), checking `operationId` results in `StateRepository` before execution, enforcing capabilities via `PolicyEngine`, and applying timeouts via `AbortController`.
- **Why:** Makes task retries idempotent and crash-resilient across worker restarts.
- **Consequences:** Every tool call requires a unique `operationId` in `ToolExecutionContext`.
- **Migration impact:** Tool execution routes through `ToolGateway.execute()`.
- **Security impact:** Enforces capability permissions (`tool:<toolName>`) before execution.
- **Operational impact:** Prevents duplicate external side effects during workflow retries.
- **Evidence:** `src/tools/applicationEngineTests.ts` verifies operation result caching and deduping.

---

## ADR-006 — Policy Engine & Capability-Based Access Control

- **Status:** APPROVED
- **Context:** Agents had direct or unrestricted access to host tools without explicit permission checks.
- **Existing implementation:** Ad-hoc command safety checks in `src/policies/commandSafetyPolicy.ts`.
- **Alternatives considered:** Global allow/deny lists (refused: lacks role/context granularity).
- **Decision:** Implement `PolicyEngine` (`src/application/policy-engine.ts`) asserting capability permissions (e.g. `tool:shell`, `filesystem.read`) against granted context permissions.
- **Why:** Default-deny capability authorization prevents unauthorized tool execution.
- **Consequences:** Ungranted capabilities throw `PermissionDeniedError`.
- **Migration impact:** Tool gateway context must supply granted capability strings.
- **Security impact:** Strict capability isolation per task/role.
- **Operational impact:** Audit trail of denied capability requests.
- **Evidence:** `src/tools/applicationEngineTests.ts` tests capability authorization and denial.

---

## ADR-007 — Namla Loop & Gate Engine Verification

- **Status:** APPROVED
- **Context:** Task completion was self-declared by agent prompt responses without mechanical verification or independent review.
- **Existing implementation:** Unverified proposal loops in `src/colonyMission/reviewLoop.ts`.
- **Alternatives considered:** Accepting prompt text "success" claims (refused: violates evidence-based execution boundary).
- **Decision:** Implement `NamlaLoop` (`src/application/namla-loop.ts`) enforcing the sequence `EXECUTE -> TEST (GateEngine) -> VERIFY (Supervisor) -> APPROVED`.
- **Why:** Ensures tasks only transition to `APPROVED` when automated gates pass and an independent supervisor approves.
- **Consequences:** Rejected tasks automatically transition to `RETRYING` or `FAILED` based on remaining attempt limits.
- **Migration impact:** Workflow execution passes through `NamlaLoop.executeTask()`.
- **Security impact:** Dual-control separation: execution ant cannot self-approve without supervisor review.
- **Operational impact:** Deterministic retry and failure handling.
- **Evidence:** `src/tools/applicationEngineTests.ts` and `src/tools/goldenE2ETests.ts`.

---

## ADR-008 — Composition Root & Application Service

- **Status:** APPROVED
- **Context:** Component dependencies were constructed ad-hoc across CLI tools and scripts.
- **Existing implementation:** Direct module instantiation across `src/cli/`.
- **Alternatives considered:** Service locators or global singletons (refused: introduces mutable global state).
- **Decision:** Create a single composition root in `src/bootstrap/container.ts` (`Container`) and expose application operations via `NamlaService` (`src/application/namla-service.ts`).
- **Why:** Provides clear dependency injection, simplifies configuration, and keeps interfaces/CLI thin.
- **Consequences:** All infrastructure and application services are wired in one place.
- **Migration impact:** Entry points construct a `Container` and call `NamlaService`.
- **Security impact:** Uniform security and policy instance injection.
- **Operational impact:** Simplifies application startup and test harness assembly.
- **Evidence:** `src/tools/goldenE2ETests.ts` validates container assembly and service invocation.
