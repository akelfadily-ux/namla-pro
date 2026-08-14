# Digital Superorganism Live Objective V3

V3 implements the first genuinely live, human-authorized, **three-ant** software
objective. Three voluntarily admitted ants (preferred Claude, Claude, Codex — or
three Claude if Codex is unavailable) plan, build, review, verify, and repair one
real small project under explicit human control. Automated verification runs the
whole flow with FAKE drivers and makes zero real calls.

## Non-negotiable bounds (Build Law §25)

- exactly ONE human-invoked live objective; cohort size exactly 3
- at most 3 real provider calls in planning/build; at most 2 human-approved repair calls; total at most 5
- one isolated workspace at `workspaces/digital-live-objective/<objective-id>/`
- no source-tree write, no Git push, no remote mutation, no unrestricted shell, no arbitrary executable
- no background continuation, no automatic retry, no provider-triggered provider call
- Tamara publishes the objective + budgets but never selects ant identities

## Modules

- `src/cognitive/liveObjectivePermit.ts` — the non-forgeable live permit + call budgets.
- `src/cognitive/smokeWorkspace.ts` — extended with the human-only real-fs live root.
- `src/digital/liveCohort.ts` — voluntary three-ant admission.
- `src/digital/liveProviderNormalization.ts` — provider output → safe structured data.
- `src/digital/liveObjectiveRunner.ts` — the live pipeline + fake drivers.
- `src/digital/liveObjectiveReport.ts` — safe command center + safety checks.
- `src/cli/digitalLiveObjectiveCli.ts` — the human-only TTY CLI.
- `src/examples/demoDigitalLiveObjectiveV3.ts` — the deterministic fake-live proof.

## The flow

Tamara publishes the objective → the colony creates demands → ≥8 qualified ants
voluntarily claim → cognitive rotation admits exactly 3 → the human confirms the
exact plan and phrase → one `LiveObjectivePermit` is minted → each ant makes at
most one initial provider call (architecture / build / review) → results are
normalized to data → artifacts are independently reviewed (never self) → approved
artifacts are applied to the isolated workspace → allowlisted verification detects
one defect → the human separately approves one repair call → the defect is fixed
and re-verified → the objective is delivered → stop.

## Proof

`demoDigitalLiveObjectiveV3` exercises the happy path plus 24 guard cases
(missing/forged permit, wrong objective/workspace/cohort, non-volunteer, provider
mismatch, oversized/malformed output, invalid path, self-review, review
rejection, permit replay, provider-call and repair-call budgets). It asserts
`acceptedLiveCohortSize: 3`, `providerCallsStarted: 3`, `providerCallsFailed > 0`
(one isolated failure), `repairCalls: 1`, `finalObjectivePassed: true`, all
real-action counters 0, `safetyViolations: 0`, and an empty `mismatchCaseIds`.

Real provider execution (routing through the single authorized process driver)
remains a separate human-authorized wiring step: the CLI stops after minting the
permit.

## Successor: Live Objective V4 — real driver wiring (Build Law §26)

V4 finishes the live path the V3 CLI stopped short of: it wires the real provider
execution (`RealLiveProviderDriver`), the real workspace application
(`RealLiveWorkspaceDriver` via `smokeWorkspace`), and the real allowlisted
verification (`runVerificationCommand` in the one `child_process` module), and
completes the human CLI with `--dry-run` and a confirmed repair loop. Automated
tests still make zero real calls. See
[digital-superorganism-live-objective-v4.md](digital-superorganism-live-objective-v4.md).
