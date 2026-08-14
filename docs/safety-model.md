# Safety Model

## The chokepoint

`SafetyGuard` (`src/core/safetyGuard.ts`) is the single class every mission
and task passes through before it is treated as approved. It classifies free
text (a mission's raw instruction, a task's description, a planned action's
description) into one of four levels:

- **SAFE** — no indicator matched. Allowed.
- **CAUTION** — matched a caution-level indicator (`deploy`, `network`,
  `download`, `external api`). Allowed, but flagged.
- **RISKY** — matched a risky indicator (`overwrite`, `force`, `shell`,
  `exec`, `spawn`). Blocked (`allowed: false`).
- **FORBIDDEN** — matched a hard-forbidden indicator. Blocked.

## The forbidden indicator list

```
rm -rf, format, del /s, delete, remove, secret, token, credential,
private key, .env, install, npm install, pip install, winget, push,
git push, sudo, production deploy, outside project root, broad rewrite
```

These map directly to the hard boundaries in
[NAMLA_BUILD_LAW.md](../NAMLA_BUILD_LAW.md): no deletion, no secret access, no
package installs, no pushes, no privilege escalation, no production
deployment, no leaving the project root, and no sweeping rewrites.

Matching is case-insensitive substring matching on lowercased text. This is
deliberately simple and deliberately over-inclusive — Phase 0 favors refusing
too much over refusing too little. A more precise (and more permissive)
matcher is future work, not a Phase 0 goal.

## Escalation, not averaging

If a piece of text matches indicators at multiple levels, `SafetyGuard` keeps
the *highest* severity level found (`escalate()` compares
`severityRank`). A single forbidden match makes the whole evaluation
`FORBIDDEN`, even if most of the text is otherwise safe or cautious.

## Where SafetyGuard is enforced

- **`AntQueen.acceptMission`** — checks `mission.rawInstruction` before
  emitting any pheromone or creating any task.
- **`ColonyOrchestrator.processTasks`** — re-checks each task's
  `description` independently, so a task cannot slip through just because
  its parent mission was safe.
- **`GuardAnt.guard`** — lets any ant request an ad hoc safety opinion.
- **`riskSense.senseRisk`** — lets any ant perceive danger in text as part of
  its normal sensing loop, using the same underlying engine.

Because all four call sites share one `SafetyGuard` (or construct one with
the same default rules), there is no way for a mission-level check and a
task-level check to disagree about what counts as forbidden.

## Supporting policies

`SafetyGuard` covers free text. Three narrower policies cover specific
surfaces:

- **`CommandSafetyPolicy`** (`src/policies/commandSafetyPolicy.ts`) —
  command-specific forbidden indicators, used by `CommandAdapter` to explain
  *why* it refuses, even though in Phase 0 it refuses every command
  regardless of this list.
- **`FileBoundaryPolicy`** (`src/policies/fileBoundaryPolicy.ts`) — resolves
  a target path against the project root and rejects anything that would
  escape it, using Node's `path.resolve`.
- **`SecretProtectionPolicy`** (`src/policies/secretProtectionPolicy.ts`) —
  a conservative keyword check (`secret`, `token`, `credential`,
  `private key`, `api key`, `password`, `.env`, `-----begin`, ...) used by
  `ReceiptLog`, `ColonyMemory`, and `PheromoneSafetyPolicy` to refuse
  secret-shaped content before it is ever stored or broadcast.
- **`BodyExecutionPolicy`** (`src/policies/bodyExecutionPolicy.ts`) — the
  single hard-coded flag (`PHASE_0_EXECUTION_ENABLED = false`) that keeps
  every body/adapter in planning-only mode.
- **`AutonomousLoopPolicy`** (`src/policies/autonomousLoopPolicy.ts`) —
  defines a `LoopBudget` (max steps, max duration) for future autonomous ant
  loops. Phase 0 sets the budget to zero, since no live loop exists yet.

## What SafetyGuard is not

It is not a machine-learning classifier, not a sandboxing mechanism, and not
a substitute for human review of anything consequential. It is a fast,
transparent, keyword-based gate whose entire rule set lives in one readable
file. Its job in Phase 0 is to prove the *pattern* — every mission and task
passes through one auditable chokepoint — so later phases can strengthen the
underlying detection without changing where it is enforced.
