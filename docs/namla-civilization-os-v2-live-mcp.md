# Namla Civilization OS V2 — Live MCP Settlement

V2 connects the Civilization OS V1 runtime to **bounded real Claude/Codex
cognition** and **bounded real MCP tool execution** (Build Law §28). It does not
replace V1 — it wires the existing settlement (20 districts, MCP nervous system,
councils, academy, knowledge economy, voluntary labor market, waste/repair) to
the proven V4 real-provider path and an injectable MCP execution driver. Automated
verification runs the whole live pipeline with fakes and makes zero real calls.

## What V2 added

- `src/cognitive/civilizationLivePermit.ts` — the non-forgeable `CivilizationLivePermit` (cohort ≤5, ≤5 initial + ≤3 repair = ≤8 provider calls, MCP/verification budgets, byte/timeout/workspace caps).
- `src/civilization/civLiveCohort.ts` — voluntary live cohort admission (≥15 claims → 1-5 accepted).
- `src/civilization/civLiveMcp.ts` — `FakeMcpExecutionDriver` (tests) + `RealMcpExecutionDriver` (human-only; file tools → `smokeWorkspace`, verification → `runVerificationCommand`).
- `mcpNervousSystem.ts` — an injectable `McpExecutionDriver` seam (default = V1 deterministic simulation, so V1 is unchanged).
- `src/civilization/civilizationLiveRunner.ts` — the live mission pipeline (reuses the V4 `RealLiveProviderDriver`).
- `src/civilization/civilizationLiveReport.ts` — the safe live command center + conservation/safety validation.
- `src/cli/civilizationLiveCli.ts` — the human-only `civilization:live` CLI (`--dry-run` + exact-phrase real path).
- `src/examples/demoNamlaCivilizationLiveV2.ts` — the deterministic all-fakes proof.

## The live mission

Tamara publishes a national objective → districts emit demand → ≥15 ants
voluntarily claim → cognitive rotation admits 1-5 → councils reach quorum on
policy with minority reports → each admitted ant makes one bounded provider call
→ results normalized → bounded MCP tools grant/call → independent review →
reviewed artifacts applied → allowlisted verification → incident council on
failure → one confirmed repair → final green → knowledge + academy + provider/MCP
health updates.

## Guarantees

- **Decentralized** — `nonVolunteerAssignments`, `centralTaskAssignments`, `queenTaskAssignments`, `tamaraDirectAntAssignments`, `globalPlannerDecisions` all 0; councils approve capability categories, never ants.
- **Bounded** — cohort ≤5, ≤8 provider calls, global cognition ≤30, MCP/verification budgets enforced by the permit.
- **No real action in tests** — `realProviderCalls`, `realProviderProcessExecutions`, `realMcpExecutions`, `realNetworkCalls`, `realFilesystemWrites` all 0.
- **Conserving + causal** — the 15-resource ledger closes; `safetyViolations: 0`.
- **Reuse, not duplication** — provider cognition reuses V4; MCP file/verification reuses the authorized `smokeWorkspace` / one-`child_process` boundaries.

## Commands

- Dry-run (no TTY, no real action):
  `npm.cmd run civilization:live -- --providers codex,codex,claude --cohort 3 --dry-run`
- Real run (interactive TTY, exact phrase `RUN NAMLA CIVILIZATION WITH 3 ANTS`; each repair call needs `RUN ONE CIVILIZATION REPAIR ANT`):
  `npm.cmd run civilization:live -- --providers codex,codex,claude --cohort 3`

After the exact phrase, the CLI closes the confirmation readline, mints one
`CivilizationLivePermit` + one scoped provider permit per accepted ant, creates the
real workspace under `workspaces/namla-civilization/<run-id>/`, and runs the bounded
live session (`runCivilizationLiveSession`): one real provider call per initial ant
via `RealLiveProviderDriver`→`NodeProviderProcessDriver`, bounded real MCP via
`RealMcpExecutionDriver`, reviewed-file application, allowlisted verification, and —
only after a SEPARATE fresh `RUN ONE CIVILIZATION REPAIR ANT` phrase — one bounded
repair round, then it reports and stops (no automatic retry, no background
continuation). The pipeline is split into a setup phase and a finalize phase around
the first verification so the repair confirmation is gathered between them; the same
phases back the synchronous demo path. `demoCivilizationLiveWiring` proves the exact
confirmation reaches this orchestration with fake drivers and zero real action. See
[civilization-live-run.md](civilization-live-run.md).
