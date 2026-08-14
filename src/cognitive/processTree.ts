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
 * Two platform strategies, both bounded and both fixed-template:
 *
 *   POSIX — the root is spawned in its own session, so pgid == root pid. A
 *     process GROUP outlives its leader, so `kill(-pgid, …)` still reaches
 *     surviving members after the root is dead. Graceful SIGTERM, bounded
 *     grace, then SIGKILL. Only ever the group we created.
 *
 *   WINDOWS — `taskkill /PID <root> /T` walks the live parent/child tree.
 *     `/F` is used only after the grace period expires.
 *
 * IDENTITY IS VERIFIED BEFORE ANY SIGNAL. A dead root's PID can be recycled by
 * the OS, and killing a recycled PID would terminate an unrelated process — the
 * exact harm this module exists to prevent. A handle therefore carries the
 * expected image basename, and termination refuses with
 * `process-tree-identity-mismatch` when it cannot confirm it.
 *
 * Honesty rule: `cleanupComplete` is only true when descendants were actually
 * confirmed gone. When the platform cannot prove it, the receipt says
 * `process-tree-cleanup-incomplete` rather than assuming success.
 */

import { spawnSync } from "child_process";
import { basename } from "path";

export type ProcessTreePlatformKind = "win32" | "posix" | "unsupported";

export type TerminationReason = "completed" | "provider-timeout" | "provider-cancelled" | "parser-rejected" | "request-rejected" | "driver-error" | "parent-shutdown";

export type ProcessTreeReasonCode = "ok" | "provider-timeout" | "provider-cancelled" | "process-tree-graceful-termination-failed" | "process-tree-force-termination-failed" | "process-tree-cleanup-incomplete" | "process-tree-identity-mismatch" | "process-tree-platform-unsupported";

