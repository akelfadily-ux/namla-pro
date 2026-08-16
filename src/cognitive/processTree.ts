/**
 * processTree — the ONE boundary for terminating a provider process and every
 * descendant it created.
 *
 * The defect, reproduced on this host: `spawnSync`'s `timeout` + `killSignal`
 * kills exactly one process. A child spawned with `detached: true` escapes the
 * parent's console/process group and stays alive after the root is SIGKILLed.
 * A provider CLI that detaches a helper therefore leaks a live process on every
 * timeout, holding the workspace open and consuming resources indefinitely.
 *
 * Two platform strategies:
 *
 *   POSIX — REFUSES (S-11). The synchronous provider path cannot prove it owns
 *     anything by the time cleanup starts, so it signals nothing at all. See
 *     `posixOwnershipProven` for why, including the part that is easy to miss:
 *     a recycled root's descendants are real processes with valid identities,
 *     so per-PID checks cannot supply the missing lineage. The earlier
 *     session-based design described here was never actually reachable —
 *     `spawnSync` creates no session, and no production caller ever claimed one.
 *
 *   WINDOWS — `taskkill /PID <root> /T` walks the live parent/child tree.
 *     `/F` is used only after the grace period expires. Identity is proven
 *     through a trusted `tasklist` before any signal (S-10), and that path is
 *     unchanged by S-11.
 *
 * IDENTITY IS VERIFIED BEFORE ANY SIGNAL. A dead root's PID can be recycled by
 * the OS, and killing a recycled PID would terminate an unrelated process — the
 * exact harm this module exists to prevent. Where identity cannot be confirmed,
 * termination refuses with `process-tree-identity-mismatch`. Note that the
 * image basename a handle carries is CORROBORATION only: a recycled PID can
 * trivially run the same executable.
 *
 * Honesty rule: `cleanupComplete` is only true when descendants were actually
 * confirmed gone. When the platform cannot prove it, the receipt says
 * `process-tree-cleanup-incomplete` rather than assuming success.
 */

import { spawnSync } from "child_process";
import { basename } from "path";
import { resolveWindowsSystemTool, type WindowsSystemToolId, type WindowsSystemToolResult } from "./windowsSystemTools";

export type ProcessTreePlatformKind = "win32" | "posix" | "unsupported";

export type TerminationReason = "completed" | "provider-timeout" | "provider-cancelled" | "parser-rejected" | "request-rejected" | "driver-error" | "parent-shutdown";

export type ProcessTreeReasonCode = "ok" | "provider-timeout" | "provider-cancelled" | "process-tree-graceful-termination-failed" | "process-tree-force-termination-failed" | "process-tree-cleanup-incomplete" | "process-tree-identity-mismatch" | "process-tree-platform-unsupported";

/** Identity of one spawned root. Carries no command line, prompt, or environment. */
export interface ProcessTreeHandle {
  readonly rootPid: number;
  /**
   * CALLER-SUPPLIED METADATA describing how the process was spawned. It is NOT
   * proof of process-group ownership and NOT a capability: any caller can set
   * it, and nothing verifies it.
   *
   * Current production has no trusted POSIX group provenance — `spawnSync`
   * creates no group, no production caller passes true, and there is no
   * `detached: true` anywhere in production. S-11 therefore grants this field
   * NO destructive signalling authority: a POSIX handle is refused whatever it
   * says here.
   */
  readonly processGroupCreated: boolean;
  /** Expected image basename, used to refuse a recycled PID. */
  readonly expectedImageBasename: string;
  /** Deterministic ordering value — this module never reads a clock for logic. */
  readonly spawnSequence: number;
}

export interface ProcessTreeTerminationPolicy {
  readonly gracePeriodMs: number;
  readonly forceAfterGrace: boolean;
  readonly maxDescendants: number;
}

export const DEFAULT_TERMINATION_POLICY: ProcessTreeTerminationPolicy = { gracePeriodMs: 2000, forceAfterGrace: true, maxDescendants: 256 };

/** Safe cleanup metadata. No prompt, no command line, no environment, no output. */
export interface ProcessTreeCleanupReceipt {
  readonly rootProcessId: number;
  readonly platform: ProcessTreePlatformKind;
  readonly terminationReason: TerminationReason;
  readonly gracefulAttempted: boolean;
  readonly gracefulSucceeded: boolean;
  readonly forcedAttempted: boolean;
  readonly forcedSucceeded: boolean;
  readonly descendantsTargeted: number;
  readonly descendantsRemaining: number;
  readonly cleanupComplete: boolean;
  readonly timeoutMs: number;
  readonly safeReasonCode: ProcessTreeReasonCode;
  readonly safeFingerprint: string;
}

