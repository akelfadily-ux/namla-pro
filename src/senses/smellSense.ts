/**
 * SmellSense: perceives electronic pheromones in the surrounding context.
 * This is the sense most directly tied to the colony's pheromone model —
 * it reports which pheromone types are present, not their full content.
 */

import type { SenseInput, SmellReading } from "../types/senseTypes";

export function smell(input: SenseInput): SmellReading {
  const pheromoneTypes = Array.isArray(input.context.pheromoneTypes)
    ? (input.context.pheromoneTypes as string[])
    : [];

  return {
    senseType: "smell",
    summary: pheromoneTypes.length > 0
      ? `Detected ${pheromoneTypes.length} pheromone type(s) nearby.`
      : "No pheromones detected nearby.",
    confidence: pheromoneTypes.length > 0 ? 0.8 : 0.3,
    generatedAt: new Date().toISOString(),
    detectedPheromoneTypes: pheromoneTypes,
  };
}
