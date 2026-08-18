/**
 * p0SecurityRunner — runs the P0 security suite, enforces platform skip rules,
 * and emits a SAFE report artifact.
 *
 * Two jobs that must not be separated:
 *
 *   1. Run every suite and demo, and fail on ANY nonzero exit. A failed test is
 *      never downgraded to a warning.
 *   2. Enforce that platform-capable tests actually RAN. On Linux and macOS a
 *      skip in a symlink or process-group test is a failure, because those
 *      platforms can always perform the operation — a skip there would mean the
 *      escape is untested on every platform.
 *
 * The report contains only: platform, test name, pass/fail/skip counts, skip
 * reasons, docker capability state, golden summary, and the commit SHA. It
 * never contains an environment dump, an absolute host path, a credential, a
 * prompt, provider output, or workspace contents.
 *
 * Usage: node dist/tools/p0SecurityRunner.js [--report <file>]
 */

import { spawnSync } from "child_process";
import { writeFileSync } from "fs";
import { resolve, basename } from "path";
import { detectContainerRuntime } from "../cognitive/sandboxPolicy";
import { redactedText } from "../cognitive/safeRedactor";
import { truncateUtf8 } from "../cognitive/safeWorkspacePath";

const PLATFORM = process.platform;
const IS_POSIX = PLATFORM === "linux" || PLATFORM === "darwin";

/** Suites run on every platform. */
const SUITES: readonly string[] = [
  "dist/tools/safeRedactorTests.js",
  "dist/tools/providerRequestContainmentTests.js",
  "dist/tools/providerParserUnicodeTests.js",
  "dist/tools/networkPolicyTests.js",
  "dist/tools/trustedExecutableTests.js",
  "dist/tools/processTreeTests.js",
  "dist/tools/windowsProcessTreeTests.js",
  "dist/tools/posixPidReuseTests.js",
  "dist/tools/permitScopeEnforcementTests.js",
  "dist/tools/verificationFailureTruthTests.js",
  "dist/tools/workspaceSecurityTests.js",
  "dist/tools/twinBundleStoreTests.js",
  "dist/tools/sandboxPolicyTests.js",
  "dist/tools/ciInvariantTests.js",
  "dist/tools/containerSandboxTests.js",
  "dist/tools/workflowSourceTests.js",
  "dist/tools/containerStartupDiagnosticsTests.js",
  "dist/tools/dockerStageBisectionTests.js",
  "dist/tools/createTargetBindingTests.js",
  "dist/tools/environmentSecretBootstrapTests.js",
  "dist/tools/verificationSandboxTests.js",
  "dist/tools/credentialPatternTests.js",
  "dist/tools/secretValueDetectionTests.js",
  "dist/tools/commandSafetyPolicyTests.js",
  "dist/tools/executableProvenanceTests.js",
];

const DEMOS: readonly string[] = [
  "dist/examples/demoTwinResumeRegression.js",
  "dist/examples/demoTwinEmpireLiveWiring.js",
  "dist/examples/demoTwinSafetyRegression.js",
  "dist/examples/demoTwinColonyFoundation.js",
  "dist/examples/demoNamolaTwinEmpireV1.js",
  "dist/examples/demoGoldenOutputs.js",
];

/**
 * Test-name fragments that MUST NOT be skipped on POSIX. Each corresponds to an
 * escape that Linux and macOS are fully capable of exercising.
 */
const POSIX_MUST_RUN: readonly string[] = ["symlinked FILE target", "SYMLINKED executable", "nested junction", "nested two directories deep", "delete and rename revalidate", "READ ESCAPE"];

/**
 * A SAFE, persistable description of one failed assertion.
 *
 * The first CI run failed on three suites and the report carried only counts,
 * so the actual assertions were unreadable without repository authentication -
 * which meant the only way to diagnose was to guess. That is precisely the
 * situation this project refuses to be in, so the report now carries the
 * assertion itself, sanitized rather than omitted.
 */
