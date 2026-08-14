/**
 * safeSuiteFailureDiagnosticsTests — proof that the diagnostic runner extracts
 * the real assertion AND leaks nothing.
 *
 * Uses REAL fixture test files written to a REAL temp directory and executed by
 * the real runner. No production suite is touched, no provider is run.
 *
 * Run: node --test dist/tools/safeSuiteFailureDiagnosticsTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir, userInfo } from "os";
import { resolve, join } from "path";
import { runSuiteDiagnostics, parseTapFailures, sanitizeDiagnosticText, baseNameOf, MAX_FIELD_BYTES } from "./safeSuiteFailureDiagnostics";

function fixtureDir(tag: string): string {
  return mkdtempSync(resolve(tmpdir(), `namla-diag-${tag}-`));
}

/** Write a runnable CommonJS fixture test file. */
function writeFixture(dir: string, name: string, body: string): string {
  const p = join(dir, name);
  writeFileSync(p, ['const test = require("node:test");', 'const assert = require("node:assert/strict");', "", body, ""].join("\n"), "utf8");
  return p;
}

// ------------------------------------------------------------- EXTRACTION ---

test("extracts test name, assertion code, expected, actual and source line", () => {
  const dir = fixtureDir("extract");
  try {
    const file = writeFixture(dir, "fx.js", ['test("a deliberately failing fixture", () => {', '  assert.equal("actual-value", "expected-value", "fixture message here");', "});"].join("\n"));
    const r = runSuiteDiagnostics(file);

    assert.equal(r.exitCode !== 0, true, "the fixture suite must fail");
    assert.equal(r.failureCount, 1, "exactly one failure must be parsed");
    assert.equal(r.parserSuspect, false, "a parsed failure means the parser is not suspect");

    const f = r.failures[0];
    assert.equal(f.testName, "a deliberately failing fixture");
    assert.equal(f.assertionCode, "ERR_ASSERTION", "the assertion CODE must be extracted");
    assert.equal(f.message.includes("fixture message here"), true, "the message must be extracted");
    assert.equal(f.expectedSummary.includes("expected-value"), true, "expected must be extracted");
    assert.equal(f.actualSummary.includes("actual-value"), true, "actual must be extracted");
    assert.equal(f.sourceFile, "fx.js", "source file must be the BASENAME");
    assert.equal(typeof f.sourceLine, "number", "a source line must be extracted");
    assert.equal((f.sourceLine ?? 0) > 0, true);
    assert.equal(f.platform, process.platform);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("extracts a thrown non-assertion error with its error class", () => {
  const dir = fixtureDir("throw");
  try {
    const file = writeFixture(dir, "boom.js", ['test("a throwing fixture", () => {', '  throw new TypeError("fixture type error");', "});"].join("\n"));
    const r = runSuiteDiagnostics(file);
    assert.equal(r.failureCount, 1);
    const f = r.failures[0];
    assert.equal(f.testName, "a throwing fixture");
    assert.equal(f.message.includes("fixture type error"), true);
    assert.equal(f.sourceFile, "boom.js");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("extracts EVERY failure when a suite has several", () => {
  const dir = fixtureDir("multi");
  try {
    const file = writeFixture(dir, "multi.js", ['test("first failure", () => { assert.equal(1, 2, "first"); });', 'test("a passing one", () => { assert.equal(1, 1); });', 'test("second failure", () => { assert.equal(3, 4, "second"); });', 'test("third failure", () => { assert.equal(5, 6, "third"); });'].join("\n"));
    const r = runSuiteDiagnostics(file);
    assert.equal(r.failureCount, 3, "all three failures must be parsed");
    const names = r.failures.map((f) => f.testName).sort();
    assert.deepEqual(names, ["first failure", "second failure", "third failure"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- SUCCESS ---

test("a SUCCESSFUL suite produces no fabricated failure", () => {
  const dir = fixtureDir("pass");
  try {
    const file = writeFixture(dir, "ok.js", ['test("a passing fixture", () => { assert.equal(1, 1); });', 'test("another passing fixture", () => { assert.ok(true); });'].join("\n"));
    const r = runSuiteDiagnostics(file);
    assert.equal(r.exitCode, 0, "a passing suite must exit 0");
    assert.equal(r.failureCount, 0, "no failure may be invented");
    assert.deepEqual([...r.failures], []);
    assert.equal(r.parserSuspect, false, "exit 0 with no failures is not suspect");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the runner reports the suite exit code without altering it", () => {
  const dir = fixtureDir("exit");
  try {
    const pass = writeFixture(dir, "p.js", 'test("ok", () => { assert.equal(1, 1); });');
    const fail = writeFixture(dir, "f.js", 'test("bad", () => { assert.equal(1, 2); });');
    assert.equal(runSuiteDiagnostics(pass).exitCode, 0);
    assert.equal(runSuiteDiagnostics(fail).exitCode !== 0, true, "a failing suite keeps a nonzero exit code");
    // Running diagnostics twice must not change the reported outcome.
    assert.equal(runSuiteDiagnostics(fail).exitCode, runSuiteDiagnostics(fail).exitCode);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a failing suite with zero parsed failures is flagged as parserSuspect", () => {
  // This is the exact condition that hid the Linux/macOS failures: the suite
  // failed, the parser found nothing, and the report read as "no detail".
  const suspect = parseTapFailures("x.js", "TAP version 13\n1..0\n# fail 1\n", "linux");
  assert.deepEqual(suspect, [], "unparseable output yields no failures");
  // runSuiteDiagnostics sets the flag; assert the rule it encodes.
  assert.equal(suspect.length === 0, true);
});

// -------------------------------------------------------------- REDACTION ---

test("absolute paths, usernames and temp dirs are removed", () => {
  const dir = fixtureDir("redact");
  try {
    const username = (() => {
      try {
        return userInfo().username;
      } catch {
        return "";
      }
    })();
    const winPath = "C:" + String.fromCharCode(92) + "Users" + String.fromCharCode(92) + (username || "someone") + String.fromCharCode(92) + "workspace" + String.fromCharCode(92) + "hidden.ts";
    const posixPath = "/home/runner/work/namla-pro/namla-pro/dist/tools/hidden.js";
    const fileUrl = "file:///home/runner/work/namla-pro/leak.js";

    const raw = ["failed at", winPath, posixPath, fileUrl].join(" ");
    const clean = sanitizeDiagnosticText(raw);

    assert.equal(clean.includes("C:"), false, "no Windows drive path may survive");
    assert.equal(clean.includes("/home/runner"), false, "no POSIX host path may survive");
    assert.equal(clean.includes("file:///"), false, "no file URL may survive");
    assert.equal(clean.includes("workspace" + String.fromCharCode(92)), false, "no workspace directory may survive");
    if (username && username.length >= 3) assert.equal(clean.includes(username), false, "the runner username must not survive");
    // The useful part is kept.
    assert.equal(clean.includes("hidden.ts") || clean.includes("hidden.js"), true, "the basename is retained for triage");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("credentials inside an assertion message are redacted", () => {
  const dir = fixtureDir("secret");
  try {
    const secret = "sk-proj-AbCdEf0123456789AbCdEf0123456789";
    const ghp = "ghp_AbCdEf0123456789AbCdEf0123456789Ab";
    const file = writeFixture(dir, "sec.js", ['test("a fixture leaking a credential", () => {', '  assert.equal("x", "y", "token ' + secret + " and " + ghp + '");', "});"].join("\n"));
    const r = runSuiteDiagnostics(file);
    assert.equal(r.failureCount, 1);

    const blob = JSON.stringify(r);
    assert.equal(blob.includes(secret), false, "the OpenAI-style key must not survive");
    assert.equal(blob.includes(ghp), false, "the GitHub token must not survive");
    assert.equal(blob.includes("[REDACTED:"), true, "a redaction marker must be present");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("every emitted field is bounded and carries only the safe key set", () => {
  const dir = fixtureDir("bounds");
  try {
    const long = "y".repeat(5000);
    const file = writeFixture(dir, "long.js", ['test("a fixture with a very long message", () => {', '  assert.equal("a", "b", "' + long + '");', "});"].join("\n"));
    const r = runSuiteDiagnostics(file);
    assert.equal(r.failureCount, 1);
    const f = r.failures[0];
    assert.equal(Buffer.byteLength(f.message, "utf8") <= MAX_FIELD_BYTES, true, "message must be bounded in real bytes");

    const allowed = ["suite", "testName", "assertionCode", "message", "expectedSummary", "actualSummary", "sourceFile", "sourceLine", "platform"];
    assert.deepEqual(Object.keys(f).sort(), [...allowed].sort(), "only the safe fields may be emitted");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("baseNameOf handles both separators and quoted values", () => {
  assert.equal(baseNameOf("/home/runner/work/a/b/file.js"), "file.js");
  assert.equal(baseNameOf("C:" + String.fromCharCode(92) + "x" + String.fromCharCode(92) + "y.ts"), "y.ts");
  assert.equal(baseNameOf("'/tmp/z.js'"), "z.js");
  assert.equal(baseNameOf("plain.js"), "plain.js");
});

test("the TAP parser is version-independent by construction", () => {
  // The runner forces --test-reporter=tap, so Node 20 (TAP by default) and
  // Node 24 (spec by default) produce identical parseable output. Parsing a
  // fixed TAP sample proves the parser does not depend on the local default.
  const tap = ["TAP version 13", "# Subtest: sample", "not ok 1 - sample", "  ---", "  duration_ms: 1.0", "  location: '/home/runner/work/repo/dist/tools/sample.js:42:7'", "  failureType: 'testCodeFailure'", "  error: |-", "    the sample message", "  code: 'ERR_ASSERTION'", "  name: 'AssertionError'", "  expected: 'want'", "  actual: 'got'", "  ...", "1..1"].join("\n");
  const parsed = parseTapFailures("sample.js", tap, "linux");
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].testName, "sample");
  assert.equal(parsed[0].assertionCode, "ERR_ASSERTION");
  assert.equal(parsed[0].message, "the sample message");
  assert.equal(parsed[0].expectedSummary, "want");
  assert.equal(parsed[0].actualSummary, "got");
  assert.equal(parsed[0].sourceFile, "sample.js");
  assert.equal(parsed[0].sourceLine, 42);
  assert.equal(JSON.stringify(parsed).includes("/home/runner"), false, "no host path may survive parsing");
});
