/**
 * demoGolden: the semantic golden evaluation model (AH2 Step 5).
 *
 * A golden here is NOT a raw-output snapshot: it is a set of semantic
 * expectations evaluated against a DemoDigest — the already-redacted,
 * stable normalization of a demo's result. Ids, timestamps, fingerprints,
 * paths, raw text, and wall-clock-derived values never reach this module,
 * because the digest never carries them.
 *
 * Failures report only: demo name, expectation key, expected safe value,
 * actual safe value, and a fixed failure code. Flag names, status names,
 * reason codes, and counts are the entire reporting vocabulary.
 *
 * Pure and deterministic: no fs, no process/env, no network, no timers,
 * no subprocesses, no ReceiptLog dependency, no mutation of inputs.
 */

import type { DemoDigest } from "./demoDigest";

export interface DemoGoldenExpectation {
  demoName: string;
  /** Flags that must be present and true in the digest. */
  requiredFlags?: string[];
  /** Flags that must be absent or false (never true). */
  forbiddenFlags?: string[];
  /** Enum-vocabulary statuses that must appear. */
  requiredStatuses?: string[];
  /** Reason codes that must appear. */
  requiredReasonCodes?: string[];
  /** Reason codes that must not appear. */
  forbiddenReasonCodes?: string[];
  /** Counts that must equal exactly (stable, semantic numbers only). */
  exactStableCounts?: Record<string, number>;
  /** Counts that must be at least the given value. */
  minimumStableCounts?: Record<string, number>;
  /** Counts that must be at most the given value. */
  maximumStableCounts?: Record<string, number>;
  /** Digest invariant fields that must have the given value. */
  expectedInvariantFields?: Partial<
    Record<"appliedFalse" | "simulatedTrue" | "executedFalse" | "pushIntentFalse", boolean>
  >;
}

export type DemoGoldenFailureCode =
  | "missing-flag"
  | "flag-not-true"
  | "forbidden-flag-true"
  | "missing-status"
  | "missing-reason-code"
  | "forbidden-reason-code-present"
  | "count-mismatch"
  | "count-below-minimum"
  | "count-above-maximum"
  | "invariant-mismatch";

export interface DemoGoldenFailure {
  demoName: string;
  expectationKey: string;
  expected: string | number | boolean;
  actual: string | number | boolean | undefined;
  failureCode: DemoGoldenFailureCode;
}

export interface DemoGoldenResult {
  demoName: string;
  passed: boolean;
  checksRun: number;
  failures: DemoGoldenFailure[];
}

export function evaluateDemoGolden(
  digest: DemoDigest,
  expectation: DemoGoldenExpectation
): DemoGoldenResult {
  const failures: DemoGoldenFailure[] = [];
  let checksRun = 0;
  const name = expectation.demoName;

  const fail = (
    expectationKey: string,
    expected: string | number | boolean,
    actual: string | number | boolean | undefined,
    failureCode: DemoGoldenFailureCode
  ) => failures.push({ demoName: name, expectationKey, expected, actual, failureCode });

  for (const flag of expectation.requiredFlags ?? []) {
    checksRun += 1;
    if (!(flag in digest.flags)) fail(`requiredFlags.${flag}`, true, undefined, "missing-flag");
    else if (digest.flags[flag] !== true) fail(`requiredFlags.${flag}`, true, digest.flags[flag], "flag-not-true");
  }

  for (const flag of expectation.forbiddenFlags ?? []) {
    checksRun += 1;
    if (digest.flags[flag] === true) fail(`forbiddenFlags.${flag}`, false, true, "forbidden-flag-true");
  }

  for (const status of expectation.requiredStatuses ?? []) {
    checksRun += 1;
    if (!digest.statuses.includes(status)) fail(`requiredStatuses.${status}`, status, undefined, "missing-status");
  }

  for (const code of expectation.requiredReasonCodes ?? []) {
    checksRun += 1;
    if (!digest.reasonCodes.includes(code)) fail(`requiredReasonCodes.${code}`, code, undefined, "missing-reason-code");
  }

  for (const code of expectation.forbiddenReasonCodes ?? []) {
    checksRun += 1;
    if (digest.reasonCodes.includes(code)) {
      fail(`forbiddenReasonCodes.${code}`, false, true, "forbidden-reason-code-present");
    }
  }

  for (const [key, expected] of Object.entries(expectation.exactStableCounts ?? {})) {
    checksRun += 1;
    const actual = digest.counts[key];
    if (actual !== expected) fail(`exactStableCounts.${key}`, expected, actual, "count-mismatch");
  }

  for (const [key, minimum] of Object.entries(expectation.minimumStableCounts ?? {})) {
    checksRun += 1;
    const actual = digest.counts[key];
    if (actual === undefined || actual < minimum) {
      fail(`minimumStableCounts.${key}`, minimum, actual, "count-below-minimum");
    }
  }

  for (const [key, maximum] of Object.entries(expectation.maximumStableCounts ?? {})) {
    checksRun += 1;
    const actual = digest.counts[key];
    if (actual === undefined || actual > maximum) {
      fail(`maximumStableCounts.${key}`, maximum, actual, "count-above-maximum");
    }
  }

  for (const [field, expected] of Object.entries(expectation.expectedInvariantFields ?? {})) {
    checksRun += 1;
    const actual = digest[field as keyof DemoDigest] as boolean | undefined;
    if (actual !== expected) fail(`expectedInvariantFields.${field}`, expected as boolean, actual, "invariant-mismatch");
  }

  return { demoName: name, passed: failures.length === 0, checksRun, failures };
}

export interface DemoGoldenTotals {
  results: DemoGoldenResult[];
  totalDemos: number;
  passedDemos: number;
  failedDemos: number;
  failedDemoNames: string[];
  totalExpectationChecks: number;
  failedExpectationChecks: number;
  failureReasonCodes: DemoGoldenFailureCode[];
  allGoldensPassed: boolean;
}

export function evaluateAllDemoGoldens(
  entries: Array<{ digest: DemoDigest; expectation: DemoGoldenExpectation }>
): DemoGoldenTotals {
  const results = entries.map((entry) => evaluateDemoGolden(entry.digest, entry.expectation));
  const failed = results.filter((r) => !r.passed);

  return {
    results,
    totalDemos: results.length,
    passedDemos: results.length - failed.length,
    failedDemos: failed.length,
    failedDemoNames: failed.map((r) => r.demoName),
    totalExpectationChecks: results.reduce((sum, r) => sum + r.checksRun, 0),
    failedExpectationChecks: results.reduce((sum, r) => sum + r.failures.length, 0),
    failureReasonCodes: [...new Set(results.flatMap((r) => r.failures.map((f) => f.failureCode)))],
    allGoldensPassed: failed.length === 0,
  };
}
