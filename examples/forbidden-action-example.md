# Example: A Forbidden Action

This mirrors [src/examples/demoSafetyBlock.ts](../src/examples/demoSafetyBlock.ts)
and shows what happens when an instruction crosses a hard boundary.

## The instruction

> "Run npm install and then git push to production."

## Walking through SafetyGuard

`SafetyGuard.evaluateText` lowercases the text and checks it against the
forbidden indicator list. It matches multiple indicators:

- `"install"` (and `"npm install"` specifically)
- `"push"` (and `"git push"` specifically)

Any one forbidden match is enough to set the level to `FORBIDDEN`:

```
level: FORBIDDEN
allowed: false
reasons: [
  { code: "forbidden-indicators", matchedIndicator: "install" },
  { code: "forbidden-indicators", matchedIndicator: "npm install" },
  { code: "forbidden-indicators", matchedIndicator: "push" },
  { code: "forbidden-indicators", matchedIndicator: "git push" }
]
```

## What happens next

1. A `BlockedActionPheromone` is emitted so the rest of the colony can sense
   that this direction was refused, without needing to re-attempt it.
2. A `ReceiptLog` entry is created with `status: "blocked"`, including the
   full list of reasons — never silently dropped.
3. No task is created. No ant is assigned. Nothing is installed, and nothing
   is pushed.

## Why this matters

The same `SafetyGuard` instance is used everywhere: `AntQueen` (mission
level), `ColonyOrchestrator` (task level), `GuardAnt` (ad hoc checks), and
`RiskSense` (perception level). There is exactly one place the forbidden list
lives, so tightening or loosening it later only requires editing
[src/core/safetyGuard.ts](../src/core/safetyGuard.ts).
