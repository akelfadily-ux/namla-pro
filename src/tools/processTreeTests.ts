/**
 * processTreeTests — proof that a provider's whole tree dies, not just its root.
 *
 * Most tests use `FakeProcessTreeDriver`, which models a tree and signals
 * nothing. One test uses a REAL local fixture (node -> node -> node, all
 * harmless sleepers) to prove the observed defect and the real driver's fix.
 * The fixture calls no provider, no npm install, no git, and no network.
 *
 * Run: node --test dist/tools/processTreeTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "child_process";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { resolve, join } from "path";
import {
  FakeProcessTreeDriver,
  NodeProcessTreeDriver,
  buildProcessTreeHandle,
  buildCleanupReceipt,
  platformKind,
  DEFAULT_TERMINATION_POLICY,
  type ProcessTreeHandle,
  type ProcessTreeCleanupReceipt,
} from "../cognitive/processTree";

const POLICY = DEFAULT_TERMINATION_POLICY;

/** root 100 -> children 200, 201 -> grandchild 300 under 200. */
const TREE = { 100: [200, 201], 200: [300], 201: [], 300: [] } as const;

function handle(rootPid = 100, overrides: Partial<ProcessTreeHandle> = {}): ProcessTreeHandle {
  return { rootPid, processGroupCreated: true, expectedImageBasename: "codex", spawnSequence: 1, ...overrides };
}

// ------------------------------------------------------- FULL TERMINATION ---

test("a root with two children and one grandchild is fully terminated", () => {
  const d = new FakeProcessTreeDriver({ tree: TREE });
  const r = d.terminate(handle(), POLICY, "provider-timeout", 5000);

  assert.equal(r.descendantsTargeted, 3, "two children and one grandchild");
  assert.equal(r.descendantsRemaining, 0);
  assert.equal(r.cleanupComplete, true);
  assert.equal(r.safeReasonCode, "provider-timeout");
  for (const pid of [100, 200, 201, 300]) assert.equal(d.isAlive(pid), false, `pid ${pid} must be dead`);
});

test("graceful termination succeeds without escalating to force", () => {
  const d = new FakeProcessTreeDriver({ tree: TREE, gracefulSucceeds: true });
  const r = d.terminate(handle(), POLICY, "provider-timeout", 5000);
  assert.equal(r.gracefulAttempted, true);
  assert.equal(r.gracefulSucceeded, true);
  assert.equal(r.forcedAttempted, false, "force must NOT be attempted when graceful worked");
  assert.equal(r.forcedSucceeded, false);
  assert.equal(r.cleanupComplete, true);
});

test("graceful failure activates forced termination", () => {
  const d = new FakeProcessTreeDriver({ tree: TREE, gracefulSucceeds: false, forceSucceeds: true });
  const r = d.terminate(handle(), POLICY, "provider-timeout", 5000);
  assert.equal(r.gracefulAttempted, true);
  assert.equal(r.gracefulSucceeded, false);
  assert.equal(r.forcedAttempted, true, "force must follow a failed graceful attempt");
  assert.equal(r.forcedSucceeded, true);
  assert.equal(r.cleanupComplete, true);
  assert.equal(r.descendantsRemaining, 0);
});

test("forced failure reports cleanup incomplete rather than claiming success", () => {
  const d = new FakeProcessTreeDriver({ tree: TREE, gracefulSucceeds: false, forceSucceeds: false });
  const r = d.terminate(handle(), POLICY, "provider-timeout", 5000);
  assert.equal(r.forcedAttempted, true);
  assert.equal(r.forcedSucceeded, false);
  assert.equal(r.cleanupComplete, false, "must not claim completion it cannot prove");
  assert.equal(r.descendantsRemaining, 3);
  assert.equal(r.safeReasonCode, "process-tree-force-termination-failed");
});

test("force is skipped when policy forbids it, and incompleteness is reported", () => {
  const d = new FakeProcessTreeDriver({ tree: TREE, gracefulSucceeds: false });
  const r = d.terminate(handle(), { ...POLICY, forceAfterGrace: false }, "provider-timeout", 5000);
  assert.equal(r.forcedAttempted, false);
  assert.equal(r.cleanupComplete, false);
  assert.equal(r.safeReasonCode, "process-tree-graceful-termination-failed");
});

// -------------------------------------------------------------- LIFECYCLE ---

test("timeout invokes cleanup exactly once", () => {
  const d = new FakeProcessTreeDriver({ tree: TREE });
  d.terminate(handle(), POLICY, "provider-timeout", 5000);
  assert.equal(d.cleanupCallCount, 1);
});

test("cancellation invokes cleanup exactly once and is labelled correctly", () => {
  const d = new FakeProcessTreeDriver({ tree: TREE });
  const r = d.terminate(handle(), POLICY, "provider-cancelled", 5000);
  assert.equal(d.cleanupCallCount, 1);
  assert.equal(r.terminationReason, "provider-cancelled");
  assert.equal(r.safeReasonCode, "provider-cancelled");
  assert.equal(r.cleanupComplete, true);
});

