/**
 * safeSuiteFailureDiagnostics — run ONE test file and emit sanitized failure
 * detail, in a form that does not depend on the Node version.
 *
 * Why this exists. The previous parser read the `spec` reporter output (the
 * `✖ name (1.2ms)` / `ℹ pass N` format). That is Node 22+ behaviour. CI installs
 * Node 20, whose `node --test` defaults to the TAP reporter in a non-TTY, so the
 * parser matched nothing and reported "no parsed failures" for every real
 * failure on Linux and macOS. Windows happened to pass, so the gap stayed
 * invisible. A diagnostic that silently finds nothing is worse than none: it
 * reads as "no detail available" rather than "the parser is broken".
 *
 * The fix is to stop depending on a default. This runner passes
 * `--test-reporter=tap` EXPLICITLY, so the format is identical on Node 20 and
 * Node 24, and parses TAP's structured YAML block, which carries `location`,
 * `code`, `name`, `expected` and `actual` as discrete fields rather than as
 * prose that has to be scraped.
 *
 * Everything emitted is sanitized: absolute paths collapse to a basename, the
 * runner username / temp dir / repo root are removed, and the text passes
 * through SafeRedactor. It never emits an environment value, a prompt, provider
 * output, or workspace contents.
 *
 * Usage: node dist/tools/safeSuiteFailureDiagnostics.js <testFile> [--out <file>]
 */

import { spawnSync } from "child_process";
import { writeFileSync } from "fs";
import { userInfo, tmpdir } from "os";
import { resolve } from "path";
import { redactedText } from "../cognitive/safeRedactor";
import { truncateUtf8 } from "../cognitive/safeWorkspacePath";

/** Max bytes for any single sanitized diagnostic field. */
export const MAX_FIELD_BYTES = 400;

export interface SafeSuiteFailure {
  readonly suite: string;
  readonly testName: string;
  readonly assertionCode: string;
  readonly message: string;
  readonly expectedSummary: string;
  readonly actualSummary: string;
  /** Basename only — never a directory. */
  readonly sourceFile: string;
  readonly sourceLine: number | null;
  readonly platform: string;
}

export interface SafeSuiteDiagnostics {
  readonly suite: string;
  readonly platform: string;
  readonly exitCode: number;
  readonly failureCount: number;
  readonly failures: readonly SafeSuiteFailure[];
  /** True when the suite failed but no failure could be parsed — a parser bug. */
  readonly parserSuspect: boolean;
}

