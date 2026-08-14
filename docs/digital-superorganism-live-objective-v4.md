# Digital Superorganism Live Objective V4 — Real Driver Wiring

V4 finishes the actual live path. A human can run one command, approve exactly
three voluntary ants, and those ants can call real Claude Code and/or Codex one
time each, return bounded structured proposals, pass independent review, write
approved files into one isolated project workspace, run allowlisted verification,
perform at most two separately-approved repair calls, and stop.

Automated verification still runs the whole flow with FAKE drivers and makes zero
real calls.

## What V4 wired (on top of V3)

- `RealLiveProviderDriver` (`src/cognitive/liveProviderExecution.ts`) — implements the runner's provider contract by consuming a scoped single-use permit and running exactly one process through the injected `ProviderProcessDriver`, then normalizing stdout to data. See [live-provider-wiring.md](live-provider-wiring.md).
- `RealLiveWorkspaceDriver` + `RealBackedVerificationDriver` (`src/cognitive/liveRealDrivers.ts`) — real writes via the authorized `smokeWorkspace`, real verification via the one `child_process` module. See [live-workspace-application.md](live-workspace-application.md) and [live-verification-boundary.md](live-verification-boundary.md).
- `runVerificationCommand` added to `nodeProviderProcessDriver.ts` (still the only `child_process` importer).
- the completed human CLI (`src/cli/digitalLiveObjectiveCli.ts`) with `--dry-run` and the real orchestration + repair confirmation. See [live-repair-confirmation.md](live-repair-confirmation.md).
- the abstracted runner workspace parameter (`LiveWorkspaceApplier`) so fake and real workspaces both fit.

## Boundaries (unchanged)

Exactly one `child_process` importer; exactly three `fs` importers; two
fs-mutation modules; `shell:false`; no arbitrary executable; no argument from
objective/provider text; no npm install; no Git; no source-tree write; no provider
direct file write or command execution; no automatic retry; no background
continuation; no self-review. Automated tests keep every real-action counter
exactly 0.

## Commands

- Dry-run (no TTY, no real action):
  `npm.cmd run digital:live-objective -- --providers claude,claude,codex --dry-run`
- Real run (interactive TTY, exact phrase `RUN DIGITAL OBJECTIVE WITH 3 ANTS`; each repair call needs `RUN ONE REPAIR ANT`):
  `npm.cmd run digital:live-objective -- --providers claude,claude,codex`

Provider pools may be `claude,claude,codex`, `claude,claude,claude`,
`codex,codex,codex`, or `claude,codex,codex`. An unavailable provider records a
failure and allows partial cohort completion — it is never silently substituted.

## Proof

`demoDigitalLiveObjectiveV4Wiring` drives the SAME real wiring through the fake
process driver: three provider calls, review-before-apply, one detected defect,
one confirmed repair, final verification green — with all real-action counters 0,
15 guard cases (including the real Node driver refusing an automated-test permit
without executing), and 14 expectations. Registered in the golden harness (35th
demo).
