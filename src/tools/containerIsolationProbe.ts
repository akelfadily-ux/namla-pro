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

export interface IsolationProbeResult {
  readonly uid: number;
  readonly uidNonRoot: boolean;
  readonly hostRootHidden: boolean;
  readonly dockerSocketAbsent: boolean;
  readonly secretsAbsent: boolean;
  readonly forbiddenEnvNames: readonly string[];
  readonly pidNamespaceIsolated: boolean;
  readonly visibleProcessCount: number;
  readonly rootFilesystemReadOnly: boolean;
  readonly writeOutsideWorkspaceFails: boolean;
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

function safe<T>(fn: () => T, fallback: T, errors: string[], label: string): T {
  try {
    return fn();
  } catch (e) {
    errors.push(`${label}:${(e as { code?: string }).code ?? "error"}`);
    return fallback;
  }
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

  // Host filesystem must not be reachable through a well-known marker.
  const hostRootHidden = HOST_MARKERS.every((m) => !existsSync(m));

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

  const sourceMountReadOnly = existsSync(PROBE_SOURCE_MOUNT) ? writeMustFail(`${PROBE_SOURCE_MOUNT}/namla-probe`) : true;

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
    hostRootHidden,
    dockerSocketAbsent,
    secretsAbsent: forbiddenEnvNames.length === 0,
    forbiddenEnvNames,
    pidNamespaceIsolated,
    visibleProcessCount,
    rootFilesystemReadOnly,
    writeOutsideWorkspaceFails,
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
