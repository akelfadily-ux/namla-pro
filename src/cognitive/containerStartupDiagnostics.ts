/**
 * containerStartupDiagnostics — tells apart the nine ways a container run can
 * produce no usable probe output.
 *
 * The backend previously collapsed every empty-stdout condition into
 * "probe produced no output". That is true and useless: a rejected Docker flag,
 * a bind mount that does not exist, a missing executable, a read-only
 * filesystem, a timeout kill, a non-zero exit, and a genuinely silent success
 * all reduce to the same sentence, so the CI receipt could not distinguish a
 * configuration mistake from a real isolation failure. `spawnSync` already
 * hands back `error`, `status`, `signal`, `stdout` and `stderr`; this module
 * uses all five instead of testing one.
 *
 * The ordering rule: sanitize FIRST, classify second. Classification matches
 * fixed phrases that survive sanitization ("permission denied", "invalid mount
 * config"), so nothing is ever classified from text that still carries a host
 * path or a credential, and nothing unsanitized can reach a fingerprint.
 *
 * Emits categories and scalars only. Never raw stdout/stderr, a host path, a
 * username, an environment value, a Docker id, a container name, or a
 * repository path.
 *
 * No fs, no child_process, no network.
 */

import { redactedText } from "./safeRedactor";
import { truncateUtf8 } from "./safeWorkspacePath";
import type { SandboxReasonCode } from "./sandboxPolicy";

/** Fixed categories. A stderr string is only ever mapped ONTO one of these. */
export type ContainerStderrCategory =
  | "none"
  | "docker-argument-rejected"
  | "bind-mount-failed"
  | "permission-denied"
  | "executable-not-found"
  | "node-script-load-failed"
  | "read-only-filesystem"
  | "container-timeout-killed"
  | "docker-run-rejected"
  | "container-command-not-invokable"
  | "container-command-not-found"
  | "container-nonzero-exit"
  | "empty-output-exit-zero"
  | "malformed-json-output"
  | "runtime-not-executable"
  | "unclassified";

/** Bytes retained from stderr for CLASSIFICATION only. Never persisted. */
const MAX_CLASSIFY_BYTES = 2000;

/**
 * Reduce stderr to something safe to look at. Host paths collapse to a
 * basename, the file-URL form is handled first so the POSIX rule cannot chop it
 * in half, container/image ids are removed, and the remainder passes through
 * SafeRedactor. The RESULT is never persisted either — it exists only so
 * classification never reads raw text.
 */
