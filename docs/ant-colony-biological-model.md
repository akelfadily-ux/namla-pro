# The biological model behind Namla Pro

Namla Pro is a **deliberate hybrid** of mechanisms observed in several ant
species, combined with digital adaptations that have no biological analogue.

**Namla Pro does not reproduce any single species.** Harvester ants do not
house-hunt by quorum; *Temnothorax* does not regulate foraging by
patroller-return rate. Combining them is an engineering choice, and this
document exists so that choice stays visible instead of hardening into a false
claim.

Every mechanism below is labeled: **real mechanism**, **hybrid**, **digital
adaptation**, **hypothesis**, or **postponed**.

---

## 1. Encounter-rate task regulation — *real mechanism*

**Source:** *Pogonomyrmex barbatus* (red harvester ant); Deborah Gordon's work
on task allocation without central control.

A harvester ant does not receive orders and cannot see the colony. It estimates
conditions from the **rate and kind of its recent encounters** — how often it
meets nestmates, what those nestmates were doing, and whether returning
foragers came back successful. Outgoing foraging is regulated largely by the
return rate of successful foragers.

**In Namla:** each ant keeps a bounded ring buffer
(`recentEncounterMemory`, capacity 20) recording only `{tick, otherWorkState,
otherCarriedSuccess}` — never the other ant's identity, genome, or history. The
encounter rate over that window becomes a stimulus input.

**Status:** implemented in G2 (`encounterNetwork.ts`) — bounded, chamber-local,
never population-wide.

---

## 2. Response thresholds — *real mechanism*, generalized

**Source:** the fixed-threshold model (Bonabeau, Theraulaz, Deneubourg),
supported across multiple genera.

Each ant has a per-task threshold θ. It engages when local stimulus *S*
overcomes θ, with probability `P = S^n / (S^n + θ^n)`. Ants differ in θ, so a
rising stimulus recruits the keenest first. Performing a task lowers its θ
(specialization); disuse lets θ drift back (forgetting).

**In Namla:** `responseThresholds` per `TaskCategory`, derived from the colony
genome times a per-ant `thresholdBias`, times a caste bias. `learningRate` and
`forgettingRate` live on `ColonyGenome`.

**Status:** implemented — decisions in G2 (`localTaskChoice.ts`), learning and
forgetting in G3 (`responseThresholdSystem.ts`).

---

## 3. Quorum decisions — *real mechanism*

**Source:** *Temnothorax albipennis* house-hunting (Franks, Pratt, and
colleagues).

Scouts assess candidate sites **independently** and hold private opinions.
Recruitment spreads by direct contact (tandem runs), not broadcast. Many ants
stay uncommitted. Commitment is **reversible** until a quorum is reached, and
the quorum is sensed **locally** — an ant estimates how many nestmates are at
the site it currently occupies. Crossing that local threshold switches the
colony from evaluation to execution.

**In Namla:** `privateCandidateAssessments` and a `commitmentState` ladder
(`uncommitted → assessing → recruiting → committed`) on each ant.

**Design commitment:** the quorum system will **observe and record**, never
tally-and-decide. A global object that counts support and declares a winner is
a central planner wearing a biology costume. Minority proposals keep their
final support counts permanently.

**Status:** implemented in G5 (`recruitmentQuorumSystem.ts`). Recruitment is
directed, transient, one-tick, and reuses each ant's own real bounded
encounter — never a second unbounded contact. Quorum sensing observes and
records exactly as designed: no function anywhere counts support across the
population or declares a winner; each ant advances only its own
`commitmentState`, from only its own bounded local observations.

---

## 4. Reserve labor — *real mechanism*

**Source:** inactive-worker studies in *Temnothorax*, *Myrmica*, and the
honeybee literature. A large fraction of a colony is inactive at any moment;
those workers activate when demand rises or active workers are lost.

**In Namla:** reserve ants are **not a class and not a flag consulted by a
scheduler**. They are ordinary ants whose thresholds are multiplied by 1.45,
making them less sensitive. When work goes undone, unmet demand accumulates
locally, stimulus rises, and previously sub-threshold ants cross.

