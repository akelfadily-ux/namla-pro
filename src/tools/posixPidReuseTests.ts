/**
 * posixPidReuseTests — S-11. Proof that POSIX termination refuses rather than
 * signalling a process it cannot prove it owns.
 *
 * THE ARCHITECTURAL FACT THIS RESTS ON. `spawnSync` does not return until the
 * child has fully closed, so by the time the provider driver builds a handle
 * the root is already exited and reaped. Measured: `process.kill(outcome.pid, 0)`
 * throws immediately after return. Two consequences, and the second is the one
 * that makes a per-PID identity check insufficient:
 *
 *   ROOT     nothing observed after the child is gone can identify it. A live
 *            process at that number proves only that SOMETHING is there.
 *   LINEAGE  the tree cannot be recovered either. If the number was reused by
 *            an unrelated process B, "descendants of <pid>" returns B's real
 *            children — each with a valid, stable start time that passes any
 *            per-process identity check. IDENTITY IS NOT LINEAGE.
 *
 * So S-11 does not try to re-identify anything. It refuses: no enumeration for
 * signalling, no SIGTERM, no SIGKILL, and a receipt that says the tree was not
 * cleaned. Best-effort cleanup is given up in exchange for making it impossible
 * to SIGKILL a stranger.
 *
 * NOTHING HERE SIGNALS ANYTHING. Production contains no POSIX signal site at
 * all after this milestone, so these tests assert an absence that is structural
 * rather than conditional.
 *
 * Run: node --test dist/tools/posixPidReuseTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { NodeProcessTreeDriver, buildProcessTreeHandle, DEFAULT_TERMINATION_POLICY, type ProcessTreeHandle } from "../cognitive/processTree";

const POLICY = { ...DEFAULT_TERMINATION_POLICY, gracePeriodMs: 0 };

/** A POSIX driver that also records whether enumeration was ever requested. */
function posixDriver(onEnumeration?: () => void) {
  return new NodeProcessTreeDriver({ platform: "linux", ...(onEnumeration ? { onPosixEnumeration: onEnumeration } : {}) });
}

function handle(pid: number, groupCreated = false, basename = "node"): ProcessTreeHandle {
  return { rootPid: pid, processGroupCreated: groupCreated, expectedImageBasename: basename, spawnSequence: 1 };
}

/** The refusal contract, asserted in one place so every case checks all of it. */
function assertRefused(receipt: ReturnType<NodeProcessTreeDriver["terminate"]>, why: string): void {
  assert.equal(receipt.gracefulAttempted, false, `${why}: no graceful signal may be attempted`);
  assert.equal(receipt.forcedAttempted, false, `${why}: no forced signal may be attempted`);
  assert.equal(receipt.gracefulSucceeded, false, `${why}: nothing succeeded, because nothing was tried`);
  assert.equal(receipt.forcedSucceeded, false, `${why}: nothing succeeded, because nothing was tried`);
  assert.equal(receipt.cleanupComplete, false, `${why}: an unproven tree is never a clean sweep`);
  assert.equal(receipt.safeReasonCode, "process-tree-identity-mismatch", `${why}: refusal must not borrow a success code`);
  assert.equal(receipt.descendantsTargeted, 0, `${why}: nothing may be targeted`);
}

// ================================================== ROOT PID IS NOT PROOF ===

test("S11-A: a post-hoc identity for a RECYCLED root authorizes nothing", () => {
  // The original root exited inside spawnSync. Whatever occupies 4242 now may
  // be perfectly real and perfectly identifiable — it is still not our child,
  // and no probe run after the fact can tell the difference.
  assertRefused(posixDriver().terminate(handle(4242), POLICY, "provider-timeout", 1000), "recycled root");
});

test("S11-B: a recycled root with a VALID descendant tree is still refused entirely", () => {
  // The case that defeats per-process identity: process B inherited the number
  // and has genuine children, each with a stable start time that would satisfy
  // any per-PID identity check. Lineage to OUR provider is what is missing, and
  // no amount of per-process evidence supplies it.
  let enumerated = false;
  const receipt = posixDriver(() => {
    enumerated = true;
  }).terminate(handle(4242), POLICY, "provider-timeout", 1000);

  assertRefused(receipt, "recycled root with valid descendants");
  assert.equal(enumerated, false, "the descendant list is never even requested — having it invites trusting it");
});

test("S11-C: the same PID with the same executable basename is still refused", () => {
  // A recycled `node` matches the handle's basename exactly. That is precisely
  // why basename is corroboration and never identity.
  assertRefused(posixDriver().terminate(handle(4242, false, "node"), POLICY, "provider-timeout", 1000), "same basename");
});

test("S11-D: a plausible post-hoc start time is still refused", () => {
  // Even a strong, stable, correctly-parsed instance identity means nothing if
  // it was obtained after ownership was already lost. The refusal does not
  // depend on the probe failing — there is no probe on this path at all.
  assertRefused(posixDriver().terminate(handle(4242), POLICY, "provider-timeout", 1000), "post-hoc start time");
});

