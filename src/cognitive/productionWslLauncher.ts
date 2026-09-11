/**
 * Production WSL launcher.
 *
 * Security boundary:
 *   proven Windows System32
 *     -> discovered but UNAUTHORIZED wsl.exe
 *     -> repository allowlist membership
 *     -> exact external SHA-256 pin
 *     -> executionAuthorized
 *     -> immediate executable revalidation
 *     -> shell:false spawn
 *
 * Candidate/mission data is never permitted to select:
 *   - the Windows executable
 *   - PATH/SystemRoot
 *   - the WSL distribution
 *   - the WSL user
 *   - the Linux executable
 *
 * Workspace bytes cross the boundary through stdin only.
 */

import { spawnSync } from "child_process";
import { win32 } from "path";

import {
  approvedWslExecutableDigests,
  resolveTrustedExecutable,
  revalidateResolvedExecutable,
  type ExecutableResolution,
  type ResolveOptions,
  type ResolvedExecutable,
} from "./trustedExecutableRegistry";

import {
  resolveWindowsSystemAuthority,
  type WindowsSystemAuthorityResult,
} from "./windowsSystemTools";

export const PRODUCTION_WSL_DISTRIBUTION = "Ubuntu-24.04" as const;
export const PRODUCTION_WSL_USER = "root" as const;

/**
 * This path is intentionally fixed and root-owned on the Linux side.
 *
 * The entrypoint itself will be installed and independently pinned/proven in
 * the next layer. It is NOT mission/provider/workspace configurable.
 */
export const PRODUCTION_WSL_BUILD_ENTRYPOINT =
  "/opt/namla-isolated-build/bin/namla-isolated-build-entry" as const;

export const PRODUCTION_WSL_MAX_INPUT_BYTES = 48 * 1024 * 1024;
export const PRODUCTION_WSL_MAX_OUTPUT_BYTES = 1024 * 1024;
export const PRODUCTION_WSL_MIN_TIMEOUT_MS = 1000;
export const PRODUCTION_WSL_MAX_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Host WSL process lives slightly longer than the Linux build budget so the
 * entrypoint can stop the transient service and PROVE cleanup before Windows
 * is allowed to terminate wsl.exe.
 */
export const PRODUCTION_WSL_CLEANUP_GRACE_MS = 15_000;

function productionWslArgs(timeoutMs: number): readonly string[] {
  return Object.freeze([
    "--distribution",
    PRODUCTION_WSL_DISTRIBUTION,
    "--user",
    PRODUCTION_WSL_USER,
    "--exec",
    PRODUCTION_WSL_BUILD_ENTRYPOINT,
    "--timeout-ms",
    String(timeoutMs),
  ]);
}

export type ProductionWslLaunchReasonCode =
  | "OK"
  | "WSL_PLATFORM_REFUSED"
  | "WSL_INPUT_REFUSED"
  | "WSL_TIMEOUT_REFUSED"
  | "WSL_SYSTEM_AUTHORITY_UNAVAILABLE"
  | "WSL_EXECUTABLE_DISCOVERY_REFUSED"
  | "WSL_DISCOVERY_UNEXPECTEDLY_AUTHORIZED"
  | "WSL_EXECUTABLE_UNAPPROVED"
  | "WSL_EXECUTABLE_PIN_REFUSED"
  | "WSL_EXECUTABLE_CHANGED"
  | "WSL_EXECUTION_UNAUTHORIZED"
  | "WSL_EXECUTABLE_REVALIDATION_REFUSED"
  | "WSL_PROCESS_TIMEOUT"
  | "WSL_OUTPUT_LIMIT_EXCEEDED"
  | "WSL_PROCESS_ERROR"
  | "WSL_EXIT_NONZERO";

export interface ProductionWslLaunchResult {
  readonly success: boolean;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly reasonCode: ProductionWslLaunchReasonCode;
}

export interface ProductionWslRunnerInvocation {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  readonly input: Buffer;
  readonly timeoutMs: number;
  readonly maxBuffer: number;
}

export interface ProductionWslRunnerResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly errorCode: string | null;
  readonly signal: string | null;
}

export type ProductionWslRunner = (
  invocation: ProductionWslRunnerInvocation,
) => ProductionWslRunnerResult;

export interface ProductionWslLauncherOptions {
  /** Test seam only. Production leaves this unset. */
  readonly platform?: NodeJS.Platform;

  /** Test seam only. */
  readonly authorityResolver?: (
    platform: NodeJS.Platform,
  ) => WindowsSystemAuthorityResult;

