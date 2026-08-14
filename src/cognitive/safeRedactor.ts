/**
 * safeRedactor — the ONE redaction boundary for untrusted provider-derived text.
 *
 * Every string that originates from a provider (summaries, findings, risks,
 * artifact purposes, failure text) MUST pass through `redactProviderText` before
 * it reaches a receipt, stage log, diagnostic, error summary, bundle metadata,
 * attempt/resume record, customer report, persisted manifest, or the terminal.
 *
 * Design rules:
 *   - The original matched secret is NEVER returned, persisted, hashed,
 *     fingerprinted, or logged. Matches are replaced by stable markers, and the
 *     `safeFingerprint` is computed over the REDACTED text only, so a digest can
 *     never become a side channel for the raw value.
 *   - Byte budgets are real UTF-8 bytes (`Buffer.byteLength`), and truncation
 *     happens on a valid UTF-8 boundary so multilingual text and emoji are never
 *     split into replacement characters.
 *   - Redaction runs BEFORE truncation, so a secret can never survive by sitting
 *     across the truncation point.
 *   - Ordinary source code is untouched unless it actually matches a secret
 *     pattern.
 *
 * No fs, no child_process, no network, no wall clock.
 */

import { truncateUtf8, utf8Bytes } from "./safeWorkspacePath";

export type RedactionCategory =
  | "OPENAI_KEY"
  | "GITHUB_TOKEN"
  | "BEARER_TOKEN"
  | "PRIVATE_KEY"
  | "AWS_KEY"
  | "COOKIE"
  | "OAUTH_TOKEN"
  // --- §36: provider credential families with a distinctive structural shape ---
  // Each has a vendor-assigned prefix that ordinary prose and source code do not
  // produce by accident, so they can be classified precisely instead of being
  // swallowed by the generic key=value rule (or, previously, missed entirely).
  | "STRIPE_KEY"
  | "SLACK_TOKEN"
  | "GOOGLE_API_KEY"
  | "NPM_TOKEN"
  | "GITLAB_TOKEN"
  // --- §37: JWT-shaped bearer credentials -----------------------------------
  // Added because the S-7 audit named JWTs explicitly and a measurement at the
  // previous commit showed `detectResidualSecrets` returned [] for a real JWT
  // shape. Without it the canonical value detector had a hole exactly where the
  // audit said it did.
  | "JWT"
  | "SECRET_VALUE";

export const REDACTION_MARKERS: Readonly<Record<RedactionCategory, string>> = {
  OPENAI_KEY: "[REDACTED:OPENAI_KEY]",
  GITHUB_TOKEN: "[REDACTED:GITHUB_TOKEN]",
  BEARER_TOKEN: "[REDACTED:BEARER_TOKEN]",
  PRIVATE_KEY: "[REDACTED:PRIVATE_KEY]",
  AWS_KEY: "[REDACTED:AWS_KEY]",
  COOKIE: "[REDACTED:COOKIE]",
  OAUTH_TOKEN: "[REDACTED:OAUTH_TOKEN]",
  STRIPE_KEY: "[REDACTED:STRIPE_KEY]",
  SLACK_TOKEN: "[REDACTED:SLACK_TOKEN]",
  GOOGLE_API_KEY: "[REDACTED:GOOGLE_API_KEY]",
  NPM_TOKEN: "[REDACTED:NPM_TOKEN]",
  GITLAB_TOKEN: "[REDACTED:GITLAB_TOKEN]",
  JWT: "[REDACTED:JWT]",
  SECRET_VALUE: "[REDACTED:SECRET_VALUE]",
};

/** Default byte budget for a redacted, persisted provider-derived field. */
export const DEFAULT_REDACTED_BYTE_CAP = 20000 as const;

interface RedactionRule {
  readonly category: RedactionCategory;
  readonly pattern: RegExp;
  /**
   * When set, only this capture group is replaced (the surrounding key name is
   * preserved so `api_key=<secret>` becomes `api_key=[REDACTED:SECRET_VALUE]`
   * rather than losing the field name that makes a diagnostic useful).
   */
  readonly valueGroup?: number;
}

/**
 * Ordered rules — the most specific first, so a PEM block or an `sk-` key is
 * classified precisely instead of being swallowed by a generic key=value rule.
 * Every pattern is global + multiline; `lastIndex` is reset before each use.
 */
