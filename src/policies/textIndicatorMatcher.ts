/**
 * textIndicatorMatcher: the canonical low-level indicator matcher for
 * Namla Pro's safety text checks (Architecture Hardening 2 Step 4E).
 *
 * Before this module, canonical policies matched indicators with raw
 * substring `includes`, which refused harmless embedded words:
 * "information" (contains "format"), "reinforcement" ("force"),
 * "executed" ("exec"), "author" ("auth"). This matcher makes match
 * semantics explicit per rule, so short indicators use lexical token
 * boundaries while commands, phrases, path fragments, and structured
 * markers keep the semantics they actually need.
 *
 * Modes:
 * - "exact":         the whole (trimmed, lowercased) text equals the
 *                    indicator.
 * - "token":         the indicator (or a listed variant) appears as a
 *                    whole lexical token. Tokens are maximal runs of
 *                    [a-z0-9] after lowercasing; punctuation, hyphens,
 *                    slashes, and whitespace are boundaries — so "exec:",
 *                    "EXEC", "auth-request", "force --flag" match their
 *                    tokens, while "executed", "author", "reinforcement",
 *                    "information" do not.
 * - "phrase":        the indicator's words appear as consecutive tokens
 *                    ("private key" also matches "private-key" and
 *                    "private_key"; "authorization bearer" also matches
 *                    "authorization: bearer").
 * - "command":       raw case-insensitive substring of a command spelling
 *                    that carries its own punctuation ("rm -rf",
 *                    "del /s") — precise because of that punctuation.
 * - "path-fragment": substring with lexical edges: where the fragment's
 *                    own edge is alphanumeric, the neighboring character
 *                    in the text must not be. ".env" matches ".env",
 *                    ".env.local", "config/.env", but not ".environment".
 * - "substring":     raw substring; only for structured markers where
 *                    breadth is the point ("-----begin").
 *
 * Pure and deterministic: no fs, no process, no network, no timers, no
 * mutation, and no regular expressions at all — matching is plain string
 * scanning, so untrusted input can neither inject patterns nor trigger
 * catastrophic backtracking.
 */

export type IndicatorMatchMode =
  | "exact"
  | "token"
  | "phrase"
  | "command"
  | "path-fragment"
  | "substring";

export interface TextIndicatorRule {
  /** Canonical indicator name, reported on match. */
  indicator: string;
  mode: IndicatorMatchMode;
  /** token mode only: inflected forms that also count as this indicator. */
  variants?: string[];
}

export interface TextIndicatorMatch {
  indicator: string;
  mode: IndicatorMatchMode;
}

function isAlphaNumeric(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  return (ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9");
}

/** Maximal [a-z0-9] runs of the lowercased text. */
function tokenize(lowered: string): string[] {
  const tokens: string[] = [];
  let current = "";
  for (const ch of lowered) {
    if (isAlphaNumeric(ch)) {
      current += ch;
    } else if (current.length > 0) {
      tokens.push(current);
      current = "";
    }
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

function phraseMatches(tokens: string[], words: string[]): boolean {
  if (words.length === 0) return false;
  outer: for (let i = 0; i + words.length <= tokens.length; i += 1) {
    for (let j = 0; j < words.length; j += 1) {
      if (tokens[i + j] !== words[j]) continue outer;
    }
    return true;
  }
  return false;
}

function pathFragmentMatches(lowered: string, fragment: string): boolean {
  const leftEdgeAlnum = isAlphaNumeric(fragment[0]);
  const rightEdgeAlnum = isAlphaNumeric(fragment[fragment.length - 1]);

  let from = 0;
  while (true) {
    const at = lowered.indexOf(fragment, from);
    if (at === -1) return false;
    const before = at > 0 ? lowered[at - 1] : undefined;
    const after = lowered[at + fragment.length];
    const leftOk = !leftEdgeAlnum || !isAlphaNumeric(before);
    const rightOk = !rightEdgeAlnum || !isAlphaNumeric(after);
    if (leftOk && rightOk) return true;
    from = at + 1;
  }
}

export function matchTextIndicators(text: string, rules: TextIndicatorRule[]): TextIndicatorMatch[] {
  const lowered = text.toLowerCase();
  const tokens = tokenize(lowered);
  const tokenSet = new Set(tokens);
  const matches: TextIndicatorMatch[] = [];

  for (const rule of rules) {
    const indicator = rule.indicator.toLowerCase();
    let matched = false;

    switch (rule.mode) {
      case "exact":
        matched = lowered.trim() === indicator;
        break;
      case "token": {
        matched = tokenSet.has(indicator);
        if (!matched && rule.variants) {
          matched = rule.variants.some((variant) => tokenSet.has(variant.toLowerCase()));
        }
        break;
      }
      case "phrase":
        matched = phraseMatches(tokens, tokenize(indicator));
        break;
      case "command":
      case "substring":
        matched = lowered.includes(indicator);
        break;
      case "path-fragment":
        matched = pathFragmentMatches(lowered, indicator);
        break;
    }

    if (matched) matches.push({ indicator: rule.indicator, mode: rule.mode });
  }

  return matches;
}

export function containsTextIndicator(text: string, rules: TextIndicatorRule[]): boolean {
  return matchTextIndicators(text, rules).length > 0;
}