This gives three properties for free: activation is **demand-specific** (only
elevated categories recruit), **graded** (thresholds are continuously
distributed, so the population cannot wake at once), and **lossy** (recruits
are less specialized, so recovery is partial).

**Status:** implemented in G4 (`colonyTickRunner.ts`) as the removal of one
exclusion — no new mechanism, no separate controller. ~45% of workers start
in reserve (G0); the same G1-G3 machinery now runs for them too, and their
elevated thresholds are the entire reason they engage later.

---

## 5. Brood-driven nursing demand — *real mechanism*

**Source:** general myrmecology. Brood presence drives nursing behavior in
nearby workers; the queen does not direct nurses.

**In Namla:** the Queen produces brood; brood raises nursing stimulus in the
nursery; nearby ants respond on their own. **This is the Queen's only channel
of influence** — she has no other, by type and by invariant.

**Status:** implemented in G6 (`broodLifecycleSystem.ts`). Brood are a small,
separately bounded record type (`MAX_LIVE_BROOD = 10`, never AntAgents until
admitted), raise their own chamber's nursing stimulus, and mature faster when
nursed — nursing ants respond through the same G1-G3 response-threshold
system, never a new decision path and never a Queen assignment
(`queenDirectNursingAssignments` is literal-zero). Admission into a real
persistent identity is strictly gated by the population cap; in every
fixed-population demo the cap is already saturated at genesis, so admission
structurally cannot fire — see `docs/colony-genesis-g6-g7.md`.

---

## 6. Pheromones as a limited persistent signal — *hybrid*

**Source:** trail pheromones in *Lasius*, *Atta*, and many others: chemical
marks that persist in the environment and decay unless reinforced.

**The discipline that matters here:** not every communication event is a
pheromone. Namla separates four channels deliberately.

| Channel | Nature | Example |
|---|---|---|
| **Pheromone field** | persistent, environmental, decaying | danger, resource trail, repair-need |
| **Encounter** | transient, pairwise, unstored | meeting a returning forager |
| **Recruitment** | directed, transient, one tick | a tandem-run partner |
| **Task stimulus** | environmental demand, not a signal | unmet work in a chamber |

Task stimulus exists **whether or not any ant marked it**, which is exactly why
it is not a pheromone.

**Planned structure:** the field is a fixed grid of `(chamber × pheromoneType)`
scalar cells, not an unbounded list of per-event objects — so memory is
independent of both population size and run length.

**Hard rule:** a pheromone type that no decision reads must be deleted from the
enum, not kept for flavour. The existing `PheromoneBus` in `src/core/` is
currently write-only in its runtime spine; Colony Genesis must not repeat that.

**Status:** implemented in G1 (`pheromoneField.ts`). Every one of the 10
`ColonyPheromoneType` values is deposited by some code path and read by at
least one decision site (`PHEROMONE_DECISION_SITES` makes this a compile-time
requirement, not a claim in prose).

---

## 7. Caste as tendency, not destiny — *hybrid*

Real ant castes are morphological and genuinely bias what an ant does well.
They do not lock an ant to one task for life; workers switch tasks readily.

**In Namla:** `caste` biases thresholds and starting chamber. It constrains
nothing. A soldier that finds strong nursing demand and no danger will nurse.

**Status:** implemented — castes are assigned deterministically at genesis
(G0); switching is live from G2 onward, decided entirely by
`localTaskChoice.chooseWorkState`.

---

## 8. Digital adaptations — *no biological claim*

These have **no** ant analogue and must never be described as biology:

- **Skill tendencies** (research, coding, testing, security, …) layered over
  biological task categories.
- **The `ActivationMode` ladder**, including `llm-eligible` / `llm-active`.
- **The cognitive budget** (≤30 of 300 ants may think expensively). This is the
  *least* biological element in the whole design. Its nearest honest framing is
  a scarce colony resource with local contention, and its resolution step is
  centralized admission control. It is acceptable only because it **denies**
  capability rather than **directing** behavior: a rejected ant still chooses
  its own task. This must stay documented as an adaptation, never dressed up as
  emergent. **Status:** implemented in G7 (`cognitiveBudgetSystem.ts`).
  `resolveCognitionClaims` never sets a task; it only labels which
  already-self-chosen working ants are additionally `"llm-eligible"` this
  tick, capped at 30 by construction. `"deterministic-local"` and
  `"llm-active"` remain deliberately inert in this pass.
