# Golden Output Model (AH2 Step 5)

How Namla Pro's demos became a semantic regression harness, and the rules
for keeping it honest.

## Why "the demo ran" is weak

A demo that exits cleanly proves only that nothing threw. It does not
prove the mission was accepted, the refusal was receipted, the proposal
stayed unapplied, or the budget halt fired. The golden harness
([`demoGoldenOutputs.ts`](../src/examples/demoGoldenOutputs.ts)) asserts
those semantics explicitly: every demo runs once in-process (direct runner
imports — no subprocesses, no console parsing), its result is normalized
by `demoDigest`, and the digest is evaluated against a per-demo baseline
([`demoGoldenBaselines.ts`](../src/tools/demoGoldenBaselines.ts)) by the
pure evaluator ([`demoGolden.ts`](../src/tools/demoGolden.ts)).

## Why not raw snapshots

Raw output embeds ids, timestamps, fingerprints, machine paths, project
file counts, and wall-clock-jittered pheromone strengths — every one a
false-diff generator, and some a leak surface. `demoDigest` strips all of
that by key discipline (unknown string keys are dropped entirely, so raw
text cannot smuggle in) and keeps only counts, closed-enum vocabulary
(statuses, kinds, levels, pheromone/sense types), reason codes, boolean
flags, and the four safety invariant fields.

## Expectation kinds

- **requiredFlags / forbiddenFlags** — booleans that must be true /
  must not be true (AND-combined per key across the whole result).
- **requiredStatuses / requiredReasonCodes / forbiddenReasonCodes** —
  enum-vocabulary membership.
- **exactStableCounts** — numbers that are deterministic and semantic
  (task counts, tick totals, case counts, zero-regression counters).
- **minimumStableCounts / maximumStableCounts** — bands for meaningful
  but boundedly-variable numbers (e.g. a wall-clock-derived elapsed
  reading asserted as "roughly the configured five seconds").
- **expectedInvariantFields** — the digest's `appliedFalse`,
  `simulatedTrue`, `executedFalse`, `pushIntentFalse`.

## What is never asserted or reported

Receipt/trace/task ids, timestamps, fingerprints, absolute paths, project
file/folder/byte counts (the repo grows), exact wall-clock-derived
pheromone strengths or strength buckets, and raw text of any kind. Golden
failures report only demo name, expectation key, expected/actual safe
values, and a fixed failure code; caught crashes report a category and
error type name — never a message, stack, or path.

## Changing a baseline

A red golden means regression until proven otherwise. A baseline may
change only when behavior was changed intentionally, the change is safe,
and the report for that change justifies it explicitly. Weakening a
baseline to make it pass is release-blocking review feedback, not a fix.
(Calibration corrections are the one exception: if a baseline asserted a
value from the excluded classes — as happened once with a wall-clock
elapsed reading — banding it is fixing the baseline's own rule violation,
and must be reported as such.)

## Limitations

The harness verifies semantic properties of what the demos exercise — it
is not a full test suite (no unit-level coverage, no property fuzzing) and
not a security sandbox. The capability-absence guarantees live in
[SAFETY_INVARIANTS.md](../SAFETY_INVARIANTS.md); the goldens make behavior
drift loud, nothing more.