/**
 * A descendant listing plus whether it is EVIDENCE.
 *
 * `proven: false` means the platform could not be asked — the tool is absent,
 * refused trust, failed, or timed out. It never means "there are none".
 */
export type DescendantEvidence =
  /** A trusted snapshot was obtained and the transitive closure was fully explored. */
  | "complete"
  /** The closure was truncated by the policy cap; reachable nodes remain unrecorded. */
  | "capped"
  /** No trusted snapshot: the tool is absent, refused, failed, or returned nothing usable. */
  | "unavailable";

export interface DescendantEnumeration {
  readonly evidence: DescendantEvidence;
  /**
   * `evidence === "complete"`. The ONLY basis on which completeness may be
   * claimed — `capped` and `unavailable` both mean the tree was not fully seen.
   */
  readonly proven: boolean;
  readonly pids: readonly number[];
}

export interface ProcessTreeDriver {
  readonly isReal: boolean;
  /** PIDs descended from the handle's root, bounded by policy. */
  listDescendants(handle: ProcessTreeHandle, policy: ProcessTreeTerminationPolicy): readonly number[];
  terminate(handle: ProcessTreeHandle, policy: ProcessTreeTerminationPolicy, reason: TerminationReason, timeoutMs: number): ProcessTreeCleanupReceipt;
}

/** FNV-1a over SAFE receipt fields only. */
function fingerprint(parts: readonly (string | number | boolean)[]): string {
  let h = 0x811c9dc5;
  const s = parts.join("|");
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `pt-${h.toString(16).padStart(8, "0")}`;
}

export function buildCleanupReceipt(input: Omit<ProcessTreeCleanupReceipt, "safeFingerprint">): ProcessTreeCleanupReceipt {
  return { ...input, safeFingerprint: fingerprint([input.rootProcessId, input.platform, input.terminationReason, input.gracefulAttempted, input.gracefulSucceeded, input.forcedAttempted, input.forcedSucceeded, input.descendantsTargeted, input.descendantsRemaining, input.cleanupComplete, input.timeoutMs, input.safeReasonCode]) };
}

export function platformKind(platform: NodeJS.Platform = process.platform): ProcessTreePlatformKind {
  if (platform === "win32") return "win32";
  if (platform === "linux" || platform === "darwin" || platform === "freebsd" || platform === "openbsd" || platform === "sunos" || platform === "aix") return "posix";
  return "unsupported";
}

// ------------------------------------------------------------------ FAKE ---

export interface FakeTreeSpec {
  /** parentPid -> child pids. */
  readonly tree: Readonly<Record<number, readonly number[]>>;
  readonly gracefulSucceeds?: boolean;
  readonly forceSucceeds?: boolean;
  readonly identityMatches?: boolean;
  readonly platform?: ProcessTreePlatformKind;
}

/**
 * Deterministic driver. Runs no process and signals nothing; it models a tree
 * so every lifecycle and failure path is provable without touching the host.
 */
export class FakeProcessTreeDriver implements ProcessTreeDriver {
  readonly isReal = false;
  /** PIDs this driver has already cleaned — a second attempt must be refused. */
  readonly cleanedPids = new Set<number>();
  /** PIDs that were signalled, so a test can prove nothing unrelated was hit. */
  readonly signalledPids: number[] = [];
  cleanupCallCount = 0;
  private readonly alive = new Set<number>();

  constructor(private readonly spec: FakeTreeSpec) {
    for (const [parent, kids] of Object.entries(spec.tree)) {
      this.alive.add(Number(parent));
      for (const k of kids) this.alive.add(k);
    }
  }

  isAlive(pid: number): boolean {
    return this.alive.has(pid);
  }

  listDescendants(handle: ProcessTreeHandle, policy: ProcessTreeTerminationPolicy): readonly number[] {
    const out: number[] = [];
    const walk = (pid: number): void => {
      for (const child of this.spec.tree[pid] ?? []) {
        if (out.length >= policy.maxDescendants) return;
        if (this.alive.has(child)) out.push(child);
        walk(child);
      }
    };
    walk(handle.rootPid);
    return out;
  }

