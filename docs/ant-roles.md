# Ant Roles

Every ant in the colony has exactly one role from `AntRole`
(`src/types/antTypes.ts`). Each role has its own file under `src/ants/` with a
minimal, safe skeleton class. Every role class exposes at least one method
that returns receipt-compatible output (`ActionReceipt`, or in the auditor's
case an `AuditReport` built from receipts).

| Role | File | Purpose | Phase 0 behavior |
|---|---|---|---|
| `queen` | `antQueenRole.ts` | The colony's single point of accountability. Accepts missions, issues directives. | Returns a directive receipt. Real mission handling lives in `src/core/antQueen.ts`. |
| `commander` | `commanderAnt.ts` | Coordinates a group of tasks under a mission. | Records a coordination receipt only. |
| `strategist` | `strategistAnt.ts` | Proposes a high-level approach for a goal. | Returns a strategy proposal receipt. |
| `scout` | `scoutAnt.ts` | Explores and reports, read-only. | Never modifies anything; returns an observation receipt. |
| `planner` | `plannerAnt.ts` | Breaks a goal into candidate sub-tasks. | Returns proposed sub-task titles in a receipt; real task creation goes through `MissionPlanner`. |
| `worker` | `workerAnt.ts` | Generic task executor. | "Executing" means planning, never running anything real. |
| `builder` | `builderAnt.ts` | Proposes how something would be constructed. | Never writes a file; returns a build proposal. |
| `tester` | `testerAnt.ts` | Proposes what should be tested. | Never runs a test suite; returns a test plan proposal. |
| `auditor` | `auditorAnt.ts` | Reviews receipts after the fact. | Purely additive review; produces an `AuditReport`. |
| `guard` | `guardAnt.ts` | The colony's distributed safety presence. | Runs `SafetyGuard` on demand for any ant that wants a second opinion. |
| `memory` | `memoryAnt.ts` | Proposes memory entries. | Checks for secret-shaped content before proposing; never writes to `ColonyMemory` directly. |
| `repair` | `repairAnt.ts` | Proposes a fix for a reported bug. | Never applies a fix; returns a proposal receipt. |
| `messenger` | `messengerAnt.ts` | Relays messages between ants or to a human. | Records the message as a receipt; no live transport in Phase 0. |
| `forager` | `foragerAnt.ts` | Gathers external information. | Simulated only; no real network access. |
| `cleaner` | `cleanerAnt.ts` | Proposes cleanup of stale colony state. | Never deletes anything; returns a cleanup proposal. |
| `optimizer` | `optimizerAnt.ts` | Proposes efficiency improvements. | Never applies a change; returns a suggestion receipt. |
| `archivist` | `archivistAnt.ts` | Proposes archiving completed mission data. | Never moves or deletes data; returns an archive proposal. |
| `nurse` | `nurseAnt.ts` | Monitors other ants' energy state. | Read-only observation; flags `tired`/`offline` ants. |
| `architect` | `architectAnt.ts` | Proposes structural/architecture decisions. | Returns a proposal; emitting an `ArchitecturePheromone` is left to the caller. |
| `reporter` | `reporterAnt.ts` | Summarizes mission/colony status for a human. | Summarizes receipts it is given; does not query live systems itself. |

## Design notes

- **Every role is a thin, typed class**, not a prompt template or an LLM
  wrapper. Phase 0 defines *shape and safety*, not intelligence. Later
  phases can plug real reasoning (including calling out to an LLM) behind
  these same method signatures without changing the colony's coordination
  model.
- **Trust levels vary by role.** Roles that only observe or propose
  (`scout`, `worker`, `builder`, `tester`, `cleaner`, `optimizer`,
  `repair`, `forager`, `messenger`) start `probationary`. Roles that
  coordinate or gate other ants (`commander`, `strategist`, `planner`,
  `auditor`, `memory`, `archivist`, `nurse`, `architect`, `reporter`) start
  `trusted`. `guard` and `queen` start `core`. Trust levels are descriptive
  in Phase 0 — no enforcement logic reads them yet — but the field exists so
  future phases can gate capability by trust without a schema change.
- **No role can bypass SafetyGuard.** `GuardAnt` wraps `SafetyGuard`
  directly; every other role that could plausibly propose something risky
  (`worker`, `builder`, `repair`, `cleaner`) still has its output routed
  through `SafetyGuard` at the orchestrator or mission level before it
  becomes a real task.
