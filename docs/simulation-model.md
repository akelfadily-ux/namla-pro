# Simulation Model (Phase 6)

Phase 6 is the first time the whole colony moves at once — and it moves
entirely inside memory, on virtual time, under a hard step budget. A
simulation is a rehearsal: real components (Queen-path planning, pheromone
bus, safety gates, receipts, proposal factories, reviewers) processing real
data (a mission, a genuine `ProjectSnapshot`), with zero ability to act on
anything outside the process.

Authorized by the Phase 6 amendment in
[NAMLA_BUILD_LAW.md](../NAMLA_BUILD_LAW.md).

## Multi-agent simulation as in-memory data

`ColonySimulation.run` takes a mission, a roster of `SimulationAntState`s,
an optional snapshot, and optional injected capabilities. It safety-gates
the mission, decomposes it through the Phase 2 engine, then steps through
the dependency-ordered tasks: each step assigns one task to one ant, emits
pheromones, writes receipts, and advances the virtual clock. The output is
a `SimulationReport` — statuses, counts, events, and ids — plus the receipt
trail that proves each step.

## Virtual time

`SimulationClock` is an integer tick counter. Time advances only when
`step()` is called from inside a human-run script; there is no
`setInterval`, no `setTimeout`, no watcher, no background anything. One
tick maps to one virtual minute via `asDate()`, anchored at the clock's
construction moment — anchored at "now" rather than a fixed past date
because pheromones carry real emission timestamps, and decaying them
against a Date in their past would compute negative elapsed time and grow
their strength instead of fading it. As a second, universal layer,
`decayPheromone` itself clamps elapsed time at zero, so no clock mismatch
anywhere can ever make decay increase a strength — a backward clock can
only over-fade, which is the safe direction.

## Deterministic scheduling

`AntScheduler` consults ants in registration order with a per-role rotating
cursor: two builders alternate builder tasks in a fixed, reproducible
sequence. Task order is the engine's topological order, which is itself
deterministic. Given the same mission, roster, and snapshot, every run
produces the same schedule, the same events, and the same outcome. (One
honest caveat: pheromone *strengths* inherit millisecond-level jitter from
real emission timestamps — negligible against multi-minute half-lives and
irrelevant to scheduling and outcomes, but strictly speaking the
determinism guarantee covers order and results, not the nth decimal of a
strength value.)

## The bounded step budget

Every scheduling decision — including one that finds no ant — consumes one
unit of a budget whose ceiling is `SIMULATION_MAX_VIRTUAL_STEPS = 100`, a
code constant in `AutonomousLoopPolicy`. Callers may tighten the budget
(the demo's second run uses 3 to show the halt), but requests above the
ceiling are clamped down; no environment variable, ant, or runtime input
can raise it. Hitting the cap halts the run with a receipted
`step-budget-reached` halt. Because skips also consume budget, even a
pathological roster starves to a halt rather than looping.

The default budget everywhere outside `src/simulation/` remains **zero** —
the Phase 6 amendment authorizes rehearsal, not autonomy.

## Why this is still not autonomy

Steps advance only while a human-run script is inside `run()`. The
simulation cannot schedule its own future, wake itself up, or continue
after returning — there is no timer to fire and no worker to keep going.
"100 steps" is not 100 actions in the world; it is 100 bookkeeping updates
to objects that are garbage-collected when the script ends.

## Pheromone flow during simulation

The run opens with a `HumanIntentPheromone` (the Queen's signal), each
processed task lays a `TrailPheromone`, a skipped task emits a
`NeedHelpPheromone` with a fixed topic, and completion emits a
`SuccessPheromone`. After every step, `PheromoneBus.tickDecay` runs at the
clock's virtual moment, so trails laid early in a long mission genuinely
fade — the colony's shared attention decays unless re-marked, exactly as
the Phase 0 model intended.

## How receipts prove each step

Every run writes: a start receipt (counts and ids), one receipt per
processed step (tick, task, ant — via links and details), one per skipped
task (reason-coded), a halt receipt when the budget stops a run, and a
completion receipt. Every summary literal was audited against the
`SecretProtectionPolicy` indicator list (the reason-literal rule from the
Phase 4 verification); dynamic values in summaries are counts and safety
levels only, with ids, ticks, roles, and reason codes in structured
details.

## How the roles connect

Scout, Planner, Builder, Tester, Auditor, and Messenger are scheduled
directly — the engine's tasks route to them by role. The Queen is the
mission gate and intent pheromone at the start of `run()`. The Guard is the
`SafetyGuard` gating at mission and (via the engine) task level. Memory is
the `ColonyMemory` lesson written on completion. Repair and Archivist
participate when their Phase 4/5 capabilities are injected, and are
registered in the demo roster to show that scheduling honors arbitrary
rosters.

## Why no commands, writes, tests, git, installs, network, timers, or concurrency

The project-wide invariant — no execution API of any kind exists anywhere —
is what makes the simulation trustworthy: a rehearsal that *could* touch
the world is not a rehearsal. Phase 6 added no capability; it added
choreography over capabilities that already existed as data.

## What is intentionally not implemented

- **Real concurrency** — the round-robin is sequential by design;
  simulated parallelism would add nondeterminism for no safety benefit.
- **Task outcomes with content** — processed tasks are marked done, not
  actually performed; placeholder proposals stand in for real builder
  output until Phase 7 adapters supply content.
- **Re-planning on skip/failure** — a skipped task does not reshape the
  plan; feedback loops remain human-driven.
- **Persistence** — reports, receipts, pheromones, and memory vanish with
  the process.
- **Any autonomy** — no scheduling beyond the explicit call stack of a
  human-run script.