/** Last path segment, treating both separators, with no directory retained. */
export function baseNameOf(p: string): string {
  const cleaned = p.replace(/['"]/g, "").trim();
  const parts = cleaned.split(/[\\/]/);
  return parts[parts.length - 1] || cleaned;
}

/**
 * Remove host-identifying material, then redact secrets, then bound the field.
 *
 * Order matters: paths are collapsed BEFORE redaction so a long path cannot
 * consume the byte budget and push a credential past the truncation point.
 */
export function sanitizeDiagnosticText(raw: string, opts: { readonly username?: string; readonly tempDir?: string; readonly repoRoot?: string } = {}): string {
  if (typeof raw !== "string" || raw.length === 0) return "";
  let text = raw.split(String.fromCharCode(13)).join(" ").split(String.fromCharCode(10)).join(" ");

  // 1. Any absolute path -> its basename. Windows drive paths and POSIX roots.
  const BSLASH = String.fromCharCode(92);
  const winAbs = new RegExp("\\b[A-Za-z]:[" + BSLASH + BSLASH + "/][^\\s'\"()]*", "g");
  text = text.replace(winAbs, (m) => baseNameOf(m));
  const posixAbs = /(?:^|[\s'"(])(\/[^\s'"()]{2,})/g;
  text = text.replace(posixAbs, (m, p: string) => m.replace(p, baseNameOf(p)));
  text = text.replace(/\bfile:\/\/\/[^\s'"()]+/g, (m) => baseNameOf(m));

  // 2. Explicit host identifiers, in case any survived as a bare token.
  const username = opts.username ?? safeUsername();
  if (username && username.length >= 3) text = text.split(username).join("<user>");
  const temp = opts.tempDir ?? tmpdir();
  if (temp) text = text.split(temp).join("<temp>").split(baseNameOf(temp)).join("<temp>");
  const root = opts.repoRoot ?? process.cwd();
  if (root) text = text.split(root).join("<repo>");

  // 3. Credentials, via the single redaction boundary.
  const redacted = redactedText(text, MAX_FIELD_BYTES);
  return truncateUtf8(redacted, MAX_FIELD_BYTES).text.trim();
}

function safeUsername(): string {
  try {
    return userInfo().username;
  } catch {
    return "";
  }
}

/** Strip TAP's surrounding quotes from a scalar value. */
function unquote(v: string): string {
  const t = v.trim();
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) return t.slice(1, -1);
  return t;
}

/**
 * Parse TAP 13 output into sanitized failures.
 *
 * Shape (node --test --test-reporter=tap):
 *   not ok 2 - <test name>
 *     ---
 *     location: '<abs path>:LINE:COL'
 *     error: |-
 *       <message>
 *     code: 'ERR_ASSERTION'
 *     name: 'AssertionError'
 *     expected: <value>
 *     actual: <value>
 *     ...
 */
export function parseTapFailures(suite: string, tapText: string, platform: string = process.platform): SafeSuiteFailure[] {
  const lines = tapText.split(String.fromCharCode(10)).map((l) => (l.endsWith(String.fromCharCode(13)) ? l.slice(0, -1) : l));
  const out: SafeSuiteFailure[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const head = /^not ok\s+\d+\s+-\s+(.+?)\s*$/.exec(lines[i]);
    if (!head) continue;
    const testName = head[1];

    // Consume the YAML block that follows, bounded.
    const fields: Record<string, string> = {};
    let blockLine: string | null = null;
    for (let j = i + 1; j < Math.min(lines.length, i + 60); j += 1) {
      const line = lines[j];
      if (/^\s*\.\.\.\s*$/.test(line)) break; // end of block
      if (/^not ok\s+\d+/.test(line) || /^ok\s+\d+/.test(line)) break; // next test

      // A `key: |-` introduces a literal block; capture its FIRST line only.
      const blockStart = /^\s{2,}([A-Za-z_]+):\s*\|-?\s*$/.exec(line);
      if (blockStart) {
        blockLine = blockStart[1];
        const next = lines[j + 1];
        if (next !== undefined && !/^\s*\.\.\./.test(next)) fields[blockLine] = next.trim();
        continue;
      }
      const scalar = /^\s{2,}([A-Za-z_]+):\s*(.*)$/.exec(line);
      if (scalar && scalar[2].length > 0) {
        if (fields[scalar[1]] === undefined) fields[scalar[1]] = scalar[2];
      }
    }

    // `location: '<path>:LINE:COL'`
    let sourceFile = "";
    let sourceLine: number | null = null;
    const loc = unquote(fields.location ?? "");
    const locMatch = /^(.*):(\d+):(\d+)$/.exec(loc);
    if (locMatch) {
      sourceFile = baseNameOf(locMatch[1]);
      sourceLine = Number(locMatch[2]);
    } else if (loc.length > 0) {
      sourceFile = baseNameOf(loc);
    }

    out.push({
      suite,
      testName: sanitizeDiagnosticText(testName),
      assertionCode: sanitizeDiagnosticText(unquote(fields.code ?? fields.failureType ?? "unknown")),
      message: sanitizeDiagnosticText(unquote(fields.error ?? "")),
      expectedSummary: sanitizeDiagnosticText(unquote(fields.expected ?? "")),
      actualSummary: sanitizeDiagnosticText(unquote(fields.actual ?? "")),
      sourceFile: sanitizeDiagnosticText(sourceFile),
      sourceLine,
      platform,
    });
  }
  return out;
}

/**
 * Run ONE test file and return sanitized diagnostics.
 *
 * The suite's own exit code is reported but NEVER altered — this is a reporter,
 * not a gate. It always forces `--test-reporter=tap` so the parsed format is
 * identical across Node versions.
 */
export function runSuiteDiagnostics(testFile: string): SafeSuiteDiagnostics {
  // NODE_TEST_CONTEXT must be stripped. When `node --test` spawns a child it
  // sets this variable, and a nested runner that inherits it switches to the
  // parent-reporting protocol: it emits NO stdout and exits 0 even when tests
  // fail. Inheriting it would make this reporter silently claim every suite
  // passed - the exact class of false-negative it exists to eliminate.
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;

  const out = spawnSync(process.execPath, ["--test", "--test-reporter=tap", testFile], { shell: false, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 900000, windowsHide: true, env: childEnv });
  const text = `${out.stdout ?? ""}${String.fromCharCode(10)}${out.stderr ?? ""}`;
  const suite = baseNameOf(testFile);
  const failures = parseTapFailures(suite, text);
  const exitCode = out.status ?? 1;
  return {
    suite,
    platform: process.platform,
    exitCode,
    failureCount: failures.length,
    failures,
    // A failing suite with zero parsed failures means the PARSER is broken,
    // which is exactly the condition that hid the Linux/macOS failures before.
    parserSuspect: exitCode !== 0 && failures.length === 0,
  };
}

function main(): void {
  const args = process.argv.slice(2);
  const files = args.filter((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--out");
  const outIndex = args.indexOf("--out");
  const outPath = outIndex >= 0 ? args[outIndex + 1] : "";

  if (files.length === 0) {
    console.error("usage: safeSuiteFailureDiagnostics <testFile...> [--out <file>]");
    process.exit(1);
  }

  const reports = files.map(runSuiteDiagnostics);
  const payload = { platform: process.platform, suites: reports };
  const json = JSON.stringify(payload, null, 2);
  if (outPath) writeFileSync(resolve(outPath), json, "utf8");
  console.log(json);

  for (const r of reports) {
    console.error(`\n=== ${r.suite} (${r.platform}) exit=${r.exitCode} failures=${r.failureCount} ===`);
    if (r.parserSuspect) console.error("  WARNING: suite failed but NO failure was parsed - the parser is suspect");
    for (const f of r.failures) {
      console.error(`  TEST     : ${f.testName}`);
      console.error(`  CODE     : ${f.assertionCode}`);
      console.error(`  MESSAGE  : ${f.message}`);
      if (f.expectedSummary) console.error(`  EXPECTED : ${f.expectedSummary}`);
      if (f.actualSummary) console.error(`  ACTUAL   : ${f.actualSummary}`);
      console.error(`  AT       : ${f.sourceFile}:${f.sourceLine ?? "?"}`);
      console.error("  ---");
    }
  }
  // A reporter must never change the outcome of the job it is reporting on.
  process.exit(0);
}

if (require.main === module) main();
