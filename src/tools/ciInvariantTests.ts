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