  terminate(handle: ProcessTreeHandle, policy: ProcessTreeTerminationPolicy, reason: TerminationReason, timeoutMs: number): ProcessTreeCleanupReceipt {
    this.cleanupCallCount += 1;
    const platform = this.spec.platform ?? "posix";
    const base = { rootProcessId: handle.rootPid, platform, terminationReason: reason, timeoutMs };

    if (platform === "unsupported") {
      return buildCleanupReceipt({ ...base, gracefulAttempted: false, gracefulSucceeded: false, forcedAttempted: false, forcedSucceeded: false, descendantsTargeted: 0, descendantsRemaining: this.listDescendants(handle, policy).length, cleanupComplete: false, safeReasonCode: "process-tree-platform-unsupported" });
    }
    if (this.spec.identityMatches === false) {
      // Refuse WITHOUT signalling: a recycled PID belongs to someone else.
      return buildCleanupReceipt({ ...base, gracefulAttempted: false, gracefulSucceeded: false, forcedAttempted: false, forcedSucceeded: false, descendantsTargeted: 0, descendantsRemaining: this.listDescendants(handle, policy).length, cleanupComplete: false, safeReasonCode: "process-tree-identity-mismatch" });
    }
    if (this.cleanedPids.has(handle.rootPid)) {
      return buildCleanupReceipt({ ...base, gracefulAttempted: false, gracefulSucceeded: false, forcedAttempted: false, forcedSucceeded: false, descendantsTargeted: 0, descendantsRemaining: 0, cleanupComplete: true, safeReasonCode: "ok" });
    }

    const targets = [handle.rootPid, ...this.listDescendants(handle, policy)];
    const graceful = this.spec.gracefulSucceeds !== false;
    for (const pid of targets) this.signalledPids.push(pid);
    if (graceful) for (const pid of targets) this.alive.delete(pid);

    let forcedAttempted = false;
    let forcedSucceeded = false;
    if (!graceful && policy.forceAfterGrace) {
      forcedAttempted = true;
      forcedSucceeded = this.spec.forceSucceeds !== false;
      if (forcedSucceeded) for (const pid of targets) this.alive.delete(pid);
    }

    // `descendantsRemaining` counts DESCENDANTS, matching its name. Completeness
    // separately requires the root to be gone as well, so a surviving root can
    // never be hidden by a zero descendant count.
    const remaining = targets.slice(1).filter((p) => this.alive.has(p)).length;
    const complete = remaining === 0 && !this.alive.has(handle.rootPid);
    if (complete) this.cleanedPids.add(handle.rootPid);

    const reasonCode: ProcessTreeReasonCode = complete ? (reason === "provider-timeout" ? "provider-timeout" : reason === "provider-cancelled" ? "provider-cancelled" : "ok") : forcedAttempted && !forcedSucceeded ? "process-tree-force-termination-failed" : !graceful ? "process-tree-graceful-termination-failed" : "process-tree-cleanup-incomplete";

    return buildCleanupReceipt({ ...base, gracefulAttempted: true, gracefulSucceeded: graceful, forcedAttempted, forcedSucceeded, descendantsTargeted: targets.length - 1, descendantsRemaining: remaining, cleanupComplete: complete, safeReasonCode: reasonCode });
  }
}

// ------------------------------------------------------------------ REAL ---

/** Is a PID alive? `signal 0` performs the permission/existence check only. */
function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * A PID that is safe to put in a command argument or a query string.
 *
 * Every Windows tool below receives the root PID, and `wmic`'s query embeds it
 * in a WQL string. The value is validated at the boundary rather than trusted
 * because it arrived in a handle: a handle can be constructed directly, and
 * "it was an integer when we built it" is not a property the spawn site can
 * check for itself. Rejecting here means no non-integer, negative, zero, or
 * out-of-range value ever reaches an argument vector.
 */
function isSpawnablePid(pid: number): boolean {
  return Number.isSafeInteger(pid) && pid > 0;
}

/**
 * Run a trusted Windows system tool, or refuse.
 *
 * Every Windows spawn in this module goes through here, so the trust rules hold
 * in one place: canonical absolute `.exe` resolved without `PATH`, `shell:
 * false`, a minimal rebuilt environment, and a working directory inside the
 * system directory rather than wherever the caller happened to be — the current
 * directory is part of the Windows DLL search order.
 *
 * Returns `null` when the tool cannot be proven, which callers must treat as
 * "no evidence", never as "nothing found".
 */
export interface WindowsToolInvocation {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly maxBuffer: number;
}

export type WindowsToolRunner = (invocation: WindowsToolInvocation) => { readonly status: number | null; readonly stdout: string } | null;

/** The real runner. `shell: false` is not negotiable and is not a parameter. */
const spawnWindowsTool: WindowsToolRunner = (invocation) => {
  const out = spawnSync(invocation.command, [...invocation.args], {
    shell: false,
    windowsHide: true,
    timeout: invocation.timeoutMs,
    maxBuffer: invocation.maxBuffer,
    encoding: "utf8",
    env: { ...invocation.env },
    cwd: invocation.cwd,
  });
  if (out.error || typeof out.stdout !== "string") return null;
  return { status: out.status, stdout: out.stdout };
};

