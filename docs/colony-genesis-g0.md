# Colony Genesis G0 — foundation only

G0 is the **non-behavioral foundation** of Namla Pro's digital ant nation. It
creates *identity* and *topology*. It creates no behavior.

Authorized by Section 12 of `NAMLA_BUILD_LAW.md`.

## What G0 builds

| Piece | File | What it is |
|---|---|---|
| Nest topology | `src/colony/nestGraph.ts` | 13 chambers, 16 undirected edges, validated connected |
| Per-ant state | `src/colony/antAgent.ts` | The canonical `AntAgent` data record |
| Queen system | `src/colony/queenContinuitySystem.ts` | One continuity identity, zero authority |
| Population | `src/colony/antPopulation.ts` | 299 workers, deterministically derived |
| Genesis | `src/colony/colonyGenesis.ts` | The pure assembly function |
| Invariants | `src/colony/colonyInvariants.ts` | 16 mechanical structural checks |
| Demo | `src/examples/demoColonyGenesisG0.ts` | Proves all of the above |

## Why this avoids the central mission-pipeline problem

The existing runtime — `ColonyEngine` → `DecompositionEngine` → `AntScheduler`
→ `ColonySimulation` — is a **mission pipeline**. Its loop iterates *tasks* and
calls `nextAntForRole(role)`, a global function with full population access
that hands an ant to a task. The ant never chooses anything. That design is
correct for its purpose and stays exactly as it is, but it is the opposite of a
colony, and no amount of renaming would change that.

Colony Genesis is therefore a **second runtime**, not a refactor. The
separation is mechanical, not aspirational: `src/colony/` imports nothing from
`src/simulation/` or `src/planner/`, and nothing from `TaskRouter`,
`ColonyOrchestrator`, or `MissionPlanner`. That import boundary is checked by
grep in `SAFETY_INVARIANTS.md`, so a future phase cannot quietly reintroduce
central assignment by importing a scheduler "just for convenience".

Both runtimes must keep passing their goldens. The C0–C2-B capability stack is
untouched and remains the only path toward any real write.

## The Queen is continuity, not command

`QueenContinuityRecord` carries reproduction, colony identity, genome
reference, generation, and lineage depth. It carries no task list, no routing
table, no quorum winner, and no reference to the worker population.

Four fields are typed as the literal `false` —
`taskAssignmentAuthority`, `routingAuthority`, `quorumSelectionAuthority`,
`populationMemoryAccess` — so a commanding Queen is *unrepresentable*, not
merely discouraged. `queenHoldsNoAuthority()` re-checks the same properties at
runtime, including forbidden keys a cast could have smuggled in, because types
do not survive `as unknown as`.

In biology the queen influences work without commanding it: she produces brood,
brood generates local nursing demand, and nearby ants respond on their own.
Influence flows through the environment. G6 will implement that; G0 only
guarantees the Queen has no other channel available.

The architectural test is simple: **if a future phase ever needs to hand the
Queen the population roster, the design has failed.**

## Roles are future behavior states, not classes

`src/ants/` contains 20 wrapper classes (ScoutAnt, BuilderAnt, …) bound to a
fixed `AntRole` on each ant's identity. In that model an ant *is* a scout
forever, and the scheduler matches tasks to role strings.

Colony Genesis inverts this. An `AntAgent` has a `caste` (morphology, which
biases thresholds and starting chamber) and a `currentBehaviorState` (a
`WorkState` it moves through). A soldier that finds strong nursing demand and
no danger will nurse. Roles become states an ant enters, never classes it
belongs to — so hundreds of genuinely distinct ants come from **one** model
plus a seeded genome derivation, not from hundreds of subclasses.

The existing wrappers are marked `colony-genesis-standing: "not-part-of-colony-
genesis"` in `antRoleRegistry.ts`. Nothing is deleted; Colony Genesis simply
does not route through them.

## 300 identities, zero LLM calls

The population is 300 *persistent identities*, which is a completely different
quantity from *simultaneous model calls*. G0 keeps four things separate:

1. **Persistent ant state** — all 300 exist at every tick, forever.
2. **Local deterministic behavior** — arithmetic on local observations (G2+).
3. **Eligibility for deeper cognition** — a locally computed score (G7).
4. **Active LLM cognition** — capped at 30, and **not implemented at all yet**.

At genesis every worker is `resting` or `reserve`, so the cognitively active
count is **0** and the invariant `no-cognitively-active-ants-at-genesis`
asserts it. `llm-eligible` and `llm-active` exist as inert labels in the
`ActivationMode` union; no code path reaches them and no model is ever called.

## Reserve is a threshold, not a class

45% of workers (`genome.reserveFraction`) start in reserve. They are **not** a
separate type and **not** idle-by-flag — they are ordinary ants whose response
thresholds are multiplied by 1.45, making them *less sensitive*.

This one multiplier is the entire reserve mechanism. When demand later rises,
low-threshold ants cross first and high-threshold ants cross later, which
produces graded activation for free — the population cannot "all wake up at
once", because there is no signal that could wake it. G4 will exercise this;
G0 only establishes the distribution.

## What G0 intentionally does not do

No tick loop. No task allocation. No task stimulus field. No pheromone
deposits, reads, reinforcement, or decay. No encounters. No response-threshold
decisions. No specialization. No reserve activation. No recruitment. No quorum.
No brood production. No cognitive budget. No LLM call, filesystem write,
network call, process execution, Git action, timer, or autonomous loop.

The `AntAgent` fields for all of the above **exist and are neutrally
initialized**, so later phases have somewhere to write. No field is read by any
decision, because G0 has no decisions.

## Determinism

A colony contains no timestamp, no wall-clock value, and no unseeded
randomness. Every stochastic choice draws from a generator seeded by
`(colonySeed, antIndex, purpose-salt)`, so **each ant owns its own stream** and
iteration order cannot change any outcome. That is what will let this scale to
thousands of ants — and to parallel evaluation — without results drifting.

`checkDeterministicRerun` builds the same colony twice and compares structural
digests; the demo asserts `deterministicRerunMatches: true`.

## Next phases

Each requires its own explicit human authorization and a separate Build Law
amendment.

| Phase | Adds |
|---|---|
| **G1** | Task-stimulus field + pheromone field (deposit, read, decay) |
| **G2** | Encounter network + local response-threshold task choice |
| **G3** | Specialization through threshold learning and forgetting |
| **G4** | Reserve activation and measured throughput recovery |
| **G5** | Recruitment network + Temnothorax quorum with minority records |
| **G6** | Brood lifecycle + queen reproduction dynamics |
| **G7** | Cognitive budget and LLM eligibility (still no real model call) |

G1 is the recommended next step: without a stimulus field there is nothing for
an ant to respond to, so every later phase depends on it.