  /** Test seam only. */
  readonly executableResolver?: (
    id: "wsl",
    opts: ResolveOptions,
  ) => ExecutableResolution;

  /** Test seam only. */
  readonly executableRevalidator?: (
    resolved: ResolvedExecutable,
    platform?: NodeJS.Platform,
  ) => ReturnType<typeof revalidateResolvedExecutable>;

  /** Test seam only. */
  readonly approvedDigestResolver?: (
    platform?: NodeJS.Platform,
  ) => readonly string[];

  /** Test seam only. */
  readonly runner?: ProductionWslRunner;
}

function sameWindowsPath(a: string, b: string): boolean {
  return (
    a.replace(/[\\/]+$/, "").toLowerCase() ===
    b.replace(/[\\/]+$/, "").toLowerCase()
  );
}

const spawnProductionWsl: ProductionWslRunner = (invocation) => {
  const out = spawnSync(invocation.command, [...invocation.args], {
    shell: false,
    windowsHide: true,
    timeout: invocation.timeoutMs,
    maxBuffer: invocation.maxBuffer,
    encoding: "utf8",
    env: { ...invocation.env },
    cwd: invocation.cwd,
    input: invocation.input,
  });

  let errorCode: string | null = null;

  if (out.error) {
    const candidate = out.error as NodeJS.ErrnoException;
    if (typeof candidate.code === "string") {
      errorCode = candidate.code;
    } else {
      errorCode = "UNKNOWN";
    }
  }

  return {
    status: out.status,
    stdout: typeof out.stdout === "string" ? out.stdout : "",
    stderr: typeof out.stderr === "string" ? out.stderr : "",
    errorCode,
    signal: out.signal === null ? null : String(out.signal),
  };
};

function fixedFailure(
  reasonCode: Exclude<ProductionWslLaunchReasonCode, "OK">,
  stderr: string,
  exitCode: number | null = null,
): ProductionWslLaunchResult {
  return {
    success: false,
    exitCode,
    stdout: "",
    stderr,
    reasonCode,
  };
}

export class ProductionWslLauncher {
  public constructor(
    private readonly options: ProductionWslLauncherOptions = {},
  ) {}