/** Seams, so the Windows rules are provable without a Windows host. */
export interface ProcessTreeDriverOptions {
  readonly toolRunner?: WindowsToolRunner;
  readonly toolResolver?: (id: WindowsSystemToolId) => WindowsSystemToolResult;
  /** Platform seam, so the POSIX refusal is provable from any host. */
  readonly platform?: NodeJS.Platform;
  /**
   * Test seam that OBSERVES enumeration. Production never passes it. It exists
   * so a test can prove the destructive path never even asks for a descendant
   * list under an unproven handle.
   */
  readonly onPosixEnumeration?: () => void;
}

/**
 * Can Namla prove it OWNS this POSIX process tree?
 *
 * Under the current synchronous provider architecture the answer is always no,
 * and that is a fact about the architecture rather than a policy choice:
 *
 *   `spawnSync` does not return until the child has fully closed, so by the
 *   time a handle is built the root is already exited and reaped. Measured:
 *   `process.kill(outcome.pid, 0)` throws immediately after return.
 *
 * Two things follow, and the second is the one that is easy to miss.
 *
 *   ROOT     nothing observed AFTER the child is gone can identify it. Probing
 *            `/proc/<pid>/stat` for a live process at that number proves only
 *            that SOMETHING is there now. Treating that as the child's identity
 *            is laundering, not evidence.
 *   LINEAGE  neither can its tree be recovered. If the number was reused by an
 *            unrelated process B, enumerating "descendants of <pid>" returns
 *            B's real children. Each has a perfectly valid, stable start time,
 *            so per-process identity checks pass — and every one of them is a
 *            stranger. IDENTITY IS NOT LINEAGE.
 *
 * `processGroupCreated` cannot rescue it either. It is an ordinary boolean on
 * an interface, not a capability: any caller can construct a handle with it set
 * to true, and an audit found ZERO production callers that pass true and no
 * `detached: true` anywhere in production. A field that asserts ownership is
 * not ownership, so the group path is refused on the same terms.
 *
 * S-11 therefore chooses NEVER SIGNAL AN UNPROVEN PROCESS over best-effort
 * cleanup. Regaining POSIX cleanup safely needs an async `spawn` that creates a
 * real session while the child is alive — recorded as a future architectural
 * milestone, deliberately not attempted here.
 */
function posixOwnershipProven(_handle: ProcessTreeHandle): boolean {
  return false;
}

/**
 * Parse `wmic ... get ProcessId /FORMAT:CSV` output into descendant PIDs.
 *
 * Exported because this is where malformed tool output would turn into
 * termination targets, and that deserves direct tests rather than inference.
 * Every record must survive all of: matches the expected CSV shape, is a
 * positive safe integer, is not the root itself, is not a duplicate. Anything
 * else is DROPPED — never coerced, never defaulted, never partially accepted.
 * `NaN`, `0`, negatives, floats, overflow and injected text all fall out here,
 * which is why no PID reaching an argument vector can carry anything but digits.
 */
export interface ProcessRow {
  readonly pid: number;
  readonly ppid: number;
}

/**
 * Parse `wmic process get ProcessId,ParentProcessId /FORMAT:CSV`.
 *
 * Rows look like `HOSTNAME,<ppid>,<pid>` — WMIC emits the requested columns in
 * alphabetical order, so ParentProcessId precedes ProcessId. The header line
 * does not match the shape and is dropped without special-casing.
 *
 * Returns `null` when the output yields NO usable rows at all. A real snapshot
 * always contains many processes, so an empty parse means the output was
 * truncated, garbled or not a snapshot — none of which may be reported as "this
 * machine has no processes". Ambiguity is unavailability, not emptiness.
 */
export const WMIC_SNAPSHOT_HEADER = "Node,ParentProcessId,ProcessId";

