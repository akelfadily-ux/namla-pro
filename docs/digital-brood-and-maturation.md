# Digital Brood and Maturation

`src/digital/digitalBrood.ts` (with the maturation state in `digitalWorkers.ts`)
translates brood development into agent/skill maturation. **No instant expert
agents**: a worker earns capability through evidence.

## Stages

`untrained → training → supervised → qualified → senior → retired`

New workers and new skills begin **untrained**: limited reliability, restricted
tool access, supervised, and **unable to perform high-risk work**. The maturation
gate (`taskPermittedForStage`) enforces this:

| Task | Minimum stage |
| --- | --- |
| scouting, resting | any active worker |
| verifying, testing, reviewing | training+ |
| planning, repairing | supervised+ |
| building | qualified+ |
| securing, mentoring | senior |

Because high-risk tasks (building, securing) require higher stages, the run shows
a positive `maturationTaskCorrelation` — capability tracks maturity, and it
**emerges** rather than being assigned.

## How a worker matures

- **Training missions + mentorship** — `trainBroodWorker` has a **senior mentor**
  spend real compute + context to grow a brood worker's competence, reliability,
  and evidence. Mentorship is not free.
- **Review, exams, project evidence** — every successful verify/review/test the
  worker performs increments its `evidenceCount`.
- **Correction after failure** — reliability moves with real outcomes.

## Evidence-gated promotion

`attemptPromotion` advances a worker **one** stage only when:

1. it has accumulated at least `evidenceToPromote` verified evidence, **and**
2. a senior mentor is available, **and**
3. it is not already senior/retired.

On promotion the evidence is **spent** (subtracted), so promotion cannot repeat
for free. The causal invariant `promotion-has-evidence`
(`promotionWithoutEvidence === 0`) guarantees no promotion without evidence.

## Retirement (death)

`retireWorker` disables a worker while **preserving its identity** (`active =
false`, reason recorded). A retired worker cannot execute
(`canExecute` returns false), and the causal invariant `no-action-after-retire`
verifies no retired worker acted after retirement. Retiring workers return any
held tool permit to the capacity pool.
