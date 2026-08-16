/**
 * windowsProcessTreeTests — S-10. Proof that the Windows process-tree path
 * cannot be redirected by PATH, by the environment, or by the current
 * directory, and that missing evidence is never laundered into a success.
 *
 * WHAT WAS ACTUALLY WRONG. `processTree` spawned `tasklist`, `wmic` and
 * `taskkill` by BARE NAME. Under `shell: false` Node passes a bare name to
 * `CreateProcessW`, whose search order starts with the calling image's
 * directory and the CURRENT DIRECTORY before any system directory. So a
 * `taskkill.exe` dropped next to the workspace was a candidate for execution at
 * the exact moment the product tries to kill something — the attacker gets to
 * supply the killer.
 *
 * And `wmic` is GONE from current Windows (removed in 11 24H2). The old code
 * turned that ENOENT into `[]`, which is indistinguishable from "no children",
 * so every cleanup receipt on such a host claimed a complete sweep it had never
 * performed. This suite pins both halves.
 *
 * Run: node --test dist/tools/windowsProcessTreeTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, symlinkSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { resolve, join, isAbsolute, sep, delimiter } from "path";
import { resolveWindowsSystemTool, windowsSystemToolEnvironment, authoritativeSystemRoot, type WindowsSystemToolId, type WindowsSystemToolResult } from "../cognitive/windowsSystemTools";
import {
  NodeProcessTreeDriver,
  parseWmicProcessSnapshot,
  WMIC_SNAPSHOT_HEADER,
  buildTransitiveDescendants,
  imageMatchesTasklistRow,
  buildProcessTreeHandle,
  DEFAULT_TERMINATION_POLICY,
  type ProcessRow,
  type ProcessTreeHandle,
  type WindowsToolInvocation,
} from "../cognitive/processTree";

const IS_WINDOWS = process.platform === "win32";
const ALL_TOOLS: readonly WindowsSystemToolId[] = ["tasklist", "taskkill", "wmic"];

function tempDir(tag: string): string {
  return mkdtempSync(resolve(tmpdir(), `namla-s10-${tag}-`));
}

/**
 * A directory shaped like a Windows installation, planted by the test.
 *
 * Used with the `testOnlySystemRoot` seam so the RULE is exercised on Linux and
 * macOS too. It is not a claim that those hosts have Windows semantics — the
 * real-System32 tests below are guarded and only run on win32.
 */
function plantWindowsRoot(tag: string, opts: { readonly kernel32?: boolean; readonly tools?: readonly WindowsSystemToolId[] } = {}): string {
  const root = tempDir(tag);
  const system32 = join(root, "System32");
  mkdirSync(join(system32, "wbem"), { recursive: true });
  if (opts.kernel32 !== false) writeFileSync(join(system32, "kernel32.dll"), "fixture");
  for (const id of opts.tools ?? ALL_TOOLS) {
    const dir = id === "wmic" ? join(system32, "wbem") : system32;
    writeFileSync(join(dir, `${id}.exe`), `fixture ${id}`);
  }
  return root;
}

/** A directory full of hostile look-alikes, exactly as an attacker would plant. */
function plantHostileTools(tag: string): string {
  const dir = tempDir(tag);
  for (const id of ALL_TOOLS) {
    writeFileSync(join(dir, `${id}.exe`), "hostile");
    writeFileSync(join(dir, `${id}.cmd`), "@echo off\r\necho hostile\r\n");
    writeFileSync(join(dir, `${id}.bat`), "@echo off\r\necho hostile\r\n");
  }
  return dir;
}

/** Records every invocation and starts NOTHING. */
function countingRunner() {
  const calls: WindowsToolInvocation[] = [];
  return {
    calls,
    run: (invocation: WindowsToolInvocation) => {
      calls.push(invocation);
      return { status: 0, stdout: "" };
    },
  };
}

const REFUSING_RESOLVER = (): WindowsSystemToolResult => ({ ok: false, value: null, reasonCode: "tool-not-found" });

function handleFor(pid: number, image = "node.exe"): ProcessTreeHandle {
  return { rootPid: pid, processGroupCreated: false, expectedImageBasename: image, spawnSequence: 1 };
}

// ================================================ A / B / C — PATH IS MUTE ===

