/**
 * safeProviderRequest — the ONE outbound boundary for provider requests.
 *
 * `safeRedactor` (§25) stops secrets on the way IN, from provider output into
 * receipts and persistence. This module stops them on the way OUT: nothing
 * reaches a provider CLI's argv, stdin, child environment, or a request
 * manifest without passing through `buildSafeProviderRequest`.
 *
 * The asymmetry with §25 is deliberate and is the core design decision here:
 *
 *   - INBOUND, redaction is the right answer. A provider that echoes a secret
 *     back has already been shown it; scrubbing the receipt is all that is left.
 *   - OUTBOUND, redaction is NOT enough. If an assembled prompt contains a live
 *     credential, the safe act is to NOT SEND IT AT ALL. Redacting and
 *     continuing would still transmit the surrounding context that a credential
 *     was found in, and it would silently normalize a caller bug that is
 *     leaking real authentication material into prompt assembly.
 *
 * So high-confidence authentication material FAILS CLOSED
 * (`provider-request-secret-blocked`, no spawn, driver never invoked), while
 * lower-risk *secret-shaped* text (an entropy blob, a UUID — often a hash, a
 * fixture, or a data URI rather than a credential) is redacted and sent with a
 * safe receipt.
 *
 * Argv and the child environment are constructed here, never by a caller and
 * never from mission text: a fixed executable map, fixed flag templates, and a
 * NAME allowlist filtered by a forbidden-name pattern. Environment VALUES are
 * read by explicit key and are never enumerated, logged, or fingerprinted.
 *
 * No fs, no child_process, no network, no wall clock.
 */

import type { ProviderExecutableId, ProviderProcessSpec } from "./providerProcessDriver";
import { redactProviderText, detectResidualSecrets, containsRegisteredEnvironmentSecret, type RedactionCategory } from "./safeRedactor";
import { truncateUtf8, utf8Bytes } from "./safeWorkspacePath";

export const REQUEST_SCHEMA_VERSION = "safe-provider-request-v1" as const;

/** Real UTF-8 byte budgets for every outbound surface. */
export const MAX_PROMPT_BYTES = 60000 as const;
export const MAX_ARGV_FIELD_BYTES = 60000 as const;
export const MAX_STDIN_BYTES = 60000 as const;
export const MAX_MANIFEST_FIELD_BYTES = 2000 as const;
export const MAX_CONTEXT_SECTIONS = 64 as const;

export type ProviderRequestReasonCode =
  | "ok"
  | "provider-request-secret-blocked"
  | "unknown-executable"
  | "empty-prompt"
  | "forbidden-environment-name";

/**
 * High-confidence authentication material. Every one of these is a credential
 * that a correct caller never has any reason to put in a prompt, so any hit
 * blocks the whole request rather than being redacted away.
 */
const BLOCKING_CATEGORIES: ReadonlySet<RedactionCategory> = new Set<RedactionCategory>([
  "OPENAI_KEY",
  "GITHUB_TOKEN",
  "BEARER_TOKEN",
  "PRIVATE_KEY",
  "AWS_KEY",
  "COOKIE",
  "OAUTH_TOKEN",
  // §36: the vendor-prefixed families are authentication material too, so they
  // block the outbound request rather than being redacted and sent.
  "STRIPE_KEY",
  "SLACK_TOKEN",
  "GOOGLE_API_KEY",
  "NPM_TOKEN",
  "GITLAB_TOKEN",
  "SECRET_VALUE",
]);

/** SSH private material that is not a PEM block (OpenSSH keys, agent sockets). */
const SSH_PRIVATE_MATERIAL = /(-----BEGIN OPENSSH PRIVATE KEY-----|\bssh-rsa\s+AAAA[A-Za-z0-9+/=]{32,}|\bPuTTY-User-Key-File-\d)/;

/**
 * Lower-risk, secret-SHAPED text. These fire on things that merely look like
 * credentials — a long base64/hex blob (often a hash or an embedded asset) or a
 * UUID. They are redacted, not blocked, because blocking them would reject
 * ordinary legitimate prompts. Deliberately narrow so real source code is not
 * touched: a blob must be unbroken and long.
 */
const LOW_RISK_RULES: readonly { readonly marker: string; readonly pattern: RegExp }[] = [
  { marker: "[REDACTED:ENTROPY]", pattern: /\b[A-Za-z0-9+/]{48,}={0,2}\b/g },
  { marker: "[REDACTED:ENTROPY]", pattern: /\b[0-9a-fA-F]{48,}\b/g },
  { marker: "[REDACTED:UUID]", pattern: /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g },
];