export interface SafeFailure {
  readonly suite: string;
  readonly testName: string;
  readonly assertionCode: string;
  readonly message: string;
  readonly expectedSummary: string;
  readonly actualSummary: string;
  /** basename:line only - never an absolute host path. */
  readonly location: string;
  readonly platform: string;
}

/** Max bytes for any single sanitized diagnostic field. */
const MAX_DIAG_BYTES = 400;

/**
 * Strip host-identifying and secret material from one diagnostic line.
 *
 *  1. Absolute paths (Windows `C:\...` and POSIX `/home`, `/Users`, `/private`,
 *     `/github/workspace`, `/tmp`) collapse to their BASENAME, which preserves
 *     `sandboxPolicyTests.js:114` while discarding the runner's directory
 *     layout and username.
 *  2. The result passes through SafeRedactor, so a credential that reached an
 *     assertion message cannot reach the artifact.
 *  3. Bounded in real UTF-8 bytes.
 */
function sanitizeDiagnostic(raw: string): string {
  let text = raw.split(String.fromCharCode(13)).join("");
  // Windows absolute paths -> basename
  const BSLASH = String.fromCharCode(92);
  const SEPS = new RegExp("[" + BSLASH + BSLASH + "/]");
  // \\b is essential: without it the "e:" inside "file:///" matches as a drive
  // letter, turning "file:///a/b/leak.ts" into the nonsense "filleak.ts".
  const WIN_ABS = new RegExp("\\b[A-Za-z]:[" + BSLASH + BSLASH + "/][^\\s'\"()]+", "g");
  text = text.replace(WIN_ABS, (m) => m.split(SEPS).pop() ?? "<path>");
  // file:// URLs FIRST: the POSIX rule below would otherwise chop one in half
  // and leave a confusing fragment ("filleak.ts") in the diagnostic.
  text = text.replace(/\bfile:\/\/\/[^\s'"()]+/g, (m) => m.split("/").pop() ?? "<path>");
  // POSIX absolute paths -> basename (only real filesystem roots, not URLs)
  text = text.replace(/(?:^|[\s(])(\/(?:home|Users|private|tmp|var|github|opt|usr|root)\/[^\s'"()]+)/g, (m, p) => m.replace(p, p.split("/").pop() ?? "<path>"));
  const redacted = redactedText(text, MAX_DIAG_BYTES);
  return truncateUtf8(redacted, MAX_DIAG_BYTES).text.trim();
}

/**
 * Parse failed-assertion blocks out of a node --test run. Node prints
 * `✖ <name>` followed by the error, then repeats them under
 * "failing tests:"; only the FIRST occurrence of each name is kept.
 */
function parseFailures(suite: string, text: string): SafeFailure[] {
  const lines = text.split(String.fromCharCode(10)).map((l) => (l.endsWith(String.fromCharCode(13)) ? l.slice(0, -1) : l));
  const out: SafeFailure[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i += 1) {
    // Both reporter shapes, for the same reason as `parseSkips`: the spec
    // reporter prints `✖ name (1.2ms)`, while TAP — Node 20's default when
    // stdout is not a TTY, which is every CI run — prints `not ok 7 - name`.
    // Reading only the spec shape is why CI run 31882257990 reported "no parsed
    // failures" for a suite that had four, leaving the failure invisible in the
    // artifact.
    const spec = /^\s*✖\s+(.+?)\s*\(\d+(?:\.\d+)?ms\)\s*$/.exec(lines[i]);
    const tap = spec ? null : /^\s*not ok\s+\d+\s*-\s*(.+?)\s*$/.exec(lines[i]);
    const head = spec ?? tap;
    if (!head) continue;
    const testName = head[1].trim();
    if (testName === "failing tests:") continue;
    // node prints each failure TWICE: once inline (name only) and again under
    // "failing tests:" WITH the assertion. Keeping the first occurrence yielded
    // an empty message, so a later block carrying detail replaces an earlier
    // detail-free one for the same test.

    // Look ahead a bounded window for the error detail.
    const block = lines.slice(i + 1, i + 25);
    let assertionCode = "unknown";
    let message = "";
    let expected = "";
    let actual = "";
    let location = "";

    for (const line of block) {
      if (/^\s*✖/.test(line)) break; // next failure begins
      const err = /^\s*(\w*Error)\s*(?:\[([A-Z_]+)\])?:\s*(.*)$/.exec(line);
      if (err && message === "") {
        assertionCode = err[2] ?? err[1];
        message = err[3];
        continue;
      }
      const codeField = /code:\s*'([A-Z_]+)'/.exec(line);
      if (codeField) assertionCode = codeField[1];
      const plus = /^\s*\+\s+(?!actual)(.+)$/.exec(line);
      if (plus && actual === "") actual = plus[1];
      const minus = /^\s*-\s+(?!expected)(.+)$/.exec(line);
      if (minus && expected === "") expected = minus[1];
      // Capture ONLY `basename.js:line:col`. Matching the basename directly
      // (rather than a full path that is then stripped) means no host path can
      // survive even if the sanitizer were bypassed.
      const at = /([A-Za-z0-9_.-]+[.](?:js|ts|mjs|cjs)):([0-9]+):([0-9]+)/.exec(line);
      if (at && location === "" && line.indexOf(" at ") >= 0 && line.indexOf("node:internal") < 0) location = at[1] + ":" + at[2] + ":" + at[3];
    }

    const entry: SafeFailure = {
      suite,
      testName: sanitizeDiagnostic(testName),
      assertionCode,
      message: sanitizeDiagnostic(message),
      expectedSummary: sanitizeDiagnostic(expected),
      actualSummary: sanitizeDiagnostic(actual),
      location: sanitizeDiagnostic(location),
      platform: PLATFORM,
    };
    const existingIndex = out.findIndex((f) => f.testName === entry.testName);
    if (existingIndex < 0) {
      out.push(entry);
      seen.add(testName);
    } else if (out[existingIndex].message === "" && entry.message !== "") {
      out[existingIndex] = entry; // the detailed block wins
    }
  }
  return out;
}

interface SuiteResult {
  readonly suite: string;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly skippedNames: readonly string[];
  readonly skipReasons: readonly string[];
  readonly failures: readonly SafeFailure[];
  readonly exitCode: number;
}

/**
 * Extract skipped test NAMES and REASONS from `node --test` output.
 *
 * `node:test` emits two different shapes, and the runner must read BOTH,
 * because which one appears is decided by the Node version and by whether
 * stdout is a TTY — neither of which this gate controls:
 *
 *   spec reporter : `﹣ name (1.23ms) # reason`
 *                   the marker is U+FE63 SMALL HYPHEN-MINUS, not an ASCII "-".
 *   TAP reporter  : `ok 12 - name # SKIP reason`
 *                   Node 20 (which CI pins) defaults to TAP when stdout is not
 *                   a TTY, which is always true under `spawnSync`.
 *
 * Reading only the spec shape is what broke CI run 31882257990: Windows parsed
 * ZERO names while the summary reported skips, so the reconciliation below
 * correctly refused to trust skip enforcement. The parser was wrong; the guard
 * was right.
 *
 * Nothing here infers names from a count. If a format appears that neither
 * branch understands, this returns fewer names than the summary reports and the
 * caller fails closed — which is the behaviour that caught this defect.
 */
export function parseSkips(text: string): { readonly skippedNames: string[]; readonly skipReasons: string[] } {
  const skippedNames: string[] = [];
  const skipReasons: string[] = [];
  const push = (name: string, reason: string) => {
    skippedNames.push(name.trim());
    skipReasons.push(reason.trim() || "(no reason given)");
  };

  for (const line of text.split(/\r?\n/)) {
    // spec: the small-hyphen marker, a name, a duration, then an optional "# reason".
    const spec = /^\s*[﹣⁃]\s+(.+?)\s*\(\d+(?:\.\d+)?ms\)\s*(?:#\s*(.*))?$/.exec(line);
    if (spec) {
      push(spec[1], spec[2] ?? "");
      continue;
    }
    // TAP: `ok <n> - <name> # SKIP <reason>`. The directive is case-insensitive
    // per the TAP spec. `not ok` is deliberately NOT accepted: a failing test is
    // not a skip, and treating it as one would hide a failure.
    const tap = /^\s*ok\s+\d+\s*-\s*(.+?)\s*#\s*SKIP\b[ \t]*(.*)$/i.exec(line);
    if (tap) push(tap[1], tap[2] ?? "");
  }

  return { skippedNames, skipReasons };
}

/** Run one node --test suite and parse its TAP-ish summary. Output is not stored. */
function runSuite(file: string): SuiteResult {
  const out = spawnSync(process.execPath, ["--test", file], { shell: false, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 600000, windowsHide: true });
  const text = `${out.stdout ?? ""}\n${out.stderr ?? ""}`;
  const num = (key: string): number => {
    const m = new RegExp(`^\\u2139 ${key} (\\d+)$`, "m").exec(text) ?? new RegExp(`${key} (\\d+)`, "m").exec(text);
    return m ? Number(m[1]) : 0;
  };
  const { skippedNames, skipReasons } = parseSkips(text);
  return { suite: basename(file), passed: num("pass"), failed: num("fail"), skipped: num("skipped"), skippedNames, skipReasons, failures: parseFailures(basename(file), text), exitCode: out.status ?? 1 };
}

interface DemoResult {
  readonly demo: string;
  readonly exitCode: number;
  readonly allExpectationsMet: boolean | null;
  readonly allGoldensPassed: boolean | null;
}

function runDemo(file: string): DemoResult {
  const out = spawnSync(process.execPath, [file], { shell: false, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 600000, windowsHide: true });
  const text = `${out.stdout ?? ""}`;
  const flag = (key: string): boolean | null => {
    const m = new RegExp(`"${key}"\\s*:\\s*(true|false)`).exec(text);
    return m ? m[1] === "true" : null;
  };
  return { demo: basename(file), exitCode: out.status ?? 1, allExpectationsMet: flag("allExpectationsMet"), allGoldensPassed: flag("allGoldensPassed") };
}

function main(): void {
  const reportIndex = process.argv.indexOf("--report");
  const reportPath = reportIndex >= 0 ? process.argv[reportIndex + 1] : "";

  const suiteResults = SUITES.map(runSuite);
  const demoResults = DEMOS.map(runDemo);
  const docker = detectContainerRuntime();

  const violations: string[] = [];

  // 1. No nonzero exit is tolerated, and no failure is downgraded to a warning.
  for (const s of suiteResults) {
    if (s.exitCode !== 0 || s.failed > 0) violations.push(`suite ${s.suite} FAILED (exit=${s.exitCode}, failed=${s.failed})`);
  }
  for (const d of demoResults) {
    if (d.exitCode !== 0) violations.push(`demo ${d.demo} FAILED (exit=${d.exitCode})`);
    if (d.allExpectationsMet === false) violations.push(`demo ${d.demo} reported allExpectationsMet=false`);
  }

  // 2. Goldens must be explicitly true — absent is not acceptable either.
  const golden = demoResults.find((d) => d.demo === "demoGoldenOutputs.js");
  if (!golden || golden.allGoldensPassed !== true) violations.push(`allGoldensPassed is not true (got ${String(golden?.allGoldensPassed)})`);

  // 3. The skip parser must agree with the runner's own count. If it does not,
  //    the POSIX enforcement below is operating on incomplete data and must not
  //    be trusted to pass.
  for (const s of suiteResults) {
    if (s.skippedNames.length !== s.skipped) {
      violations.push(`${s.suite}: parsed ${s.skippedNames.length} skip names but the runner reported ${s.skipped} skipped — skip enforcement cannot be trusted`);
    }
  }

  // 4. On POSIX, a skip in a platform-capable security test is a FAILURE.
  if (IS_POSIX) {
    for (const s of suiteResults) {
      for (const name of s.skippedNames) {
        if (POSIX_MUST_RUN.some((frag) => name.includes(frag))) {
          violations.push(`${s.suite}: "${name}" was SKIPPED on ${PLATFORM}, which supports this operation`);
        }
      }
    }
  }

  const totals = suiteResults.reduce((a, s) => ({ passed: a.passed + s.passed, failed: a.failed + s.failed, skipped: a.skipped + s.skipped }), { passed: 0, failed: 0, skipped: 0 });

  // SAFE report only: no env dump, no host path, no output, no credentials.
  const report = {
    platform: PLATFORM,
    commitSha: (process.env.GITHUB_SHA ?? "local").slice(0, 40),
    totals,
    suites: suiteResults.map((s) => ({ suite: s.suite, passed: s.passed, failed: s.failed, skipped: s.skipped, skippedNames: s.skippedNames, skipReasons: s.skipReasons })),
    // Sanitized assertions: suite, test, code, expected/actual, basename:line.
    // Never a credential, environment value, prompt, provider output, or an
    // absolute host path. Omitting these is what forced guesswork last time.
    failures: suiteResults.flatMap((s) => s.failures),
    demos: demoResults.map((d) => ({ demo: d.demo, exitCode: d.exitCode, allExpectationsMet: d.allExpectationsMet })),
    golden: { allGoldensPassed: golden?.allGoldensPassed ?? null },
    dockerCapability: {
      backendId: docker.backendId,
      capabilityState: docker.capabilityState,
      available: docker.available,
      // Detection NEVER verifies Namla's sandbox. This stays false until a real
      // ContainerSandboxBackend exists and its isolation is actually exercised.
      namlaSandboxVerified: false,
      safeReasonCode: docker.safeReasonCode,
    },
    violations,
  };

  const json = JSON.stringify(report, null, 2);
  if (reportPath) writeFileSync(resolve(reportPath), json, "utf8");
  console.log(json);

  if (violations.length > 0) {
    // Print the SAFE assertion detail before exiting, so a red CI job is
    // diagnosable from the log alone without repository authentication.
    const allFailures = suiteResults.flatMap((s) => s.failures);
    if (allFailures.length > 0) {
      console.error(`\n=== SAFE FAILURE DIAGNOSTICS (${PLATFORM}) ===`);
      for (const f of allFailures) {
        console.error(`  SUITE    : ${f.suite}`);
        console.error(`  TEST     : ${f.testName}`);
        console.error(`  CODE     : ${f.assertionCode}`);
        console.error(`  MESSAGE  : ${f.message}`);
        if (f.expectedSummary) console.error(`  EXPECTED : ${f.expectedSummary}`);
        if (f.actualSummary) console.error(`  ACTUAL   : ${f.actualSummary}`);
        if (f.location) console.error(`  AT       : ${f.location}`);
        console.error("  ---");
      }
    }
    console.error(`\nP0 SECURITY GATE FAILED on ${PLATFORM}:`);
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }
  console.error(`\nP0 security gate PASSED on ${PLATFORM}: ${totals.passed} passed, ${totals.failed} failed, ${totals.skipped} skipped.`);
}

// Run the gate ONLY when this file is the entry point. Without this guard,
// importing it — which the parser tests must do to exercise `parseSkips`
// against captured reporter output — would execute the whole gate as a side
// effect and could call `process.exit`. Invocation via
// `node dist/tools/p0SecurityRunner.js` is unchanged.
if (require.main === module) {
  main();
}
