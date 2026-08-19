/**
 * containerCleanupProofTests — S-16. Proof that "the container is gone" is only
 * ever claimed from evidence that the check ACTUALLY RAN and said so.
 *
 * THE DEFECT. Both container cleanup paths decided removal with:
 *
 *     return check.status !== 0;
 *
 * `spawnSync`'s `status` is TRI-STATE, not boolean: a number when the process
 * exited normally, and `null` whenever it never produced an exit code at all —
 * the binary was missing, the call timed out, the output blew past `maxBuffer`,
 * or a signal killed it. `null !== 0` is `true`, so every one of those
 * "we could not look" outcomes was read as "we looked and it was gone".
 *
 * That inverts the meaning of the only evidence the caller has. `verifyIsolation`
 * gates `available-and-verified` on this value, and `execute` copies it straight
 * onto a receipt as `cleanupComplete`, so a container still holding the
 * read-write workspace bind-mount could be reported as cleanly removed — and the
 * sandbox reported verified — at the same moment.
 *
 * Worse, it fails open exactly where it matters most. S-14 added the
 * `if (!removed)` guard because a TIMED-OUT container is the one most likely to
 * survive `--rm`; but a wedged Docker daemon is precisely what makes the
 * follow-up `inspect` time out too, and a timed-out inspect returned "removed".
 *
 * The repository already had the right rule. `processTree.ts` refuses to treat
 * an unusable process snapshot as a small one:
 *
 *     // Unresolvable tool, spawn failure, timeout, buffer overrun, or non-zero
 *     // exit: no evidence.
 *     if (!out || out.status !== 0) return null;
 *
 * S-16 applies that same discipline to container cleanup: UNKNOWN IS NOT REMOVED.
 *
 * THESE TESTS EXECUTE THE DECISION. The six required outcomes are driven through
 * the real predicate, and the `spawnSync` shapes they encode are themselves
 * produced by REAL child processes in S16-7 — so the fixture cannot drift away
 * from what Node actually returns. No Docker runtime is required and no
 * container is started; this host has neither docker nor podman.
 *
 * Run: node --test dist/tools/containerCleanupProofTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "child_process";
import { readFileSync } from "fs";
import { containerRemovalProven, type ContainerInspectOutcome } from "../cognitive/containerSandboxBackend";

const BACKEND_SRC = readFileSync("src/cognitive/containerSandboxBackend.ts", "utf8");
const BISECTION_SRC = readFileSync("src/cognitive/dockerStageBisection.ts", "utf8");

/** A `spawnSync`-shaped result. Defaults are the "never ran" shape. */
function outcome(over: Partial<ContainerInspectOutcome> = {}): ContainerInspectOutcome {
  return { status: null, error: undefined, signal: null, ...over };
}

function errno(code: string): NodeJS.ErrnoException {
  const e = new Error(code) as NodeJS.ErrnoException;
  e.code = code;
  return e;
}

/** Bounded helper child. Never a shell, always reaped by spawnSync. */
function runNode(script: string, opts: { timeout?: number; maxBuffer?: number } = {}) {
  return spawnSync(process.execPath, ["-e", script], {
    shell: false,
    encoding: "utf8",
    timeout: opts.timeout ?? 30000,
    killSignal: "SIGKILL",
    maxBuffer: opts.maxBuffer ?? 65536,
    windowsHide: true,
  });
}

// ============================== THE SIX REQUIRED CLEANUP OUTCOMES ===========

test("S16-1: a completed inspect that EXITS 0 means the container is still there", () => {
  // Docker exits 0 when it successfully described an existing container. This
  // is the only outcome that proves PRESENCE, and it must never read as removed.
  assert.equal(containerRemovalProven(outcome({ status: 0 })), false, "exit 0 means present, never removed");
});

test("S16-2: a completed inspect that exits NON-ZERO is the one proof of removal", () => {
  // The process ran to completion and reported "no such object". This is the
  // ONLY affirmative evidence of absence, so it must stay true — a fix that
  // refused everything would break real cleanup instead of repairing it.
  for (const status of [1, 2, 125, 127]) {
    assert.equal(containerRemovalProven(outcome({ status })), true, `a completed exit ${status} proves absence`);
  }
});

test("S16-3: an inspect that could not SPAWN is not proof of removal (ENOENT)", () => {
  // The runtime binary vanished or was never resolvable. Nothing was observed.
  assert.equal(containerRemovalProven(outcome({ status: null, error: errno("ENOENT") })), false);
});

