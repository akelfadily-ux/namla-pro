/**
 * ciInvariantTests — makes the cross-platform matrix mean something.
 *
 * An honest skip is the right answer when a platform genuinely cannot perform
 * an operation. It becomes a LIE the moment it is used on a platform that can:
 * "skipped" then reads as "fine" forever, and the escape it was meant to prove
 * is silently never tested anywhere.
 *
 * So these tests invert the relationship. On Linux and macOS, where file
 * symlinks and POSIX process groups are always available, a skip in the
 * corresponding security test is a FAILURE. This file asserts the platform
 * capability directly, so if a security suite skips on a platform that supports
 * the operation, this suite fails and the CI job fails with it.
 *
 * On Windows it asserts the opposite direction: junctions must work (they do,
 * unprivileged), and a file-symlink skip is permitted ONLY when the platform
 * genuinely refuses creation.
 *
 * Run: node --test dist/tools/ciInvariantTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { parseSkips } from "./p0SecurityRunner";
import { mkdtempSync, writeFileSync, symlinkSync, rmSync, lstatSync } from "fs";
import { spawn } from "child_process";
import { tmpdir } from "os";
import { resolve, join } from "path";
import { FakeSandboxBackend, projectSandbox, describeSandbox, detectContainerRuntime } from "../cognitive/sandboxPolicy";
import { evaluateNetworkCapability, projectNetwork, UnobservedNetworkProvider, TOOL_NETWORK_DECLARATIONS } from "../cognitive/networkPolicy";
import { platformKind } from "../cognitive/processTree";

const PLATFORM = process.platform;
const IS_POSIX = PLATFORM === "linux" || PLATFORM === "darwin";
const IS_WINDOWS = PLATFORM === "win32";

function tempDir(tag: string): string {
  return mkdtempSync(resolve(tmpdir(), `namla-ci-${tag}-`));
}

/** Can this platform create a FILE symlink? Answered by trying, not by guessing. */
function canCreateFileSymlink(): boolean {
  const dir = tempDir("filelink");
  try {
    const target = join(dir, "target.txt");
    writeFileSync(target, "x", "utf8");
    symlinkSync(target, join(dir, "link.txt"), "file");
    return lstatSync(join(dir, "link.txt")).isSymbolicLink();
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Can this platform create a DIRECTORY link (junction on Windows)? */
function canCreateDirLink(): boolean {
  const dir = tempDir("dirlink");
  try {
    const target = join(dir, "targetdir");
    require("fs").mkdirSync(target, { recursive: true });
    symlinkSync(target, join(dir, "link"), IS_WINDOWS ? "junction" : "dir");
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ------------------------------------------------ PLATFORM SKIP ENFORCEMENT ---

test("LINUX/MACOS: file symlinks MUST be creatable — no honest skip is permitted", () => {
  if (!IS_POSIX) {
    // On Windows this expectation does not apply; the Windows test below runs.
    assert.equal(IS_WINDOWS, true, `unexpected platform ${PLATFORM}`);
    return;
  }
  assert.equal(
    canCreateFileSymlink(),
    true,
    `file symlink creation MUST succeed on ${PLATFORM}. If this fails, the file-symlink ` +
      `containment test and the symlinked-executable refusal test are skipping on a platform ` +
      `that supports them, which means those escapes are untested everywhere.`
  );
});

test("LINUX/MACOS: directory symlinks MUST be creatable — nested escape must really run", () => {
  if (!IS_POSIX) return;
  assert.equal(canCreateDirLink(), true, `directory symlink creation MUST succeed on ${PLATFORM}; nested symlink escape cannot be skipped here`);
});

test("LINUX/MACOS: POSIX process groups MUST be available — tree termination cannot skip", () => {
  if (!IS_POSIX) return;
  assert.equal(platformKind(), "posix", "process-tree driver must take the POSIX branch");

  // `kill(-N, …)` addresses the process GROUP whose id is N, and a group with
  // id N exists only if some process is a group LEADER with pid N. This test
  // previously signalled `-process.pid`, which assumed THIS process is its own
  // group leader. Under a CI shell it is not: node inherits the shell's pgid,
  // so `kill(-process.pid, 0)` raises ESRCH and the assertion failed for a
  // reason that had nothing to do with process groups being unavailable.
  //
  // Spawning with `detached: true` calls setsid(), which makes the child a
  // group leader with pgid === child.pid. Addressing THAT group is the exact
  // primitive the process-tree driver relies on, so this is both correct and a
  // stronger proof than the original.
  const child = spawn(process.execPath, ["-e", "setTimeout(() => process.exit(0), 10000)"], { detached: true, stdio: "ignore" });
  child.unref();
  try {
    assert.equal(typeof child.pid, "number", "the child must have a pid");
    const pid = child.pid as number;
    // Signal 0 delivers nothing; it only checks that the group exists and is
    // addressable. If this throws, POSIX group termination is genuinely
    // unavailable and no test may honestly skip on that basis.
    assert.doesNotThrow(() => {
      process.kill(-pid, 0);
    }, "kill(-pgid, 0) must work against a detached child's own group; POSIX process-group termination cannot be honestly skipped");

    // And the group must actually be killable, which is what termination needs.
    process.kill(-pid, "SIGKILL");
  } finally {
    try {
      process.kill(child.pid as number, "SIGKILL");
    } catch {
      /* already dead */
    }
  }
});

test("WINDOWS: junctions MUST be creatable — junction containment cannot skip", () => {
  if (!IS_WINDOWS) return;
  assert.equal(canCreateDirLink(), true, "Windows junction creation must succeed unprivileged; junction containment tests must really run");
  assert.equal(platformKind(), "win32");
});

test("WINDOWS: a file-symlink skip is permitted ONLY when creation genuinely fails", () => {
  if (!IS_WINDOWS) return;
  const possible = canCreateFileSymlink();
  // Either outcome is acceptable on Windows, but it must be REPORTED, never
  // assumed. Developer Mode or elevation makes this true and then the
  // file-symlink tests must run rather than skip.
  if (possible) {
    assert.equal(possible, true, "this runner CAN create file symlinks, so file-symlink tests must not skip");
  } else {
    assert.equal(possible, false, "this runner cannot create file symlinks — the skip is honest and the escape stays UNVERIFIED on Windows");
  }
});

// ------------------------------------------------- PROJECTION HONESTY GATES ---

test("an unavailable or unverified sandbox is NEVER projected as sandboxed", () => {
  for (const state of ["unavailable", "available-unverified", "fake-test-backend"] as const) {
    const p = projectSandbox(new FakeSandboxBackend(state).detectCapability());
    assert.equal(p.sandboxVerified, false, `${state} must not be verified`);
    assert.equal(p.sandboxExecutionBlocked, true, `${state} must block execution`);
    assert.equal(p.sandboxLimits, "none-enforced", `${state} must not claim enforced limits`);
    assert.equal(describeSandbox(p).includes("NOT SANDBOXED"), true, `${state} must render as NOT SANDBOXED`);
  }
  // And the REAL capability of this runner obeys the same rule.
  const real = projectSandbox(detectContainerRuntime());
  if (!real.sandboxVerified) {
    assert.equal(real.sandboxExecutionBlocked, true, "an unverified runner must block high-risk execution");
  }
});

test("an unknown network observation is NEVER projected as zero", () => {
  const receipt = evaluateNetworkCapability({ declaration: TOOL_NETWORK_DECLARATIONS.claude, grantedPolicy: "provider-only", observationProvider: new UnobservedNetworkProvider(), sequence: 1 });
  const p = projectNetwork(receipt);
  assert.equal(p.networkObservation, "unknown");
  assert.equal(p.observedNetworkCallCount, null, "unknown MUST be null, never 0");
  assert.notEqual(p.observedNetworkCallCount, 0);
  assert.equal(p.networkEvidenceAvailable, false);
  // Serialization must not silently coerce it either.
  assert.equal(JSON.stringify(p).includes('"observedNetworkCallCount":0'), false);
});

test("the platform is reported explicitly so a matrix job cannot be mistaken", () => {
  assert.equal(["win32", "linux", "darwin"].includes(PLATFORM), true, `unexpected CI platform: ${PLATFORM}`);
  assert.equal(["win32", "posix"].includes(platformKind()), true);
});

// ================= SKIP-NAME PARSER, BOTH node:test REPORTERS ==============
// CI run 31882257990 failed on windows-latest with:
//   "parsed 0 skip names but the runner reported 2 skipped —
//    skip enforcement cannot be trusted"
//
// The guard was right and the parser was wrong. `node:test` emits the spec
// shape when stdout is a TTY and the TAP shape otherwise, and CI pins Node 20,
// where every `spawnSync` run is non-TTY. The runner only understood spec, so
// on every CI platform it parsed zero names while the summary counted skips.
//
// These fixtures are the literal shapes both reporters produce.

const SPEC_OUTPUT = [
  "✔ a trusted candidate resolves (1.2345ms)",
  "﹣ a file replaced by a SYMLINK after trust is refused (3.2595ms) # platform does not permit file symlink creation",
  "﹣ POSIX: a world-writable parent directory is refused (0.2516ms) # win32 has no POSIX mode bits",
  "✖ something failed (0.9ms)",
  "ℹ tests 4",
  "ℹ pass 1",
  "ℹ fail 1",
  "ℹ skipped 2",
].join("\n");

/** The exact shape Node 20 emits under CI — the one that parsed zero names. */
const TAP_OUTPUT = [
  "TAP version 13",
  "ok 1 - a trusted candidate resolves",
  "ok 19 - a file replaced by a SYMLINK after trust is refused # SKIP platform does not permit file symlink creation",
  "ok 23 - POSIX: a world-writable parent directory is refused # SKIP win32 has no POSIX mode bits",
  "not ok 24 - something failed",
  "# tests 4",
  "# pass 1",
  "# fail 1",
  "# skipped 2",
].join("\n");

test("the SPEC reporter's skip lines are parsed with names and reasons", () => {
  const { skippedNames, skipReasons } = parseSkips(SPEC_OUTPUT);
  assert.equal(skippedNames.length, 2, "both skips are named");
  assert.equal(skippedNames[0], "a file replaced by a SYMLINK after trust is refused");
  assert.equal(skippedNames[1], "POSIX: a world-writable parent directory is refused");
  assert.equal(skipReasons[0], "platform does not permit file symlink creation");
  assert.equal(skipReasons[1], "win32 has no POSIX mode bits");
});

test("the TAP reporter's skip lines are parsed — the exact CI shape that parsed zero", () => {
  const { skippedNames, skipReasons } = parseSkips(TAP_OUTPUT);
  assert.equal(skippedNames.length, 2, "the CI shape must yield the same two names");
  assert.equal(skippedNames[0], "a file replaced by a SYMLINK after trust is refused");
  assert.equal(skippedNames[1], "POSIX: a world-writable parent directory is refused");
  assert.equal(skipReasons[0], "platform does not permit file symlink creation");
  assert.equal(skipReasons[1], "win32 has no POSIX mode bits");
});

test("both reporters yield IDENTICAL skip accounting for the same run", () => {
  // The property that matters: which reporter Node happens to choose must not
  // change what the gate concludes.
  const spec = parseSkips(SPEC_OUTPUT);
  const tap = parseSkips(TAP_OUTPUT);
  assert.deepEqual(spec.skippedNames, tap.skippedNames);
  assert.deepEqual(spec.skipReasons, tap.skipReasons);
});

test("a FAILING TAP line is never counted as a skip", () => {
  // `not ok` is a failure, not a skip. Counting it would hide a failure and
  // inflate the skip tally.
  const { skippedNames } = parseSkips("not ok 24 - something failed\nnot ok 25 - other # TODO later");
  assert.equal(skippedNames.length, 0);
});

test("a skip with no reason is recorded, not dropped", () => {
  const spec = parseSkips("﹣ nameless (0.1ms)");
  assert.equal(spec.skippedNames.length, 1);
  assert.equal(spec.skipReasons[0], "(no reason given)");
  const tap = parseSkips("ok 3 - nameless # SKIP");
  assert.equal(tap.skippedNames.length, 1);
  assert.equal(tap.skipReasons[0], "(no reason given)");
});

test("the SKIP directive is matched case-insensitively, per the TAP spec", () => {
  assert.equal(parseSkips("ok 1 - a # skip lowercase").skippedNames.length, 1);
  assert.equal(parseSkips("ok 2 - b # Skip mixed").skippedNames.length, 1);
});

test("an UNRECOGNISED shape yields no names, so the gate fails closed", () => {
  // The parser never infers names from a count. An unknown format produces
  // fewer names than the summary reports, which is exactly what made run
  // 31882257990 fail rather than silently pass.
  const unknown = ["~ weird 1 - a skipped thing", "SKIPPED: b", "# skipped 2"].join("\n");
  assert.equal(parseSkips(unknown).skippedNames.length, 0, "no guessing");
});

test("an ASCII hyphen is not mistaken for the skip marker", () => {
  // The spec reporter uses U+FE63, not "-". Accepting "-" would swallow
  // ordinary diagnostic lines as skips.
  assert.equal(parseSkips("- not a skip marker (1ms) # nope").skippedNames.length, 0);
});
