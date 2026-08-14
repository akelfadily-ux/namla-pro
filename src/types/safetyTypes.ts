/**
 * Safety types. SafetyGuard classifies text or planned actions into a
 * SafetyLevel and produces a SafetyDecision explaining why.
 */

export type SafetyLevel = "SAFE" | "CAUTION" | "RISKY" | "FORBIDDEN";

export interface SafetyReason {
  code: string;
  description: string;
  matchedIndicator?: string;
}

export interface SafetyRule {
  ruleId: string;
  description: string;
  indicators: string[];
  level: SafetyLevel;
}

export interface SafetyDecision {
  level: SafetyLevel;
  reasons: SafetyReason[];
  allowed: boolean;
  evaluatedAt: string;
  evaluatedText: string;
}