- **Brood genome inheritance with controlled mutation** (G6,
  `broodLifecycleSystem.ts`): a bounded, seeded perturbation applied to an
  otherwise normally-derived genome profile. No single named biological
  source — real ant colonies do not tune per-trait mutation magnitudes.
- **Knowledge-storage chambers** and **receipts**.

---

## 9. Hypotheses — *unproven, testable in simulation*

Stated as hypotheses because they are not established by anything:

1. That threshold reinforcement over *software* task categories yields
   **useful** specialization, not merely measurable specialization.
2. That decentralized quorum produces **better** architectural choices than a
   planner would.
3. That reserve activation restores useful throughput in a software colony.
4. That encounter-rate regulation is a sensible proxy for demand when "work" is
   code review rather than seed collection.

Simulation can support or refute these. G0 asserts none of them.

---

## 10. Postponed until a real LLM-worker phase

Real model calls, real tool use, and any connection between an ant's decision
and an external agent are **postponed entirely**. As of G7, `llm-eligible` IS
reached — up to 30 ants per tick are labeled with it when they win a bounded
cognition-budget slot — but the label changes nothing about what any ant
does; its own already-computed local decision proceeds unaffected.
`llm-active` remains unreached. `CognitiveWorkerContract`
(`cognitiveBudgetSystem.ts`) defines the shape a real cognitive worker
(Claude, Codex, OpenAI, Anthropic, or a local model) would satisfy, so a
future phase can attach one without redesigning this module — but no
implementation of it exists anywhere in Namla Pro, nothing constructs one,
and nothing calls `requestCognition`. Namla Pro has never called an external
model and G7 does not change that.

---

## Honesty checklist

When extending this model, every new mechanism must be labeled with one of:
**real mechanism** (cite the species), **hybrid** (say which sources were
combined and why), **digital adaptation** (say plainly that it has no
biological basis), **hypothesis** (say what would confirm or refute it), or
**postponed** (say what it depends on).

A mechanism whose label cannot be defended does not belong in the architecture.

---

## Ant Intelligence Deepening V1 — how the deeper layer is labeled

The intelligence layer (Build Law §17, `docs/ant-intelligence-deepening-v1.md`)
sits on the mechanisms above. Its own honesty labels:

- **Real-mechanism-inspired:** experience-driven specialization (thresholds),
  reserve/young-worker development, and reversible quorum-style commitment for
  high-impact decisions all extend behaviors already grounded above.
- **Hybrid:** peer review and temporary guilds blend social-insect task
  partitioning and transient work groups with human software-team practice.
  Namla does not claim any ant species performs typed code review.
- **Digital adaptations (no biological claim):** the 15-dimension cognitive
  profile, confidence calibration, the versioned/contradiction-flagged knowledge
  store, and the cognitive-budget admission cap. These are engineering, stated
  as such.
- **Hypotheses (unproven, testable in simulation):** that richer per-ant
  cognition improves collective decision quality, and that these deterministic
  mechanisms will transfer usefully once real cognition is attached.
- **Future real-LLM behavior (postponed):** only a bounded subset (≤30) of ants
  will ever receive real model cognition, through the type-only
  `CognitiveWorkerContract` seam. No provider is called today;
  `externalLlmCalls` is literal zero.

**Namla still reproduces no single species.** The deeper layer is even more
explicitly a hybrid of biology and software engineering, and that boundary is
kept visible here rather than blurred.

## Status: frozen research reference layer (Build Law §22)

As of the Digital Superorganism Metabolism V1 milestone, the literal biological
colony model in `src/biology/` is a **frozen research reference layer**. It is
preserved (not deleted) but is no longer the product model and must not be
extended with further literal food/water/pathogen metabolism. The product model
is the digital economy — see
[digital-superorganism-metabolism-v1.md](digital-superorganism-metabolism-v1.md).
The biology layer's conserving double-entry ledger and event-sourced design
directly informed the digital `DigitalResourceEconomy`.
