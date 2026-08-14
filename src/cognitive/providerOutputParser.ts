/**
 * providerOutputParser — turns a provider process's bounded stdout into safe,
 * structured DATA (Build Law §19). Provider output is never authority: this
 * parser never evaluates JavaScript, never executes a returned command, and
 * never trusts a file path the provider returned.
 *
 * It enforces a maximum byte length, rejects empty output when a response is
 * required, and fails safely on malformed structured output (a fixed failure
 * category, never a thrown exception that could leak a stack). Any artifact
 * proposals it surfaces are DATA for the existing review-gated workflow — never
 * applied automatically.
 *
 * No fs, no child_process, no network, no eval.
 */
import { truncateUtf8 } from "./safeWorkspacePath";

export interface ParsedProviderOutput {
  readonly ok: boolean;
  readonly summary: string;
  readonly confidence: number;
  readonly observations: readonly string[];
  /** Always empty in the smoke path; cognition-only returns no artifacts to apply. */
  readonly artifactProposals: readonly [];
  readonly safeFailureCategory: string;
  readonly outputTruncated: boolean;
}

function clampConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : Math.round(value * 1000) / 1000;
}

/** Keep only short, plain string observations; drop anything non-string or oversized. */
function safeObservations(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.length > 0 && item.length <= 500) out.push(item.slice(0, 500));
    if (out.length >= 8) break; // bounded
  }
  return out;
}

export function parseProviderOutput(
  rawStdout: string,
  maxBytes: number,
  responseRequired: boolean
): ParsedProviderOutput {
  // REAL UTF-8 bytes. `rawStdout.length` is a UTF-16 unit count: for Arabic or
  // Hebrew it under-counts by ~2x (so oversized output is accepted as complete),
  // and `.slice(0, maxBytes)` can cut an emoji between its surrogate halves.
  const bounded = truncateUtf8(rawStdout, maxBytes);
  const outputTruncated = bounded.truncated;
  const stdout = bounded.text;

  const empty = stdout.trim().length === 0;
  if (empty) {
    return {
      ok: !responseRequired,
      summary: "",
      confidence: 0,
      observations: [],
      artifactProposals: [],
      safeFailureCategory: responseRequired ? "empty-output" : "none",
      outputTruncated,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    // Malformed structured output — safe, no throw, no leak.
    return {
      ok: false,
      summary: "",
      confidence: 0,
      observations: [],
      artifactProposals: [],
      safeFailureCategory: "malformed-output",
      outputTruncated,
    };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return {
      ok: false,
      summary: "",
      confidence: 0,
      observations: [],
      artifactProposals: [],
      safeFailureCategory: "malformed-output",
      outputTruncated,
    };
  }

  const record = parsed as Record<string, unknown>;
  const summaryRaw = typeof record.summary === "string" ? record.summary : "";
  const summary = summaryRaw.slice(0, 1000);

  // Observations may be spread across a few known safe fields.
  const observations = [
    ...safeObservations(record.observations),
    ...(typeof record.edgeCase === "string" ? [record.edgeCase.slice(0, 500)] : []),
    ...(typeof record.testSuggestion === "string" ? [record.testSuggestion.slice(0, 500)] : []),
  ].slice(0, 8);

  return {
    ok: summary.length > 0,
    summary,
    confidence: clampConfidence(record.confidence),
    observations,
    artifactProposals: [],
    safeFailureCategory: summary.length > 0 ? "none" : "missing-summary",
    outputTruncated,
  };
}
