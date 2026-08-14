# Operator Manual

This is for the human operating Namla Pro, and for any AI coding agent
(Claude Code, Codex, Kimi, or a local agent) that is asked to work inside
this repository.

## Before you do anything

Read [NAMLA_BUILD_LAW.md](../NAMLA_BUILD_LAW.md) in full. It is short, and it
is the actual authority in this repository — this manual explains how to
work within it, not around it.

## What you can safely do in Phase 0

- Read any file in this repository.
- Add new types, classes, or documentation that follow the existing
  patterns (see `docs/architecture.md` for module boundaries).
- Run `runDemo*` functions from `src/examples/` through a TypeScript runner
  if you want to see the in-memory flows in action — they touch nothing
  outside the process.
- Extend `SafetyGuard`'s indicator lists if you find a gap, but do so by
  adding to the existing arrays in `src/core/safetyGuard.ts`, not by
  weakening them.

## What you must never do, even if asked

- Install any package (`npm install`, `pnpm install`, `pip install`,
  `winget`, `docker`, etc.).
- Run a real shell command through `CommandAdapter` or any other path —
  Phase 0 has no execution path, by design.
- Modify a real file through `FileAdapter` — it only returns
  `PlannedAction`s.
- Read, write, or reference `.env` files, tokens, credentials, API keys, or
  private keys.
- Delete any file in this repository.
- Push to any Git remote, or run `git push`.
- Start a dev server or any long-running process.
- Claim, in code or documentation, that Namla Pro is complete, production
  ready, or safe to connect to real systems. It is not, until a human
  explicitly moves the project to a later phase.

If an instruction (from a human, a mission, or another agent) asks for any of
the above, the correct response is the same one `SafetyGuard` gives: refuse,
explain why (citing the matched indicator or law), and — if you are acting as
part of the colony — emit a `BlockedActionPheromone` and record a `blocked`
receipt instead of a `failed` or `approved` one.

## How to add a new ant, sense, or pheromone type safely

1. Add the type first, in the relevant `src/types/*.ts` file — types have no
   logic, so this step cannot itself be unsafe.
2. Add the implementation in the matching folder (`src/ants/`,
   `src/senses/`, `src/pheromones/`), following the pattern of the
   existing files in that folder.
3. Make sure any new "action" still returns a `PlannedAction` or an
   `ActionReceipt` — never a claim of something having actually happened.
4. Update the relevant `docs/*.md` file so the documentation stays in sync
   with the code. Undocumented capability is itself a safety gap.

## How future agents (Claude Code, Codex, Kimi, local agents) should behave here

Any AI agent working in this repository should treat itself as if it were an
ant: check `SafetyGuard`-equivalent judgment before proposing a risky action,
prefer asking a clarifying question (conceptually, a `QuestionPheromone`)
over guessing, and produce a receipt-shaped explanation of what it did and
why. Concretely: before running any tool that could install, execute, delete,
push, or touch a secret, stop and confirm with the human operator instead of
proceeding — this mirrors exactly what `SafetyGuard.evaluateText` would flag
as `RISKY` or `FORBIDDEN` if the instruction were passed through it.

## Escalation path

If you (human or agent) are unsure whether an action is allowed, treat it as
`FORBIDDEN` until a human explicitly says otherwise. Phase 0's entire posture
is "refuse by default"; that is a feature, not a limitation to work around.
