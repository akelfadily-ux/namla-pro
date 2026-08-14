# Digital Senses

A digital sense is a structured way for an ant to turn raw context into a
typed, confidence-scored reading. Every sense lives in `src/senses/` and
shares the same shape: it takes a `SenseInput` (a `senseType`, some
`context`, who asked, and when) and returns a `SenseReading` subtype.

## Why senses exist

An LLM-driven agent can technically "just look at everything" in an unbounded
way, but that produces two problems: it is expensive and unpredictable, and
it makes it hard to reason about *what an ant actually knew* when it decided
to do something. Digital senses give every ant a small, fixed vocabulary of
perception. This makes an ant's decisions auditable ("it smelled a
`DangerPheromone` and a `BugPheromone`, so it asked for help") instead of
opaque.

## The eight senses

| Sense | File | What it perceives | Phase 0 source of truth |
|---|---|---|---|
| Vision | `visionSense.ts` | Structure — file names, folder shapes, diagram nodes | `context.structures`, given by the caller |
| Hearing | `hearingSense.ts` | Incoming signals — messages, human instructions | `context.signals`, given by the caller |
| Smell | `smellSense.ts` | Electronic pheromones nearby | `context.pheromoneTypes`, given by the caller |
| Touch | `touchSense.ts` | Paths an ant is considering (never implies modification) | `context.paths`, given by the caller |
| Taste | `tasteSense.ts` | A qualitative "does this feel right" judgment | `context.concerns`, given by the caller |
| Memory | `memorySense.ts` | Which memory entries were recalled | `context.recalledEntryIds`, given by the caller |
| Time | `timeSense.ts` | Elapsed time since mission start | `context.missionStartedAt` compared to `input.requestedAt` |
| Risk | `riskSense.ts` | Danger level of a piece of text | `SafetyGuard.evaluateText`, the same engine the core safety layer uses |

## What senses deliberately do NOT do in Phase 0

- **No real camera, microphone, or screen access.** "Vision" and "hearing"
  are named after the ant-colony metaphor, not literal senses — they read
  whatever context object they are handed.
- **No real filesystem access.** "Touch" reports paths it was told about; it
  never calls `fs.readdir` or similar.
- **No live network or message bus.** "Hearing" and "smell" read from
  in-memory context, not from any transport.
- **No semantic search.** "Memory" expects the caller to have already
  selected candidate entry ids; it does not rank or retrieve on its own.

This is intentional: Phase 0 proves the *shape* of perception (typed inputs,
typed outputs, a confidence score, a summary) so that when real sensing is
wired in later (e.g. an inspector that actually reads the filesystem in
Phase 1), it slots into the same interface instead of requiring a redesign.

**Phase 1 update:** vision and touch can now consume a real
`ProjectSnapshot` passed as `context.snapshot`, produced by the read-only
`ProjectInspector` (see [inspector-model.md](./inspector-model.md)). The
senses themselves still never call the filesystem — the inspector observes,
the senses interpret — and the Phase 0 caller-supplied-context behavior
remains as the fallback. Snapshot-based readings carry higher confidence
(0.9) than asserted context (0.7) because they were actually observed.

## Confidence scores

Every `SenseReading` includes a `confidence` between 0 and 1. In Phase 0 this
is a simple heuristic (e.g. "did the caller give me any data at all"), not a
calibrated probability. It exists so that downstream consumers (like
`tasteSense`'s quality judgment, or a future planner) have a consistent field
to weigh readings against, even before the underlying computation is
sophisticated.

## Risk sense and SafetyGuard

`riskSense.ts` is the one sense that is not purely descriptive — it directly
reuses `SafetyGuard` (`src/core/safetyGuard.ts`) so that any ant can "smell
danger" in a piece of text using the exact same rules the central safety
chokepoint uses, rather than a separate, potentially inconsistent copy of the
danger list.
