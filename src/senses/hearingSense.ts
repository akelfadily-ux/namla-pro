/**
 * HearingSense: perceives incoming signals — messages, human instructions,
 * other ants speaking. Phase 0 only reads what is already present in the
 * given context, never a live audio or network stream.
 */

import type { HearingReading, SenseInput } from "../types/senseTypes";

export function hear(input: SenseInput): HearingReading {
  const signals = Array.isArray(input.context.signals) ? (input.context.signals as string[]) : [];

  return {
    senseType: "hearing",
    summary: signals.length > 0
      ? `Heard ${signals.length} signal(s).`
      : "No signals were provided to hear.",
    confidence: signals.length > 0 ? 0.75 : 0.2,
    generatedAt: new Date().toISOString(),
    heardSignals: signals,
  };
}