test("every lifecycle exit path produces a cleanup receipt", () => {
  for (const reason of ["completed", "provider-timeout", "provider-cancelled", "parser-rejected", "request-rejected", "driver-error", "parent-shutdown"] as const) {
    const d = new FakeProcessTreeDriver({ tree: TREE });
    const r = d.terminate(handle(), POLICY, reason, 5000);
    assert.equal(r.terminationReason, reason);
    assert.equal(d.cleanupCallCount, 1, `${reason} must clean exactly once`);
    assert.equal(r.cleanupComplete, true);
  }
});

test("the same PID cannot be cleaned twice", () => {
  const d = new FakeProcessTreeDriver({ tree: TREE });
  const first = d.terminate(handle(), POLICY, "provider-timeout", 5000);
  assert.equal(first.cleanupComplete, true);
  const signalledAfterFirst = d.signalledPids.length;

  const second = d.terminate(handle(), POLICY, "provider-timeout", 5000);
  assert.equal(second.descendantsTargeted, 0, "a second cleanup must target nothing");
  assert.equal(second.gracefulAttempted, false, "a second cleanup must not signal again");
  assert.equal(d.signalledPids.length, signalledAfterFirst, "no additional PID may be signalled");
});

// --------------------------------------------------------------- SAFETY ---

test("an identity mismatch is refused WITHOUT signalling anything", () => {
  const d = new FakeProcessTreeDriver({ tree: TREE, identityMatches: false });
  const r = d.terminate(handle(), POLICY, "provider-timeout", 5000);
  assert.equal(r.safeReasonCode, "process-tree-identity-mismatch");
  assert.equal(r.cleanupComplete, false);
  // The whole point: a recycled PID must not be killed.
  assert.equal(d.signalledPids.length, 0, "nothing may be signalled on identity mismatch");
  for (const pid of [100, 200, 201, 300]) assert.equal(d.isAlive(pid), true, "no process may be killed");
});

test("an unrelated process is never signalled", () => {
  // 999 is alive in the model but is NOT descended from the root.
  const d = new FakeProcessTreeDriver({ tree: { ...TREE, 999: [] } });
  d.terminate(handle(), POLICY, "completed", 5000);
  assert.equal(d.signalledPids.includes(999), false, "an unrelated pid must never be signalled");
  assert.equal(d.isAlive(999), true, "an unrelated process must survive");
});

test("an unsupported platform is reported, not silently treated as success", () => {
  const d = new FakeProcessTreeDriver({ tree: TREE, platform: "unsupported" });
  const r = d.terminate(handle(), POLICY, "provider-timeout", 5000);
  assert.equal(r.safeReasonCode, "process-tree-platform-unsupported");
  assert.equal(r.cleanupComplete, false);
  assert.equal(d.signalledPids.length, 0);
});

test("a cleanup receipt carries only safe metadata", () => {
  const d = new FakeProcessTreeDriver({ tree: TREE });
  const r = d.terminate(handle(), POLICY, "provider-timeout", 5000);
  const allowed = ["rootProcessId", "platform", "terminationReason", "gracefulAttempted", "gracefulSucceeded", "forcedAttempted", "forcedSucceeded", "descendantsTargeted", "descendantsRemaining", "cleanupComplete", "timeoutMs", "safeReasonCode", "safeFingerprint"];
  assert.deepEqual(Object.keys(r).sort(), [...allowed].sort(), "receipt must carry exactly the safe fields");

  const json = JSON.stringify(r);
  for (const forbidden of ["sk-", "ghp_", "Authorization", "Cookie", "PATH", "taskkill", "--print", "prompt"]) {
    assert.equal(json.includes(forbidden), false, `receipt must not contain ${forbidden}`);
  }
  assert.match(r.safeFingerprint, /^pt-[0-9a-f]{8}$/);
});

test("identical safe cleanups fingerprint identically; different ones differ", () => {
  const base = { rootProcessId: 1, platform: "posix" as const, terminationReason: "provider-timeout" as const, gracefulAttempted: true, gracefulSucceeded: true, forcedAttempted: false, forcedSucceeded: false, descendantsTargeted: 2, descendantsRemaining: 0, cleanupComplete: true, timeoutMs: 1000, safeReasonCode: "provider-timeout" as const };
  assert.equal(buildCleanupReceipt(base).safeFingerprint, buildCleanupReceipt(base).safeFingerprint);
  assert.notEqual(buildCleanupReceipt(base).safeFingerprint, buildCleanupReceipt({ ...base, descendantsRemaining: 1 }).safeFingerprint);
});

