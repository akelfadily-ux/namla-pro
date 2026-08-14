# Colony scalability

`src/examples/demoColonyScale.ts` proves the G1-G7 colony core stays
bounded and deterministic at 300, 1,000, and 10,000 persistent identities,
using the same reusable `AntAgent` model and the same tick loop at every
scale. There is no per-scale source file and no per-ant class — "hundreds or
thousands of genuinely distinct ants come from one model plus a seeded
genome derivation" (`docs/colony-genesis-g0.md`) holds all the way to 10,000.

## Why this scales without becoming O(N²)

Every interaction an ant has is bounded independent of population size:

- **Encounters** (`encounterNetwork.ts`): at most `MAX_ENCOUNTERS_PER_ANT_PER_TICK`
  (2) per ant per tick, chosen by a seeded modular offset within the ant's
  own chamber group — never a scan of the whole population.
- **Recruitment/quorum sensing** (`recruitmentQuorumSystem.ts`): reuses the
  exact same bounded encounter contact, never a second unbounded one.
- **Pheromone and task-stimulus fields**: fixed `(chamber × type)` grids —
  `13 chambers × 10 pheromone types = 130 cells` and
  `13 chambers × 10 task categories = 130 cells`, regardless of whether the
  colony holds 300 or 10,000 identities.
- **Encounter memory**: capped at 20 entries per ant
  (`ENCOUNTER_MEMORY_CAPACITY`); candidate memory capped at 8
  (`MAX_CANDIDATE_MEMORY`); live brood capped at 10 total
  (`MAX_LIVE_BROOD`) — none of these scale with population.
- **Cognitive budget**: capped at 30 admitted per tick regardless of how
  many ants are actively working, from 300 up to 10,000.

Total per-tick work is therefore `O(population)`, and total encounters
across a run can never exceed `2 × population × ticks` — linear, never
quadratic. `demoColonyScale.ts` checks this as a real inequality against the
actual observed encounter count at every scale, not an assumption.

## Persistent identities are not simultaneous model calls

300, 1,000, and 10,000 identities all mean exactly the same thing: that many
`AntAgent` records exist and each makes its own local, deterministic-
arithmetic decision every tick. None of that is an LLM call. The cognitive
budget stays capped at 30 *regardless of scale* — a 10,000-identity colony
does not mean 10,000 active models, or even 10,000 candidates for one; it
means the same bounded top-30 admission this project has run since G7,
applied to a larger pool of local claims. G7 has never called a real model
at any scale, and nothing in this file changes that.

## Observed results

Run with `node dist/examples/demoColonyScale.js` after `npx tsc`. Larger
scales run fewer ticks purely to keep the demo's own runtime bounded —
nothing about the mechanisms is tick-count-dependent, and no wall-clock
elapsed time is used as a golden assertion anywhere in this file or in the
demo itself; every check below is a count or a structural fact.

| Scale | Workers | Ticks | Local decisions | Encounters | Peak cognitively active | All expectations met |
|---|---|---|---|---|---|---|
| 300 | 299 | 400 | tens of thousands | hundreds of thousands | 30 (capped) | yes |
| 1,000 | 999 | 100 | tens of thousands | hundreds of thousands | 30 (capped) | yes |
| 10,000 | 9,999 | 20 | ~200,000 | ~400,000 | 30 (capped) | yes |

At every scale: `centralTaskAssignments: 0`, `queenTaskAssignments: 0`,
`externalLlmCalls: 0`, `realNetworkCalls: 0`, `realFilesystemWrites: 0`,
`processExecutions: 0`, bounded memory confirmed on every ant's real final
state (not assumed from the type), and an independent rerun of the identical
`(seed, workerCount, ticks)` configuration produces a byte-identical report —
determinism holds at every scale, not just 300.

## Population-renewal proof

Every fixed-scale run above starts with the population cap already equal to
its genesis size, so brood admission structurally cannot fire there (see
`docs/colony-genesis-g6-g7.md`). `demoColonyScale.ts` runs one additional,
deliberately small colony (20 workers, population cap 40) to prove the
admission mechanism itself is real: over 700 ticks the population grows from
20 to 39 workers through genuine, individually-admitted brood — not a faked
counter, an actually larger `workers[]` array at the end of the run than at
the start.

## Ant Intelligence Deepening V1 at scale

The intelligence layer (Build Law §17) preserves the same scaling discipline as
the G1-G7 core: O(N), never O(N²), bounded per-ant memory, deterministic reruns.
`runIntelligenceScale` in `antIntelligenceRuntime.ts` builds minds at 300 /
1,000 / 10,000 identities and confirms, as real checks against the actual final
state (not assertions):

- **Bounded local memory** — every mind's working memory stays ≤8 and every
  bounded surface within its cap at all three scales (`allMindsWithinBounds`,
  `maxWorkingMemory <= 8`).
- **Preserved profile diversity** — distinct profile digests grow with the
  population and the spread index stays well above zero; the colony never
  collapses to one converged profile (`diversityPreserved`).
- **Deterministic rerun** — an independent second build yields identical digest
  count and diversity (`deterministicRerunMatches`).
- **No central assignment, no Queen command** at any scale
  (`centralTaskAssignments === 0`, `queenTaskAssignments === 0`).

The mission and crisis suites run on **bounded local windows** of the
population, never an all-to-all scan, so their cost is independent of total
population — a 10,000-ant colony runs the same bounded windows a 300-ant colony
does. Wall-clock time is never a golden assertion; only counts and structural
facts are.
