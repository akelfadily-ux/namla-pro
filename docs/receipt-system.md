# Receipt System

## Why receipts exist

A colony of many ants acting somewhat independently is only trustworthy if
every action — successful, blocked, or refused — leaves a record. Without
that, "chaos" means: nobody, human or ant, can reconstruct what actually
happened, which ant did it, or why something was refused. `ReceiptLog`
(`src/core/receiptLog.ts`) exists to make the colony's behavior legible after
the fact, not just in the moment.

## The shape of a receipt

```ts
interface ActionReceipt {
  receiptId: string;
  summary: string;
  status: ReceiptStatus; // approved | blocked | completed | failed | refused
  links: ReceiptLink;    // missionId?, taskId?, antId?, pheromoneId?
  createdAt: string;
  details?: Record<string, unknown>;
}
```

Receipts are intentionally flat and small. `summary` is meant to be
human-readable on its own; `links` connects a receipt back to the mission,
task, ant, or pheromone it relates to; `details` is an open bag for
structured extras (like `SafetyDecision.reasons`) that don't need their own
top-level field.

## What produces a receipt

- `AntQueen.acceptMission` — one final receipt per mission (approved or
  blocked), summarizing how many tasks were assigned vs. blocked.
- `ColonyOrchestrator.processTasks` — one receipt per task, whether it was
  blocked by `SafetyGuard` or successfully routed.
- Every ant role class in `src/ants/` — each role's primary method (e.g.
  `ScoutAnt.scout`, `BuilderAnt.proposeBuild`) returns a receipt-shaped
  object directly, so even ad hoc ant activity outside a full mission flow
  stays legible.

## Never storing secrets

`ReceiptLog.create` calls `looksLikeSecret` (from
`SecretProtectionPolicy`) against the receipt's `summary` and throws if it
matches. This is the same policy `ColonyMemory` and `PheromoneSafetyPolicy`
use — one shared definition of "secret-shaped," checked at every place
content could persist or broadcast. A receipt's `details` bag can still
contain arbitrary structured data (like safety reasons or task ids), which is
why callers should keep summaries as the human-readable, secret-free
headline and put anything sensitive-adjacent through the same check before it
goes into `details`.

## Querying receipts

`ReceiptLog.list()` returns every receipt ever created (in Phase 0, this
means "since the process started" — there is no persistence). `linkedTo()`
filters by any subset of `ReceiptLink` fields, e.g. `linkedTo({ missionId })`
to get every receipt tied to one mission, which is exactly what
`ReporterAnt.report` and `AuditorAnt.audit` are built to consume.

## What receipts are not (yet)

- **Not persisted.** Phase 0 keeps receipts in an in-memory array. Restarting
  the process loses them. Persistence is future work once there is a
  concrete storage decision to make.
- **Not tamper-evident.** There is no hashing, signing, or chain-of-custody
  yet. Phase 0's guarantee is "every action produces a record," not
  "records cannot be forged."
- **Not queryable at scale.** `linkedTo` is a simple array filter, fine for
  Phase 0's in-memory scope, not a database index.
