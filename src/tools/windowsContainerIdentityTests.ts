/**
 * windowsContainerIdentityTests — the container EXECUTION identity on Windows
 * (SANDBOX-R0G), and the separation between it and host workspace ownership.
 *
 * THE DISTINCTION THESE LOCK DOWN. Two different questions were answered by one
 * function, and the failure detail asserted the wrong one:
 *
 *   host ownership      - "who owns the host workspace?"  On win32: UNPROVABLE,
 *                         and still reported that way. `statSync` returns
 *                         uid 0 / gid 0 / mode 0666 for a user directory, for
 *                         %TEMP%, and for C:\Windows alike, so it distinguishes
 *                         nothing and is never evidence.
 *   container identity  - "which non-root user should the container run as?"
 *                         On POSIX this must match the host owner so a non-root
 *                         process can write a mode-0700 bind mount. Docker
 *                         Desktop presents the Windows mount as uid 0 / gid 0 /
 *                         mode 0777 regardless of NTFS ACLs, so there is no
 *                         owner to match and the approved image user suffices.
 *
 * WHAT IS NOT CLAIMED. Neither platform proves host exclusivity.
 * `validateIdentity` checks only that the identity is a non-root integer pair;
 * it never checks that a directory rejects other principals. That limitation is
 * shared, not Windows-specific, and these tests deliberately assert nothing
 * about it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import { mkdtempSync, mkdirSync, symlinkSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { resolveContainerExecutionIdentity, resolveTrustedWorkspaceIdentity, validateIdentity, IMAGE_DEFAULT_IDENTITY } from "../cognitive/containerSandboxBackend";
import { composeVerificationSandbox } from "../cognitive/verificationSandbox";
import { validateMountSource } from "../cognitive/safeMountSource";

const IS_WIN = process.platform === "win32";

// ---------------------------------------------------------------------------
// 1. Windows synthetic metadata is never used as provenance.
// ---------------------------------------------------------------------------
test("1: win32 host ownership is never claimed, for any path", () => {
  // The property that actually holds and is worth asserting: on win32 host
  // ownership is NEVER `ok`, whatever path is supplied - an existing directory,
  // a missing one, the repo root, or a system directory.
  for (const p of [process.cwd(), "C:/definitely/not/a/real/path", "C:/Windows", ""]) {
    const r = resolveTrustedWorkspaceIdentity(p, "win32");
    assert.equal(r.ok, false, `win32 host ownership must never be claimed for ${p || "(empty)"}`);
    assert.equal(r.identity, null);
    assert.equal(r.reasonCode, "sandbox-user-not-isolated");
  }

  // WHY REMOVING THE win32 GUARD IS NOT OBSERVABLY DANGEROUS, and why this test
  // does not pretend otherwise. Measured: deleting the guard so the code falls
  // through to `statSync` leaves every case above still refusing, because
  // Windows reports uid 0 / gid 0 for every file and `validateIdentity` rejects
  // root in both positions. A non-vacuity injection against that guard therefore
  // stays GREEN, and asserting it turns red would be asserting something untrue.
  // The guard is clarity and defence-in-depth; the refusal is carried by the
  // root check. That is the honest description, so it is the one recorded here.
  assert.equal(validateIdentity(0, 0).ok, false, "the synthetic 0/0 pair is root and is refused on its own merits");
  assert.equal(validateIdentity(0, 10001).ok, false);
  assert.equal(validateIdentity(10001, 0).ok, false);
});

// ---------------------------------------------------------------------------
// 2. The approved non-root image user is selected on win32.
// ---------------------------------------------------------------------------
test("2: the approved image user is the win32 container execution identity", () => {
  const r = resolveContainerExecutionIdentity("C:/any/workspace", "win32");
  assert.equal(r.ok, true, "a non-root approved identity must be selectable on win32");
  assert.deepEqual(r.identity, IMAGE_DEFAULT_IDENTITY, "it must come from approved image policy, not an invented pair");
  assert.equal(r.identity.uid, 10001);
  assert.equal(r.identity.gid, 10001);
  assert.equal(r.reasonCode, "ok");
  // The path is irrelevant to the identity: nothing about the workspace,
  // its location, or the username string feeds this decision.
  const other = resolveContainerExecutionIdentity("C:/Users/someone/Desktop/x", "win32");
  assert.deepEqual(other.identity, r.identity, "the identity must not vary with the workspace path");
});

// ---------------------------------------------------------------------------
// 3 + 4 + 5. Root, malformed and inconsistent identities are refused.
// ---------------------------------------------------------------------------
test("3/4/5: root, malformed and negative identities are refused by the same gate", () => {
  // 3. Root in either position.
  assert.equal(validateIdentity(0, 10001).ok, false, "uid 0 must be refused");
  assert.equal(validateIdentity(10001, 0).ok, false, "gid 0 must be refused");
  assert.equal(validateIdentity(0, 0).ok, false);
  // 4. Malformed.
  for (const [u, g] of [[NaN, 10001], [10001, NaN], [Infinity, 10001], [1.5, 10001], [-1, 10001]] as const) {
    assert.equal(validateIdentity(u as number, g as number).ok, false, `${String(u)}:${String(g)} must be refused`);
  }
  // 5. The approved policy value itself must satisfy the gate - if it ever
  // became root or malformed, win32 verification must BLOCK rather than run.
  assert.equal(validateIdentity(IMAGE_DEFAULT_IDENTITY.uid, IMAGE_DEFAULT_IDENTITY.gid).ok, true, "approved policy must be a valid non-root identity");
  assert.equal(IMAGE_DEFAULT_IDENTITY.uid > 0 && IMAGE_DEFAULT_IDENTITY.gid > 0, true, "approved policy must be non-root");
});

// ---------------------------------------------------------------------------
// 6. POSIX is unchanged.
// ---------------------------------------------------------------------------
test("6: POSIX still derives the identity from the host workspace owner", () => {
  // On POSIX the execution identity delegates to the host-owner derivation, so
  // the two functions must agree exactly - the win32 branch must not leak.
  for (const platform of ["linux", "darwin"] as const) {
    const viaExecution = resolveContainerExecutionIdentity("/definitely/not/a/real/path", platform);
    const viaHost = resolveTrustedWorkspaceIdentity("/definitely/not/a/real/path", platform);
    assert.deepEqual(viaExecution, viaHost, `${platform} must delegate to the host-owner path`);
    assert.equal(viaExecution.ok, false, "a missing path yields no identity on POSIX");
    // Crucially it must NOT silently substitute the image default.
    assert.equal(viaExecution.identity, null, "POSIX must never fall back to the image user");
  }
});

// ---------------------------------------------------------------------------
// 7 + 8. Host-path safety is still enforced elsewhere, and is unaffected.
// ---------------------------------------------------------------------------
test("7/8: host workspace safety remains a separate, still-enforced concern", (t) => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "namla-r0g-")));
  const root = join(base, "root");
  const outside = join(base, "outside");
  mkdirSync(root);
  mkdirSync(outside);
  let linked = false;
  try {
    symlinkSync(outside, join(root, "link"), "junction");
    linked = true;
  } catch {
    linked = false;
  }
  if (!linked) return t.skip("this host cannot create a junction; reparse refusal UNVERIFIED here");
  // The identity decision says nothing about path safety, and must not be
  // mistaken for it: a traversing workspace is still refused - by the MOUNT
  // VALIDATOR, which is the authoritative resolved-path boundary.
  //
  // This originally asserted composeVerificationSandbox returned null, which
  // passed only while isolation could not be established on this host. Compose
  // applies a LEXICAL pre-filter (`root/link/ws` is lexically inside `root`);
  // the resolved-path check that actually catches a junction lives in
  // `validateMountSource`, used by both verifyIsolation and execute before any
  // container starts. Asserting the real boundary is both true and stronger.
  fs.mkdirSync(join(outside, "ws"), { recursive: true });
  const viaJunction = join(root, "link", "ws");
  const validated = validateMountSource(viaJunction, [root], "workspace");
  assert.equal(validated.ok, false, "a workspace reached through a junction must be refused");
  assert.equal(validated.reasonCode, "sandbox-mount-source-outside-root", "and refused for escaping the authorized root");
});

// ---------------------------------------------------------------------------
// 9. No bypass exists.
// ---------------------------------------------------------------------------
test("9: no environment, CLI, mission or provider input can alter the identity", () => {
  const before = resolveContainerExecutionIdentity("C:/w", "win32");
  const injected = ["NAMLA_TRUST_WINDOWS_WORKSPACE", "NAMLA_CONTAINER_UID", "NAMLA_CONTAINER_GID", "NAMLA_SANDBOX_USER", "SANDBOX_UID"];
  const saved: Record<string, string | undefined> = {};
  for (const k of injected) {
    saved[k] = process.env[k];
    process.env[k] = "0";
  }
  try {
    const after = resolveContainerExecutionIdentity("C:/w", "win32");
    assert.deepEqual(after, before, "no environment variable may change the execution identity");
    assert.equal(after.ok && after.identity.uid, 10001, "and it must certainly not become root");
  } finally {
    for (const k of injected) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});

// ---------------------------------------------------------------------------
// 10. No identity => no executor.
// ---------------------------------------------------------------------------
test("10: when no valid execution identity exists, composition stays null", () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "namla-r0g-null-")));
  const ws = join(base, "ws");
  const probe = join(base, "probe");
  mkdirSync(ws, { recursive: true });
  mkdirSync(probe, { recursive: true });
  // ORIGINALLY this asserted the executor was always null on this host, which
  // held only while isolation was blocked. Once the Windows repairs let
  // isolation VERIFY, that became false - it had encoded a host STATE as an
  // invariant. The invariant that is true on any host: an input which fails
  // mount validation yields no executor.
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "namla-r0g-outside-")));
  assert.equal(composeVerificationSandbox({ workspaceHostPath: outside, authorizedMountRoots: [base], probeWorkspaceHostPath: probe }), null, "a workspace outside the authorized roots yields no executor");
  assert.equal(composeVerificationSandbox({ workspaceHostPath: ws, authorizedMountRoots: [], probeWorkspaceHostPath: probe }), null, "an empty root list authorizes nothing");
  // And the identity refusal path itself remains reachable: a root policy blocks.
  assert.equal(validateIdentity(0, 0).ok, false);
});

// ---------------------------------------------------------------------------
// Separation: the two questions must never collapse into one answer.
// ---------------------------------------------------------------------------
test("separation: selecting a container user is not a claim about host ownership", () => {
  if (!IS_WIN) return;
  const identity = resolveContainerExecutionIdentity("C:/w", "win32");
  const ownership = resolveTrustedWorkspaceIdentity("C:/w", "win32");
  assert.equal(identity.ok, true, "an execution identity IS available on win32");
  assert.equal(ownership.ok, false, "host ownership is NOT proven on win32");
  assert.notEqual(identity.ok, ownership.ok, "the two answers must be able to differ, or one is masquerading as the other");
});
