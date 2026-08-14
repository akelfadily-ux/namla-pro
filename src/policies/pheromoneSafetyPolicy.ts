/**
 * PheromoneSafetyPolicy prevents pheromones from becoming a side channel for
 * unsafe content. A pheromone's topic and payload are checked the same way
 * any other colony text would be.
 */

import { looksLikeSecret } from "./secretProtectionPolicy";

export function isPheromonePayloadSafe(payload: Record<string, unknown>): boolean {
  return Object.values(payload).every((value) => {
    if (typeof value !== "string") return true;
    return !looksLikeSecret(value);
  });
}

export function assertPheromoneSafe(topic: string, payload: Record<string, unknown>): void {
  if (looksLikeSecret(topic) || !isPheromonePayloadSafe(payload)) {
    throw new Error("PheromoneSafetyPolicy refused to allow secret-shaped content onto the PheromoneBus.");
  }
}