/** The only executables that may ever run. Never a path, never mission text. */
const REQUEST_EXECUTABLE_MAP: Readonly<Record<ProviderExecutableId, string>> = { claude: "claude", codex: "codex" };

/**
 * Fixed flag templates. The executable and EVERY flag are hard-coded. Codex
 * takes the bounded prompt as its single final POSITIONAL argument; with
 * `shell: false` a positional argv entry can never be reinterpreted as a flag.
 */
// `--disallowedTools` is a SECURITY flag. Namla curates exactly what a provider
// may see: prompt sections are assembled here, high-confidence credentials fail
// closed, and file information is passed as summaries rather than contents. A
// provider that reads its own context off disk bypasses that curation entirely —
// the bytes never pass through this module, and nothing in the parsed provider
// payload records the access. The shell names are denied for the stronger
// reason: Build Law says a provider "never writes files, runs commands" and
// "receives no generic run-tool capability", yet the child inherits the real
// user settings (HOME is necessarily forwarded so the CLI can find its own
// credentials), so an ordinary permission rule added there could otherwise
// influence the permission decision. The deny list is stated at the fixed argv
// layer, where mission text cannot reach it, so Namla states this boundary
// independently of ambient settings.
// The mutation names are denied on the strength of the SAME Build Law sentence,
// whose first clause is about writing: a provider "never writes files". The parsed
// provider payload's file operations are applied by Namla's own workspace writer, so
// provider generation never needs a native write tool for the product to work.
// Denying them states that half of the invariant at the same fixed argv layer where
// the read and shell halves are already stated. Until now it was not stated there at
// all: Codex's `--sandbox read-only` governs model-generated shell commands rather
// than a native tool set, so no existing flag carried the write clause. It rested on
// host-CLI behaviour that Namla does not own, does not state, and does not test.
// Scope: this removes these tool NAMES from the provider-generation session; it
// is not a claim that no file is reachable or writable and no command can run by
// any other mechanism, and it is not OS-level process isolation.
// Installed 2.1.237: `--disallowedTools <tools...>`, comma or space separated;
// canonical identifiers verified against the shipped tool catalog.
const CLAUDE_FLAGS: readonly string[] = ["--print", "--output-format", "json", "--disallowedTools", "Read,Glob,Grep,Bash,PowerShell,Write,Edit,MultiEdit,NotebookEdit"];
// `--ignore-user-config` and `--sandbox read-only` are SECURITY flags, not
// ergonomics. The Codex provider process runs directly on the host, outside the
// verification container, so its authority would otherwise be whatever the CLI
// default resolves to plus whatever `$CODEX_HOME/config.toml` happens to
// declare — including MCP servers, which Codex starts during exec startup as
// host processes that no sandbox mode constrains (`--sandbox` governs
// model-generated shell commands only). Namla states the boundary instead of
// inheriting it. Auth still resolves through CODEX_HOME.
const CODEX_FLAGS: readonly string[] = ["exec", "--ephemeral", "--json", "--ignore-user-config", "--sandbox", "read-only"];

/** Environment variable NAMES never forwarded to a child, whatever the allowlist says. */
export const FORBIDDEN_ENV_NAME_PATTERN = /(TOKEN|SECRET|PASSWORD|COOKIE|SESSION|PRIVATE_?KEY|API_?KEY|CREDENTIAL|AUTH|\bKEY\b|PRIVATE)/i;

/** The minimal NAME allowlist a provider CLI needs to resolve and run. */
export const ALLOWED_ENV_NAMES: readonly string[] = ["PATH", "Path", "HOME", "USERPROFILE", "SystemRoot", "SYSTEMROOT", "windir", "TEMP", "TMP", "LANG", "LC_ALL", "APPDATA", "LOCALAPPDATA"];

/**
 * Build the child environment: allowlisted NAMES only, minus anything matching
 * the forbidden pattern. `process.env` is read by explicit key and is NEVER
 * enumerated, so a credential variable cannot be forwarded by accident. Values
 * are never logged, fingerprinted, or returned in a receipt.
 */
export function buildSafeChildEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of ALLOWED_ENV_NAMES) {
    if (FORBIDDEN_ENV_NAME_PATTERN.test(name)) continue;
    const value = source[name];
    if (typeof value === "string") env[name] = value;
  }
  return env;
}

/** Names the caller asked to forward that must be refused. Names only — never values. */
export function rejectedEnvNames(requestedNames: readonly string[]): readonly string[] {
  return requestedNames.filter((n) => FORBIDDEN_ENV_NAME_PATTERN.test(n) || !ALLOWED_ENV_NAMES.includes(n));
}

