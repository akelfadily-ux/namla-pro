// Focused feature demo — proves PheromoneBus emit/reinforce/decay/query (Phase 0).
// The canonical end-to-end runtime path is demoEndToEnd.ts.
/**
 * demoPheromoneFlow: shows a pheromone being emitted, reinforced, and
 * decayed over simulated time. Illustrative only.
 */

import { PheromoneBus } from "../core/pheromoneBus";

export function runDemoPheromoneFlow() {
  const bus = new PheromoneBus();

  const trail = bus.emit({
    type: "TrailPheromone",
    emittedByAntId: "scout-demo-1",
    topic: "explored-docs-folder",
    missionId: "mission-demo-1",
  });

  bus.reinforce(trail.pheromoneId, 0.1);

  const before = bus.query({ type: "TrailPheromone" });

  // Simulate time passing well beyond the trail's half-life.
  const future = new Date(Date.now() + 60 * 60 * 1000);
  bus.tickDecay(future);

  const after = bus.query({ type: "TrailPheromone" });

  return { before, after };
}

if (require.main === module) {
  console.log(JSON.stringify(runDemoPheromoneFlow(), null, 2));
}