  public launchBuildPayload(
    payload: Buffer,
    timeoutMs: number,
  ): ProductionWslLaunchResult {
    const platform = this.options.platform ?? process.platform;

    if (platform !== "win32") {
      return fixedFailure(
        "WSL_PLATFORM_REFUSED",
        "Production WSL launcher requires Windows",
      );
    }

    if (
      !Buffer.isBuffer(payload) ||
      payload.length === 0 ||
      payload.length > PRODUCTION_WSL_MAX_INPUT_BYTES
    ) {
      return fixedFailure(
        "WSL_INPUT_REFUSED",
        "WSL staging payload refused",
      );
    }

    if (
      !Number.isInteger(timeoutMs) ||
      timeoutMs < PRODUCTION_WSL_MIN_TIMEOUT_MS ||
      timeoutMs > PRODUCTION_WSL_MAX_TIMEOUT_MS
    ) {
      return fixedFailure(
        "WSL_TIMEOUT_REFUSED",
        "WSL execution timeout refused",
      );
    }

    const authority = this.options.authorityResolver
      ? this.options.authorityResolver(platform)
      : resolveWindowsSystemAuthority({ platform });

    if (!authority.ok) {
      return fixedFailure(
        "WSL_SYSTEM_AUTHORITY_UNAVAILABLE",
        `Windows system authority unavailable: ${authority.reasonCode}`,
      );
    }

    const resolver =
      this.options.executableResolver ?? resolveTrustedExecutable;

    /*
     * Phase 1: discovery only.
     *
     * No process runs here. On Windows this resolution is deliberately NOT
     * execution-authorized because no external identity pin has yet been
     * supplied.
     */
    const discovery = resolver("wsl", {
      searchPath: authority.value.systemDirectory,
      workspaceRoots: [],
      probeVersion: false,
      computeHash: true,
      requireIdentityPin: false,
      platform,
    });

    if (!discovery.ok) {
      return fixedFailure(
        "WSL_EXECUTABLE_DISCOVERY_REFUSED",
        `WSL discovery refused: ${discovery.reasonCode}`,
      );
    }

    if (discovery.value.executionAuthorized) {
      return fixedFailure(
        "WSL_DISCOVERY_UNEXPECTEDLY_AUTHORIZED",
        "Unpinned WSL discovery unexpectedly granted execution authority",
      );
    }

    if (
      discovery.value.prefixArgs.length !== 0 ||
      !sameWindowsPath(
        win32.dirname(discovery.value.command),
        authority.value.systemDirectory,
      )
    ) {
      return fixedFailure(
        "WSL_EXECUTABLE_DISCOVERY_REFUSED",
        "Resolved WSL executable is outside the proven System32 authority",
      );
    }

    const digestResolver =
      this.options.approvedDigestResolver ??
      approvedWslExecutableDigests;

    const approvedDigests = digestResolver(platform).map((digest) =>
      digest.toLowerCase(),
    );

    const discoveredHash = discovery.value.hash.toLowerCase();

    if (
      discoveredHash.length !== 64 ||
      !approvedDigests.includes(discoveredHash)
    ) {
      return fixedFailure(
        "WSL_EXECUTABLE_UNAPPROVED",
        "Installed WSL executable is not repository-approved",
      );
    }

    /*
     * Phase 2: resolve AGAIN with the exact externally-approved identity.
     *
     * If the executable changed between discovery and this point, the pinned
     * resolution fails rather than silently accepting the replacement.
     */
    const pinned = resolver("wsl", {
      searchPath: authority.value.systemDirectory,
      workspaceRoots: [],
      probeVersion: false,
      computeHash: true,
      expectedSha256: discoveredHash,
      requireIdentityPin: true,
      platform,
    });

    if (!pinned.ok) {
      return fixedFailure(
        "WSL_EXECUTABLE_PIN_REFUSED",
        `Pinned WSL resolution refused: ${pinned.reasonCode}`,
      );
    }

    if (
      pinned.value.hash.toLowerCase() !== discoveredHash ||
      !sameWindowsPath(
        pinned.value.command,
        discovery.value.command,
      )
    ) {
      return fixedFailure(
        "WSL_EXECUTABLE_CHANGED",
        "WSL executable identity changed during authorization",
      );
    }

    if (
      pinned.value.prefixArgs.length !== 0 ||
      !sameWindowsPath(
        win32.dirname(pinned.value.command),
        authority.value.systemDirectory,
      )
    ) {
      return fixedFailure(
        "WSL_EXECUTABLE_CHANGED",
        "Pinned WSL executable escaped the proven System32 authority",
      );
    }

    if (!pinned.value.executionAuthorized) {
      return fixedFailure(
        "WSL_EXECUTION_UNAUTHORIZED",
        `Pinned WSL executable is not execution-authorized: ${pinned.value.authorizationReason}`,
      );
    }

    /*
     * Final TOCTOU narrowing immediately before spawn.
     */
    const revalidator =
      this.options.executableRevalidator ??
      revalidateResolvedExecutable;

    const revalidation = revalidator(pinned.value, platform);

    if (revalidation !== "ok") {
      return fixedFailure(
        "WSL_EXECUTABLE_REVALIDATION_REFUSED",
        `WSL executable revalidation refused: ${revalidation}`,
      );
    }

    const runner = this.options.runner ?? spawnProductionWsl;

    const out = runner({
      command: pinned.value.command,
      args: productionWslArgs(timeoutMs),
      env: authority.value.environment,
      cwd: authority.value.systemDirectory,
      input: payload,
      timeoutMs: timeoutMs + PRODUCTION_WSL_CLEANUP_GRACE_MS,
      maxBuffer: PRODUCTION_WSL_MAX_OUTPUT_BYTES,
    });

    if (out.errorCode === "ETIMEDOUT") {
      return {
        success: false,
        exitCode: out.status,
        stdout: out.stdout,
        stderr: out.stderr,
        reasonCode: "WSL_PROCESS_TIMEOUT",
      };
    }

    if (out.errorCode === "ENOBUFS") {
      return {
        success: false,
        exitCode: out.status,
        stdout: out.stdout,
        stderr: out.stderr,
        reasonCode: "WSL_OUTPUT_LIMIT_EXCEEDED",
      };
    }

    if (out.errorCode !== null) {
      return {
        success: false,
        exitCode: out.status,
        stdout: out.stdout,
        stderr: out.stderr,
        reasonCode: "WSL_PROCESS_ERROR",
      };
    }

    if (out.status !== 0) {
      return {
        success: false,
        exitCode: out.status,
        stdout: out.stdout,
        stderr: out.stderr,
        reasonCode: "WSL_EXIT_NONZERO",
      };
    }

    return {
      success: true,
      exitCode: 0,
      stdout: out.stdout,
      stderr: out.stderr,
      reasonCode: "OK",
    };
  }
}