test("S16-4: an inspect that TIMED OUT is not proof of removal (ETIMEDOUT)", () => {
  // The exact S-14 scenario: the daemon is wedged, so the probe timed out AND
  // the follow-up inspect timed out. Before S-16 this reported "removed" —
  // defeating the S-14 guard precisely when a container was most likely alive.
  assert.equal(containerRemovalProven(outcome({ status: null, error: errno("ETIMEDOUT"), signal: "SIGKILL" })), false);
});

test("S16-5: an inspect that overran maxBuffer is not proof of removal (ENOBUFS)", () => {
  assert.equal(containerRemovalProven(outcome({ status: null, error: errno("ENOBUFS"), signal: "SIGKILL" })), false);
});

test("S16-6: an inspect killed by a SIGNAL is not proof of removal", () => {
  // Killed by something other than our own timeout: no error is set, but there
  // is still no exit code, so nothing was observed.
  for (const signal of ["SIGKILL", "SIGTERM", "SIGINT"] as const) {
    assert.equal(containerRemovalProven(outcome({ status: null, error: undefined, signal })), false, `${signal} termination observes nothing`);
  }
});

// ================================= THE INVARIANT, STATED DIRECTLY ===========

test("S16-7: the six shapes are what Node REALLY returns, not a hand-made fixture", () => {
  // If the fixture shapes above ever stopped matching reality, the whole suite
  // would be testing a fiction. So they are produced by real child processes.
  const present = runNode("process.exit(0)");
  assert.equal(present.status, 0);
  assert.equal(containerRemovalProven(present), false, "a real exit 0 is PRESENT");

  const absent = runNode("process.exit(1)");
  assert.equal(absent.status, 1);
  assert.equal(containerRemovalProven(absent), true, "a real exit 1 is proven ABSENT");

  const missing = spawnSync("namla-s16-no-such-binary", ["inspect", "c"], { shell: false, encoding: "utf8", timeout: 30000, killSignal: "SIGKILL", maxBuffer: 65536, windowsHide: true });
  assert.equal(missing.status, null, "a missing binary yields NO exit code");
  assert.equal((missing.error as NodeJS.ErrnoException | undefined)?.code, "ENOENT");
  assert.equal(containerRemovalProven(missing), false, "and therefore proves nothing");

  const timedOut = runNode("setTimeout(()=>{},5000)", { timeout: 300 });
  assert.equal(timedOut.status, null, "a timeout yields NO exit code");
  assert.equal((timedOut.error as NodeJS.ErrnoException | undefined)?.code, "ETIMEDOUT");
  assert.equal(containerRemovalProven(timedOut), false, "and therefore proves nothing");

  const overran = runNode("process.stdout.write('x'.repeat(200000))", { maxBuffer: 64 });
  assert.equal(overran.status, null, "a maxBuffer overrun yields NO exit code");
  assert.equal(containerRemovalProven(overran), false, "and therefore proves nothing");
});

test("S16-8: UNKNOWN is never REMOVED — exhaustively over every no-exit-code shape", () => {
  // The whole finding in one assertion: removal is provable ONLY from a
  // completed, error-free, non-zero exit. Every other combination is unknown.
  const codes = [undefined, errno("ENOENT"), errno("ETIMEDOUT"), errno("ENOBUFS"), errno("EACCES"), errno("EAGAIN")];
  const signals: (NodeJS.Signals | null)[] = [null, "SIGKILL", "SIGTERM"];
  for (const error of codes) {
    for (const signal of signals) {
      // No exit code at all: never provable, whatever else is set.
      assert.equal(containerRemovalProven(outcome({ status: null, error, signal })), false, `status null (error=${error?.code ?? "none"}, signal=${signal}) must not prove removal`);
      // A numeric status still cannot count when the call itself errored.
      if (error) {
        assert.equal(containerRemovalProven(outcome({ status: 1, error, signal })), false, `a spawn error voids even a numeric status (${error.code})`);
      }
    }
  }
  // And presence still wins over everything.
  assert.equal(containerRemovalProven(outcome({ status: 0 })), false);
});

test("S16-9: the predicate reads ONLY the three fields that carry evidence", () => {
  // Extra fields a caller happens to pass must not influence the verdict, so
  // stdout text can never be mistaken for evidence of absence.
  const base = { status: null as number | null, error: errno("ETIMEDOUT"), signal: "SIGKILL" as NodeJS.Signals };
  const noisy = { ...base, stdout: "no such object", stderr: "", pid: 1234, output: [] };
  assert.equal(containerRemovalProven(noisy as ContainerInspectOutcome), false, "container stdout is not evidence");
  const provable = { status: 1, error: undefined, signal: null, stdout: "Error: No such object" };
  assert.equal(containerRemovalProven(provable as ContainerInspectOutcome), true);
});

