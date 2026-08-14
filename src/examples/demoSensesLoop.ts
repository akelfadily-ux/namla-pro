// Focused feature demo — proves the digital sense skeletons (Phase 0).
// The canonical end-to-end runtime path is demoEndToEnd.ts.
/**
 * demoSensesLoop: runs every digital sense once against a small shared
 * context, to show how senses turn context into structured readings.
 * Illustrative only.
 */

import { see } from "../senses/visionSense";
import { hear } from "../senses/hearingSense";
import { smell } from "../senses/smellSense";
import { touch } from "../senses/touchSense";
import { taste } from "../senses/tasteSense";
import { recall } from "../senses/memorySense";
import { senseTime } from "../senses/timeSense";
import { senseRisk } from "../senses/riskSense";
import type { SenseInput } from "../types/senseTypes";

function baseInput(context: Record<string, unknown>): SenseInput {
  return {
    senseType: "vision",
    context,
    requestedByAntId: "scout-demo-1",
    requestedAt: new Date().toISOString(),
  };
}

export function runDemoSensesLoop() {
  const missionStartedAt = new Date(Date.now() - 5000).toISOString();

  return {
    vision: see(baseInput({ structures: ["src/", "docs/", "examples/"] })),
    hearing: hear(baseInput({ signals: ["human said: build phase 0"] })),
    smell: smell(baseInput({ pheromoneTypes: ["TrailPheromone", "HumanIntentPheromone"] })),
    touch: touch(baseInput({ paths: ["docs/architecture.md"] })),
    taste: taste(baseInput({ concerns: [] })),
    memory: recall(baseInput({ recalledEntryIds: ["memory-1"] })),
    time: senseTime(baseInput({ missionStartedAt })),
    risk: senseRisk(baseInput({ text: "read the docs folder and summarize it" })),
  };
}

if (require.main === module) {
  console.log(JSON.stringify(runDemoSensesLoop(), null, 2));
}
