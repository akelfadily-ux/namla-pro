/**
 * pheromoneDecay implements exponential half-life decay for pheromones, the
 * same way a real ant trail's scent fades over time unless reinforced.
 */

import type { ElectronicPheromone, PheromoneDecayRule, PheromoneType } from "../types/pheromoneTypes";

const DEFAULT_HALF_LIFE_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_MIN_STRENGTH = 0.02;

const DECAY_RULES: Record<PheromoneType, PheromoneDecayRule> = {
  PriorityPheromone: { type: "PriorityPheromone", halfLifeMs: 10 * 60 * 1000, minimumStrengthBeforeRemoval: DEFAULT_MIN_STRENGTH },
  DangerPheromone: { type: "DangerPheromone", halfLifeMs: 30 * 60 * 1000, minimumStrengthBeforeRemoval: DEFAULT_MIN_STRENGTH },
  TrailPheromone: { type: "TrailPheromone", halfLifeMs: DEFAULT_HALF_LIFE_MS, minimumStrengthBeforeRemoval: DEFAULT_MIN_STRENGTH },
  NeedHelpPheromone: { type: "NeedHelpPheromone", halfLifeMs: 3 * 60 * 1000, minimumStrengthBeforeRemoval: DEFAULT_MIN_STRENGTH },
  ConfidencePheromone: { type: "ConfidencePheromone", halfLifeMs: DEFAULT_HALF_LIFE_MS, minimumStrengthBeforeRemoval: DEFAULT_MIN_STRENGTH },
  BugPheromone: { type: "BugPheromone", halfLifeMs: 20 * 60 * 1000, minimumStrengthBeforeRemoval: DEFAULT_MIN_STRENGTH },
  ArchitecturePheromone: { type: "ArchitecturePheromone", halfLifeMs: 60 * 60 * 1000, minimumStrengthBeforeRemoval: DEFAULT_MIN_STRENGTH },
  HumanIntentPheromone: { type: "HumanIntentPheromone", halfLifeMs: 60 * 60 * 1000, minimumStrengthBeforeRemoval: DEFAULT_MIN_STRENGTH },
  BlockedActionPheromone: { type: "BlockedActionPheromone", halfLifeMs: 30 * 60 * 1000, minimumStrengthBeforeRemoval: DEFAULT_MIN_STRENGTH },
  SuccessPheromone: { type: "SuccessPheromone", halfLifeMs: DEFAULT_HALF_LIFE_MS, minimumStrengthBeforeRemoval: DEFAULT_MIN_STRENGTH },
  QuestionPheromone: { type: "QuestionPheromone", halfLifeMs: 15 * 60 * 1000, minimumStrengthBeforeRemoval: DEFAULT_MIN_STRENGTH },
  MemoryPheromone: { type: "MemoryPheromone", halfLifeMs: 2 * 60 * 60 * 1000, minimumStrengthBeforeRemoval: DEFAULT_MIN_STRENGTH },
};

export function getDecayRule(type: PheromoneType): PheromoneDecayRule {
  return DECAY_RULES[type];
}

export function decayPheromone(pheromone: ElectronicPheromone, now: Date = new Date()): ElectronicPheromone {
  const rule = getDecayRule(pheromone.type);
  // Clamp at zero: if a caller's clock (e.g. a virtual simulation clock)
  // ever sits behind this pheromone's anchor, negative elapsed time would
  // make Math.pow(0.5, negative) GROW the strength. Decay may only fade.
  const elapsedMs = Math.max(0, now.getTime() - new Date(pheromone.lastReinforcedAt).getTime());
  const halfLives = elapsedMs / rule.halfLifeMs;
  const decayedStrength = pheromone.strength * Math.pow(0.5, halfLives);

  // Re-anchor lastReinforcedAt to `now` so a later decay tick computes decay
  // only over the time since THIS tick, instead of re-applying decay across
  // the full span since the pheromone was last reinforced (which would
  // double-count the decay already applied here).
  return { ...pheromone, strength: Math.max(0, decayedStrength), lastReinforcedAt: now.toISOString() };
}

export function isExpired(pheromone: ElectronicPheromone): boolean {
  const rule = getDecayRule(pheromone.type);
  return pheromone.strength <= rule.minimumStrengthBeforeRemoval;
}
