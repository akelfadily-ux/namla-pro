# Colony Genesis G6-G7 — lifecycle, brood, generations, cognitive budget

G6 activates the Queen's other channel of influence (brood-created local
demand) and the aging/lifecycle fields G0 declared and left neutrally
initialized. G7 adds a bounded, deliberately-labeled digital adaptation: a
scarce per-tick cognition budget that denies capability without ever
directing behavior.

Authorized by Section 15 of `NAMLA_BUILD_LAW.md`.

## What G6 builds

| Piece | File | What it is |
|---|---|---|
| Worker lifecycle | `src/colony/workerLifecycleSystem.ts` | Aging, energy/health drift, senescence, bounded recovery, retirement |
| Brood lifecycle | `src/colony/broodLifecycleSystem.ts` | `BroodRecord`, spawn, maturation, nursing demand, population-cap-gated admission |
| Generation transition | `queenContinuitySystem.maybeAdvanceGeneration` | Advances the Queen's own `generation`/`lineageDepth` when a full generation's brood is admitted |

## What G7 builds

| Piece | File | What it is |
|---|---|---|
| Cognition claims | `src/colony/cognitiveBudgetSystem.ts` | Per-ant local claim score from task difficulty, choice ambiguity, recent failures, specialization, reliability, energy, health |
| Budget resolution | `cognitiveBudgetSystem.resolveCognitionClaims` | Ranks a tick's claims, admits at most `MAX_COGNITIVE_BUDGET` (30) |
| Future contract | `CognitiveWorkerContract` | Type-only shape for a later real worker (Claude/Codex/OpenAI/Anthropic/local model). Never implemented, never called |

## Brood are not AntAgents

The single most important structural fact in G6: a `BroodRecord` is a
separate, small, bounded record type — never a persistent identity. Its
lifecycle (`egg → larva → pupa → young-worker`) is tracked in a list capped
at `MAX_LIVE_BROOD = 10`, entirely independent of population size. A brood
record becomes a real `AntAgent` only through `admitMaturedBroodIfRoom`,
which computes `room = populationCap - currentPersistentCount` and admits at
most `room` records — never more, structurally, by array slice.

In every fixed-population demo in this repo (`demoColonyGenesis.ts`'s
300-ant run, and all three scale runs in `demoColonyScale.ts`), the
population cap equals the genesis count from tick zero, so `room` is always
`0` and admission never fires. This is not a shortcut around the mechanism —
it is the literal, intended behavior of NAMLA_BUILD_LAW.md Section 15's
bounded population policy: "when the cap is already reached, matured brood
remain queued... rather than creating unlimited agents." `demoColonyScale.ts`
runs one additional small colony (20 workers, cap 40) specifically to prove
the admission mechanism is real: over 700 ticks it grows the population from
20 to 39 workers, 19 genuine admissions, each one a real new persistent
`AntAgent` built from that brood record's own inherited (and mutated) genome
profile.

## Nursing demand, not a Queen assignment

Live brood raise their own chamber's `"nursing"` cell in the already-authorized
G1 `TaskStimulusField` (`applyBroodNursingDemand`, using the new
`raiseTaskStimulus` — the inverse of the existing `relieveTaskStimulus`).
Nothing new decides who nurses: the same G1-G3
`localTaskChoice.chooseWorkState` an ant already uses for every other
category reads that raised stimulus and may choose `"nursing"` on its own.
`nursingLocalResponses` counts exactly this — an existing signal
(`attemptedCategory === "nursing"`) observed, not a new decision path added.
`queenDirectNursingAssignments` is a literal `0` type, the same discipline
`colonyGenesis.ts` already uses for the six central-authority counters:
unrepresentable as nonzero, not merely asserted zero in a comment.

Nursed brood mature faster than unnursed brood (`advanceBroodMaturation`
takes a `nursedThisTick` boolean) — a real behavioral consequence of the
nursing response, not a decorative one.

## A retired ant is a closed record, not a deleted one

`AntAgent.lifecycleState` (`"egg" | "larva" | "pupa" | "adult" | "senescent" |
"retired"`, declared in G0, unused until now) advances
`adult → senescent → retired` under bounded, mostly health-driven
conditions — deliberately more selective than uniform, since age thresholds
sit near the 1000-tick hard cap while health thresholds are reachable within
an ordinary 400-tick run. A retired (or mid-recovery senescent) ant makes no
decision that tick: `isWithdrawnFromActiveDuty` short-circuits task choice,
learning, cognition claims, and movement for it. It is never removed from
`workers[]`. "No identity may silently disappear" is satisfied by
construction — the array length and identity set that
`populationIdentityPreserved` checks never shrinks from retirement, only
from nothing at all.

## The cognitive budget denies capability, never directs it

Every ant's `WorkState` is fully decided by G1-G3's
`localTaskChoice.chooseWorkState` before `cognitiveBudgetSystem.ts` runs at
all. A cognition claim is computed from only that ant's own local state —
its own threshold for the category it just attempted, how close the top two
candidate categories scored in its own choice (from
`LocalTaskChoiceResult.probabilities`), its own failure history, its own
specialization, reliability, energy, and health. `resolveCognitionClaims` is
the one deliberately centralized step in the whole G1-G7 core — and it is
pre-authorized for exactly this narrow purpose by
`docs/ant-colony-biological-model.md` section 8's existing language: bounded
resource admission that denies rather than directs. It ranks claims
(deterministic: score, then `antId`) and admits at most 30, by array slice —
structurally incapable of admitting more, not merely tuned to stay under 30.

Only `"llm-eligible"` is ever assigned, and only for the tick an ant is
admitted; every other ant's `activationMode` reverts to its own genesis
baseline (`"resting"` or `"reserve"`, from the immutable `startsInReserve`
field) every tick. Claims are recomputed fresh every tick — nothing persists
across ticks, so a rejected ant is never starved (fresh chance next tick)
and there is no unbounded waiting queue (nothing is queued at all).
`"deterministic-local"` and `"llm-active"` remain deliberately unreached in
this pass: activating a second tier for every actively-working ant would
trivially exceed the 30-slot budget, since G1-G4 already lets the whole
population work simultaneously.

## What G6-G7 intentionally do not do

No real model call — `CognitiveWorkerContract` is a type only.
`externalLlmCalls` stays literal-zero. No second cognitive-activation tier.
No population growth beyond the configured cap, ever. No change to the
Queen's four `false`-typed authority fields or her literal-zero
`queenTaskAssignments`. No fs, network, process, Git, timer, or autonomous
authority — unchanged from every earlier phase.

## Next phases

Real cognitive-worker attachment (implementing `CognitiveWorkerContract` for
real) and a second activation tier both require their own explicit human
authorization and a separate Build Law amendment, exactly like every phase
before them.
