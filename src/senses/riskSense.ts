/**
 * RiskSense: perceives danger in text using the same classification logic as
 * SafetyGuard. This lets any ant "smell danger" before proposing an action,
 * not just the central guard that checks missions and tasks.
 */

import type { RiskReading, SenseInput } from "../types/senseTypes";
import { SafetyGuard } from "../core/safetyGuard";

const guard = new SafetyGuard();

function toRiskLevel(level: string): RiskReading["riskLevel"] {
  switch (level) {
    case "SAFE":
      return "safe";
    case "CAUTION":
      return "caution";
    case "RISKY":
      return "risky";
    default:
      return "forbidden";
  }
}

export function senseRisk(input: SenseInput): RiskReading {
  const text = typeof input.context.text === "string" ? input.context.text : "";
  const decision = guard.evaluateText(text);

  return {
    senseType: "risk",
    summary: `Risk level ${decision.level} based on ${decision.reasons.length} indicator(s).`,
    confidence: text ? 0.85 : 0.1,
    generatedAt: new Date().toISOString(),
    riskLevel: toRiskLevel(decision.level),
    riskIndicators: decision.reasons.map((r) => r.matchedIndicator ?? r.code),
  };
}