// ===================== BOTH CLEANUP SITES ROUTE THROUGH THE ONE PREDICATE ===

/** The source text of one method or function body, for wiring assertions. */
function bodyOf(src: string, signature: string, indent: string): string {
  const start = src.indexOf(signature);
  assert.notEqual(start, -1, `not found: ${signature}`);
  const rest = src.slice(start);
  const end = rest.indexOf(`\n${indent}}`);
  assert.notEqual(end, -1, `end not found: ${signature}`);
  return rest.slice(0, end);
}

test("S16-10: both cleanup paths use the shared predicate, and neither decides alone", () => {
  // The two sites had byte-identical defective logic. Fixing one and leaving
  // the other is the failure mode this milestone exists to avoid, so BOTH
  // cleanup methods are checked — and the bare status test must survive in
  // neither of them. (The predicate itself may end on that comparison; what
  // matters is that it is reached only after the two refusals below.)
  const sites = [
    ["containerSandboxBackend.forceRemove", bodyOf(BACKEND_SRC, "  private forceRemove(runtime: string, name: string): boolean {", "  ")],
    ["dockerStageBisection.remove", bodyOf(BISECTION_SRC, "  remove(containerName: string): boolean {", "  ")],
  ] as const;
  for (const [name, body] of sites) {
    assert.equal(/check\.status\s*!==\s*0/.test(body), false, `${name} must not decide cleanup from a bare status check`);
    assert.match(body, /return containerRemovalProven\(check\);/, `${name} must decide cleanup through the shared predicate`);
  }

  // One definition, so the rule cannot drift apart again.
  assert.equal((BACKEND_SRC.match(/export function containerRemovalProven\(/g) ?? []).length, 1, "exactly one definition");
  assert.equal((BISECTION_SRC.match(/export function containerRemovalProven\(/g) ?? []).length, 0, "the bisection must not restate it");
  assert.match(BISECTION_SRC, /import \{[^}]*containerRemovalProven[^}]*\} from "\.\/containerSandboxBackend"/, "the bisection imports the one definition");

  // And that definition refuses BEFORE it ever compares a status: an errored
  // call and a missing exit code are both rejected on their own line.
  const predicate = bodyOf(BACKEND_SRC, "export function containerRemovalProven(check: ContainerInspectOutcome): boolean {", "");
  assert.match(predicate, /if \(check\.error\) return false;/, "a failed call proves nothing");
  assert.match(predicate, /if \(typeof check\.status !== "number"\) return false;/, "a missing exit code proves nothing");
  const errorIdx = predicate.indexOf("if (check.error)");
  const statusIdx = predicate.indexOf('if (typeof check.status !== "number")');
  const compareIdx = predicate.lastIndexOf("check.status !== 0");
  assert.ok(errorIdx > 0 && statusIdx > errorIdx && compareIdx > statusIdx, "both refusals precede the comparison");
});

test("S16-11: an unproven cleanup still fails the verification and receipt paths closed", () => {
  // The predicate is only half the repair: its `false` must still reach the
  // refusals. These are the exact consumers, unchanged by S-16.
  assert.match(BACKEND_SRC, /if \(!removed\) return unverified\("sandbox-cleanup-incomplete", `container not removed after failed probe/, "the failed-probe path refuses");
  assert.match(BACKEND_SRC, /if \(!removed\) return unverified\("sandbox-cleanup-incomplete", "container not removed after exit"\)/, "the success path refuses");
  assert.match(BACKEND_SRC, /safeReasonCode: cleanupComplete \? "ok" : "sandbox-cleanup-incomplete"/, "the receipt reports cleanup truthfully");
  assert.match(BISECTION_SRC, /if \(!removed\) cleanupComplete = false;/, "the bisection records an unremovable container");

  // `available-and-verified` is only ever produced AFTER the cleanup refusal.
  const vStart = BACKEND_SRC.indexOf("  verifyIsolation(): SandboxCapabilityReport {");
  const body = BACKEND_SRC.slice(vStart);
  const refusalIdx = body.indexOf('if (!removed) return unverified("sandbox-cleanup-incomplete", "container not removed after exit")');
  const verifiedIdx = body.indexOf('capabilityState: "available-and-verified"');
  assert.ok(refusalIdx > 0 && verifiedIdx > refusalIdx, "cleanup must be proven BEFORE the verified state is built");
});
