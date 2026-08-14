/**
 * demoDigest: normalizes a demo's result object into stable review data —
 * groundwork for future golden-output checks, not a test framework.
 *
 * Pure by construction: no fs, no process, no network, no timers, no
 * randomness — the same input object always yields the same digest.
 *
 * What survives into a digest: numeric counts, enum-like status strings,
 * reason codes, and boolean flags. What is stripped: everything unstable
 * or raw — ids, timestamps, fingerprints, paths, prompts, code content,
 * diffs, summaries, and any other free text. Stripping is by KEY NAME, so
 * a leaky demo cannot smuggle raw text into a digest through a known slot;
 * unknown string keys are dropped entirely rather than guessed at.
 */

export interface DemoDigest {
  moduleName?: string;
  /** Numeric leaves, summed per key name, keys sorted. */
  counts: Record<string, number>;
  /** Enum-like status values (status/verdict/level/kind/...), sorted unique. */
  statuses: string[];
  /** Reason codes, sorted unique. */
  reasonCodes: string[];
  /** Boolean leaves, AND-combined per key name (suits invariant flags). */
  flags: Record<string, boolean>;
  /** Present when an `applied` leaf exists: true iff every one is false. */
  appliedFalse?: boolean;
  /** Present when a `simulated` leaf exists: true iff every one is true. */
  simulatedTrue?: boolean;
  /** Present when an `executed` leaf exists: true iff every one is false. */
  executedFalse?: boolean;
  /** Present when a `pushIntent` leaf exists: true iff every one is false. */
  pushIntentFalse?: boolean;
}

/** Keys whose values are unstable or raw; their subtrees are dropped. */
const STRIP_KEY_PATTERN =
  /(id|ids|at|fingerprint|path|paths|prompt|content|diff|text|summary|title|description|message|rationale|topic|note|line|instruction|name|extension|extensions|url)$/i;

/** Keys whose string values are stable enum vocabulary worth keeping. */
const STATUS_KEYS = new Set([
  "status",
  "verdict",
  "level",
  "haltReason",
  "severity",
  "severities",
  "kind",
  "kinds",
  "changeKind",
  "safetyClass",
  "agentKind",
  "purpose",
  "energy",
  "role",
  "requiredRole",
  "priority",
  // AH2 Step 5 (minimal extension for golden baselines): both carry
  // closed enum vocabulary only (PheromoneType, DigitalSense).
  "type",
  "senseType",
]);

const REASON_KEYS = new Set(["reasonCode", "reasonCodes", "code", "refusalReasonCodes", "pushCandidateRefusals"]);

export function createDemoDigest(input: unknown, moduleName?: string): DemoDigest {
  const counts: Record<string, number> = {};
  const statuses = new Set<string>();
  const reasonCodes = new Set<string>();
  const flags: Record<string, boolean> = {};

  // Tracked separately so absence stays distinguishable from false.
  const invariantSeen = {
    applied: undefined as boolean | undefined,
    simulated: undefined as boolean | undefined,
    executed: undefined as boolean | undefined,
    pushIntent: undefined as boolean | undefined,
  };

  const seen = new WeakSet<object>();

  const visit = (value: unknown, key: string, depth: number): void => {
    if (depth > 12) return;

    if (typeof value === "number" && Number.isFinite(value)) {
      counts[key] = (counts[key] ?? 0) + value;
      return;
    }

    if (typeof value === "boolean") {
      flags[key] = key in flags ? flags[key] && value : value;
      if (key === "applied") invariantSeen.applied = (invariantSeen.applied ?? true) && value === false;
      if (key === "simulated") invariantSeen.simulated = (invariantSeen.simulated ?? true) && value === true;
      if (key === "executed") invariantSeen.executed = (invariantSeen.executed ?? true) && value === false;
      if (key === "pushIntent") invariantSeen.pushIntent = (invariantSeen.pushIntent ?? true) && value === false;
      return;
    }

    if (typeof value === "string") {
      if (STATUS_KEYS.has(key)) statuses.add(value);
      else if (REASON_KEYS.has(key)) reasonCodes.add(value);
      // Any other string is potentially raw text: dropped.
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) visit(item, key, depth + 1);
      return;
    }

    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return;
      seen.add(value);
      for (const [childKey, childValue] of Object.entries(value)) {
        if (STRIP_KEY_PATTERN.test(childKey) && !STATUS_KEYS.has(childKey) && !REASON_KEYS.has(childKey)) {
          continue; // unstable or raw: drop the whole subtree
        }
        visit(childValue, childKey, depth + 1);
      }
    }
  };

  visit(input, "root", 0);

  const sortRecord = <T>(record: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));

  return {
    moduleName,
    counts: sortRecord(counts),
    statuses: [...statuses].sort(),
    reasonCodes: [...reasonCodes].sort(),
    flags: sortRecord(flags),
    appliedFalse: invariantSeen.applied,
    simulatedTrue: invariantSeen.simulated,
    executedFalse: invariantSeen.executed,
    pushIntentFalse: invariantSeen.pushIntent,
  };
}
