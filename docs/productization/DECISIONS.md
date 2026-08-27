# ARCHITECTURAL DECISION RECORDS (ADR)

## ADR-001 — POSIX Test Harness Temp Directory Permissions
- **Status:** APPROVED
- **Context:** Test suites (`trustedExecutableTests.ts` and `executableProvenanceTests.ts`) failed on Linux environments where default umask sets directory modes to 0700 or files to 0664, causing `evaluatePosixProvenance` to reject test fixtures as `untrusted-executable-owner` or `untrusted-executable-parent`.
- **Decision:** Explicitly call `chmodSync(dir, 0o755)` and `chmodSync(file, 0o755)` on test fixtures created via `mkdtempSync` and `plant` on POSIX platforms.
- **Consequences:** Ensures test execution is deterministic across varied execution environments without weakening security rules.

## ADR-002 — Standard Core Domain Contracts Architecture
- **Status:** APPROVED
- **Context:** NAMLA PRO target architecture requires strict separation between pure domain contracts and infrastructure dependencies.
- **Decision:** Place core types, lifecycle transition state machine, error taxonomy, and interfaces under `src/domain/`. Domain code MUST NOT import LLM SDKs, Docker, Fastify/Express, Postgres, or filesystem implementations directly.
- **Consequences:** Enables modular infrastructure adapters and deterministic testing.