export function parseWmicProcessSnapshot(stdout: string): readonly ProcessRow[] | null {
  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return null; // no output at all
  // The header is a required integrity signal: without it we are not looking at
  // the start of a snapshot, so we cannot know what was lost before this point.
  if (lines[0].toLowerCase() !== WMIC_SNAPSHOT_HEADER.toLowerCase()) return null;
  if (lines.length === 1) return null; // header alone proves nothing

  const rows: ProcessRow[] = [];
  for (const line of lines.slice(1)) {
    const m = /^([^,]*),(\d+),(\d+)$/.exec(line);
    // ANY non-conforming row invalidates the WHOLE snapshot. Dropping it and
    // carrying on is the flaw review caught: a truncated final row means output
    // was lost, and the surviving rows would then be presented as a complete
    // picture of the machine — hiding a reachable descendant and licensing a
    // `cleanupComplete` that was never earned.
    if (!m) return null;

    const ppid = Number(m[2]);
    const pid = Number(m[3]);

    // SNAPSHOT VALIDITY IS NOT TARGETABILITY. Two different questions, kept
    // deliberately separate:
    //
    //   snapshot-valid PID  : safe integer >= 0
    //   snapshot-valid PPID : safe integer >= 0
    //   TARGETABLE PID      : safe integer >  0   (enforced in the closure)
    //
    // ProcessId 0 is the System Idle Process and ParentProcessId 0 is its
    // parent; both appear in every genuine Windows snapshot. Treating either as
    // malformed would invalidate real snapshots and leave Windows enumeration
    // permanently unavailable. They are therefore structurally VALID here and
    // simply never become termination targets, which `isSpawnablePid` enforces
    // where it matters — at the point a PID could reach an argument vector.
    //
    // Out-of-range values still invalidate the snapshot: an overflowing digit
    // run is not a number we can reason about, so it is lost evidence, not a
    // droppable row.
    if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(ppid) || pid < 0 || ppid < 0) return null;

    rows.push({ pid, ppid });
  }

  return rows.length > 0 ? rows : null;
}

/**
 * The TRANSITIVE closure of descendants, from one bounded snapshot.
 *
 * Human review caught the previous query asking `wmic` for
 * `ParentProcessId = <root>`, which returns DIRECT CHILDREN ONLY. For
 * `100 -> 200 -> 300` it sees 200 and never 300, yet the result was consumed as
 * a descendant enumeration and fed a `cleanupComplete` claim. One generation of
 * evidence cannot support a statement about a tree.
 *
 * A whole-snapshot query plus an in-memory walk fixes that and removes the PID
 * interpolation entirely — the query is now a fixed string with nothing
 * substituted into it.
 *
 * Bounded and total: `visited` makes self-cycles and multi-node cycles
 * terminate, the root is pre-marked so it can never be its own descendant,
 * duplicate rows collapse, and the policy cap is enforced. Hitting the cap
 * while reachable nodes remain yields `capped` — an explicitly INCOMPLETE
 * answer, never a complete one that happens to be short.
 */
export function buildTransitiveDescendants(rows: readonly ProcessRow[], rootPid: number, maxDescendants: number): { readonly evidence: "complete" | "capped"; readonly pids: readonly number[] } {
  const children = new Map<number, number[]>();
  for (const row of rows) {
    // Malformed or self-parenting rows never become edges. PPID 0 is a
    // legitimate parent value in a Windows snapshot, so it is admitted as an
    // edge source — it simply is not reachable from a positive root PID.
    if (!isSpawnablePid(row.pid) || !Number.isSafeInteger(row.ppid) || row.ppid < 0 || row.pid === row.ppid) continue;
    const list = children.get(row.ppid) ?? [];
    list.push(row.pid);
    children.set(row.ppid, list);
  }

  const visited = new Set<number>([rootPid]);
  const pids: number[] = [];
  const queue: number[] = [rootPid];
  let capped = false;

  while (queue.length > 0 && !capped) {
    const current = queue.shift() as number;
    for (const child of children.get(current) ?? []) {
      if (visited.has(child)) continue; // duplicates and cycles
      if (pids.length >= maxDescendants) {
        // A reachable node exists that we are not allowed to record. Say so.
        capped = true;
        break;
      }
      visited.add(child);
      pids.push(child);
      queue.push(child);
    }
  }

  return { evidence: capped ? "capped" : "complete", pids };
}

/**
 * Confirm the PID still belongs to the image we spawned. A dead root's PID can
 * be recycled; signalling a recycled PID would kill an unrelated process.
 *
 * Unchanged in spirit from S-9: anything short of a confirmed match is `false`,
 * so an unresolvable `tasklist`, a spawn failure, a non-zero exit, or unparsable
 * output all refuse termination rather than allowing it.
 */
