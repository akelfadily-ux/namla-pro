# The AntMind model

`src/colony/antMind.ts`. Every worker gets one bounded `AntMind` — a private
cognitive state derived deterministically from the ant's genome profile and its
accumulated G1-G7 experience (reliability, success/failure history, age,
energy). One reusable model, hundreds of distinct instances; never a class per
ant.

## Bounded surfaces (hard caps, re-checked by `mindWithinBounds`)

| Surface | Cap | Notes |
|---|---|---|
| `workingMemory` | 8 | oldest note evicted first |
| `episodicSummaries` | 6 | compacted from working memory, detail discarded |
| `successPatterns` / `failurePatterns` | 6 each | strategy promotion / retirement |
| `unresolvedQuestions` | 5 | oldest evicted |

Everything else on the mind is a bounded scalar or a fixed-size record:
`confidence`, `uncertainty`, `curiosity`, `caution`, `persistence`,
`flexibility`, `socialTrust`, `peerReputation`, `fatigue`, `frustration`,
`recoveryNeed`, `taskUnderstanding`, `progressEstimate`, `selfEvaluation`,
`recentContradictionCount`, `currentHypothesisCode`, `hasLocalPlan`.

**No ant holds** the colony roster, the whole knowledge store, another ant's
full mind, or any unbounded event history. An ant may hold summaries of what
**it** personally observed and nothing else. Old episodic detail is *compacted*
(`compactEpisodicMemory`) into a scalar summary, never accumulated.

## Cognitive profile — 15 dimensions

`analytical, creative, precision, implementation, debugging, testing, security,
documentation, architectural, memoryRetrieval, communication, skepticism,
speed, patience, riskTolerance`.

Each dimension is **seeded by the genome** (`skillTendencies`) and **shifted by
real experience**: reliability, category failure rate, age, specialization
strength, exploration, and energy each move specific dimensions
(`deriveCognitiveProfile`). Peer feedback (`applyPeerFeedback`) and mentorship
nudge dimensions further. Two ants with different histories therefore end with
different profiles — the point of the design.

### Measuring diversity

- `profileDigest` quantizes the 15 dims to 5 levels each — an O(N) way to count
  behaviorally-distinct profiles at any scale (299 distinct out of 299 in the
  demo).
- `profileDiversityIndex` is the mean absolute deviation from the population
  mean across all dims — a spread metric, O(N) not O(N²).

## Status labels

- **Real-mechanism-inspired:** genome-plus-experience differentiation echoes how
  real workers diverge through task exposure and age.
- **Digital adaptation (no biological claim):** the specific 15-dimension
  software-skill vector, and the affect scalars (frustration, fatigue as
  cognition inputs).
- **Hypothesis:** that richer per-ant cognition improves collective outcomes —
  tested by the mission/crisis suites, not asserted.
- **Deterministic implementation:** all draws come from `mindDraw` (seeded); no
  clock, no ambient randomness.