test("S11-F: no pre-captured ownership means zero destructive signals", () => {
  // The real provider handle, built the way the driver builds it.
  const built = buildProcessTreeHandle(4242, "/usr/bin/node", false, 1);
  assert.notEqual(built, null);
  assert.equal((built as ProcessTreeHandle).processGroupCreated, false, "spawnSync creates no group, and the handle says so");
  assertRefused(posixDriver().terminate(built as ProcessTreeHandle, POLICY, "provider-timeout", 1000), "no pre-captured ownership");
});

test("S11-G: the destructive path never consumes a stale-root descendant list", () => {
  // Enumeration is refused BEFORE it happens, for every reason and every policy.
  for (const reason of ["provider-timeout", "provider-cancelled", "completed", "driver-error"] as const) {
    let enumerated = false;
    const r = posixDriver(() => {
      enumerated = true;
    }).terminate(handle(4242), { ...POLICY, forceAfterGrace: true, maxDescendants: 256 }, reason, 1000);
    assert.equal(enumerated, false, `${reason}: no enumeration for signalling`);
    assert.equal(r.descendantsTargeted, 0, `${reason}: no targets`);
    assert.equal(r.cleanupComplete, false, `${reason}: no completeness claim`);
  }
});

test("S11-H: liveness does not authorize — our own live PID is still refused", () => {
  // `process.pid` is unquestionably alive and signal-visible. Under the old
  // rule that was enough to proceed. It authorizes nothing now, and asserting
  // it against our OWN pid makes the point without risking anything.
  assertRefused(posixDriver().terminate(handle(process.pid), POLICY, "provider-timeout", 1000), "live pid");
});

test("S11-I: a bare processGroupCreated=true boolean grants no destructive authority", () => {
  // A field is not a capability. Any caller can construct this handle, and an
  // audit found ZERO production callers that pass true and no `detached: true`
  // anywhere in production — so the group path is refused on the same terms as
  // every other POSIX handle.
  assertRefused(posixDriver().terminate(handle(4242, true), POLICY, "provider-timeout", 1000), "claimed group");
  assertRefused(posixDriver().terminate(handle(process.pid, true), POLICY, "provider-timeout", 1000), "claimed group, live pid");
});

// ======================================================= STRUCTURAL PROOF ===

test("S11-E: no lstart-style identity primitive exists to be abused", () => {
  // Apple documents `ps -o lstart` as strftime %c — SECOND resolution. Two
  // instances can share a PID after reuse, a basename, and a printed second, so
  // it can never distinguish them. The earlier draft of S-11 accepted that
  // string as identity; the primitive is gone rather than merely unused, so it
  // cannot be reached by a future caller.
  const src = readFileSync("src/cognitive/processTree.ts", "utf8");
  assert.equal(/lstart/i.test(src), false, "no lstart parsing may exist in production");
  assert.equal(/parseDarwinLstart|defaultProcessIdentityProbe/.test(src), false, "no identity-probe authorization primitive may exist");
});

test("production contains NO POSIX destructive signal site at all", () => {
  // The strongest form of "recycled PIDs cannot be killed": there is no code
  // that could kill one. `kill(pid, 0)` remains, and is a liveness observation
  // that sends no signal.
  const src = readFileSync("src/cognitive/processTree.ts", "utf8");
  const killSites = [...src.matchAll(/process\.kill\(([^)]*)\)/g)].map((m) => m[1].trim());
  for (const args of killSites) {
    assert.equal(/SIGTERM|SIGKILL/.test(args), false, `no destructive signal may remain: process.kill(${args})`);
    assert.equal(args.includes("-"), false, `no negative-PID group signal may remain: process.kill(${args})`);
  }
  assert.equal(/SIGTERM|SIGKILL/.test(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), false, "no destructive signal constant survives outside comments");
});

test("Windows is untouched by the POSIX refusal", () => {
  // The refusal is gated on the POSIX branch; a Windows handle still reaches
  // the S-10 machinery. Asserted through the platform seam so it holds here.
  const win = new NodeProcessTreeDriver({ platform: "win32", toolResolver: () => ({ ok: false, value: null, reasonCode: "tool-not-found" }) });
  const r = win.terminate(handle(4242), POLICY, "provider-timeout", 1000);
  assert.equal(r.platform, "win32", "the Windows branch still runs");
  // With no trusted tasklist the Windows path refuses on its own terms — the
  // S-10 semantics, not the S-11 POSIX rule.
  assert.equal(r.cleanupComplete, false);
});

test("an unsupported platform keeps its own distinct reason code", () => {
  const r = new NodeProcessTreeDriver({ platform: "haiku" as NodeJS.Platform }).terminate(handle(4242), POLICY, "completed", 1000);
  assert.equal(r.safeReasonCode, "process-tree-platform-unsupported", "unsupported is not conflated with unproven");
  assert.equal(r.cleanupComplete, false);
});