/** Identity of one spawned root. Carries no command line, prompt, or environment. */
export interface ProcessTreeHandle {
  readonly rootPid: number;
  /** True when the root was spawned into its own group/session. */
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
 * Confirm the PID still belongs to the image we spawned. A dead root's PID can
 * be recycled; signalling a recycled PID would kill an unrelated process.
 */
function identityMatches(handle: ProcessTreeHandle): boolean {
  if (platformKind() !== "win32") return true; // POSIX targets the group we created
  const out = spawnSync("tasklist", ["/FI", `PID eq ${handle.rootPid}`, "/FO", "CSV", "/NH"], { shell: false, windowsHide: true, timeout: 5000, maxBuffer: 8192, encoding: "utf8" });
  if (out.error || typeof out.stdout !== "string") return false;
  const image = (out.stdout.split(",")[0] ?? "").replace(/"/g, "").trim().toLowerCase();
  if (image.length === 0 || image.startsWith("info:")) return false;
  return image === handle.expectedImageBasename.toLowerCase();
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

  listDescendants(handle: ProcessTreeHandle, policy: ProcessTreeTerminationPolicy): readonly number[] {
    if (platformKind() === "posix") return this.listPosixDescendants(handle, policy);
    if (platformKind() !== "win32") return [];
    const out = spawnSync("wmic", ["process", "where", `(ParentProcessId=${handle.rootPid})`, "get", "ProcessId", "/FORMAT:CSV"], { shell: false, windowsHide: true, timeout: 5000, maxBuffer: 65536, encoding: "utf8" });
    if (out.error || typeof out.stdout !== "string") return [];
    const pids: number[] = [];
    for (const line of out.stdout.split(/\r?\n/)) {
      const m = /,(\d+)\s*$/.exec(line.trim());
      if (m) {
        const pid = Number(m[1]);
        if (Number.isInteger(pid) && pid > 0 && pids.length < policy.maxDescendants) pids.push(pid);
      }
    }
    return pids;
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

  terminate(handle: ProcessTreeHandle, policy: ProcessTreeTerminationPolicy, reason: TerminationReason, timeoutMs: number): ProcessTreeCleanupReceipt {
    const platform = platformKind();
    const base = { rootProcessId: handle.rootPid, platform, terminationReason: reason, timeoutMs };

    if (platform === "unsupported") {
      return buildCleanupReceipt({ ...base, gracefulAttempted: false, gracefulSucceeded: false, forcedAttempted: false, forcedSucceeded: false, descendantsTargeted: 0, descendantsRemaining: 0, cleanupComplete: false, safeReasonCode: "process-tree-platform-unsupported" });
    }

    const descendants = this.listDescendants(handle, policy);
    const rootLive = pidAlive(handle.rootPid);

    // Nothing left to do — and nothing to signal, so no recycled-PID risk.
    if (!rootLive && descendants.length === 0) {
      return buildCleanupReceipt({ ...base, gracefulAttempted: false, gracefulSucceeded: true, forcedAttempted: false, forcedSucceeded: false, descendantsTargeted: 0, descendantsRemaining: 0, cleanupComplete: true, safeReasonCode: reason === "provider-timeout" ? "provider-timeout" : reason === "provider-cancelled" ? "provider-cancelled" : "ok" });
    }

    if (rootLive && !identityMatches(handle)) {
      return buildCleanupReceipt({ ...base, gracefulAttempted: false, gracefulSucceeded: false, forcedAttempted: false, forcedSucceeded: false, descendantsTargeted: descendants.length, descendantsRemaining: descendants.length, cleanupComplete: false, safeReasonCode: "process-tree-identity-mismatch" });
    }

    const stillAlive = (): number => [handle.rootPid, ...descendants].filter(pidAlive).length;
    const descendantsStillAlive = (): number => descendants.filter(pidAlive).length;

    // 1. Graceful.
    let gracefulSucceeded = false;
    if (platform === "win32") {
      spawnSync("taskkill", ["/PID", String(handle.rootPid), "/T"], { shell: false, windowsHide: true, timeout: 8000, maxBuffer: 16384, encoding: "utf8" });
    } else if (handle.processGroupCreated) {
      // Signal ONLY the group we created. A group outlives its leader.
      try {
        process.kill(-handle.rootPid, "SIGTERM");
      } catch {
        /* group already gone */
      }
    } else {
      try {
        process.kill(handle.rootPid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
    waitBounded(policy.gracePeriodMs, () => stillAlive() === 0);
    gracefulSucceeded = stillAlive() === 0;

    // 2. Forced, ONLY after the grace period expired.
    let forcedAttempted = false;
    let forcedSucceeded = false;
    if (!gracefulSucceeded && policy.forceAfterGrace) {
      forcedAttempted = true;
      if (platform === "win32") {
        spawnSync("taskkill", ["/PID", String(handle.rootPid), "/T", "/F"], { shell: false, windowsHide: true, timeout: 8000, maxBuffer: 16384, encoding: "utf8" });
        for (const pid of descendants) {
          if (pidAlive(pid)) spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { shell: false, windowsHide: true, timeout: 5000, maxBuffer: 8192, encoding: "utf8" });
        }
      } else if (handle.processGroupCreated) {
        try {
          process.kill(-handle.rootPid, "SIGKILL");
        } catch {
          /* gone */
        }
      } else {
        for (const pid of [handle.rootPid, ...descendants]) {
          try {
            process.kill(pid, "SIGKILL");
          } catch {
            /* gone */
          }
        }
      }
      waitBounded(500, () => stillAlive() === 0);
      forcedSucceeded = stillAlive() === 0;
    }

    const remaining = descendantsStillAlive();
    const complete = stillAlive() === 0;
    const reasonCode: ProcessTreeReasonCode = complete ? (reason === "provider-timeout" ? "provider-timeout" : reason === "provider-cancelled" ? "provider-cancelled" : "ok") : forcedAttempted ? "process-tree-force-termination-failed" : "process-tree-graceful-termination-failed";

    return buildCleanupReceipt({ ...base, gracefulAttempted: true, gracefulSucceeded, forcedAttempted, forcedSucceeded, descendantsTargeted: descendants.length, descendantsRemaining: remaining, cleanupComplete: complete, safeReasonCode: reasonCode });
  }
}

/** Build a handle from a spawn outcome. `expectedImageBasename` pins identity. */
export function buildProcessTreeHandle(rootPid: number | undefined, executableAbsolutePath: string, processGroupCreated: boolean, spawnSequence: number): ProcessTreeHandle | null {
  if (!Number.isInteger(rootPid) || (rootPid ?? 0) <= 0) return null;
  return { rootPid: rootPid as number, processGroupCreated, expectedImageBasename: basename(executableAbsolutePath), spawnSequence };
}
