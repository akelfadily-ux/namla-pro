# Real provider adapters (Claude Code CLI, Codex CLI)

`src/colonyMission/claudeCliAdapter.ts` and `codexCliAdapter.ts` are the
provider identities for the two real CLI tools this project is built to
eventually support. Neither one has ever executed anything, and neither one
can, without a foundational change to `NAMLA_BUILD_LAW.md` itself — not an
amendment, a rewrite of the constitution's own hard boundaries. This
document explains the distinction precisely, because it matters.

## Why this isn't just "disabled by default"

`NAMLA_BUILD_LAW.md` Section 1 lists "Never run real system commands" as a
**hard boundary**. Section 2 is explicit: *"none of them are allowed to
loosen the hard boundaries above, only add new capability behind new
explicit guards."* Every other capability in this codebase (the C0-C2-B
filesystem-write stack, Colony Genesis G1-G7's cognitive budget) was added
by an amendment that named the file and specified exact bounds. Real
process execution is different in kind: it is not a capability waiting for
its amendment, it is the one thing an amendment cannot grant. `Section 16`
says this outright rather than leaving it implied.

## What the adapters actually do

`CliCognitiveWorkerBase` (shared by both) builds a `PlannedCliInvocation` —
the exact same "describe what would happen, never do it" discipline
`src/bodies/commandAdapter.ts` already established for shell commands:

- hard-coded executable name (`"claude"` / `"codex"`)
- hard-coded argument template (never built from mission or task text)
- prompt content delivered through a bounded prompt file, fingerprinted
  (never stored raw) in the receipt
- bounded `maxStdoutBytes` / `maxStderrBytes` / `timeoutMs`
- the mission's own workspace as the working directory, nothing broader

Then `submit()` **always returns a refusal** —
`reasonCode: "real-provider-execution-not-authorized"` — receipted with the
planned invocation's safe metadata. There is no `child_process` import
anywhere in `src/colonyMission/`; there is no branch that could execute
even if a future caller wanted it to.

## The same discipline applies to verification

The "tester ant" step (`npx tsc --noEmit`, `npm test`, `npm run build`) is
real system command execution in miniature. `verificationRunner.ts` has two
implementations: `FakeVerificationRunner` (a genuine, deterministic,
content-based check — fails if a workspace file contains the known defect
marker, passes otherwise; this is what every demo and the CLI's default
path use) and `RealVerificationRunner`, which exists only to name the exact
allowlisted commands a future phase would run and then refuses, exactly
like the CLI adapters.

## What IS real in this milestone

Everything upstream and downstream of the provider call is genuine:

- Mission workspace boundary checks (`missionWorkspace.ts`) run for real
  against real proposed paths.
- Work-market claim submission and deterministic contention resolution
  (`workDemand.ts`) run for real against the real 299-worker population's
  real `skillTendencies`.
- Scout-proposal local quorum (`proposalCompetition.ts`) runs a real,
  bounded recruitment simulation among a real assessor sample.
- The cognitive-execution budget (`cognitiveExecutionBudget.ts`) really
  admits and releases slots, capped at 5 for this milestone.
- Reviewer checks, defect injection, and repair (`reviewLoop.ts`,
  `missionRunner.ts`) run for real against real (fake-provider-sourced)
  artifact content.

Only the boundary between "an admitted ant asks a provider for cognition"
and "a real model actually thinks" is simulated — and it is simulated by a
provider, `DeterministicCognitiveWorker`, that is exactly as real about its
own limits as the AI adapters are about theirs: same request, same
response, every time, forever.

## Running the smoke command

`npm run colony:real-smoke -- --provider claude` (or `--provider codex`)
requires the provider flag, prints the exact task and workspace, requires
typed `YES` confirmation, sends exactly one request, and prints the result
— which will always be a refusal, for the reasons above. This command
exists to exercise the full bounded path end to end, not to bypass it. It
is never invoked by anything in this codebase's automated build, test, or
demo suite.

## What would actually need to change

Attaching a real provider is not a matter of flipping a flag in this
codebase. It requires:

1. A human decision to rewrite `NAMLA_BUILD_LAW.md` Section 1/2 themselves
   — acknowledging that a specific, bounded execution capability is being
   added to the constitution's hard boundaries, not merely behind a new
   guard within them.
2. A real driver implementing `CliCognitiveWorkerBase`'s execution step
   (currently nonexistent — refusal is the only code path).
3. Its own security review: credential handling (the adapters already
   avoid storing or receipting any), output bounds enforcement at the
   process level (not just as planned data), and a real audit of what a
   CLI tool with an authenticated local session can actually reach.

None of that exists yet, and nothing in this milestone starts it.