/** A safe, persistable receipt of ONE outbound request. No prompt, no secret, no env value. */
export interface ProviderRequestReceipt {
  readonly requestId: string;
  readonly providerId: ProviderExecutableId;
  readonly role: string;
  readonly acceptedBytes: number;
  readonly rejectedBytes: number;
  readonly redactionCount: number;
  readonly redactionCategories: readonly string[];
  readonly blocked: boolean;
  readonly safeReasonCode: ProviderRequestReasonCode;
  readonly safeFingerprint: string;
}

export interface ProviderRequestInput {
  readonly requestId: string;
  readonly providerId: ProviderExecutableId;
  readonly role: string;
  /** Provider-derived / mission-derived text sections, all untrusted. */
  readonly objective: string;
  readonly promptBody: string;
  readonly contextExcerpts?: readonly string[];
  readonly fileSummaries?: readonly string[];
  readonly evidenceExcerpts?: readonly string[];
  /** Extra env NAMES the caller wants forwarded (still allowlist-filtered). */
  readonly requestedEnvNames?: readonly string[];
  readonly workingDirectoryAbsolute: string;
  readonly timeoutMs: number;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
  readonly maxPromptBytes?: number;
}

export type SafeProviderRequest =
  | { readonly ok: true; readonly spec: ProviderProcessSpec; readonly env: Record<string, string>; readonly receipt: ProviderRequestReceipt }
  | { readonly ok: false; readonly spec: null; readonly env: null; readonly receipt: ProviderRequestReceipt };

/** Apply the lower-risk shaped-text rules. Returns the text and how many fired. */
function redactLowRisk(text: string): { readonly text: string; readonly count: number; readonly markers: readonly string[] } {
  let out = text;
  let count = 0;
  const markers = new Set<string>();
  for (const rule of LOW_RISK_RULES) {
    rule.pattern.lastIndex = 0;
    out = out.replace(rule.pattern, (match) => {
      if (match.includes("[REDACTED:")) return match;
      count += 1;
      markers.add(rule.marker);
      return rule.marker;
    });
  }
  return { text: out, count, markers: [...markers].sort() };
}

function receipt(input: ProviderRequestInput, fields: { blocked: boolean; safeReasonCode: ProviderRequestReasonCode; acceptedBytes: number; rejectedBytes: number; redactionCount: number; redactionCategories: readonly string[]; safeFingerprint: string }): ProviderRequestReceipt {
  return { requestId: input.requestId, providerId: input.providerId, role: input.role, ...fields };
}

/**
 * The ONE outbound request boundary. Assembles, inspects, and bounds every
 * provider-facing surface, then either returns a ready-to-run spec or a blocked
 * receipt. A blocked result carries `spec: null`, so a caller structurally
 * cannot hand it to a driver.
 */
