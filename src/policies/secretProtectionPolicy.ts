/**
 * SecretProtectionPolicy provides a conservative check for secret-shaped
 * content. It is intentionally over-cautious in direction: false positives
 * (refusing something safe) are acceptable, false negatives (storing a
 * real secret) are not.
 *
 * AH2 Step 4E: matching goes through the canonical textIndicatorMatcher
 * with explicit modes instead of raw substring `includes`. Secret nouns
 * are lexical tokens with plural variants (so "secretive" or "tokenizer"
 * no longer trip them, while "my token", "the secrets file", and
 * "password:" still do); key phrases match across hyphens/underscores
 * ("private-key", "api_key"); ".env" is a path fragment (".env.local"
 * matches, ".environment" does not); and the PEM marker stays an
 * intentionally broad substring.
 *
 * This policy remains the single canonical protected-text check consumed
 * by ReceiptLog (summaries), ColonyMemory, PheromoneSafetyPolicy, the
 * inspector's filename gate, and MemoryAnt.
 */

import { containsTextIndicator, TextIndicatorRule } from "./textIndicatorMatcher";
// §37: the canonical structural + registered-value detector. Imported rather
// than reimplemented — safeRedactor stays the ONE source of structural truth,
// so a credential family is added in exactly one place and every consumer of
// this policy inherits it. No cycle: safeRedactor imports only
// safeWorkspacePath, which imports only `fs` and `path`.
import { containsSecretValue, stripRedactionMarkers } from "../cognitive/safeRedactor";

const SECRET_RULES: TextIndicatorRule[] = [
  { indicator: "secret", mode: "token", variants: ["secrets"] },
  { indicator: "token", mode: "token", variants: ["tokens"] },
  { indicator: "credential", mode: "token", variants: ["credentials"] },
  { indicator: "password", mode: "token", variants: ["passwords", "passphrase", "passphrases"] },
  { indicator: "apikey", mode: "token", variants: ["apikeys"] },
  { indicator: "private key", mode: "phrase" },
  { indicator: "api key", mode: "phrase" },
  { indicator: "authorization: bearer", mode: "phrase" },
  { indicator: ".env", mode: "path-fragment" },
  { indicator: "-----begin", mode: "substring" },
];

/**
 * True when `text` looks like a secret — by NAME or by VALUE (§37).
 *
 * Before S-7 this checked only the lexical rules above, which recognise secret
 * NOUNS. That left the more dangerous half open: a bare `ghp_…`, `sk-…`, AWS
 * key or JWT contains no secret noun at all, so every consumer of this policy —
 * ReceiptLog, ColonyMemory, PheromoneSafetyPolicy, MemoryAnt, the cognitive
 * validators — happily accepted a live credential while refusing the sentence
 * "the token expires".
 *
 * The value check is ADDED, not substituted. The noun rules are deliberately
 * over-inclusive and their false positives are a separate, later concern; the
 * two halves answer different questions and both are needed.
 */
export function looksLikeSecret(text: string): boolean {
  // Marker shielding applies to the LEXICAL half only, and reuses the canonical
  // helper rather than restating the marker set. A marker is what redaction
  // PRODUCES, so scanning it would make the pipeline refuse its own safe
  // output: `[REDACTED:GITHUB_TOKEN]` contains the lexical token "token" and
  // `[REDACTED:SECRET_VALUE]` contains "secret". Measured before this shielding,
  // 9 of the 14 markers returned true here.
  //
  // Shielding is not an exemption. Only the marker text itself is removed, so a
  // genuine noun ELSEWHERE in the string survives and still fires — pinned by
  // "the token expires [REDACTED:GITHUB_TOKEN]".
  const safeForLexicalScan = stripRedactionMarkers(text);

  // The VALUE half gets the RAW text. It strips markers internally through the
  // same helper, so stripping here first would be a second, redundant edit of
  // the input — and splicing text out before a structural scan is exactly how a
  // scanner ends up matching across a seam that never existed in the original.
  return containsTextIndicator(safeForLexicalScan, SECRET_RULES) || containsSecretValue(text);
}

export function assertNotSecret(text: string, context: string): void {
  if (looksLikeSecret(text)) {
    throw new Error(`SecretProtectionPolicy refused content in ${context}: looks like a secret.`);
  }
}