export function sanitizeForClassification(raw: string): string {
  if (typeof raw !== "string" || raw.length === 0) return "";
  let text = raw.split(String.fromCharCode(13)).join(" ").split(String.fromCharCode(10)).join(" ");

  const BSLASH = String.fromCharCode(92);
  const base = (p: string): string => {
    const parts = p.split(new RegExp("[" + BSLASH + BSLASH + "/]"));
    return parts[parts.length - 1] || "<path>";
  };
  text = text.replace(/\bfile:\/\/\/[^\s'"()]+/g, (m) => base(m));
  text = text.replace(new RegExp("\\b[A-Za-z]:[" + BSLASH + BSLASH + "/][^\\s'\"()]+", "g"), (m) => base(m));
  text = text.replace(/(?:^|[\s'"(])(\/[^\s'"()]{2,})/g, (m, p: string) => m.replace(p, base(p)));
  // Docker/container/image ids: long hex runs.
  text = text.replace(/\b[0-9a-f]{12,64}\b/g, "<id>");
  // Container names this backend generates.
  text = text.replace(/\bnamla-(?:verify|run)-\d+-\d+\b/g, "<container>");

  const redacted = redactedText(text, MAX_CLASSIFY_BYTES);
  return truncateUtf8(redacted, MAX_CLASSIFY_BYTES).text.trim();
}

/**
 * Fixed phrase table. Order matters: the most specific cause wins, so a
 * "permission denied" inside a mount error is reported as a mount failure
 * rather than a bare permission problem.
 */
const CATEGORY_RULES: readonly { readonly category: ContainerStderrCategory; readonly pattern: RegExp }[] = [
  { category: "bind-mount-failed", pattern: /invalid mount config|bind source path does not exist|are you trying to mount a directory onto a file|mount denied|invalid volume specification/i },
  { category: "executable-not-found", pattern: /executable file not found|no such file or directory: unknown|exec: .*not found|starting container process caused|command not found/i },
  { category: "node-script-load-failed", pattern: /cannot find module|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|SyntaxError|Error: Cannot find/i },
  { category: "read-only-filesystem", pattern: /read-only file system|EROFS/i },
  { category: "permission-denied", pattern: /permission denied|EACCES|operation not permitted|EPERM|requires root privileges|denied while trying to connect/i },
  { category: "docker-argument-rejected", pattern: /unknown flag|unknown shorthand flag|invalid argument|flag needs an argument|unable to parse|see 'docker run --help'|invalid reference format/i },
  { category: "runtime-not-executable", pattern: /cannot connect to the docker daemon|is the docker daemon running|docker: not found/i },
];

export interface ContainerStartupOutcome {
  /** spawnSync error code, e.g. ETIMEDOUT / ENOENT. */
  readonly errorCode?: string;
  readonly status: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  /** True when the caller could not parse stdout as JSON. */
  readonly jsonParseFailed?: boolean;
}

/** SAFE diagnostic fields. This is the complete persistable set. */
export interface SafeStartupDiagnostics {
  readonly runtimeExitCode: number | null;
  readonly runtimeSignal: string | null;
  readonly stdoutPresent: boolean;
  readonly stderrCategory: ContainerStderrCategory;
  readonly safeFailureFingerprint: string;
  readonly safeReasonCode: SandboxReasonCode;
}

/** FNV-1a over SANITIZED, classified fields only — never raw output. */
function fingerprint(parts: readonly (string | number | boolean | null)[]): string {
  let h = 0x811c9dc5;
  const s = parts.map((p) => String(p)).join("|");
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `csd-${h.toString(16).padStart(8, "0")}`;
}

/** Map a SANITIZED stderr string onto exactly one fixed category. */
export function classifyStderr(sanitized: string): ContainerStderrCategory {
  if (sanitized.length === 0) return "none";
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(sanitized)) return rule.category;
  }
  return "unclassified";
}

/**
 * Classify a container start attempt using EVERY signal spawnSync provides.
 *
 * The reason code stays `sandbox-probe-failed` for genuine probe problems, but
 * the category now says which one, so a CI receipt distinguishes "the flag was
 * rejected" from "isolation is broken".
 */
export function classifyContainerStartup(outcome: ContainerStartupOutcome): SafeStartupDiagnostics {
  const sanitized = sanitizeForClassification(outcome.stderr);
  const stdoutPresent = typeof outcome.stdout === "string" && outcome.stdout.trim().length > 0;

  // 1. Timeout: spawnSync reports ETIMEDOUT, or a kill signal.
  const timedOut = outcome.errorCode === "ETIMEDOUT" || outcome.signal === "SIGKILL" || outcome.signal === "SIGTERM";
  // 2. The runtime binary itself could not be executed.
  const runtimeMissing = outcome.errorCode === "ENOENT";

  let category: ContainerStderrCategory;
  if (runtimeMissing) category = "runtime-not-executable";
  else if (timedOut) category = "container-timeout-killed";
  else if (outcome.jsonParseFailed === true) category = "malformed-json-output";
  else {
    const fromStderr = classifyStderr(sanitized);
    if (fromStderr !== "none" && fromStderr !== "unclassified") category = fromStderr;
    else if (!stdoutPresent && outcome.status === 0) category = "empty-output-exit-zero";
    // Docker reserves three exit codes, and collapsing them into a generic
    // non-zero exit discards the single most useful fact. 125 in particular
    // means DOCKER ITSELF refused the run - the container command never
    // executed - so it is a configuration problem, not a workload failure.
    else if (outcome.status === 125) category = "docker-run-rejected";
    else if (outcome.status === 126) category = "container-command-not-invokable";
    else if (outcome.status === 127) category = "container-command-not-found";
    else if (typeof outcome.status === "number" && outcome.status !== 0) category = "container-nonzero-exit";
    else category = fromStderr; // none | unclassified
  }

  const safeReasonCode: SandboxReasonCode = runtimeMissing ? "sandbox-runtime-unavailable" : "sandbox-probe-failed";

  return {
    runtimeExitCode: typeof outcome.status === "number" ? outcome.status : null,
    runtimeSignal: outcome.signal ?? null,
    stdoutPresent,
    stderrCategory: category,
    // Fingerprint over the CATEGORY and scalars, never over sanitized text -
    // a digest of the message would still be a channel back to the message.
    safeFailureFingerprint: fingerprint([outcome.status ?? "null", outcome.signal ?? "null", stdoutPresent, category, safeReasonCode]),
    safeReasonCode,
  };
}

/** Human-readable, safe one-liner for a CI log. */
export function describeStartupFailure(d: SafeStartupDiagnostics): string {
  return `category=${d.stderrCategory} exit=${d.runtimeExitCode ?? "null"} signal=${d.runtimeSignal ?? "none"} stdout=${d.stdoutPresent ? "present" : "empty"} fp=${d.safeFailureFingerprint}`;
}