export function buildSafeProviderRequest(input: ProviderRequestInput): SafeProviderRequest {
  const maxPromptBytes = input.maxPromptBytes ?? MAX_PROMPT_BYTES;

  // Unknown executable: refuse before assembling anything.
  const executable = REQUEST_EXECUTABLE_MAP[input.providerId];
  if (executable !== "claude" && executable !== "codex") {
    return { ok: false, spec: null, env: null, receipt: receipt(input, { blocked: true, safeReasonCode: "unknown-executable", acceptedBytes: 0, rejectedBytes: 0, redactionCount: 0, redactionCategories: [], safeFingerprint: "spr-blocked" }) };
  }

  // A caller asking to forward a credential-shaped env NAME is a bug, not a
  // request to sanitize: refuse it rather than silently dropping the name.
  const badEnvNames = rejectedEnvNames(input.requestedEnvNames ?? []);
  if (badEnvNames.length > 0) {
    return { ok: false, spec: null, env: null, receipt: receipt(input, { blocked: true, safeReasonCode: "forbidden-environment-name", acceptedBytes: 0, rejectedBytes: 0, redactionCount: 0, redactionCategories: [], safeFingerprint: "spr-blocked" }) };
  }

  // Assemble every untrusted section into the text that would actually be sent.
  const sections: string[] = [input.objective, ...(input.contextExcerpts ?? []).slice(0, MAX_CONTEXT_SECTIONS), ...(input.fileSummaries ?? []).slice(0, MAX_CONTEXT_SECTIONS), ...(input.evidenceExcerpts ?? []).slice(0, MAX_CONTEXT_SECTIONS), input.promptBody];
  const assembled = sections.filter((s) => typeof s === "string" && s.length > 0).join("\n\n");

  if (assembled.trim().length === 0) {
    return { ok: false, spec: null, env: null, receipt: receipt(input, { blocked: true, safeReasonCode: "empty-prompt", acceptedBytes: 0, rejectedBytes: 0, redactionCount: 0, redactionCategories: [], safeFingerprint: "spr-blocked" }) };
  }

  // FAIL CLOSED on high-confidence authentication material. `detectResidualSecrets`
  // runs the same rule set as the inbound kernel, so there is exactly one
  // definition of "this is a credential" in the codebase.
  const found = detectResidualSecrets(assembled);
  const blocking = found.filter((c) => BLOCKING_CATEGORIES.has(c));
  const sshMaterial = SSH_PRIVATE_MATERIAL.test(assembled);
  // A registered environment-secret VALUE matches no structural pattern, so the
  // rule set alone cannot see it. Ask the kernel's predicate instead — it
  // answers yes/no without ever exposing the registered values.
  const envSecret = containsRegisteredEnvironmentSecret(assembled);
  if (blocking.length > 0 || sshMaterial || envSecret) {
    // The receipt names the CATEGORIES only — never the matched value, never a
    // digest of it, and never the surrounding prompt text.
    const extra: string[] = [];
    if (sshMaterial) extra.push("SSH_PRIVATE_MATERIAL");
    if (envSecret) extra.push("ENVIRONMENT_SECRET");
    const categories = [...new Set<string>([...blocking, ...extra])].sort();
    return { ok: false, spec: null, env: null, receipt: receipt(input, { blocked: true, safeReasonCode: "provider-request-secret-blocked", acceptedBytes: 0, rejectedBytes: utf8Bytes(assembled), redactionCount: 0, redactionCategories: categories, safeFingerprint: "spr-blocked" }) };
  }

  // Nothing high-risk. Redact lower-risk shaped text, then run the inbound
  // kernel too as defense in depth (idempotent; it should find nothing left).
  const low = redactLowRisk(assembled);
  const kernel = redactProviderText(low.text, { maxBytes: maxPromptBytes });

  // Bound EVERY outbound surface in real UTF-8 bytes on a valid boundary.
  const promptBound = truncateUtf8(kernel.redactedText, maxPromptBytes);
  const isCodex = input.providerId === "codex";
  const argvPrompt = isCodex ? truncateUtf8(promptBound.text, MAX_ARGV_FIELD_BYTES).text : "";
  const stdinData = isCodex ? "" : truncateUtf8(promptBound.text, MAX_STDIN_BYTES).text;

  const categories = [...new Set([...kernel.redactionCategories, ...low.markers])].sort();
  const spec: ProviderProcessSpec = {
    executableId: input.providerId,
    argumentList: isCodex ? [...CODEX_FLAGS, argvPrompt] : [...CLAUDE_FLAGS],
    stdinData,
    maxStdinBytes: MAX_STDIN_BYTES,
    maxStdoutBytes: input.maxStdoutBytes,
    maxStderrBytes: input.maxStderrBytes,
    timeoutMs: input.timeoutMs,
    workingDirectoryAbsolute: input.workingDirectoryAbsolute,
  };

  return {
    ok: true,
    spec,
    env: buildSafeChildEnv(),
    receipt: receipt(input, {
      blocked: false,
      safeReasonCode: "ok",
      acceptedBytes: promptBound.acceptedBytes,
      rejectedBytes: utf8Bytes(assembled) - promptBound.acceptedBytes,
      redactionCount: kernel.redactionCount + low.count,
      redactionCategories: categories,
      // Computed over the REDACTED, bounded prompt only — never the raw input.
      safeFingerprint: redactProviderText(promptBound.text, { maxBytes: maxPromptBytes }).safeFingerprint,
    }),
  };
}

/** A request manifest carries receipt fields ONLY — never prompt, argv, or env. */
export function buildRequestManifest(receipts: readonly ProviderRequestReceipt[]): string {
  return JSON.stringify({
    schemaVersion: REQUEST_SCHEMA_VERSION,
    requests: receipts.map((r) => ({
      requestId: truncateUtf8(r.requestId, MAX_MANIFEST_FIELD_BYTES).text,
      providerId: r.providerId,
      role: truncateUtf8(r.role, MAX_MANIFEST_FIELD_BYTES).text,
      acceptedBytes: r.acceptedBytes,
      rejectedBytes: r.rejectedBytes,
      redactionCount: r.redactionCount,
      redactionCategories: r.redactionCategories,
      blocked: r.blocked,
      safeReasonCode: r.safeReasonCode,
      safeFingerprint: r.safeFingerprint,
    })),
  });
}
