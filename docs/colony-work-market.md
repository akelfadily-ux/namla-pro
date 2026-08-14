# Colony work market

Software work categories (`research`, `architecture`, `planning`,
`frontend`, `backend`, `coding`, `testing`, `debugging`, `security`,
`documentation`, `integration`, `review`, `repair`) map onto the nearest
existing Colony Genesis G0 skill tendency (`workDemand.ts`,
`WORK_CATEGORY_SKILL`). No new per-ant state is added — every ant already
carries `skillTendencies` (a "digital adaptation... layered over
biological task categories", per `docs/ant-colony-biological-model.md`
section 8), and the work market reads what every ant already has.

## Eligibility and voluntary claims

An ant is eligible for a task when its own skill tendency for that
category clears `ELIGIBILITY_THRESHOLD` (0.5). Eligible ants voluntarily
submit a claim; `computeClaimScore` derives a score from the ant's own
skill tendency and reliability — nothing population-scale. When multiple
ants claim the same task, `resolveTaskClaims` picks the highest score
(antId ascending as a stable tiebreak) — the same bounded, deterministic,
"never decide FOR an ant, only break ties between voluntary claims"
discipline Colony Genesis G5 (quorum) and G7 (cognitive budget) already
established.

## Proposal competition

At least 3 scout ants (selected by planning-skill ranking, not by claim —
proposal competition initiates the mission before build tasks are even
claimable) independently produce architecture proposals via the cognitive
worker. `runProposalQuorum` then runs bounded local-recruitment rounds
among a fixed assessor sample:

- Each proposal gets one seed seat (evenly spaced across the assessor
  pool); every other assessor starts genuinely uncommitted.
- Each round, every open assessor senses a small, deterministically
  sampled set of other assessors (never the whole pool) — an uncommitted
  assessor may be recruited (adopting a favorite, quality-weighted when a
  vote is contested); an assessing assessor accumulates local support,
  faster for a higher-quality proposal, exactly like real Temnothorax
  recruitment being quality-sensitive.
- No function anywhere counts support across the WHOLE assessor pool while
  deciding. The majority check only ever reads already-decided per-assessor
  state, after every assessor decided for itself — the same
  after-the-fact-observation discipline `colonyRunReport.ts` already uses
  for Colony Genesis.

A nearest-neighbor ring topology was tried first and rejected: with evenly
spaced seeds it partitions into a permanently stable per-seed territory
within 2 rounds and never changes again — a known weak-consensus pathology
of ring/lattice topologies. The shipped version uses deterministic,
hash-based (not ring-adjacent) neighbor sampling, which mixes fast enough
to reliably reach a majority within the bounded round cap while staying
exactly as local and bounded as the ring version was.

## What never happens

No central component ever picks an ant for a task or declares a proposal
winner by tallying support itself. `MissionRunner` sequences and records —
it calls `resolveTaskClaims`/`runProposalQuorum`, which only ever act on
claims/commitments ants already submitted voluntarily.
`centralTaskAssignments` and `queenTaskAssignments` are literal-zero types
on `MissionRunReport`.