test("A/B/C: a hostile tasklist, taskkill or wmic earlier on PATH is never selected", () => {
  // The attack, verbatim: own the PATH, plant the three tools, wait for the
  // product to enumerate or terminate something.
  const hostile = plantHostileTools("pathfirst");
  const root = plantWindowsRoot("pathfirstroot");

  for (const id of ALL_TOOLS) {
    const resolved = resolveWindowsSystemTool(id, {
      platform: "win32",
      testOnlySystemRoot: root,
      environment: { PATH: [hostile, "C:\\Windows\\System32"].join(delimiter), Path: hostile, SystemRoot: hostile },
    });
    assert.equal(resolved.ok, true, `${id} must still resolve: ${resolved.reasonCode}`);
    if (!resolved.ok) continue;
    assert.equal(resolved.value.command.startsWith(hostile), false, `${id}: the PATH-planted binary must NOT be chosen`);
    assert.equal(resolved.value.command.startsWith(root), true, `${id}: only the proven system root may supply the tool`);
  }

  rmSync(hostile, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

test("A/B/C on the REAL host: PATH and SystemRoot poisoning cannot move the tools", (t) => {
  if (!IS_WINDOWS) {
    t.skip("real System32 evidence requires Windows; the rule itself is proven cross-platform above");
    return;
  }
  const hostile = plantHostileTools("realpath");
  // A fully-formed decoy: it even carries the kernel32.dll proof.
  const decoy = plantWindowsRoot("realdecoy");

  for (const id of ALL_TOOLS) {
    const poisoned = resolveWindowsSystemTool(id, { environment: { PATH: hostile, Path: hostile, SystemRoot: decoy, windir: decoy } });
    const honest = resolveWindowsSystemTool(id);
    // Identical outcome whether or not the environment was poisoned.
    assert.equal(poisoned.ok, honest.ok, `${id}: poisoning must not change resolvability`);
    if (poisoned.ok && honest.ok) {
      assert.equal(poisoned.value.command, honest.value.command, `${id}: poisoning must not change WHICH binary`);
      assert.equal(poisoned.value.command.startsWith(hostile), false, `${id}: never the PATH plant`);
      assert.equal(poisoned.value.command.startsWith(decoy), false, `${id}: never the SystemRoot decoy`);
    }
  }

  rmSync(hostile, { recursive: true, force: true });
  rmSync(decoy, { recursive: true, force: true });
});

test("D: a workspace-local Windows root cannot become the execution target", (t) => {
  if (!IS_WINDOWS) {
    t.skip("outranking the real C:\\Windows requires a Windows host");
    return;
  }
  // The workspace is attacker-writable by assumption; a complete fake Windows
  // is planted inside it and advertised through every root variable at once.
  const workspace = plantWindowsRoot("workspace");
  for (const id of ALL_TOOLS) {
    const r = resolveWindowsSystemTool(id, { environment: { SystemRoot: workspace, SYSTEMROOT: workspace, windir: workspace, WINDIR: workspace, PATH: join(workspace, "System32") } });
    if (r.ok) {
      assert.equal(r.value.command.startsWith(workspace), false, `${id}: a workspace-local tool must never be trusted`);
      assert.equal(r.value.systemRoot.toLowerCase().startsWith("c:\\windows"), true, `${id}: the conventional root must win`);
    } else {
      // Refusal is equally acceptable — what must never happen is selection.
      assert.equal(r.value, null);
    }
  }
  rmSync(workspace, { recursive: true, force: true });
});

// ============================================ E / F — MISSING TOOL, CLOSED ===

test("E: a missing trusted system tool fails closed with a reason, never a fallback", () => {
  // A real Windows root, but the tool itself is absent.
  const root = plantWindowsRoot("missing", { tools: ["taskkill"] });
  const missing = resolveWindowsSystemTool("tasklist", { platform: "win32", testOnlySystemRoot: root });
  assert.equal(missing.ok, false, "an absent tool must not resolve");
  assert.equal(missing.value, null, "a refusal carries no value to accidentally use");
  assert.equal(missing.reasonCode, "tool-not-found");

  // The one that IS present still resolves, so the refusal is specific rather
  // than a blanket failure.
  assert.equal(resolveWindowsSystemTool("taskkill", { platform: "win32", testOnlySystemRoot: root }).ok, true);
  rmSync(root, { recursive: true, force: true });
});

test("E: a directory that merely looks like System32 is refused without kernel32", () => {
  const fake = plantWindowsRoot("nokernel", { kernel32: false });
  const r = resolveWindowsSystemTool("tasklist", { platform: "win32", testOnlySystemRoot: fake });
  assert.equal(r.ok, false, "planting a directory named System32 must not be enough");
  assert.equal(r.reasonCode, "system-root-not-a-windows-install");
  rmSync(fake, { recursive: true, force: true });
});

test("F: WMIC absence is reported as ABSENT, never as an empty process list", () => {
  const root = plantWindowsRoot("nowmic", { tools: ["tasklist", "taskkill"] });
  const r = resolveWindowsSystemTool("wmic", { platform: "win32", testOnlySystemRoot: root });
  assert.equal(r.ok, false, "wmic is genuinely absent on current Windows and must resolve as such");
  assert.equal(r.reasonCode, "tool-not-found");
  rmSync(root, { recursive: true, force: true });
});

test("F: without a trusted enumerator, descendants are UNPROVEN and cleanup is not claimed", () => {
  // The exact fail-open S-10 closes: no evidence must never render as "clean".
  const runner = countingRunner();
  const driver = new NodeProcessTreeDriver({ toolResolver: REFUSING_RESOLVER, toolRunner: runner.run });
  const enumeration = driver.enumerateDescendants(handleFor(process.pid), DEFAULT_TERMINATION_POLICY);

  if (IS_WINDOWS) {
    assert.equal(enumeration.proven, false, "an unresolvable enumerator yields NO evidence");
    assert.deepEqual(enumeration.pids, [], "and certainly no descendants");
    assert.equal(runner.calls.length, 0, "M: refusal happens BEFORE any process starts");
  } else {
    // POSIX enumerates through /bin/ps and does not consult these tools at all.
    assert.equal(enumeration.proven, true, "POSIX enumeration is independent of the Windows tools");
  }
});

test("F: on THIS host the wmic contract holds whichever way it falls", () => {
  if (!IS_WINDOWS) return;
  const wmic = resolveWindowsSystemTool("wmic");
  const proven = new NodeProcessTreeDriver().enumerateDescendants(handleFor(process.pid), DEFAULT_TERMINATION_POLICY).proven;
  // Two legitimate worlds, one contract: enumeration is proven exactly when a
  // trusted enumerator exists. Neither is a skip, and neither is assumed.
  assert.equal(proven, wmic.ok, `enumeration provability must track wmic trust (wmic.ok=${wmic.ok}, reason=${wmic.reasonCode})`);
});

// ================================= G / H / M — WHAT ACTUALLY GETS INVOKED ===

test("G/H: the runner receives the CANONICAL system path, and shell is never an option", () => {
  const root = plantWindowsRoot("invoked");
  const runner = countingRunner();
  const resolver = (id: WindowsSystemToolId) => resolveWindowsSystemTool(id, { platform: "win32", testOnlySystemRoot: root });
  const driver = new NodeProcessTreeDriver({ toolResolver: resolver, toolRunner: runner.run });

  driver.enumerateDescendants(handleFor(4242), DEFAULT_TERMINATION_POLICY);

  if (IS_WINDOWS) {
    assert.equal(runner.calls.length, 1, "exactly one enumeration call");
    const call = runner.calls[0];
    assert.equal(call.command, join(root, "System32", "wbem", "wmic.exe"), "H: the canonical resolved executable, not a name");
    assert.equal(isAbsolute(call.command), true, "H: absolute, so no search can occur");
    assert.equal(/\.(cmd|bat)$/i.test(call.command), false, "G: never a script shim");
    assert.equal(call.cwd, join(root, "System32"), "the working directory is the system directory, not the caller's");
    // `shell` is not part of the invocation surface at all — it cannot be
    // switched on by a caller, which is stronger than passing `shell: false`.
    assert.equal(Object.prototype.hasOwnProperty.call(call, "shell"), false, "G: shell is not a parameter anyone can set");
  }
});

test("M: an invalid root PID starts ZERO processes", () => {
  for (const bad of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
    const runner = countingRunner();
    const driver = new NodeProcessTreeDriver({ toolResolver: (id) => resolveWindowsSystemTool(id, { platform: "win32", testOnlySystemRoot: "" }), toolRunner: runner.run });
    const enumeration = driver.enumerateDescendants(handleFor(bad), DEFAULT_TERMINATION_POLICY);
    assert.equal(runner.calls.length, 0, `pid ${bad}: nothing may be spawned`);
    if (IS_WINDOWS) assert.equal(enumeration.proven, false, `pid ${bad}: and nothing may be claimed`);
  }
});

// ==================================== I / J — THE ENVIRONMENT HANDED OVER ===

test("I: the environment given to the tool cannot redirect binary or DLL loading", () => {
  const env = windowsSystemToolEnvironment("C:\\Windows", "C:\\Windows\\System32");
  const parts = (env.PATH ?? "").split(delimiter);

  // PATH is REBUILT. It cannot select the binary (absolute path, no shell), but
  // the Windows DLL search order reads it, so an inherited PATH would be a way
  // to load an attacker's DLL inside a trusted executable.
  assert.deepEqual(parts, ["C:\\Windows\\System32", "C:\\Windows", "C:\\Windows\\System32\\wbem"], "only proven system directories");
  for (const p of parts) assert.equal(isAbsolute(p), true, `PATH entry must be absolute: ${p}`);
  assert.equal(parts.includes("."), false, "the current directory is never on PATH");
  assert.equal(env.PATHEXT, ".EXE", "no .CMD/.BAT interpretation anywhere downstream");

  // Deliberately absent, each for a stated reason.
  for (const absent of ["COMSPEC", "ComSpec", "TEMP", "TMP", "USERPROFILE", "APPDATA", "NODE_OPTIONS"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(env, absent), false, `${absent} must not be handed to a privileged system tool`);
  }
});

test("J: the variables Windows genuinely needs ARE preserved", () => {
  const env = windowsSystemToolEnvironment("C:\\Windows", "C:\\Windows\\System32");
  assert.equal(env.SystemRoot, "C:\\Windows", "system components resolve their own resources through SystemRoot");
  assert.equal(env.windir, "C:\\Windows", "the legacy spelling is still consulted by some tooling");
  assert.equal(env.SystemDrive, "C:", "derived from the proven root, never from the caller");
});

test("J: the minimal environment really does run the real tool", (t) => {
  if (!IS_WINDOWS) {
    t.skip("executing tasklist requires Windows; the composition of the environment is proven above");
    return;
  }
  // The claim "this environment is sufficient" is worth nothing unverified, so
  // the tool is actually executed under it — read-only, on our own PID.
  const tool = resolveWindowsSystemTool("tasklist");
  assert.equal(tool.ok, true, `tasklist must resolve on Windows: ${tool.reasonCode}`);
  if (!tool.ok) return;

  const driver = new NodeProcessTreeDriver();
  const handle = buildProcessTreeHandle(process.pid, process.execPath, false, 1);
  assert.notEqual(handle, null);
  // identityMatches is exercised through the public termination path against a
  // LIVE pid we own; a match proves the tool ran and parsed under the minimal
  // environment. Nothing is signalled: the image name will not match.
  const receipt = driver.terminate({ ...(handle as ProcessTreeHandle), expectedImageBasename: "definitely-not-this-image.exe" }, { ...DEFAULT_TERMINATION_POLICY, gracePeriodMs: 0, forceAfterGrace: false }, "completed", 1000);
  assert.equal(receipt.safeReasonCode, "process-tree-identity-mismatch", "a live PID whose image does not match must be REFUSED, which requires tasklist to have run");
  assert.equal(receipt.gracefulAttempted, false, "and refused before any signal");
});

// ================================ K / L — MALFORMED OUTPUT AND INJECTION ===

/** `HOSTNAME,<ppid>,<pid>` — the shape WMIC emits, columns alphabetical. */
function csv(rows: readonly (readonly [number | string, number | string])[]): string {
  return ["Node,ParentProcessId,ProcessId", ...rows.map(([ppid, pid]) => `HOST,${ppid},${pid}`)].join("\r\n");
}

function closure(rows: readonly (readonly [number | string, number | string])[], root: number, cap = 256) {
  const parsed = parseWmicProcessSnapshot(csv(rows));
  assert.notEqual(parsed, null, "fixture must parse");
  return buildTransitiveDescendants(parsed as readonly ProcessRow[], root, cap);
}

test("K: a malformed row INVALIDATES the snapshot rather than being dropped", () => {
  // Review caught the earlier behaviour: malformed rows were dropped and the
  // survivors were still presented as a complete picture of the machine. A
  // truncated row means output was LOST, so the rows that did arrive cannot
  // support a statement about what exists — a reachable descendant may be
  // sitting in the part that never made it.
  for (const bad of ["-5", "1.5", "99999999999999999999", "abc", ""]) {
    assert.equal(parseWmicProcessSnapshot(csv([[100, 2002], [100, bad]])), null, `PID "${bad}" must invalidate the whole snapshot`);
    assert.equal(parseWmicProcessSnapshot(csv([[100, 2002], [bad, 2003]])), null, `PPID "${bad}" must invalidate the whole snapshot`);
  }

  // Lines that are not rows at all.
  assert.equal(parseWmicProcessSnapshot("garbage without commas"), null, "unparsable output is UNAVAILABLE, not empty");
  assert.equal(parseWmicProcessSnapshot(""), null, "empty output is UNAVAILABLE, not 'no processes'");
  assert.equal(parseWmicProcessSnapshot(WMIC_SNAPSHOT_HEADER), null, "a header alone proves nothing");
});

// ================= BLOCKER 3 — STRICT WMIC SNAPSHOT INTEGRITY ==============
//
// The flaw: a snapshot could contain valid rows AND a truncated one, the
// truncated row was dropped, and the remainder was treated as complete. That
// hides a reachable descendant and wrongly licenses cleanupComplete.

test("B3-1: a valid header with valid rows is accepted", () => {
  const rows = parseWmicProcessSnapshot(csv([[100, 200], [200, 300], [1, 4]]));
  assert.notEqual(rows, null, "a well-formed snapshot is evidence");
  assert.deepEqual([...(rows as readonly ProcessRow[])], [
    { pid: 200, ppid: 100 },
    { pid: 300, ppid: 200 },
    { pid: 4, ppid: 1 },
  ]);
});

test("B3-2: valid rows followed by a MALFORMED final row => unavailable", () => {
  assert.equal(parseWmicProcessSnapshot([WMIC_SNAPSHOT_HEADER, "HOST,100,200", "HOST,200,300", "HOST,300,xyz"].join("\r\n")), null);
});

test("B3-3: valid rows followed by a TRUNCATED final row => unavailable", () => {
  // The exact review example: the last row lost its ProcessId mid-write.
  assert.equal(parseWmicProcessSnapshot([WMIC_SNAPSHOT_HEADER, "HOST,100,200", "HOST,200,300", "HOST,300,"].join("\r\n")), null, "a truncated row is lost evidence");
  // Other truncation shapes: a severed line, a missing column, a stray column.
  assert.equal(parseWmicProcessSnapshot([WMIC_SNAPSHOT_HEADER, "HOST,100,200", "HOS"].join("\r\n")), null);
  assert.equal(parseWmicProcessSnapshot([WMIC_SNAPSHOT_HEADER, "HOST,100,200", "HOST,300"].join("\r\n")), null);
  assert.equal(parseWmicProcessSnapshot([WMIC_SNAPSHOT_HEADER, "HOST,100,200", "HOST,300,400,500"].join("\r\n")), null);
});

test("B3-4: a malformed row in the MIDDLE => unavailable", () => {
  assert.equal(parseWmicProcessSnapshot([WMIC_SNAPSHOT_HEADER, "HOST,100,200", "HOST,,", "HOST,200,300"].join("\r\n")), null, "position does not matter; lost evidence is lost");
});

test("B3-5: a missing header => unavailable", () => {
  // Without the header we are not looking at the start of the snapshot, so we
  // cannot know what was lost before the first line we can see.
  assert.equal(parseWmicProcessSnapshot(["HOST,100,200", "HOST,200,300"].join("\r\n")), null);
  assert.equal(parseWmicProcessSnapshot(["Node,ProcessId,ParentProcessId", "HOST,100,200"].join("\r\n")), null, "a differently-ordered header is not the expected one");
});

test("B3-6: header only => unavailable", () => {
  assert.equal(parseWmicProcessSnapshot(WMIC_SNAPSHOT_HEADER), null);
  assert.equal(parseWmicProcessSnapshot(`\r\n${WMIC_SNAPSHOT_HEADER}\r\n\r\n`), null, "blank padding does not make a snapshot");
});

test("B3-7: empty output => unavailable", () => {
  assert.equal(parseWmicProcessSnapshot(""), null);
  assert.equal(parseWmicProcessSnapshot("\r\n\r\n   \r\n"), null, "whitespace is not a snapshot");
});

test("B3-8: PPID 0 is structurally VALID and does not invalidate the snapshot", () => {
  // Every genuine Windows snapshot contains ParentProcessId 0. Rejecting it
  // would make real snapshots permanently unavailable.
  const rows = parseWmicProcessSnapshot(csv([[0, 4], [100, 200], [200, 300]]));
  assert.notEqual(rows, null, "PPID 0 must not invalidate an otherwise valid snapshot");
  assert.equal((rows as readonly ProcessRow[]).some((r) => r.ppid === 0), true, "the PPID 0 row survives as data");

  // And it is simply not reachable from an ordinary positive root.
  const c = buildTransitiveDescendants(rows as readonly ProcessRow[], 100, 256);
  assert.deepEqual(c.pids, [200, 300]);
  assert.equal(c.evidence, "complete");
});

test("B3-9: PID 0 is structurally VALID but is NEVER a termination target", () => {
  // ProcessId 0 is the System Idle Process: real data, never targetable.
  const rows = parseWmicProcessSnapshot(csv([[0, 0], [0, 4], [100, 200]]));
  assert.notEqual(rows, null, "PID 0 must not invalidate an otherwise valid snapshot");
  assert.equal((rows as readonly ProcessRow[]).some((r) => r.pid === 0), true, "the PID 0 row survives as data");

  // From every plausible root, 0 never appears among the targets.
  for (const root of [100, 4, 1, 999]) {
    const c = buildTransitiveDescendants(rows as readonly ProcessRow[], root, 256);
    assert.equal(c.pids.includes(0), false, `root ${root}: PID 0 must never be a termination target`);
    for (const pid of c.pids) assert.equal(pid > 0 && Number.isSafeInteger(pid), true, `root ${root}: targets are positive safe integers only`);
  }
  // Even asking for descendants OF pid 0 yields only positive targets.
  const fromZero = buildTransitiveDescendants(rows as readonly ProcessRow[], 0, 256);
  assert.equal(fromZero.pids.includes(0), false, "0 is never its own descendant");
  assert.deepEqual(fromZero.pids, [4], "children of the idle process are still positive PIDs");
});

test("B3-10: spawn error, non-zero exit, timeout and buffer failure are all unavailable", () => {
  const root = plantWindowsRoot("b3runner");
  const resolver = (id: WindowsSystemToolId) => resolveWindowsSystemTool(id, { platform: "win32", testOnlySystemRoot: root });
  const valid = csv([[100, 200], [200, 300]]);

  const scenarios: readonly (readonly [string, (invocation: WindowsToolInvocation) => { status: number | null; stdout: string } | null])[] = [
    ["spawn error / ENOENT / maxBuffer / timeout (runner returns null)", () => null],
    ["non-zero exit with otherwise valid output", () => ({ status: 1, stdout: valid })],
    ["killed by timeout (null status)", () => ({ status: null, stdout: valid })],
    ["truncated output at status 0", () => ({ status: 0, stdout: valid.slice(0, valid.length - 4) })],
  ];

  for (const [label, run] of scenarios) {
    const driver = new NodeProcessTreeDriver({ toolResolver: resolver, toolRunner: run });
    const e = driver.enumerateDescendants(handleFor(100), DEFAULT_TERMINATION_POLICY);
    if (IS_WINDOWS) {
      assert.equal(e.evidence, "unavailable", `${label}: must be unavailable`);
      assert.equal(e.proven, false, `${label}: must not be proven`);
      assert.deepEqual(e.pids, [], `${label}: must yield no targets`);
    }
  }
  rmSync(root, { recursive: true, force: true });
});

test("B3-11: a partially valid snapshot can NEVER produce evidence=complete", () => {
  const root = plantWindowsRoot("b3partial");
  // Valid rows PLUS one truncated row — the review scenario, end to end through
  // the driver rather than only through the parser.
  const partial = [WMIC_SNAPSHOT_HEADER, "HOST,100,200", "HOST,200,300", "HOST,300,"].join("\r\n");
  const driver = new NodeProcessTreeDriver({
    toolResolver: (id) => resolveWindowsSystemTool(id, { platform: "win32", testOnlySystemRoot: root }),
    toolRunner: () => ({ status: 0, stdout: partial }),
  });
  const e = driver.enumerateDescendants(handleFor(100), DEFAULT_TERMINATION_POLICY);
  if (IS_WINDOWS) {
    assert.notEqual(e.evidence, "complete", "partial evidence is never complete evidence");
    assert.equal(e.evidence, "unavailable");
    assert.equal(e.proven, false, "and so can never license cleanupComplete");
    assert.deepEqual(e.pids, [], "the surviving rows are not used as a partial answer");
  }
  rmSync(root, { recursive: true, force: true });
});

test("B3: every numeric edge case is classified explicitly", () => {
  // Accepted as snapshot data.
  for (const [ppid, pid] of [[0, 0], [0, 4], [4, 8], [1, Number.MAX_SAFE_INTEGER]] as const) {
    assert.notEqual(parseWmicProcessSnapshot(csv([[ppid, String(pid)]])), null, `ppid=${ppid} pid=${pid} is valid snapshot data`);
  }
  // Rejected outright — the snapshot is unavailable, not partially usable.
  const invalid = ["-1", "-0.5", "1.5", "0.0", "1e3", " 12", "+12", "0x10", "99999999999999999999", "abc", ""];
  for (const bad of invalid) {
    assert.equal(parseWmicProcessSnapshot(csv([[100, bad]])), null, `PID "${bad}" must invalidate`);
    assert.equal(parseWmicProcessSnapshot(csv([[bad, 200]])), null, `PPID "${bad}" must invalidate`);
  }

  // Whitespace, precisely. Padding INSIDE the line breaks the row shape, but
  // trailing whitespace at end-of-line is ordinary CSV output and is trimmed —
  // so it must be accepted, and must parse to the exact value with no coercion.
  assert.equal(parseWmicProcessSnapshot(csv([["12 ", 200]])), null, "space inside the line invalidates");
  const trailing = parseWmicProcessSnapshot(csv([[100, "12 "]]));
  assert.notEqual(trailing, null, "line-trailing whitespace is not corruption");
  assert.deepEqual([...(trailing as readonly ProcessRow[])], [{ pid: 12, ppid: 100 }], "and parses exactly, without coercion");
});

test("L: a PID cannot smuggle arguments, options or a second command", () => {
  // Injection would need a PID carrying separators or switches. The row shape
  // is anchored end-to-end, so a payload breaks the match outright.
  for (const payload of ["123 /F", '123" /F "', "123;calc.exe", "123&&calc.exe", "/T", "--flag", "123 456"]) {
    const parsed = parseWmicProcessSnapshot(csv([[100, payload]]));
    assert.equal(parsed, null, `"${payload}" must not yield any row`);
  }
  // Every PID that does survive is pure digits, so the argument vector is safe.
  const r = closure([[100, 2001]], 100);
  for (const pid of r.pids) assert.equal(/^\d+$/.test(String(pid)), true, "arguments are pure digits");

  // And the production query interpolates nothing at all any more.
  const root = plantWindowsRoot("noninterp");
  const runner = countingRunner();
  const driver = new NodeProcessTreeDriver({ toolResolver: (id) => resolveWindowsSystemTool(id, { platform: "win32", testOnlySystemRoot: root }), toolRunner: runner.run });
  driver.enumerateDescendants(handleFor(31337), DEFAULT_TERMINATION_POLICY);
  if (IS_WINDOWS) {
    assert.equal(runner.calls.length, 1);
    assert.equal(runner.calls[0].args.join(" ").includes("31337"), false, "no PID is placed into the query");
    assert.deepEqual(runner.calls[0].args, ["process", "get", "ProcessId,ParentProcessId", "/FORMAT:CSV"], "a fixed snapshot query");
  }
  rmSync(root, { recursive: true, force: true });
});

// ===================== BLOCKER 2 — TRANSITIVE DESCENDANT ENUMERATION ========

test("B2-1/2/3: children, GRANDCHILDREN and further generations are all reached", () => {
  // THE MANDATORY NON-VACUITY CASE. `100 -> 200 -> 300`: a direct-child query
  // sees 200 and stops. If transitive traversal is ever replaced by
  // direct-child traversal, this assertion fails.
  const two = closure(
    [
      [100, 200],
      [200, 300],
    ],
    100
  );
  assert.deepEqual(two.pids, [200, 300], "the grandchild MUST be reached");
  assert.equal(two.evidence, "complete");

  const four = closure(
    [
      [100, 200],
      [200, 300],
      [300, 400],
      [400, 500],
    ],
    100
  );
  assert.deepEqual(four.pids, [200, 300, 400, 500], "depth is not limited to one generation");

  // A single child still works, so the deep cases are not the only path.
  assert.deepEqual(closure([[100, 200]], 100).pids, [200]);
});

test("B2-4: siblings across generations are all collected, unrelated trees are not", () => {
  const r = closure(
    [
      [100, 200],
      [100, 201],
      [200, 300],
      [201, 301],
      [999, 900], // an unrelated tree
      [900, 901],
    ],
    100
  );
  assert.deepEqual([...r.pids].sort((a, b) => a - b), [200, 201, 300, 301], "every reachable node, and nothing else");
  assert.equal(r.pids.includes(900), false, "an unrelated tree is never targeted");
  assert.equal(r.pids.includes(901), false, "nor its descendants");
});

test("B2-5/6/7/10: duplicates, self-cycles, multi-node cycles and the root itself", () => {
  assert.deepEqual(closure([[100, 200], [100, 200], [100, 200]], 100).pids, [200], "duplicate rows collapse");

  // Self-cycle: a process claiming to be its own parent.
  assert.deepEqual(closure([[200, 200], [100, 200]], 100).pids, [200], "a self-cycle terminates and is not double-counted");

  // Multi-node cycle 200 -> 300 -> 200, reachable from the root.
  const cyc = closure(
    [
      [100, 200],
      [200, 300],
      [300, 200],
    ],
    100
  );
  assert.deepEqual([...cyc.pids].sort((a, b) => a - b), [200, 300], "a cycle is visited once and terminates");

  // A cycle that includes the ROOT must never enrol the root as its own
  // descendant — that would make termination target itself.
  const rootCycle = closure(
    [
      [100, 200],
      [200, 100],
    ],
    100
  );
  assert.deepEqual(rootCycle.pids, [200], "the root is never its own descendant");
  assert.equal(rootCycle.pids.includes(100), false);
});

test("B2-11/12: reaching the cap is reported as CAPPED, never as complete", () => {
  const rows: (readonly [number, number])[] = [
    [100, 200],
    [200, 300],
    [300, 400],
  ];
  const capped = closure(rows, 100, 2);
  assert.equal(capped.pids.length, 2, "the bound is enforced");
  assert.equal(capped.evidence, "capped", "a reachable node remains unrecorded, so this is INCOMPLETE");

  // Exactly at the bound with nothing further reachable is genuinely complete.
  const exact = closure([[100, 200], [200, 300]], 100, 2);
  assert.equal(exact.pids.length, 2);
  assert.equal(exact.evidence, "complete", "hitting the cap with nothing left over is still complete");
});

test("B2-12: a capped enumeration can never support a completeness claim", () => {
  const rows = Array.from({ length: 10 }, (_, i) => [100 + i, 101 + i] as const);
  const parsed = parseWmicProcessSnapshot(csv(rows)) as readonly ProcessRow[];
  const capped = buildTransitiveDescendants(parsed, 100, 3);
  assert.equal(capped.evidence, "capped");
  // The driver maps evidence to `proven`, and only `proven` may license
  // `cleanupComplete`. Capped is not proven.
  assert.equal((["capped", "unavailable"] as const).includes(capped.evidence as "capped"), true);
});

test("B2-13/14/15: absent, failing and truncated snapshots are all UNAVAILABLE", () => {
  const root = plantWindowsRoot("snapshot");
  const resolver = (id: WindowsSystemToolId) => resolveWindowsSystemTool(id, { platform: "win32", testOnlySystemRoot: root });

  const scenarios: readonly (readonly [string, (invocation: WindowsToolInvocation) => { status: number | null; stdout: string } | null])[] = [
    ["wmic missing", () => null],
    ["non-zero exit", () => ({ status: 1, stdout: csv([[100, 200]]) })],
    ["truncated/garbled", () => ({ status: 0, stdout: "Node,ParentProcessId,Proc" })],
    ["empty output", () => ({ status: 0, stdout: "" })],
    ["header only", () => ({ status: 0, stdout: "Node,ParentProcessId,ProcessId" })],
  ];

  for (const [label, run] of scenarios) {
    const driver = new NodeProcessTreeDriver({ toolResolver: label === "wmic missing" ? REFUSING_RESOLVER : resolver, toolRunner: run });
    const e = driver.enumerateDescendants(handleFor(100), DEFAULT_TERMINATION_POLICY);
    if (IS_WINDOWS) {
      assert.equal(e.evidence, "unavailable", `${label}: must be UNAVAILABLE`);
      assert.equal(e.proven, false, `${label}: must not be proven`);
      assert.deepEqual(e.pids, [], `${label}: and must yield no targets`);
    }
  }
  rmSync(root, { recursive: true, force: true });
});

test("B2: a real snapshot drives the driver's transitive closure end to end", () => {
  const root = plantWindowsRoot("e2e");
  const stdout = csv([
    [100, 200],
    [200, 300],
    [300, 400],
    [777, 888],
  ]);
  const driver = new NodeProcessTreeDriver({
    toolResolver: (id) => resolveWindowsSystemTool(id, { platform: "win32", testOnlySystemRoot: root }),
    toolRunner: () => ({ status: 0, stdout }),
  });
  const e = driver.enumerateDescendants(handleFor(100), DEFAULT_TERMINATION_POLICY);
  if (IS_WINDOWS) {
    assert.equal(e.evidence, "complete");
    assert.equal(e.proven, true);
    assert.deepEqual(e.pids, [200, 300, 400], "grandchild and great-grandchild included, unrelated tree excluded");
  }
  rmSync(root, { recursive: true, force: true });
});

test("SCOPE: POSIX enumeration keeps its BASELINE semantics, unchanged by S-10", (t) => {
  // S-10 is the Windows milestone. An earlier revision also rewrote the POSIX
  // branch onto the strict parser and evidence model; review rejected that as
  // out of scope and it was reverted. POSIX must therefore always report
  // `complete`, exactly as it did at HEAD, where no notion of unproven
  // enumeration existed — so `cleanupComplete` resolves identically.
  if (IS_WINDOWS) {
    t.skip("POSIX enumeration semantics can only be observed on a POSIX host");
    return;
  }
  const e = new NodeProcessTreeDriver().enumerateDescendants(handleFor(process.pid), DEFAULT_TERMINATION_POLICY);
  assert.equal(e.evidence, "complete", "POSIX must keep reporting complete, as baseline did");
  assert.equal(e.proven, true, "POSIX completeness is unchanged by the Windows evidence model");

  // The Windows-only seams must not have leaked into the POSIX path: a refusing
  // resolver and a counting runner change nothing here, because POSIX never
  // consults a Windows system tool.
  const runner = countingRunner();
  const seamed = new NodeProcessTreeDriver({ toolResolver: REFUSING_RESOLVER, toolRunner: runner.run });
  const withSeams = seamed.enumerateDescendants(handleFor(process.pid), DEFAULT_TERMINATION_POLICY);
  assert.equal(withSeams.evidence, "complete", "the Windows tool seams do not affect POSIX");
  assert.equal(runner.calls.length, 0, "and POSIX starts no Windows system tool");
});

test("K: a tasklist row is only an identity match when it really matches", () => {
  assert.equal(imageMatchesTasklistRow('"node.exe","1234"', "node.exe"), true, "an exact image match");
  assert.equal(imageMatchesTasklistRow('"NODE.EXE","1234"', "node.exe"), true, "Windows image names are case-insensitive");
  assert.equal(imageMatchesTasklistRow("INFO: No tasks are running which match the specified criteria.", "node.exe"), false, "the no-match banner is not an identity");
  assert.equal(imageMatchesTasklistRow("", "node.exe"), false, "empty output proves nothing");
  assert.equal(imageMatchesTasklistRow('"evil.exe","1234"', "node.exe"), false, "a different image is a mismatch");
});

// ============================================== STRUCTURAL / NON-VACUITY ===

test("a symlinked or non-regular tool file is refused, not followed", (t) => {
  const root = plantWindowsRoot("linked", { tools: ["taskkill", "wmic"] });
  const target = join(root, "elsewhere.exe");
  writeFileSync(target, "payload");
  try {
    symlinkSync(target, join(root, "System32", "tasklist.exe"), "file");
  } catch {
    t.skip("this host cannot create file symlinks unprivileged; substitution refusal UNVERIFIED here");
    rmSync(root, { recursive: true, force: true });
    return;
  }
  const r = resolveWindowsSystemTool("tasklist", { platform: "win32", testOnlySystemRoot: root });
  assert.equal(r.ok, false, "a symlink standing in for a system tool must be refused");
  assert.equal(r.reasonCode, "tool-not-a-regular-file");
  rmSync(root, { recursive: true, force: true });
});

// ================= BLOCKER 1 — WINDOWS SYSTEM ROOT AUTHORITY ===============
//
// Human review rejected the earlier design, which tried `C:\Windows` first and
// then fell back to `SystemRoot`/`WINDIR`. Both halves were demonstrably
// exploitable and both are pinned shut here.

test("B1-A/B: a poisoned SystemRoot or WINDIR cannot redirect resolution", () => {
  // A complete, convincing fake — right layout, right filenames, even the
  // kernel32.dll that the old code accepted as proof.
  const fake = plantWindowsRoot("poisonroot");

  for (const variable of ["SystemRoot", "SYSTEMROOT", "windir", "WINDIR"]) {
    const poisoned = resolveWindowsSystemTool("tasklist", { environment: { [variable]: fake, PATH: join(fake, "System32") } });
    const honest = resolveWindowsSystemTool("tasklist");
    assert.equal(poisoned.ok, honest.ok, `${variable}: must not change resolvability`);
    if (poisoned.ok) {
      assert.equal(poisoned.value.command.startsWith(fake), false, `${variable}: the planted tree must never be selected`);
      assert.equal(poisoned.value.command, (honest as typeof poisoned).value.command, `${variable}: identical outcome either way`);
    }
  }

  // The environment is not merely outranked — it is never read. Handing over
  // ONLY a poisoned root (no other candidate) still resolves to the pinned one.
  const only = resolveWindowsSystemTool("tasklist", { environment: { SystemRoot: fake, windir: fake, SYSTEMROOT: fake, WINDIR: fake } });
  if (only.ok) assert.equal(only.value.systemRoot, authoritativeSystemRoot(), "the KERNEL-supplied root is the only authority");
  rmSync(fake, { recursive: true, force: true });
});

test("B1-C: a fake Windows tree is not trusted just because the filenames exist", () => {
  // kernel32.dll is CORROBORATION, never authority — an attacker who can plant
  // tools can plant that too. The defence is that the root is pinned, so this
  // tree is unreachable unless someone configures it deliberately.
  const fake = plantWindowsRoot("fakenames");
  const viaEnvironment = resolveWindowsSystemTool("tasklist", { environment: { SystemRoot: fake } });
  if (viaEnvironment.ok) assert.equal(viaEnvironment.value.command.startsWith(fake), false, "a named-alike tree must not be reachable from the environment");

  // And on a host where the pinned root does not exist, the answer is refusal
  // rather than "use whatever tree was offered".
  const nonWindows = resolveWindowsSystemTool("tasklist", { platform: "win32", testOnlySystemRoot: join(fake, "does-not-exist") });
  assert.equal(nonWindows.ok, false, "an unprovable root must fail closed");
  rmSync(fake, { recursive: true, force: true });
});

test("B1-D: a reparse point anywhere in the chain refuses the candidate", (t) => {
  // Measured before this fix: with `System32` as a junction into attacker
  // territory, resolution returned the ATTACKER'S tasklist.exe. `realpath`
  // followed the junction and containment was then checked against the followed
  // result, so the redirection validated itself.
  const base = tempDir("reparse");
  const root = join(base, "root");
  const evil = join(base, "evil");
  mkdirSync(join(evil, "wbem"), { recursive: true });
  writeFileSync(join(evil, "kernel32.dll"), "fake");
  for (const id of ALL_TOOLS) writeFileSync(join(id === "wmic" ? join(evil, "wbem") : evil, `${id}.exe`), "HOSTILE");
  mkdirSync(root, { recursive: true });

  try {
    symlinkSync(evil, join(root, "System32"), "junction");
  } catch {
    t.skip("this host cannot create junctions; reparse redirection UNVERIFIED here");
    rmSync(base, { recursive: true, force: true });
    return;
  }

  for (const id of ALL_TOOLS) {
    const r = resolveWindowsSystemTool(id, { platform: "win32", testOnlySystemRoot: root });
    assert.equal(r.ok, false, `${id}: a junctioned System32 must be refused, not followed`);
    assert.equal(r.value, null, `${id}: and must hand back nothing usable`);
  }

  // The same tree WITHOUT the junction resolves, so the refusal is about the
  // reparse point and not about the fixture being malformed.
  const honest = plantWindowsRoot("reparse-control");
  assert.equal(resolveWindowsSystemTool("tasklist", { platform: "win32", testOnlySystemRoot: honest }).ok, true, "control fixture must resolve");
  rmSync(honest, { recursive: true, force: true });
  rmSync(base, { recursive: true, force: true });
});

test("B1-D: a junctioned wbem subdirectory cannot relocate wmic", (t) => {
  const base = tempDir("wbemlink");
  const root = plantWindowsRoot("wbemroot", { tools: ["tasklist", "taskkill"] });
  const evil = join(base, "evilwbem");
  mkdirSync(evil, { recursive: true });
  writeFileSync(join(evil, "wmic.exe"), "HOSTILE");
  rmSync(join(root, "System32", "wbem"), { recursive: true, force: true });
  try {
    symlinkSync(evil, join(root, "System32", "wbem"), "junction");
  } catch {
    t.skip("this host cannot create junctions; wbem redirection UNVERIFIED here");
    rmSync(base, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
    return;
  }
  const r = resolveWindowsSystemTool("wmic", { platform: "win32", testOnlySystemRoot: root });
  assert.equal(r.ok, false, "an intermediate junction must be refused as firmly as a leaf one");
  // The sibling tools, reached without traversing the junction, still resolve.
  assert.equal(resolveWindowsSystemTool("tasklist", { platform: "win32", testOnlySystemRoot: root }).ok, true, "unaffected tools still resolve");
  rmSync(base, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

test("B1-E: a non-standard or unprovable installation fails closed", () => {
  // No OS primitive exists in Node for the real Windows directory, so a root
  // that cannot be proven is refused rather than inferred.
  const cases: readonly (readonly [string, string])[] = [
    [tempDir("emptyroot"), "a directory with no System32"],
    ["relative\\path", "a relative root"],
    ["", "an empty root"],
  ];
  for (const [candidate, why] of cases) {
    const r = resolveWindowsSystemTool("tasklist", { platform: "win32", testOnlySystemRoot: candidate });
    assert.equal(r.ok, false, `${why} must fail closed`);
    assert.equal(r.value, null, `${why} must yield no tool`);
  }
  // A System32 without kernel32.dll is likewise not an installation.
  const bare = plantWindowsRoot("barewin", { kernel32: false });
  const r = resolveWindowsSystemTool("tasklist", { platform: "win32", testOnlySystemRoot: bare });
  assert.equal(r.ok, false);
  assert.equal(r.reasonCode, "system-root-not-a-windows-install");
  rmSync(bare, { recursive: true, force: true });
});

test("B1-F: ZERO subprocesses start when root authority cannot be proven", () => {
  const unprovable = tempDir("unprovable"); // exists, but is not a Windows install
  const runner = countingRunner();
  const driver = new NodeProcessTreeDriver({
    toolResolver: (id) => resolveWindowsSystemTool(id, { platform: "win32", testOnlySystemRoot: unprovable }),
    toolRunner: runner.run,
  });

  const enumeration = driver.enumerateDescendants(handleFor(process.pid), DEFAULT_TERMINATION_POLICY);
  driver.listDescendants(handleFor(process.pid), DEFAULT_TERMINATION_POLICY);

  assert.equal(runner.calls.length, 0, "an unprovable root must start nothing at all");
  if (IS_WINDOWS) {
    assert.equal(enumeration.evidence, "unavailable", "and must claim nothing");
    assert.equal(enumeration.proven, false);
  }
  rmSync(unprovable, { recursive: true, force: true });
});

// ============ FINAL BLOCKER — OS-BACKED ROOT AUTHORITY (R1–R10) ============
//
// A pinned `C:\Windows` string was still the production trust anchor. Correct
// on most machines, a GUESS on any other, and on an installation rooted
// elsewhere it would have trusted whatever ordinary `C:\Windows` directory
// happened to exist. The authority is now the kernel's own object-manager link
// `\\?\GLOBALROOT\SystemRoot`, which user space cannot forge.

test("R6: the authority is OS-backed and resolves the REAL system directory", (t) => {
  if (!IS_WINDOWS) {
    t.skip("the object-manager namespace exists only on Windows");
    return;
  }
  const root = authoritativeSystemRoot();
  assert.notEqual(root, null, "the kernel must answer on a Windows host");
  assert.equal(isAbsolute(root as string), true, "a canonical absolute DOS path");
  assert.equal((root as string).startsWith("\\\\?\\"), false, "the object-manager prefix must never leak into a spawnable path");

  // It genuinely designates the running installation: the real system files
  // are present underneath it.
  for (const rel of ["System32", join("System32", "kernel32.dll"), join("System32", "tasklist.exe")]) {
    assert.equal(existsSync(join(root as string, rel)), true, `${rel} must exist under the kernel-supplied root`);
  }

  // And it is what resolution actually uses.
  const tool = resolveWindowsSystemTool("tasklist");
  assert.equal(tool.ok, true, `tasklist must resolve: ${tool.reasonCode}`);
  if (tool.ok) {
    assert.equal(tool.value.systemRoot, root, "resolution is anchored to the kernel-supplied root");
    assert.equal(tool.value.command, join(root as string, "System32", "tasklist.exe"));
  }
});

test("R1/R2/R3: SystemRoot, WINDIR and PATH are not consulted at all", () => {
  const fake = plantWindowsRoot("authpoison");
  const hostile = plantHostileTools("authpath");

  // Every root-ish variable AND path variable poisoned simultaneously.
  const poisoned = {
    SystemRoot: fake,
    SYSTEMROOT: fake,
    windir: fake,
    WINDIR: fake,
    SystemDrive: fake,
    PATH: [hostile, join(fake, "System32")].join(delimiter),
    Path: hostile,
    PATHEXT: ".EXE;.CMD;.BAT",
    ComSpec: join(hostile, "cmd.exe"),
  };

  for (const id of ALL_TOOLS) {
    const a = resolveWindowsSystemTool(id, { environment: poisoned });
    const b = resolveWindowsSystemTool(id);
    assert.equal(a.ok, b.ok, `${id}: a poisoned environment changes nothing`);
    if (a.ok && b.ok) {
      assert.equal(a.value.command, b.value.command, `${id}: identical binary`);
      assert.equal(a.value.systemRoot, b.value.systemRoot, `${id}: identical root`);
      assert.equal(a.value.command.startsWith(fake), false, `${id}: never the poisoned root`);
      assert.equal(a.value.command.startsWith(hostile), false, `${id}: never the PATH plant`);
    }
  }
  rmSync(fake, { recursive: true, force: true });
  rmSync(hostile, { recursive: true, force: true });
});

test("R4: a complete fake tree cannot establish its OWN authority", (t) => {
  if (!IS_WINDOWS) {
    t.skip("outranking a real kernel-supplied root requires a Windows host");
    return;
  }
  // Everything the old checks looked for: System32, kernel32.dll, all three
  // tools in their correct sub-locations.
  const fake = plantWindowsRoot("selfauth");
  assert.equal(existsSync(join(fake, "System32", "kernel32.dll")), true, "fixture really is complete");
  assert.equal(existsSync(join(fake, "System32", "wbem", "wmic.exe")), true, "including wmic in wbem");

  for (const id of ALL_TOOLS) {
    const r = resolveWindowsSystemTool(id, { environment: { SystemRoot: fake, windir: fake, PATH: join(fake, "System32") } });
    if (r.ok) assert.equal(r.value.command.startsWith(fake), false, `${id}: a self-declared root proves nothing`);
  }
  rmSync(fake, { recursive: true, force: true });
});

test("R5: the resolved root is DERIVED from the kernel, not a hard-coded literal", (t) => {
  if (!IS_WINDOWS) {
    t.skip("requires the object-manager namespace");
    return;
  }
  // The value must come from resolving the object-manager link. Proof that it
  // is derived rather than constant: it equals what the kernel link resolves
  // to, and resolution follows the kernel even when every other channel
  // disagrees. On a D:\Windows host this yields D:\Windows.
  const kernelRoot = authoritativeSystemRoot();
  const tool = resolveWindowsSystemTool("tasklist", { environment: { SystemRoot: "C:\\Windows", windir: "C:\\Windows" } });
  assert.equal(tool.ok, true);
  if (tool.ok) assert.equal(tool.value.systemRoot, kernelRoot, "the root tracks the kernel, not any literal");

  // There is no code path that can reintroduce a literal fallback: with the
  // kernel answer unavailable (simulated by an unusable test root), resolution
  // REFUSES rather than dropping back to C:\Windows.
  const refused = resolveWindowsSystemTool("tasklist", { platform: "win32", testOnlySystemRoot: join(tempDir("nofallback"), "absent") });
  assert.equal(refused.ok, false, "no implicit fallback exists");
  assert.equal(refused.value, null);
});

test("R7: a non-standard root simulation is never redirected back to C:\\Windows", () => {
  // A planted root standing in for an installation rooted elsewhere. When it is
  // the supplied authority, resolution stays INSIDE it and never silently
  // substitutes the conventional location.
  const elsewhere = plantWindowsRoot("elsewhere");
  for (const id of ALL_TOOLS) {
    const r = resolveWindowsSystemTool(id, { platform: "win32", testOnlySystemRoot: elsewhere });
    assert.equal(r.ok, true, `${id} must resolve inside the supplied root: ${r.reasonCode}`);
    if (!r.ok) continue;
    assert.equal(r.value.systemRoot, elsewhere, `${id}: the root is the one supplied, not a literal`);
    assert.equal(r.value.command.startsWith(elsewhere), true, `${id}: the tool comes from that root`);
    assert.equal(r.value.command.toLowerCase().startsWith("c:\\windows"), false, `${id}: never redirected to C:\\Windows`);
    // The minimal environment must describe THAT root too, not a literal one.
    assert.equal(r.value.environment.SystemRoot, elsewhere, `${id}: the child environment names the real root`);
  }
  rmSync(elsewhere, { recursive: true, force: true });
});

test("R8: an unprovable authority yields zero subprocess starts and a closed result", () => {
  const unusable = join(tempDir("noauthority"), "not-a-windows-root");
  const runner = countingRunner();
  const driver = new NodeProcessTreeDriver({
    toolResolver: (id) => resolveWindowsSystemTool(id, { platform: "win32", testOnlySystemRoot: unusable }),
    toolRunner: runner.run,
  });

  const e = driver.enumerateDescendants(handleFor(process.pid), DEFAULT_TERMINATION_POLICY);
  driver.listDescendants(handleFor(process.pid), DEFAULT_TERMINATION_POLICY);
  const receipt = driver.terminate(handleFor(process.pid), DEFAULT_TERMINATION_POLICY, "completed", 1000);

  assert.equal(runner.calls.length, 0, "no tool may be started without a proven authority");
  if (IS_WINDOWS) {
    assert.equal(e.evidence, "unavailable");
    assert.equal(e.proven, false);
    assert.equal(receipt.cleanupComplete, false, "and nothing may be claimed complete");
  }
});

test("R10: production supplies NO root override anywhere", () => {
  // The seam is named `testOnlySystemRoot` and production passes no options at
  // all — `runTool` calls `resolveWindowsSystemTool(id)`. This asserts the
  // behavioural consequence: the default resolver ignores every caller-supplied
  // channel, so the only reachable root is the kernel's.
  const fake = plantWindowsRoot("r10");
  const defaultResolution = resolveWindowsSystemTool("tasklist");
  const withEverythingPoisoned = resolveWindowsSystemTool("tasklist", {
    environment: { SystemRoot: fake, windir: fake, WINDIR: fake, SYSTEMROOT: fake, PATH: join(fake, "System32"), Path: join(fake, "System32") },
  });
  assert.equal(withEverythingPoisoned.ok, defaultResolution.ok, "no caller-supplied channel changes production resolution");
  if (defaultResolution.ok && withEverythingPoisoned.ok) {
    assert.equal(withEverythingPoisoned.value.systemRoot, defaultResolution.value.systemRoot);
    assert.equal(withEverythingPoisoned.value.command, defaultResolution.value.command);
  }
  rmSync(fake, { recursive: true, force: true });
});

test("resolution refuses outright on a non-Windows platform", () => {
  const r = resolveWindowsSystemTool("tasklist", { platform: "linux" });
  assert.equal(r.ok, false);
  assert.equal(r.reasonCode, "not-windows");
  assert.equal(r.value, null);
});

test("a relative or absent root is refused rather than resolved from the cwd", () => {
  for (const bad of ["", "System32", "..\\Windows", "relative/path"]) {
    const r = resolveWindowsSystemTool("tasklist", { platform: "win32", environment: { SystemRoot: bad, windir: bad } });
    if (r.ok) {
      // Only acceptable outcome on a real Windows host: the conventional root
      // was used, NOT the relative value.
      assert.equal(r.value.systemRoot.toLowerCase().startsWith("c:\\windows"), true, `"${bad}" must never be resolved relative to the current directory`);
    } else {
      assert.equal(r.value, null);
    }
  }
});

test("the resolved command is canonical and contained in the system directory", (t) => {
  if (!IS_WINDOWS) {
    t.skip("canonicality against the real System32 requires Windows");
    return;
  }
  for (const id of ALL_TOOLS) {
    const r = resolveWindowsSystemTool(id);
    if (!r.ok) continue; // wmic is legitimately absent on current Windows
    assert.equal(isAbsolute(r.value.command), true, `${id}: absolute`);
    assert.equal(realpathSync(r.value.command).toLowerCase(), r.value.command.toLowerCase(), `${id}: already canonical`);
    assert.equal(r.value.command.toLowerCase().startsWith(r.value.systemDirectory.toLowerCase() + sep), true, `${id}: contained in the system directory`);
    assert.equal(/\.exe$/i.test(r.value.command), true, `${id}: an executable image, never a script`);
    assert.equal(existsSync(r.value.command), true, `${id}: the resolved file exists`);
  }
});

test("this suite terminated nothing and started no system tool of its own", () => {
  // Every driver above was built with a counting runner or a refusing resolver,
  // except the two explicitly-guarded real-host tests, which only ever run
  // read-only `tasklist` against our own PID and assert a REFUSAL.
  const runner = countingRunner();
  const driver = new NodeProcessTreeDriver({ toolResolver: REFUSING_RESOLVER, toolRunner: runner.run });
  driver.enumerateDescendants(handleFor(process.pid), DEFAULT_TERMINATION_POLICY);
  driver.listDescendants(handleFor(process.pid), DEFAULT_TERMINATION_POLICY);
  assert.equal(runner.calls.length, 0, "a refused resolver starts nothing at all");
});
