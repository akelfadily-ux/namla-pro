/**
 * SafetyGuard classifies free text or planned actions into a SafetyLevel and
 * blocks anything that matches a dangerous indicator. This is the single
 * chokepoint every mission and task must pass through.
 *
 * SafetyGuard is deliberately conservative: when in doubt, it escalates the
 * level rather than allowing the action.
 *
 * AH2 Step 4E: indicators are matched through the canonical
 * textIndicatorMatcher with explicit per-rule modes instead of raw
 * substring `includes`. Short indicators are lexical tokens (so
 * "information" no longer trips "format", "reinforcement" no longer trips
 * "force", "executed" no longer trips "exec"), while commands keep their
 * punctuation-precise substring semantics and multi-word indicators are
 * token phrases. Token rules carry explicit inflected variants so real
 * dangerous wording ("removed", "installing", "pushed", "execute") remains
 * refused — the regression matrix lives in demoSafetyMatcher.ts.
 */

import type { SafetyDecision, SafetyLevel, SafetyReason, SafetyRule } from "../types/safetyTypes";
import { matchTextIndicators, TextIndicatorRule } from "../policies/textIndicatorMatcher";

const FORBIDDEN_RULES: TextIndicatorRule[] = [
  { indicator: "rm -rf", mode: "command" },
  { indicator: "del /s", mode: "command" },
  { indicator: "format", mode: "token", variants: ["formats", "formatted"] },
  { indicator: "delete", mode: "token", variants: ["deletes", "deleted", "deleting", "deletion"] },
  { indicator: "remove", mode: "token", variants: ["removes", "removed", "removing", "removal"] },
  { indicator: "secret", mode: "token", variants: ["secrets"] },
  { indicator: "token", mode: "token", variants: ["tokens"] },
  { indicator: "credential", mode: "token", variants: ["credentials"] },
  { indicator: "private key", mode: "phrase" },
  { indicator: ".env", mode: "path-fragment" },
  { indicator: "install", mode: "token", variants: ["installs", "installed", "installing", "installation", "installer"] },
  { indicator: "npm install", mode: "phrase" },
  { indicator: "pip install", mode: "phrase" },
  { indicator: "winget", mode: "token" },
  { indicator: "push", mode: "token", variants: ["pushes", "pushed", "pushing"] },
  { indicator: "git push", mode: "phrase" },
  { indicator: "sudo", mode: "token" },
  { indicator: "production deploy", mode: "phrase" },
  { indicator: "outside project root", mode: "phrase" },
  { indicator: "broad rewrite", mode: "phrase" },
];

const RISKY_RULES: TextIndicatorRule[] = [
  { indicator: "overwrite", mode: "token", variants: ["overwrites", "overwritten", "overwriting"] },
  { indicator: "force", mode: "token", variants: ["forces", "forced", "forcing"] },
  { indicator: "shell", mode: "token", variants: ["shells"] },
  // "execute"/"execution" are request wording and stay refused; the past
  // participle "executed" is descriptive and is deliberately NOT a variant
  // (it is one of the four canonical harmless embedded-word cases).
  { indicator: "exec", mode: "token", variants: ["execute", "executes", "executing", "execution"] },
  { indicator: "spawn", mode: "token", variants: ["spawns", "spawned", "spawning"] },
];

const CAUTION_RULES: TextIndicatorRule[] = [
  { indicator: "deploy", mode: "token", variants: ["deploys", "deployed", "deploying", "deployment"] },
  { indicator: "network", mode: "token", variants: ["networks"] },
  { indicator: "download", mode: "token", variants: ["downloads", "downloaded", "downloading"] },
  { indicator: "external api", mode: "phrase" },
];

interface RuleFamily {
  ruleId: string;
  description: string;
  level: SafetyLevel;
  rules: TextIndicatorRule[];
}

const DEFAULT_FAMILIES: RuleFamily[] = [
  { ruleId: "forbidden-indicators", description: "Matches hard-forbidden keywords", level: "FORBIDDEN", rules: FORBIDDEN_RULES },
  { ruleId: "risky-indicators", description: "Matches risky-but-not-forbidden keywords", level: "RISKY", rules: RISKY_RULES },
  { ruleId: "caution-indicators", description: "Matches keywords worth extra caution", level: "CAUTION", rules: CAUTION_RULES },
];

export class SafetyGuard {
  private readonly families: RuleFamily[];

  constructor(customRules: SafetyRule[] = []) {
    // Custom rules keep their historical substring semantics: callers who
    // supply raw indicator strings get the broad matching they asked for.
    const customFamilies: RuleFamily[] = customRules.map((rule) => ({
      ruleId: rule.ruleId,
      description: rule.description,
      level: rule.level,
      rules: rule.indicators.map((indicator) => ({ indicator, mode: "substring" as const })),
    }));
    this.families = [...DEFAULT_FAMILIES, ...customFamilies];
  }

  evaluateText(text: string): SafetyDecision {
    const reasons: SafetyReason[] = [];
    let level: SafetyLevel = "SAFE";

    for (const family of this.families) {
      for (const match of matchTextIndicators(text, family.rules)) {
        reasons.push({
          code: family.ruleId,
          description: family.description,
          matchedIndicator: match.indicator,
        });
        level = escalate(level, family.level);
      }
    }

    return {
      level,
      reasons,
      allowed: level === "SAFE" || level === "CAUTION",
      evaluatedAt: new Date().toISOString(),
      evaluatedText: text,
    };
  }

  evaluatePlannedActionDescription(description: string): SafetyDecision {
    return this.evaluateText(description);
  }
}

function severityRank(level: SafetyLevel): number {
  switch (level) {
    case "SAFE":
      return 0;
    case "CAUTION":
      return 1;
    case "RISKY":
      return 2;
    case "FORBIDDEN":
      return 3;
  }
}

function escalate(current: SafetyLevel, candidate: SafetyLevel): SafetyLevel {
  return severityRank(candidate) > severityRank(current) ? candidate : current;
}
