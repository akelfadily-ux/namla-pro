/**
 * TasteSense: a qualitative "does this feel right" judgment, used for
 * lightweight self-review before an ant commits to a plan. Phase 0 returns a
 * simple heuristic score based on context flags, not a real quality model.
 */

import type { SenseInput, TasteReading } from "../types/senseTypes";

export function taste(input: SenseInput): TasteReading {
  const concerns = Array.isArray(input.context.concerns) ? (input.context.concerns as string[]) : [];
  const qualityScore = concerns.length === 0 ? 0.8 : Math.max(0.1, 0.8 - concerns.length * 0.15);

  return {
    senseType: "taste",
    summary: concerns.length > 0
      ? `Tasted ${concerns.length} concern(s) affecting quality.`
      : "No concerns tasted; plan feels reasonable.",
    confidence: 0.5,
    generatedAt: new Date().toISOString(),
    qualityScore,
  };
}
