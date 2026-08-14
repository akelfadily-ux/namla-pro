# Example: Sensory Loop

This walks through a single pass of every digital sense against one shared
piece of context, mirroring [src/examples/demoSensesLoop.ts](../src/examples/demoSensesLoop.ts).

An ant (say, a `ScoutAnt`) has just been asked to look around the `docs/` and
`src/` folders and report what it notices, before proposing any task.

| Sense    | Input given                                              | What it reports                                   |
|----------|-----------------------------------------------------------|----------------------------------------------------|
| Vision   | `["src/", "docs/", "examples/"]`                          | 3 structures observed                               |
| Hearing  | `["human said: build phase 0"]`                            | 1 signal heard                                      |
| Smell    | `["TrailPheromone", "HumanIntentPheromone"]`               | 2 pheromone types detected nearby                   |
| Touch    | `["docs/architecture.md"]`                                 | In contact with 1 path, nothing modified            |
| Taste    | no concerns                                                | Quality score ~0.8, feels reasonable                |
| Memory   | `["memory-1"]`                                             | 1 memory entry recalled                             |
| Time     | mission started 5 seconds ago                              | ~5000ms elapsed                                     |
| Risk     | `"read the docs folder and summarize it"`                 | `safe`, no risk indicators matched                  |

None of these senses touch a real filesystem, microphone, or camera in Phase
0. They all operate on context that was already handed to them — the point is
to prove the *shape* of perception before any real perception is wired up in
a later phase.

An ant would typically call `senseRisk` last, right before proposing an
action, so the risk reading is as close as possible to the actual thing it is
about to propose.
