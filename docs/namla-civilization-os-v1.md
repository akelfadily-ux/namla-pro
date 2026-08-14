# Namla Digital Civilization OS V1

Namla is no longer a collection of demos and smoke tests: it is a **living digital
ant settlement** (Build Law §27). Tamara is the sovereign strategic intelligence;
Namla is the decentralized civilization and workforce; Claude, Codex, local
models, MCP tools, and APIs are TEMPORARY bounded cognitive/execution resources
used by individual ants. The layer lives in `src/civilization/` and REUSES the
proven `DigitalResourceEconomy`, `createDigitalWorker` persistence, the Tamara
federation authority record, the academy, and the provider boundaries — it never
duplicates them.

## The settlement

Twenty districts (`settlementDistricts.ts`), each holding real local state,
publishing real demand, consuming resources, producing artifacts/failures, and
communicating through bounded local messages: queen-continuity, academy, research,
architecture-council, software-engineering, frontend/backend/database guilds,
ai-agent-engineering, testing-quality, debugging-repair, defensive-security,
devops-infrastructure, knowledge-memory, tool-mcp, provider-compute,
operations-command, waste-recycling, reserve-worker, brood-development.

## Modules

- `settlementTypes.ts` — districts, academy domains/levels, councils, MCP tools, knowledge states, seeded draw.
- `mcpNervousSystem.ts` — the MCP capability fabric (registry, scoped grants, session receipts, tool + provider health, cost/rate budgets, failure isolation, result validation, deterministic provider routing).
- `settlementDistricts.ts` — districts + the voluntary labor market (claims → bounded resolver → temporary teams).
- `councilsGovernance.ts` — decentralized councils (private assessments, local recruitment, quorum, minority reports, conflict-of-interest exclusion, bounded terms).
- `nationalInstitutions.ts` — the living knowledge economy, evidence-gated academy promotion, and the waste/repair economy.
- `settlementRunner.ts` — the national-objective orchestrator.
- `settlementReport.ts` — the safe command-center projection + conservation/causality validation.
- `src/examples/demoNamlaCivilizationOSV1.ts` — the deterministic 300/1k/10k proof.

## Guarantees

- **Decentralized** — voluntary labor market; `nonVolunteerAssignments`, `centralTaskAssignments`, `queenTaskAssignments`, `tamaraDirectAntAssignments`, `globalPlannerDecisions` all 0.
- **Bounded cognition** — deep cognition ≤ 30 concurrent; real providers a separate human-gated pilot; `realProviderCalls: 0`.
- **Conserving + causal** — 15-resource ledger closes (`unexplainedResourceCreation: 0`), causal invariants hold (`causalityViolations: 0`).
- **No real action** — `realNetworkCalls`/`realFilesystemWrites`/`processExecutions` all 0; the layer imports no fs/child_process/network.
- **MCP receipted** — every tool call is a receipt; grants are task/ant/time-scoped, revocable, costed, allowlisted, human-approved when powerful.

## Systems audit matrix (reuse, not duplication)

| System | Decision | How it is used here |
| --- | --- | --- |
| Colony Genesis (`src/colony/`) | keep | The frozen decentralized-behavior substrate; civilization reuses its decentralization + bounded-cognition guarantees conceptually. |
| Ant Intelligence (`src/colony/` intelligence) | keep | Per-ant minds/plans/peer-review model; civilization ants carry the same persistent identity discipline. |
| Tamara Federation (`src/federation/`) | integrate | `createTamaraAuthorityRecord` is reused directly — Tamara publishes the national objective and holds no worker authority. |
| Ant Academy (`src/academy/`, digital brood) | integrate | Extended into a 22-domain, 7-level national training system with evidence-gated promotion + independent evaluators. |
| Digital Superorganism (`src/digital/`) | integrate | `DigitalResourceEconomy` + `createDigitalWorker` are the conserving base; civilization threads them through districts. |
| MCP-related code | missing → built | No MCP code existed; `mcpNervousSystem.ts` is the new nervous system. |
| Provider adapters (`src/cognitive/`) | keep/bypass | Real provider execution stays the human-only V4 path; the civilization uses deterministic provider routing (0 real calls). |
| Workspaces (`smokeWorkspace`, `digitalWorkspace`) | keep | Real-fs surface unchanged; the civilization demo performs no fs. |
| Command-center state | integrate | `settlementReport.ts` projects a safe national command center for a future UI. |
| Receipts (`src/core/`) | keep | Receipt discipline unchanged; MCP sessions carry their own bounded receipts. |
| SafetyGuard / SecretProtection | keep | Unchanged; the civilization layer emits no secret-shaped summaries. |
| C0–C2 capability layers | keep | Untouched; the civilization adds no fs-mutation or exclusive-create surface. |

Nothing was deleted; every prior system remains verified, and the golden harness
grows from 37 to 38 demos with all checks green.

## Follow-on: Civilization OS V2 (Live MCP Settlement)

V1 is the deterministic settlement. **V2 does not replace it** — it wires the same
runtime (districts, MCP nervous system, councils, academy, knowledge/waste
economies, voluntary labor market) to bounded real Claude/Codex cognition and
bounded real MCP tool execution behind human-only authorization. The V1 golden is
unchanged (the MCP execution seam is backward-compatible: no executor → the V1
deterministic simulation). See
[namla-civilization-os-v2-live-mcp.md](namla-civilization-os-v2-live-mcp.md).
