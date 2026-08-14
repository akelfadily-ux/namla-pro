# Example: A Bot Body Plan (Never Executed)

This shows what happens when an ant asks `BotBody`/`CommandAdapter`/
`FileAdapter` to do something, in Phase 0.

## Scenario

A `WorkerAnt` decides the mission needs a new file created at
`docs/notes.md`, and separately wants to run `npm test`.

## FileAdapter's answer

```ts
fileAdapter.planFileAction("docs/notes.md", "write");
```

Returns a `PlannedAction`:

```
kind: file-write
description: 'Planned (not executed) file action "write" on docs/notes.md.'
executed: false
requiresHumanApproval: true
```

Nothing is written. The path is checked against `FileBoundaryPolicy` first —
if it were outside the project root, the description would instead explain
the refusal.

## CommandAdapter's answer

```ts
commandAdapter.plan({ command: "npm test", requestedByAntId: "worker-demo-1" });
```

Returns a `PlannedAction`:

```
kind: command-execute
description: 'Refused: Command is not on the forbidden list, but Phase 0
              never executes any command regardless: "npm test"'
executed: false
```

Even a harmless-looking command like `npm test` is refused in Phase 0 —
`CommandAdapter` does not distinguish "safe" commands from "unsafe" ones
because it does not execute *any* command yet. That distinction becomes
meaningful starting in a later phase, once execution is deliberately turned
on for a narrow, audited set of commands.

## The takeaway

`PlannedAction.executed` is typed as the literal `false` in Phase 0 — it is
not just a default, it is the only value the type allows. Any future phase
that wants real execution has to change the type itself, which is a visible,
reviewable change to `src/types/bodyTypes.ts`, not a quiet runtime flag flip.
