# Example: Pheromone Trail

This walks through a pheromone's life cycle, mirroring
[src/examples/demoPheromoneFlow.ts](../src/examples/demoPheromoneFlow.ts).

## 1. Emit

A `ScoutAnt` finishes exploring the `docs/` folder and emits a
`TrailPheromone`:

```
type: TrailPheromone
emittedByAntId: scout-demo-1
topic: explored-docs-folder
strength: 1.0
```

## 2. Reinforce

A second ant walks the same path shortly after and finds the trail still
useful, so it reinforces it:

```
strength: 1.0 -> 1.0 (capped; was already at maximum)
lastReinforcedAt: updated
```

If the trail had already decayed to, say, `0.6`, reinforcing by `0.1` would
bring it to `0.7`.

## 3. Decay

`TrailPheromone` has a 5-minute half-life. If an hour passes with no further
reinforcement, the strength decays through many half-lives and drops below
the removal threshold (`0.02`). `PheromoneBus.tickDecay` then removes it from
the bus entirely.

## 4. Why this matters

A trail that nobody reinforces fades — exactly like a real ant colony. This
means stale signals don't pile up forever, and "hot" trails (the ones ants
keep re-walking) stay visible without any human needing to manually clear
old state.
