# Command-center state

`src/colonyMission/commandCenterState.ts`. A real **state projection** of a
running mission — safe summaries only, never a decorative UI and never raw
private cognition.

## What it exposes

mission status; population counts; work demands; voluntary claims; cognitive
claims; admitted cognitive ants; provider status; proposals; quorum progress;
artifacts; reviews; verification results; repair rounds; receipts; final
outcome.

## What it never exposes

Raw private `AntMind` content, hidden provider prompts, provider credentials,
environment dumps, full colony history, or another ant's internal reasoning. The
projection carries counts, ids, statuses, and safe reason codes — the same
redaction discipline as `ReceiptLog` and the demo digest.

`CommandCenterStateBuilder` accumulates events as the mission runs
(`recordProposals`, `recordClaims`, `recordCognitiveAdmission`,
`recordArtifact`, `recordReview`, `recordVerification`, `recordRepairRound`,
`setFinalOutcome`) and emits an immutable `CommandCenterState` snapshot. It
directs nothing — it is an observer, exactly like the colony's other aggregate
reporters.

## Status labels

- **Digital adaptation:** an operability/observability projection, no biological
  analogue; deliberately read-only over already-safe data.