const RULES: readonly RedactionRule[] = [
  // Multi-line PEM private key blocks (header through footer).
  { category: "PRIVATE_KEY", pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g },
  // Provider API keys.
  { category: "OPENAI_KEY", pattern: /\bsk-(?:proj-|ant-|live-)?[A-Za-z0-9_-]{16,}/g },
  { category: "GITHUB_TOKEN", pattern: /\b(?:ghp_|gho_|ghu_|ghs_|ghr_)[A-Za-z0-9]{16,}\b/g },
  { category: "GITHUB_TOKEN", pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  // --- §36: vendor-prefixed credential families -----------------------------
  // Placed here, BEFORE the generic key=value rule, so `stripe_key=sk_live_...`
  // is reported as STRIPE_KEY rather than the vague SECRET_VALUE. Each pattern
  // is anchored on a vendor prefix AND a minimum body length, because the
  // prefix alone (`npm_`, `glpat-`) appears in ordinary prose and identifiers.
  //
  // NO LEADING \b, deliberately. Untrusted provider text could otherwise evade
  // redaction by gluing a credential to a preceding word character
  // (`prefixsk_live_REALKEY`), since `\b` requires a non-word character before
  // the prefix. The body-length requirement is what keeps false positives away,
  // not the word boundary. A truncation-boundary test proves no fragment leaks.
  //
  // Stripe: `sk_live_`/`sk_test_` secret keys and `rk_live_`/`rk_test_`
  // restricted keys. Note this is UNDERSCORE `sk_`, which the OpenAI rule
  // (hyphenated `sk-`) never matched.
  { category: "STRIPE_KEY", pattern: /[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/g },
  // Slack bot/user/app/refresh tokens. The `xox<letter>-` prefix is distinctive
  // and the body is digit- and hyphen-separated.
  { category: "SLACK_TOKEN", pattern: /xox[baprse]-[A-Za-z0-9-]{12,}/g },
  // Google API keys: the fixed `AIza` prefix plus exactly 35 more characters.
  // Length is exact rather than a minimum, which is what keeps it off ordinary
  // base64-looking text. No overlap with the AWS rule, whose prefixes are all
  // uppercase (`AIDA` != `AIza`).
  { category: "GOOGLE_API_KEY", pattern: /AIza[A-Za-z0-9_-]{35}/g },
  // npm automation/access tokens: `npm_` plus a 36-character body. Written as a
  // MINIMUM rather than an exact length so a longer future token is still
  // caught; 36 alphanumerics after the prefix is already far beyond anything
  // ordinary prose or an identifier produces.
  { category: "NPM_TOKEN", pattern: /npm_[A-Za-z0-9]{36,}/g },
  // GitLab personal/deploy/runner/OAuth tokens. Prefix list is explicit rather
  // than a wildcard so unrelated `gl`-prefixed identifiers are untouched.
  { category: "GITLAB_TOKEN", pattern: /(?:glpat|gldt|glrt|glsoat|glptt|glcbt|glimt|glagent|glffct)-[A-Za-z0-9_-]{16,}/g },
  // JWT-shaped bearer credentials (§37). Anchored on the ONE thing that makes a
  // JWT recognisable rather than on "three dot-separated words": the header
  // segment is base64url of a JSON object, so it always begins `eyJ`. All three
  // segments are required, each with a real body length, which is what keeps
  // this off `a.b.c`, `version 1.2.3`, `file.name.ext` and ISO timestamps.
  //
  // A JWT payload is only base64, not encrypted — anything inside it is
  // readable — so a leaked one is a live bearer credential, not an opaque id.
  { category: "JWT", pattern: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  // AWS access key ids and secret access keys.
  { category: "AWS_KEY", pattern: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA)[A-Z0-9]{12,}\b/g },
  { category: "AWS_KEY", pattern: /\b(aws_secret_access_key|aws_session_token)\s*[:=]\s*["']?([A-Za-z0-9/+=_-]{16,})["']?/gi, valueGroup: 2 },
  // Authorization headers and bearer tokens.
  { category: "BEARER_TOKEN", pattern: /\b(Authorization)\s*[:=]\s*["']?((?:Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,})["']?/gi, valueGroup: 2 },
  { category: "BEARER_TOKEN", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g },
  // OAuth access / refresh tokens (explicitly named).
  { category: "OAUTH_TOKEN", pattern: /\b(access_token|refresh_token|id_token|oauth_token)\s*["']?\s*[:=]\s*["']?([A-Za-z0-9._~+/=-]{8,})["']?/gi, valueGroup: 2 },
  // Cookies and sessions.
  { category: "COOKIE", pattern: /\b(Cookie|Set-Cookie)\s*[:=]\s*([^\r\n]{4,})/gi, valueGroup: 2 },
  { category: "COOKIE", pattern: /\b(session|sessionid|session_id|sid)\s*["']?\s*[:=]\s*["']?([A-Za-z0-9._~+/=-]{6,})["']?/gi, valueGroup: 2 },
  // Generic named secrets: api_key / api-key / password / secret / token.
  { category: "SECRET_VALUE", pattern: /\b(api[_-]?key|apikey|password|passwd|pwd|secret|client_secret|token|auth[_-]?token)\s*["']?\s*[:=]\s*["']?([^\s"',;}\]]{4,})["']?/gi, valueGroup: 2 },
];

export interface RedactionResult {
  readonly redactedText: string;
  readonly redactionCount: number;
  readonly redactionCategories: readonly RedactionCategory[];
  readonly acceptedBytes: number;
  readonly rejectedBytes: number;
  readonly truncated: boolean;
  readonly safeFingerprint: string;
}

/** FNV-1a over the REDACTED text only — never over raw input. */
function safeDigest(redacted: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < redacted.length; i += 1) {
    h ^= redacted.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `sr-${h.toString(16).padStart(8, "0")}-${utf8Bytes(redacted)}`;
}

/** A marker (or a marker fragment) is already-redacted text — never re-redact it. */
const MARKER_PREFIX = "[REDACTED:";
function isAlreadyRedacted(value: string): boolean {
  return value.includes(MARKER_PREFIX);
}

/** Escape a literal environment-secret value for use inside a RegExp. */
function escapeLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Process-wide environment-secret values. The composition root registers the
 * live values ONCE, so every downstream call site (`redactedText`, `redactList`,
 * `redactMeta`, `safeErrorSummary`) scrubs them without having to plumb the list
 * through. Deliberately module-private with no getter: the registry can only be
 * written to and consumed internally, never read back out or serialized.
 */
const registeredEnvironmentSecrets = new Set<string>();

/** Register exact environment-secret VALUES to scrub from all redacted output. */
export function registerEnvironmentSecrets(values: readonly (string | undefined)[]): void {
  for (const v of values) {
    if (typeof v === "string" && v.length >= 4) registeredEnvironmentSecrets.add(v);
  }
}

/** Clear the registry (test hygiene only — production registers once at startup). */
export function clearRegisteredEnvironmentSecrets(): void {
  registeredEnvironmentSecrets.clear();
}

/**
 * Does `text` contain a registered environment-secret value? A PREDICATE, not a
 * getter: the outbound boundary (§26) needs to fail closed on a literal
 * credential that matches no structural pattern, and this answers that question
 * without ever exposing, returning, or digesting the registered values.
 */
export function containsRegisteredEnvironmentSecret(text: string): boolean {
  for (const secret of registeredEnvironmentSecrets) {
    if (text.includes(secret)) return true;
  }
  return false;
}

export interface RedactOptions {
  /** Real UTF-8 byte cap applied AFTER redaction. */
  readonly maxBytes?: number;
  /**
   * Exact environment-secret VALUES to scrub literally (e.g. the value of
   * OPENAI_API_KEY). Only the values are used; they are never stored, echoed,
   * or included in any output field.
   */
  readonly environmentSecrets?: readonly string[];
}

/**
 * Redact, then bound, then fingerprint. This is the ONLY function that may
 * prepare provider-derived text for a receipt, log, or persisted record.
 */
export function redactProviderText(input: string, options: RedactOptions = {}): RedactionResult {
  const maxBytes = options.maxBytes ?? DEFAULT_REDACTED_BYTE_CAP;
  const originalBytes = utf8Bytes(input);
  let text = input;
  let count = 0;
  const categories = new Set<RedactionCategory>();

  // 1. Explicit environment secrets first (registered + per-call): an exact
  //    value must never survive, even if it matches no structural pattern.
  for (const secret of [...registeredEnvironmentSecrets, ...(options.environmentSecrets ?? [])]) {
    if (typeof secret !== "string" || secret.length < 4) continue; // ignore trivia
    const literal = new RegExp(escapeLiteral(secret), "g");
    text = text.replace(literal, () => {
      count += 1;
      categories.add("SECRET_VALUE");
      return REDACTION_MARKERS.SECRET_VALUE;
    });
  }

  // 2. Structural patterns, most specific first.
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    text = text.replace(rule.pattern, (match, ...groups) => {
      const marker = REDACTION_MARKERS[rule.category];
      const value = rule.valueGroup === undefined ? undefined : (groups[rule.valueGroup - 1] as string | undefined);
      // A later, more generic rule must not re-redact an earlier rule's marker:
      // that would double-count and mangle `"token":"[REDACTED:GITHUB_TOKEN]"`.
      if (isAlreadyRedacted(value ?? match)) return match;
      count += 1;
      categories.add(rule.category);
      if (rule.valueGroup === undefined) return marker;
      // Preserve the field name AND anything after the value (a closing quote,
      // a brace) so structured text such as JSON stays well-formed.
      if (typeof value !== "string" || value.length === 0) return marker;
      const idx = match.lastIndexOf(value);
      return idx < 0 ? marker : match.slice(0, idx) + marker + match.slice(idx + value.length);
    });
  }

  // 3. Bound in real UTF-8 bytes AFTER redaction, on a valid boundary.
  const bounded = truncateUtf8(text, maxBytes);

  return {
    redactedText: bounded.text,
    redactionCount: count,
    redactionCategories: [...categories].sort(),
    acceptedBytes: bounded.acceptedBytes,
    rejectedBytes: bounded.truncated ? bounded.rejectedBytes : Math.max(0, originalBytes - utf8Bytes(text)),
    truncated: bounded.truncated,
    safeFingerprint: safeDigest(bounded.text),
  };
}

/** Convenience: redact and return only the safe string (the common call site). */
export function redactedText(input: string, maxBytes: number = DEFAULT_REDACTED_BYTE_CAP): string {
  return redactProviderText(input, { maxBytes }).redactedText;
}

/** Redact every string in a bounded list (findings, risks, test suggestions). */
export function redactList(values: readonly string[], maxBytesEach: number = DEFAULT_REDACTED_BYTE_CAP): string[] {
  return values.map((v) => redactedText(v, maxBytesEach));
}

/**
 * Redact the safe scalar metadata of a stage log / receipt. Numbers and booleans
 * pass through untouched; every string value is redacted.
 */
export function redactMeta(meta: Record<string, string | number | boolean>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(meta)) {
    out[k] = typeof v === "string" ? redactedText(v, 2000) : v;
  }
  return out;
}

/**
 * Build a SAFE error summary from an unknown thrown value: the error NAME and a
 * redacted, bounded message only — never a stack trace, path, or raw payload.
 */
export function safeErrorSummary(error: unknown, maxBytes = 500): { readonly name: string; readonly safeMessage: string; readonly safeFingerprint: string } {
  const name = error instanceof Error ? error.name : "unknown";
  const raw = error instanceof Error ? error.message : "";
  const r = redactProviderText(raw, { maxBytes });
  return { name, safeMessage: r.redactedText, safeFingerprint: r.safeFingerprint };
}

/**
 * Remove every redaction marker from `text` (§37).
 *
 * THE canonical marker-stripping helper. A marker is SAFE output — it is what
 * redaction produces — but it embeds a category label such as `GITHUB_TOKEN`
 * or `SECRET_VALUE`. Any scanner that looks at markers therefore risks
 * reporting its own output as a finding: a `key=value` rule re-matches the
 * marker as a value, and a lexical noun rule sees the word "token" inside it.
 *
 * Both scanners strip through this one function so the marker set is defined
 * in exactly one place and cannot drift apart.
 */
export function stripRedactionMarkers(text: string): string {
  return Object.values(REDACTION_MARKERS).reduce((acc, marker) => acc.split(marker).join(""), text);
}

/**
 * THE canonical "does this text contain an actual secret VALUE?" predicate
 * (§37).
 *
 * It answers a different question from the lexical secret-noun policy, and the
 * distinction is the whole point of S-7: "the token expires" contains a secret
 * NOUN and no secret, while a bare `ghp_…` contains a secret and no noun. The
 * noun rules stay where they are; this covers the half they never could.
 *
 * Both sources of structural truth are combined so callers cannot accidentally
 * consult only one:
 *
 *   1. the ordered RULES above — every vendor and generic credential family
 *      this boundary recognises, markers stripped first so already-redacted
 *      output is not re-reported as a raw leak;
 *   2. the S-4 exact-value registry — a live credential that matches no
 *      pattern at all, which is precisely why that registry exists.
 *
 * Deliberately a BOOLEAN. It never returns the matched text, the category, an
 * offset, a length, or a digest, so no caller can turn it into a side channel
 * for the value it just refused.
 */
export function containsSecretValue(text: string): boolean {
  if (typeof text !== "string" || text.length === 0) return false;
  return detectResidualSecrets(text).length > 0 || containsRegisteredEnvironmentSecret(text);
}

/**
 * Assert (for tests and fail-closed call sites) that a serialized record carries
 * no residual raw secret. Returns the categories that still match, if any.
 */
export function detectResidualSecrets(serialized: string): readonly RedactionCategory[] {
  // Strip the markers first: `Cookie: [REDACTED:COOKIE]` is CORRECTLY redacted,
  // but a key=value rule would otherwise re-match the marker as the value and
  // report a false leak. Only genuinely un-redacted text is scanned.
  const withoutMarkers = stripRedactionMarkers(serialized);
  const found = new Set<RedactionCategory>();
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(withoutMarkers)) found.add(rule.category);
  }
  return [...found].sort();
}