export function imageMatchesTasklistRow(stdout: string, expectedImageBasename: string): boolean {
  const image = (stdout.split(",")[0] ?? "").replace(/"/g, "").trim().toLowerCase();
  if (image.length === 0 || image.startsWith("info:")) return false;
  return image === expectedImageBasename.toLowerCase();
}

/** Busy-wait a bounded grace period. Sync by necessity: the caller is sync. */
function waitBounded(ms: number, until: () => boolean): void {
  const deadline = Date.now() + Math.max(0, ms);
  while (Date.now() < deadline) {
    if (until()) return;
    spawnSync(process.execPath, ["-e", "setTimeout(()=>{},50)"], { shell: false, windowsHide: true, timeout: 200, maxBuffer: 1024 });
  }
}

export class NodeProcessTreeDriver implements ProcessTreeDriver {
  readonly isReal = true;

  constructor(private readonly seams: ProcessTreeDriverOptions = {}) {}

  private kind(): ProcessTreePlatformKind {
    return platformKind(this.seams.platform ?? process.platform);
  }

  /**
   * Run a trusted Windows system tool, or refuse WITHOUT running anything.
   *
   * Every Windows spawn in this module funnels through here, so the trust rules
   * hold in exactly one place: a canonical absolute `.exe` resolved without ever
   * reading `PATH`, `shell: false`, a minimal rebuilt environment, and a working
   * directory inside the system directory — the current directory is part of the
   * Windows DLL search order, so leaving it wherever the caller stood is a way
   * in.
   *
   * The resolution happens BEFORE the runner is called. When a tool cannot be
   * proven this returns `null` having started zero processes, and the caller
   * must read that as "no evidence", never as "nothing found".
   */
  private runTool(id: WindowsSystemToolId, args: readonly string[], timeoutMs: number, maxBuffer: number): { readonly status: number | null; readonly stdout: string } | null {
    const tool = (this.seams.toolResolver ?? resolveWindowsSystemTool)(id);
    if (!tool.ok) return null;
    const runner = this.seams.toolRunner ?? spawnWindowsTool;
    return runner({ command: tool.value.command, args, env: tool.value.environment, cwd: tool.value.systemDirectory, timeoutMs, maxBuffer });
  }

  /**
   * Confirm the PID still belongs to the image we spawned. A dead root's PID can
   * be recycled; signalling a recycled PID would kill an unrelated process.
   *
   * Anything short of a confirmed match is `false`, so an unresolvable
   * `tasklist`, a spawn failure, a non-zero exit or unparsable output all refuse
   * termination rather than permit it.
   */
  private identityMatches(handle: ProcessTreeHandle): boolean {
    if (platformKind() !== "win32") return true; // POSIX targets the group we created
    if (!isSpawnablePid(handle.rootPid)) return false;
    const out = this.runTool("tasklist", ["/FI", `PID eq ${handle.rootPid}`, "/FO", "CSV", "/NH"], 5000, 8192);
    if (!out || out.status !== 0) return false;
    return imageMatchesTasklistRow(out.stdout, handle.expectedImageBasename);
  }

  /**
   * Descendants, WITH whether the answer is evidence or merely an absence of it.
   *
   * The distinction is the whole point. The previous code returned `[]` when
   * `wmic` failed, which is indistinguishable from "this process has no
   * children" — so a host where the tool is missing reported a clean, complete
   * cleanup while descendants were never looked at. That is not a hypothetical:
   * `wmic` is REMOVED from current Windows (11 24H2 onward), so on those hosts
   * the enumeration failed on every single call and the receipt claimed success
   * every time.
   *
   * `proven: false` therefore means "no evidence was obtained", and the caller
   * must not convert it into a completeness claim.
   */
  enumerateDescendants(handle: ProcessTreeHandle, policy: ProcessTreeTerminationPolicy): DescendantEnumeration {
    const unavailable: DescendantEnumeration = { evidence: "unavailable", proven: false, pids: [] };
    const kind = this.kind();
    if (kind === "unsupported") return unavailable;

    // POSIX IS DELIBERATELY UNCHANGED IN S-10.
    //
    // This milestone is about the Windows path — bare `tasklist`/`wmic`/
    // `taskkill` and the environment they inherit. An earlier revision of this
    // work also rewrote the POSIX branch onto the new strict parser and
    // evidence model. Review rejected that as out of scope, and it has been
    // reverted: `listPosixDescendants` below is byte-identical to baseline, and
    // POSIX therefore keeps reporting exactly what it reported before —
    // including its own fail-open on a `ps` failure, which is recorded as a
    // FUTURE FINDING and deliberately NOT fixed here.
    //
    // Mapping baseline behaviour onto the new return type is mechanical:
    // baseline had no notion of unproven enumeration, so POSIX is always
    // "complete", which makes `cleanupComplete` resolve exactly as it did at
    // HEAD.
    if (kind === "posix") {
      this.seams.onPosixEnumeration?.();
      return { evidence: "complete", proven: true, pids: this.listPosixDescendants(handle, policy) };
    }

    if (!isSpawnablePid(handle.rootPid)) return unavailable;

    const rows = this.windowsSnapshot();
    if (!rows) return unavailable;

    const closure = buildTransitiveDescendants(rows, handle.rootPid, policy.maxDescendants);
    return { evidence: closure.evidence, proven: closure.evidence === "complete", pids: closure.pids };
  }

  /**
   * ONE bounded snapshot of every process, with no PID substituted into it.
   *
   * The query is a fixed string. Nothing derived from a handle is interpolated,
   * so there is no query-construction surface at all — the previous
   * `where (ParentProcessId=<pid>)` form both limited the answer to one
   * generation and put a number inside a WQL string.
   */
  private windowsSnapshot(): readonly ProcessRow[] | null {
    const out = this.runTool("wmic", ["process", "get", "ProcessId,ParentProcessId", "/FORMAT:CSV"], 5000, 4 * 1024 * 1024);
    // Unresolvable tool, spawn failure, timeout, buffer overrun, or non-zero
    // exit: no evidence. A truncated snapshot must never look like a small one.
    if (!out || out.status !== 0) return null;
    return parseWmicProcessSnapshot(out.stdout);
  }

  /** Walk `ps -eo pid,ppid` into the transitive descendant set. Fixed template. */
  private listPosixDescendants(handle: ProcessTreeHandle, policy: ProcessTreeTerminationPolicy): readonly number[] {
    const out = spawnSync("/bin/ps", ["-eo", "pid,ppid"], { shell: false, timeout: 5000, maxBuffer: 1048576, encoding: "utf8" });
    if (out.error || typeof out.stdout !== "string") return [];
    const children = new Map<number, number[]>();
    for (const line of out.stdout.split("\n").slice(1)) {
      const m = /^\s*(\d+)\s+(\d+)/.exec(line);
      if (!m) continue;
      const pid = Number(m[1]);
      const ppid = Number(m[2]);
      const list = children.get(ppid) ?? [];
      list.push(pid);
      children.set(ppid, list);
    }
    const acc: number[] = [];
    const seen = new Set<number>();
    const walk = (pid: number): void => {
      for (const c of children.get(pid) ?? []) {
        if (seen.has(c) || acc.length >= policy.maxDescendants) continue;
        seen.add(c);
        acc.push(c);
        walk(c);
      }
    };
    walk(handle.rootPid);
    return acc;
  }

  listDescendants(handle: ProcessTreeHandle, policy: ProcessTreeTerminationPolicy): readonly number[] {
    return this.enumerateDescendants(handle, policy).pids;
  }

  terminate(handle: ProcessTreeHandle, policy: ProcessTreeTerminationPolicy, reason: TerminationReason, timeoutMs: number): ProcessTreeCleanupReceipt {
    const platform = this.kind();
    const base = { rootProcessId: handle.rootPid, platform, terminationReason: reason, timeoutMs };

    if (platform === "unsupported") {
      return buildCleanupReceipt({ ...base, gracefulAttempted: false, gracefulSucceeded: false, forcedAttempted: false, forcedSucceeded: false, descendantsTargeted: 0, descendantsRemaining: 0, cleanupComplete: false, safeReasonCode: "process-tree-platform-unsupported" });
    }

    // S-11: POSIX REFUSES BEFORE IT LOOKS.
    //
    // The refusal comes first deliberately. Enumerating a stale numeric root
    // would produce a descendant list belonging to whoever inherited the PID,
    // and merely HAVING that list invites treating it as ours — so the list is
    // never requested. Nothing is enumerated, nothing is signalled, and the
    // receipt says the tree was not cleaned rather than implying it was.
    //
    // `process-tree-identity-mismatch` is the existing code for exactly this:
    // "termination refuses when it cannot confirm identity". No new reason code
    // is invented, and the success codes are not reused — `ok`,
    // `provider-timeout` and `provider-cancelled` all imply a completed sweep.
    if (platform === "posix" && !posixOwnershipProven(handle)) {
      return buildCleanupReceipt({ ...base, gracefulAttempted: false, gracefulSucceeded: false, forcedAttempted: false, forcedSucceeded: false, descendantsTargeted: 0, descendantsRemaining: 0, cleanupComplete: false, safeReasonCode: "process-tree-identity-mismatch" });
    }

    const enumeration = this.enumerateDescendants(handle, policy);
    const descendants = enumeration.pids;
    const rootLive = pidAlive(handle.rootPid);

    // Whether the descendant half of "everything is gone" can be asserted at
    // all. On Windows without a trusted `wmic` it cannot, so completeness is
    // withheld below rather than assumed — `taskkill /T` still walks and kills
    // the tree in the kernel, we simply decline to CLAIM we watched it happen.
    const descendantsProven = enumeration.proven;

    // Nothing left to do — and nothing to signal, so no recycled-PID risk.
    if (!rootLive && descendants.length === 0 && descendantsProven) {
      return buildCleanupReceipt({ ...base, gracefulAttempted: false, gracefulSucceeded: true, forcedAttempted: false, forcedSucceeded: false, descendantsTargeted: 0, descendantsRemaining: 0, cleanupComplete: true, safeReasonCode: reason === "provider-timeout" ? "provider-timeout" : reason === "provider-cancelled" ? "provider-cancelled" : "ok" });
    }

    if (rootLive && !this.identityMatches(handle)) {
      return buildCleanupReceipt({ ...base, gracefulAttempted: false, gracefulSucceeded: false, forcedAttempted: false, forcedSucceeded: false, descendantsTargeted: descendants.length, descendantsRemaining: descendants.length, cleanupComplete: false, safeReasonCode: "process-tree-identity-mismatch" });
    }

    const stillAlive = (): number => [handle.rootPid, ...descendants].filter(pidAlive).length;
    const descendantsStillAlive = (): number => descendants.filter(pidAlive).length;

    // 1. Graceful.
    let gracefulSucceeded = false;
    if (platform === "win32") {
      // A refused/unresolvable taskkill returns null and signals NOTHING. The
      // liveness checks below then report the tree as surviving, which is the
      // honest outcome — far better than a bare-name fallback that would hand
      // the kill to whatever binary the search order happened to find.
      this.runTool("taskkill", ["/PID", String(handle.rootPid), "/T"], 8000, 16384);
    }
    // NO POSIX BRANCH EXISTS ANY MORE. Every POSIX handle is refused above, so
    // a signalling path here could only ever be dead code — and dead code that
    // sends SIGKILL is exactly the kind of machinery that gets re-enabled by
    // accident. When ownership becomes provable, the branch comes back WITH the
    // proof, not before it.
    waitBounded(policy.gracePeriodMs, () => stillAlive() === 0);
    gracefulSucceeded = stillAlive() === 0;

    // 2. Forced, ONLY after the grace period expired.
    let forcedAttempted = false;
    let forcedSucceeded = false;
    if (!gracefulSucceeded && policy.forceAfterGrace) {
      forcedAttempted = true;
      if (platform === "win32") {
        this.runTool("taskkill", ["/PID", String(handle.rootPid), "/T", "/F"], 8000, 16384);
        for (const pid of descendants) {
          // `descendants` only ever holds validated positive integers, and the
          // argument vector is an array under `shell: false`, so a PID cannot
          // become an option or a second command.
          if (isSpawnablePid(pid) && pidAlive(pid)) this.runTool("taskkill", ["/PID", String(pid), "/T", "/F"], 5000, 8192);
        }
      }
      // Likewise: no POSIX forced branch. See the refusal above.
      waitBounded(500, () => stillAlive() === 0);
      forcedSucceeded = stillAlive() === 0;
    }

    const remaining = descendantsStillAlive();
    // Completeness needs BOTH halves: everything we know about is gone, AND we
    // were actually able to look. Without proven enumeration the second half is
    // missing, so the receipt reports `process-tree-cleanup-incomplete` — the
    // code this module's contract already reserves for "the platform cannot
    // prove it" — instead of silently upgrading ignorance into success.
    const observedClear = stillAlive() === 0;
    const complete = observedClear && descendantsProven;
    const reasonCode: ProcessTreeReasonCode = complete
      ? reason === "provider-timeout"
        ? "provider-timeout"
        : reason === "provider-cancelled"
          ? "provider-cancelled"
          : "ok"
      : observedClear
        ? "process-tree-cleanup-incomplete"
        : forcedAttempted
          ? "process-tree-force-termination-failed"
          : "process-tree-graceful-termination-failed";

    return buildCleanupReceipt({ ...base, gracefulAttempted: true, gracefulSucceeded, forcedAttempted, forcedSucceeded, descendantsTargeted: descendants.length, descendantsRemaining: remaining, cleanupComplete: complete, safeReasonCode: reasonCode });
  }
}

/** Build a handle from a spawn outcome. `expectedImageBasename` pins identity. */
export function buildProcessTreeHandle(rootPid: number | undefined, executableAbsolutePath: string, processGroupCreated: boolean, spawnSequence: number): ProcessTreeHandle | null {
  if (!Number.isInteger(rootPid) || (rootPid ?? 0) <= 0) return null;
  return { rootPid: rootPid as number, processGroupCreated, expectedImageBasename: basename(executableAbsolutePath), spawnSequence };
}