test("a handle is refused for an invalid pid, so nothing can be signalled", () => {
  // The executable path must be PLATFORM-NATIVE. `path.basename` does not treat
  // a backslash as a separator on POSIX, so a hard-coded "C:\\bin\\codex.exe"
  // yielded the whole string as the basename on Linux and macOS and the
  // assertion failed there. Production cannot hit this: the value passed to
  // buildProcessTreeHandle is `resolved.value.command`, which is realpathSync
  // output and therefore always native. This was a test assumption, not a
  // defect in PID validation - which is deliberately left unchanged.
  const nativeExe = process.platform === "win32" ? "C:\\bin\\codex.exe" : "/usr/bin/codex";
  const expectedBasename = process.platform === "win32" ? "codex.exe" : "codex";

  for (const bad of [undefined, 0, -1, 1.5]) {
    assert.equal(buildProcessTreeHandle(bad as number | undefined, nativeExe, false, 1), null, `pid ${String(bad)} must yield no handle`);
  }
  const good = buildProcessTreeHandle(4321, nativeExe, false, 7);
  assert.equal(good?.rootPid, 4321);
  assert.equal(good?.expectedImageBasename, expectedBasename, "identity is pinned to the platform-native basename");
});

test("PID validation itself is unchanged and still refuses every invalid pid", () => {
  // Guards the fix above: relaxing the path form must not have relaxed the pid
  // rule. Every non-positive-integer pid yields NO handle, so nothing can be
  // signalled, on every platform.
  const exe = process.platform === "win32" ? "C:\\bin\\codex.exe" : "/usr/bin/codex";
  for (const bad of [undefined, 0, -1, -4321, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(buildProcessTreeHandle(bad as number | undefined, exe, false, 1), null, `pid ${String(bad)} must yield no handle`);
  }
  for (const good of [1, 42, 4321, 999999]) {
    assert.equal(buildProcessTreeHandle(good, exe, false, 1)?.rootPid, good, `pid ${good} must yield a handle`);
  }
});

// -------------------------------------------------- REAL LOCAL FIXTURE ---

test("REAL fixture: a detached descendant survives a single-process kill and the tree driver reaps it", (t) => {
  const dir = mkdtempSync(resolve(tmpdir(), "namla-tree-"));
  const spawned: number[] = [];
  try {
    // Harmless sleepers. No provider, no npm, no git, no network.
    writeFileSync(join(dir, "sleeper.js"), "setTimeout(() => process.exit(0), 30000);\n", "utf8");
    writeFileSync(join(dir, "root.js"), ["const { spawn } = require('child_process');", "const fs = require('fs'); const path = require('path');", "const c = spawn(process.execPath, [path.join(__dirname, 'sleeper.js')], { stdio: 'ignore', detached: true });", "c.unref();", "fs.writeFileSync(process.argv[2], String(c.pid));", "setTimeout(() => process.exit(0), 30000);"].join("\n"), "utf8");

    const pidFile = join(dir, "detached.pid");
    // Exactly the pre-fix strategy: spawnSync + timeout + SIGKILL.
    const outcome = spawnSync(process.execPath, [join(dir, "root.js"), pidFile], { shell: false, timeout: 2000, killSignal: "SIGKILL", windowsHide: true, encoding: "utf8" });

    let detachedPid = 0;
    try {
      detachedPid = Number(require("fs").readFileSync(pidFile, "utf8"));
    } catch {
      t.skip("fixture did not reach the detach step on this host");
      return;
    }
    spawned.push(detachedPid);
    const alive = (pid: number): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };

    // THE DEFECT: the root is dead, the detached descendant is not.
    assert.equal(alive(outcome.pid ?? 0), false, "the root must be dead after the timeout kill");
    if (!alive(detachedPid)) {
      t.skip("this host reaped the detached descendant automatically; orphan survival unverified here");
      return;
    }

    // THE FIX: the real tree driver reaps it.
    const driver = new NodeProcessTreeDriver();
    const h = buildProcessTreeHandle(detachedPid, process.execPath, false, 1);
    assert.notEqual(h, null);
    const receipt: ProcessTreeCleanupReceipt = driver.terminate(h as ProcessTreeHandle, { ...POLICY, gracePeriodMs: 500 }, "provider-timeout", 2000);

    assert.equal(receipt.platform, platformKind());
    assert.equal(alive(detachedPid), false, "the orphan must be gone after tree termination");
    assert.equal(receipt.cleanupComplete, true, "cleanup must be reported complete only when it is");
  } finally {
    for (const pid of spawned) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* already dead */
      }
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no timer or handle is left active by cleanup", () => {
  const before = (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.().length ?? 0;
  const d = new FakeProcessTreeDriver({ tree: TREE });
  d.terminate(handle(), POLICY, "provider-timeout", 5000);
  const after = (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.().length ?? 0;
  assert.equal(after <= before, true, "cleanup must not leave a handle or timer active");
});

test("no provider retry and no real action occurs", () => {
  const d = new FakeProcessTreeDriver({ tree: TREE });
  d.terminate(handle(), POLICY, "provider-timeout", 5000);
  d.terminate(handle(), POLICY, "provider-timeout", 5000);
  assert.equal(d.isReal, false, "these tests use the fake driver only");
  // Two terminate calls, ZERO spawns: cleanup never re-runs the provider.
  assert.equal(d.cleanupCallCount, 2);
  assert.equal(d.signalledPids.filter((p) => p === 100).length, 1, "the root is signalled once, never retried");
});

/** Keep the async spawn import referenced without ever starting a process. */
export const __unusedSpawnGuard = typeof spawn === "function";
