# Civilization Live Run — Pre-flight & Operational Readiness

Operational hardening for the human-authorized live settlement (Build Law §28).
This doc records the full execution transition matrix, the pre-flight guards, the
recovery behavior, and the process-cleanup guarantees. It changes no architecture —
it makes the existing live path safer, more observable, and ready for the first
real run.

## Transition matrix

Every stage, its input, its next stage, failure behavior, receipt/log, budget
consumed, and whether a human confirmation is required. Stage names are the
redacted logs emitted at runtime.

| # | Stage | Required input | Next stage | Failure behavior | Receipt / log | Budget consumed | Human confirmation |
|---|-------|----------------|-----------|------------------|---------------|-----------------|--------------------|
| 0 | plan display + `workspace preflight` | argv (`--providers`, `--cohort`) | confirmation prompt (real) / exit (dry-run) | `refused: insufficient-volunteers` if <15 claims | plan lines + `workspace preflight` | none | no |
| 0a | provider availability probe | provider ids | confirmation prompt | non-fatal warn if not on PATH (`--version`, unpaid) | `provider availability:` lines | none | no |
| 0b | stale-workspace guard | `inspectCivilizationWorkspace(runId)` | confirmation prompt | `refused: stale-workspace-output` — STOP, human archives/renames; nothing deleted | `civilization-live-run-complete{refused}` | none | no |
| 1 | human confirmation | exact `RUN NAMLA CIVILIZATION WITH <N> ANTS` at a TTY | permit creation | `aborted: phrase-mismatch` / `not-interactive-tty` | `confirmation-accepted` | none | **YES** |
| 2 | permit creation | `HumanConfirmation` | cohort permits | `aborted: permit-mint-failed` | `civilization-permit-created` | 1 CivilizationLivePermit (≤5 cohort, ≤8 provider, ≤3 repair) | (from #1) |
| 3 | cohort provider permits | same confirmation | workspace-ready | `aborted: cohort-permit-mint-failed` | `cohort-permits-created` | 1 scoped single-use permit / ant | (from #1) |
| 4 | workspace creation | validated run id | councils-ready | `aborted: workspace-create-failed` | `workspace-ready` | real dir `workspaces/namla-civilization/<run-id>/` | no |
| 5 | councils | active workers + cohort | provider-request-ready | quorum recorded; minority reports kept | `councils-ready` | none | no |
| 6 | provider execution (per initial ant) | scoped permit + fixed prompt | output normalization | provider failure → incident + waste; **no retry** | `provider-spawn-starting/-completed` | 1 initial provider call (≤5) | no |
| 7 | output normalization | bounded stdout (data only) | council review | malformed/oversized/traversal/absolute/source/secret rejected | (in provider-spawn-completed) | none | no |
| 8 | bounded MCP | approved capability category | artifact application | tool failure isolated → incident + waste | `mcp-grant-created`, `mcp-call-starting/-completed` + session receipt | 1 MCP call / grant (≤50) | no |
| 9 | independent review + apply | ≥1 reviewer (2 + councils for high-risk), never self | verification | unreviewed/rejected artifact not applied | `reviews-completed`, `artifacts-applied` | none | no |
| 10 | verification | allowlisted command, cwd = workspace | incident (fail) / final report (pass) | fail → incident + error waste + technical debt + repair demand | `verification-started/-completed`, `incident-created` | 1 verification call (≤10) | no |
| 11 | repair confirmation | fresh `RUN ONE CIVILIZATION REPAIR ANT` at a TTY | repair provider call / final report | declined → run completes unrepaired | `repair-confirmation-requested` | none | **YES (separate, per repair)** |
| 12 | repair provider call | fresh scoped repair permit | final report | repair failure → recorded, no retry | `repair-provider-starting/-completed` | 1 repair provider call (≤3, ≤8 total) | (from #11) |
| 13 | final report | run result (or thrown error) | process exit | on throw → redacted `error` summary (error NAME only) | `civilization-live-run-complete` + JSON report | none | no |
| 14 | process exit | — | — | — | — | none | no |

No transition is missing: every stage has a defined next stage and a defined
failure behavior; every terminal path emits `civilization-live-run-complete` and a
JSON summary, then `process.exit`.

## Pre-flight guards (this hardening pass)

- **Provider availability** — `detectProviderAvailability` runs each provider's own
  `--version` (bounded, `shell:false`, fixed arg, timeout, safe env, **unpaid** — no
  prompt/cognition/cost), inside the single `child_process` importer. Non-fatal: it
  warns before the human commits; PATH resolution at spawn remains the real gate.
  Never runs in dry-run or in any automated test.
- **Stale-workspace guard** — `inspectCivilizationWorkspace` (read-only, no
  creation/mutation) reports the resolved path, whether it is inside the allowed
  root, existing file + byte count, new-vs-reused, and `staleOutput`. If the run
  directory already holds prior-run output the CLI **refuses** (`stale-workspace-output`)
  and asks the human to archive or rename it — **nothing is deleted or overwritten**,
  and it refuses *before* any confirmation or permit.

## Recovery behavior

Every failure terminates or requests a separately-confirmed repair — never an
infinite loop, automatic retry, or background continuation:

| Condition | Behavior |
|-----------|----------|
| provider timeout / non-zero / malformed / oversized / empty | mapped to a failure category → incident + waste; no retry |
| all initial providers fail | run completes with `objective-not-passed`; no retry |
| one provider succeeds | its reviewed artifacts proceed; partial completion |
| MCP failure | isolated, receipted → incident + waste; other tools continue |
| rejected / high-risk artifact | not applied |
| typecheck / test / build failure | incident + error waste + technical debt + repair demand → separate repair confirmation |
| repair rejected by human | run completes unrepaired |
| repair timeout / failure | recorded; no retry |
| provider- or MCP-call budget exhausted | `recordCivilizationCall` refuses further calls |
| session throws | redacted `error` summary (error NAME only); exit 1 |

## Process cleanup

Proven by `demoCivilizationLiveCleanup` (fake drivers, three terminal shapes —
success, confirmed repair, rejected repair): after every run the permit is consumed
and **not reusable**, every MCP grant issued was revoked (no active session), no
real provider process / MCP / filesystem / network action occurred, the readline
opened via `askOnce` closed immediately, and the watchdog timer — once cleared —
never fires, so the Node process exits normally.
