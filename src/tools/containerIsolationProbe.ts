/**
 * containerIsolationProbe — runs INSIDE a disposable container and proves, from
 * the inside, that isolation actually holds.
 *
 * This is the difference between "docker --version worked" and "the sandbox is
 * real". A detected CLI proves a binary exists on the host; only this probe,
 * executing under the exact flags the backend will use for real work, can show
 * that the UID is non-root, the host filesystem is absent, the Docker socket is
 * not mounted, limits are configured, and the network is denied.
 *
 * Every check is HARMLESS and read-mostly: it stats paths, reads cgroup files,
 * attempts a write that MUST fail, and attempts one connection that MUST fail.
 * It installs nothing, pulls nothing, and contacts no service that could
 * succeed.
 *
 * Output is a single JSON object on stdout. It reports booleans and small
 * scalars only — never a host path, an environment value, or file contents.
 *
 * Run inside the container as: node /namla-probe/containerIsolationProbe.js
 */

import { existsSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from "fs";
import { connect } from "net";

/** Where the backend mounts things. Fixed, never mission-derived. */
export const PROBE_WORKSPACE_MOUNT = "/workspace";
export const PROBE_SOURCE_MOUNT = "/src-readonly";
/** The deterministic fixture the host places in the read-only source mount. */
export const SOURCE_FIXTURE_NAME = "namla-readonly-fixture.txt";
export const SOURCE_FIXTURE_CONTENT = "namla-readonly-source-fixture-v1";

export interface IsolationProbeResult {
  readonly uid: number;
  readonly uidNonRoot: boolean;
  /**
   * Do the six well-known SENSITIVE host markers appear? This is a denylist, and
   * it is named for exactly what it measures. It proves those six paths were not
   * observed; it proves nothing about any other path, and on its own it can
   * never establish a total mount guarantee.
   */
  readonly sensitiveHostMarkersAbsent: boolean;
  /** Every mount target the container can see, from /proc/mounts. */
  readonly mountTargets: readonly string[];
  /**
   * Mount targets that are neither a known container-runtime mount nor one of
   * Namla's approved application mounts. An ENUMERATION, not a denylist: any
   * unexpected bind target lands here whether or not anyone predicted it.
   */
  readonly unexpectedApplicationMounts: readonly string[];
  readonly dockerSocketAbsent: boolean;
  readonly secretsAbsent: boolean;
  readonly forbiddenEnvNames: readonly string[];
  readonly pidNamespaceIsolated: boolean;
  readonly visibleProcessCount: number;
  readonly rootFilesystemReadOnly: boolean;
  readonly writeOutsideWorkspaceFails: boolean;
  /**
   * The read-only source mount, observed as THREE separate facts.
   *
   * WHY THREE. This was one boolean computed as
   * `existsSync(mount) ? writeMustFail(...) : true`, so an ABSENT mount returned
   * TRUE and `readOnlySourceMountSupported` was reported in the verified claim
   * set on the strength of a check that never ran. Absence is not evidence.
   * Splitting the observation makes the vacuous case impossible to express: a
   * mount that is not present cannot be readable, and a mount that was never
   * written to cannot have refused a write.
   */
  readonly sourceMountPresent: boolean;
  readonly sourceMountReadable: boolean;
  readonly sourceMountWriteDenied: boolean;
  /** Derived: present AND readable AND write-denied. Never true on absence. */
  readonly sourceMountReadOnly: boolean;
  readonly workspaceWritable: boolean;
  readonly memoryLimitBytes: number | null;
  readonly cpuLimitConfigured: boolean;
  readonly pidLimit: number | null;
  readonly networkDenied: boolean;
  readonly probeErrors: readonly string[];
}

/** Env NAME patterns that must not be inherited into the container. */
const FORBIDDEN_ENV = /(TOKEN|SECRET|PASSWORD|COOKIE|SESSION|PRIVATE_?KEY|API_?KEY|CREDENTIAL|AUTH)/i;

/** Host directories that must NOT be visible from inside the container. */
const HOST_MARKERS = ["/host", "/hostfs", "/home/runner", "/Users", "/mnt/c", "/var/lib/docker"];

/** The ONLY application mounts Namla ever creates. Anything else is unexpected. */
export const APPROVED_APPLICATION_MOUNTS: readonly string[] = ["/workspace", "/namla-probe", "/src-readonly"];

/**
 * Mounts the container RUNTIME creates, which are not host bind mounts and must
 * not be reported as violations: the overlay root, the kernel pseudo-filesystems
 * and their per-container overlays, and the three files Docker manages itself.
 */
const SYSTEM_MOUNT_EXACT: readonly string[] = ["/", "/etc/resolv.conf", "/etc/hostname", "/etc/hosts"];
const SYSTEM_MOUNT_PREFIXES: readonly string[] = ["/proc", "/sys", "/dev", "/tmp"];

export interface MountInventory {
  readonly targets: readonly string[];
  readonly unexpected: readonly string[];
}

/**
 * Enumerate mount targets and identify anything unexpected.
 *
 * WHY ENUMERATION RATHER THAN A DENYLIST. The previous evidence was six
 * existsSync probes, which prove only that those six paths were absent. A
 * seventh unexpected bind mount would have gone unnoticed while the claim still
 * read "no host filesystem mounts". Reading the mount table inverts that: the
 * observed set must be a SUBSET of what Namla approved plus what the runtime
 * creates, so an unpredicted target is caught precisely because nobody had to
 * predict it.
 *
 * WHAT THIS CANNOT PROVE. On Docker Desktop a Windows bind appears as fstype
 * 9p whose source is the whole drive share (aname=drvfs), not the specific host
 * directory. Runtime data therefore establishes TARGET, TYPE and ro/rw only;
 * the host SOURCE identity is established separately, host-side, by the
 * canonical mount validator. Neither half is sufficient alone.
 *
 * Pure, so it can be tested directly against captured mount tables.
 */
export function evaluateMountInventory(procMountsText: string, approved: readonly string[] = APPROVED_APPLICATION_MOUNTS): MountInventory {
  const targets: string[] = [];
  for (const line of procMountsText.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    // /proc/mounts escapes spaces and specials as octal; decode so a target
    // containing a space cannot slip past comparison as a different string.
    const target = parts[1].replace(/\\([0-7]{3})/g, (_m, o: string) => String.fromCharCode(parseInt(o, 8)));
    targets.push(target);
  }
  const isSystem = (p: string): boolean => SYSTEM_MOUNT_EXACT.includes(p) || SYSTEM_MOUNT_PREFIXES.some((pre) => p === pre || p.startsWith(pre + "/"));
  const unexpected = targets.filter((p) => !approved.includes(p) && !isSystem(p));
  return { targets, unexpected };
}

function safe<T>(fn: () => T, fallback: T, errors: string[], label: string): T {
  try {
    return fn();
  } catch (e) {
    errors.push(`${label}:${(e as { code?: string }).code ?? "error"}`);
    return fallback;
  }
}

/**
 * Evaluate the read-only source mount as THREE independent facts.
 *
 * WHY A PURE FUNCTION. This logic used to be inline and read
 * `existsSync(mount) ? writeMustFail(...) : true`, so an ABSENT mount produced
 * TRUE and the claim was reported on the strength of a check that never ran.
 * The runtime backend cannot catch a probe that merely CLAIMS a write was
 * refused without attempting one - only a test of this function can - so the
 * logic is exported and exercised directly against real directories.
 *
 * `writeDenied` requires two distinct refusals: overwriting the existing fixture
 * AND creating a new file. `readOnly` requires all three facts, so absence,
 * unreadability, or an unattempted write can never yield a pass.
 */
export interface SourceMountObservation {
  readonly present: boolean;
  readonly readable: boolean;
  readonly writeDenied: boolean;
  readonly readOnly: boolean;
}

export function evaluateSourceMount(mountPath: string): SourceMountObservation {
  const fixture = `${mountPath}/${SOURCE_FIXTURE_NAME}`;
  const present = existsSync(mountPath) && existsSync(fixture);
  let readable = false;
  if (present) {
    try {
      readable = readFileSync(fixture, "utf8").trim() === SOURCE_FIXTURE_CONTENT;
    } catch {
      readable = false;
    }
  }
  const writeDenied = present && writeMustFail(fixture) && writeMustFail(`${mountPath}/namla-probe-new`);
  return { present, readable, writeDenied, readOnly: present && readable && writeDenied };
}

/** Does writing to `p` fail? A write that SUCCEEDS is an isolation failure. */
function writeMustFail(p: string): boolean {
  try {
    writeFileSync(p, "x", "utf8");
    try {
      unlinkSync(p);
    } catch {
      /* best effort */
    }
    return false; // the write succeeded — isolation did NOT hold
  } catch {
    return true; // refused, as required
  }
}

/** Read a cgroup v2 scalar; returns null when unavailable or unlimited. */
function cgroupScalar(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    const v = readFileSync(path, "utf8").trim();
    return v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function runIsolationProbe(): IsolationProbeResult {
  const errors: string[] = [];

  const uid = safe(() => (typeof process.getuid === "function" ? process.getuid() : -1), -1, errors, "uid");

  // SUPPLEMENTARY denylist: six well-known sensitive markers must be absent.
  // Named for what it measures; it is not the mount guarantee on its own.
  const sensitiveHostMarkersAbsent = HOST_MARKERS.every((m) => !existsSync(m));

  // PRIMARY evidence: enumerate the real mount table and identify anything that
  // is neither an approved Namla mount nor a container-runtime mount. An
  // unreadable table is a failure, never an empty (passing) result.
  const inventory = safe(() => evaluateMountInventory(readFileSync("/proc/mounts", "utf8")), { targets: [] as readonly string[], unexpected: ["<mount-table-unreadable>"] as readonly string[] }, errors, "mounts");
  const mountTargets = inventory.targets;
  const unexpectedApplicationMounts = inventory.unexpected;

  const dockerSocketAbsent = !existsSync("/var/run/docker.sock") && !existsSync("/run/docker.sock");

  // Environment NAMES only — values are never read, printed, or returned.
  const forbiddenEnvNames = Object.keys(process.env).filter((n) => FORBIDDEN_ENV.test(n));

  // A private PID namespace shows only our own handful of processes. The host
  // would show hundreds, and host PID 1 would not be our own init.
  const visibleProcessCount = safe(() => readdirSync("/proc").filter((e) => /^\d+$/.test(e)).length, 9999, errors, "proc");
  const pidNamespaceIsolated = visibleProcessCount > 0 && visibleProcessCount < 50;

  // Root filesystem read-only, and any write outside the workspace refused.
  const rootFilesystemReadOnly = writeMustFail("/namla-rootfs-probe");
  const writeOutsideWorkspaceFails = writeMustFail("/etc/namla-probe") && writeMustFail("/namla-probe-outside");

  // The read-only source mount, proven NON-VACUOUSLY by a pure function so the
  // logic is unit-testable on the host as well as observed in the container.
  const src = evaluateSourceMount(PROBE_SOURCE_MOUNT);
  const sourceMountPresent = src.present;
  const sourceMountReadable = src.readable;
  const sourceMountWriteDenied = src.writeDenied;
  const sourceMountReadOnly = src.readOnly;

  // The ONE authorized writable mount must actually work.
  const workspaceWritable = safe(
    () => {
      const p = `${PROBE_WORKSPACE_MOUNT}/.namla-probe`;
      writeFileSync(p, "ok", "utf8");
      unlinkSync(p);
      return true;
    },
    false,
    errors,
    "workspace"
  );

  // cgroup v2 limits.
  const memRaw = cgroupScalar("/sys/fs/cgroup/memory.max");
  const memoryLimitBytes = memRaw && memRaw !== "max" ? Number(memRaw) : null;
  const cpuRaw = cgroupScalar("/sys/fs/cgroup/cpu.max");
  const cpuLimitConfigured = Boolean(cpuRaw && !cpuRaw.startsWith("max"));
  const pidRaw = cgroupScalar("/sys/fs/cgroup/pids.max");
  const pidLimit = pidRaw && pidRaw !== "max" ? Number(pidRaw) : null;

  return {
    uid,
    uidNonRoot: uid > 0,
    sensitiveHostMarkersAbsent,
    mountTargets,
    unexpectedApplicationMounts,
    dockerSocketAbsent,
    secretsAbsent: forbiddenEnvNames.length === 0,
    forbiddenEnvNames,
    pidNamespaceIsolated,
    visibleProcessCount,
    rootFilesystemReadOnly,
    writeOutsideWorkspaceFails,
    sourceMountPresent,
    sourceMountReadable,
    sourceMountWriteDenied,
    sourceMountReadOnly,
    workspaceWritable,
    memoryLimitBytes,
    cpuLimitConfigured,
    pidLimit,
    networkDenied: false, // filled in asynchronously by main()
    probeErrors: errors,
  };
}

/**
 * Attempt ONE outbound TCP connection that must fail. A default-deny network
 * refuses it; success means the network is reachable and isolation is broken.
 * Bounded to 2s so a black-holed packet cannot hang the probe.
 */
function checkNetworkDenied(): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (denied: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(denied);
    };
    const timer = setTimeout(() => finish(true), 2000); // no answer => denied
    timer.unref();
    try {
      const socket = connect({ host: "1.1.1.1", port: 443 }, () => {
        socket.destroy();
        clearTimeout(timer);
        finish(false); // CONNECTED — network is NOT denied
      });
      socket.setTimeout(2000, () => {
        socket.destroy();
        clearTimeout(timer);
        finish(true);
      });
      socket.on("error", () => {
        clearTimeout(timer);
        finish(true); // refused / unreachable => denied
      });
    } catch {
      clearTimeout(timer);
      finish(true);
    }
  });
}

async function main(): Promise<void> {
  const base = runIsolationProbe();
  const networkDenied = await checkNetworkDenied();
  const result: IsolationProbeResult = { ...base, networkDenied };
  // Single JSON object, booleans and scalars only.
  process.stdout.write(JSON.stringify(result));
  process.exit(0);
}

if (require.main === module) {
  void main();
}
