/**
 * TimeSense: perceives elapsed time since a mission started. Useful later
 * for loop budgets and stale-task detection. Phase 0 only computes the
 * elapsed value; it never triggers any action from it.
 */

import type { SenseInput, TimeReading } from "../types/senseTypes";

export function senseTime(input: SenseInput): TimeReading {
  const missionStartedAt = typeof input.context.missionStartedAt === "string"
    ? input.context.missionStartedAt
    : undefined;

  const elapsedSinceMissionStartMs = missionStartedAt
    ? new Date(input.requestedAt).getTime() - new Date(missionStartedAt).getTime()
    : 0;

  return {
    senseType: "time",
    summary: missionStartedAt
      ? `${elapsedSinceMissionStartMs}ms elapsed since mission start.`
      : "No mission start time provided.",
    confidence: missionStartedAt ? 0.9 : 0.1,
    generatedAt: new Date().toISOString(),
    elapsedSinceMissionStartMs,
  };
}
