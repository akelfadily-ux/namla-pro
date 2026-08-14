# Electronic Pheromones

An electronic pheromone is the colony's indirect communication primitive.
Instead of every ant messaging every other ant directly, ants emit
pheromones onto a shared `PheromoneBus`, and other ants sense (query) that
bus to decide what to do next. This mirrors stigmergy — the way real ants
coordinate by modifying and reading a shared environment (scent trails)
rather than talking to each other one-on-one.

## The twelve pheromone types

Defined in `src/types/pheromoneTypes.ts`:

| Type | Meaning | Example emitter |
|---|---|---|
| `PriorityPheromone` | "This matters more than the default." | Commander, Strategist |
| `DangerPheromone` | "Something dangerous was detected nearby." | Guard, Risk sense |
| `TrailPheromone` | "Work is happening in this direction." | Any ant that just completed a step |
| `NeedHelpPheromone` | "I am stuck and need another ant." | Worker, Builder, Repair |
| `ConfidencePheromone` | "I am confident in this direction." | Strategist, Architect |
| `BugPheromone` | "A bug was found here." | Tester, Auditor |
| `ArchitecturePheromone` | "A structural decision was proposed here." | Architect |
| `HumanIntentPheromone` | "This is what the human actually asked for." | Queen, on mission acceptance |
| `BlockedActionPheromone` | "An action was refused by SafetyGuard." | Queen, ColonyOrchestrator, GuardAnt |
| `SuccessPheromone` | "This path led to a completed outcome." | Reporter, Commander |
| `QuestionPheromone` | "An ant needs clarification before proceeding." | Any ant, when uncertain |
| `MemoryPheromone` | "A memory-worthy fact was observed here." | MemoryAnt, Archivist |

## Emitting, decaying, reinforcing, querying

`PheromoneBus` (`src/core/pheromoneBus.ts`) wraps four pure functions from
`src/pheromones/`:

- **`pheromoneFactory.createPheromone`** builds a well-formed
  `ElectronicPheromone`, and runs `PheromoneSafetyPolicy` first — a
  pheromone's topic or payload can never contain secret-shaped content.
- **`pheromoneDecay.decayPheromone`** applies exponential half-life decay:
  `strength * 0.5 ^ (elapsedMs / halfLifeMs)`. Each pheromone type has its
  own half-life in `DECAY_RULES` — e.g. `NeedHelpPheromone` decays fast (3
  minutes) because urgency should not linger, while `MemoryPheromone` decays
  slowly (2 hours) because remembered facts should persist.
- **`pheromoneReinforcement.reinforcePheromone`** boosts a pheromone's
  strength (capped at 1) and refreshes `lastReinforcedAt`, the way a real ant
  re-walking a trail keeps it fresh.
- **`pheromoneQuery.queryPheromones`** filters the bus by type, topic,
  mission, task, or minimum strength — this is how an ant "smells" for
  something specific instead of reading every pheromone ever emitted.

## Why decay and reinforcement matter

Without decay, the pheromone space would grow forever and old, irrelevant
signals would drown out current ones. Without reinforcement, every trail
would fade at a fixed rate regardless of whether it was still useful. Together
they let the colony's shared signal space behave like a real ant trail
network: paths that are actively useful stay strong, paths that stop being
walked fade out on their own, and nothing needs a human or a cron job to
manually garbage-collect stale state.

`PheromoneBus.tickDecay(now)` is the single place decay is applied — it is
not automatic on a timer in Phase 0 (there are no background loops yet); it
must be called explicitly, which keeps Phase 0 fully deterministic and
testable.

## Safety

`PheromoneSafetyPolicy` (`src/policies/pheromoneSafetyPolicy.ts`) is checked
inside `pheromoneFactory.createPheromone`, meaning it is impossible to emit a
pheromone through `PheromoneBus.emit` whose topic or string payload values
look like a secret. This closes off the pheromone bus as a potential leak
channel for the same category of content `ColonyMemory` and `ReceiptLog`
already refuse.
