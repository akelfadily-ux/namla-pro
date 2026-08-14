# Provider comparison policy

Build Law §21. When a human allows both Claude and Codex in one pilot, different
ants may use different providers. `realAcademyPilot.ts` records a bounded
`ProviderComparison`: per provider, the number of attempts, evaluator passes, and
failures — attributable to the ant and provider, scored by the same rubric.

## Rules

- **No provider is automatically declared superior.** The comparison is a
  bounded single-pilot tally, explicitly tagged
  `note: "single-pilot-bounded-not-a-ranking"`.
- A small pilot is **never generalized** into a universal provider ranking.
- Comparable dimensions (pass rate, evidence/correction/test quality, uncertainty
  honesty, failure categories) come from the same independent-evaluator rubric,
  not from provider self-report.
- Cost is represented as **unknown** unless the provider CLI returns real cost
  data; no figure is invented.

The comparison is data for a human to interpret across many pilots over time —
one run of five calls proves the mechanism, not a verdict.
