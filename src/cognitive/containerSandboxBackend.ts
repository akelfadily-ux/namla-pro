/**
 * containerSandboxBackend — the real container backend, and the ONLY thing that
 * may ever raise capability to `available-and-verified`.
 *
 * The rule this module exists to enforce: DETECTION IS NOT VERIFICATION. A
 * successful `docker --version` proves a CLI binary exists on the host. It
 * proves nothing about cgroup limits, namespaces, mount scope, or network
 * policy. `detectCapability()` therefore returns at most
 * `available-unverified`, and only `verifyIsolation()` — which starts a real
 * disposable container under the exact flags real work will use, and reads the
 * probe's findings back — can return `available-and-verified`.
 *
 * Every failure names ONE missing guarantee (`sandbox-network-not-denied`,
 * `sandbox-user-not-isolated`, …) rather than a generic "sandbox failed", so a
 * refusal is actionable and cannot be mistaken for an unrelated problem.
 *
 * Argument construction is a fixed template. There is no mission-provided
 * image, no arbitrary flag, no shell string, and `shell: false` throughout: the
 * argv array is built from constants plus validated paths only.
 *
 * NOTE ON VERIFICATION STATUS: this file is written against Docker's CLI
 * contract but has NOT been executed against a real daemon on the authoring
 * host, which has no container runtime. Its behaviour is proven only by the
 * deterministic argument-template and fake-backend tests until the ubuntu CI
 * job runs it for real.
 */

import { spawnSync } from "child_process";
import { statSync } from "fs";
import { resolve } from "path";
import { resolveTrustedExecutable, type TrustedExecutableId } from "./trustedExecutableRegistry";
import { buildSandboxReceipt, describeMountPolicy, detectContainerRuntime, isIssuedPermit, validateSandboxPolicySpec, NO_ISOLATION_CLAIMS, type ContainerSandboxBackend, type SandboxCapabilityReport, type SandboxExecutionPermit, type SandboxExecutionReceipt, type SandboxReasonCode, type SandboxIsolationClaims } from "./sandboxPolicy";
import type { NetworkPolicy } from "./networkPolicy";
import { redactedText } from "./safeRedactor";
import { classifyContainerStartup, describeStartupFailure, type SafeStartupDiagnostics } from "./containerStartupDiagnostics";
import { truncateUtf8 } from "./safeWorkspacePath";
import { validateMountSourceSet, revalidateMountSource, type CanonicalMountSource } from "./safeMountSource";

// ------------------------------------------------------------ IMAGE POLICY ---

/**
 * The ONE approved image. A mission can never choose an image.
 *
 * `IMAGE_DIGEST` pins the exact content. When it is set, the backend runs the
 * digest form and an unpinned tag is refused with `sandbox-image-unpinned`, so
 * a mutated upstream tag cannot silently change what executes. It is empty here
 * because the digest must be recorded from the image actually loaded in CI —
 * inventing one would guarantee a mismatch.
 */
export const IMAGE_REPOSITORY = "namla-sandbox" as const;
export const IMAGE_TAG = "v1" as const;
export const IMAGE_DIGEST = "" as const;

/** Fixed reference: digest form when pinned, otherwise the local tag. */
export function approvedImageReference(): string {
  return IMAGE_DIGEST.length > 0 ? `${IMAGE_REPOSITORY}@${IMAGE_DIGEST}` : `${IMAGE_REPOSITORY}:${IMAGE_TAG}`;
}

export function imageIsPinned(): boolean {
  return IMAGE_DIGEST.length > 0;
}

/** Mount points inside the container. Fixed, never mission-derived. */
export const CONTAINER_WORKSPACE_MOUNT = "/workspace" as const;
export const CONTAINER_SOURCE_MOUNT = "/src-readonly" as const;
export const CONTAINER_PROBE_MOUNT = "/namla-probe" as const;

// ------------------------------------------------------- TRUSTED IDENTITY ---

export interface ContainerUserIdentity {
  readonly uid: number;
  readonly gid: number;
}

export type IdentityResolution = { readonly ok: true; readonly identity: ContainerUserIdentity; readonly reasonCode: "ok" } | { readonly ok: false; readonly identity: null; readonly reasonCode: SandboxReasonCode };

/** The image-level default. Used ONLY where a trusted identity is unavailable. */
export const IMAGE_DEFAULT_IDENTITY: ContainerUserIdentity = { uid: 10001, gid: 10001 };

/**
 * Validate a numeric identity. Shared so every entry point refuses identically.
 *
 * Root is refused in BOTH positions: a container running as uid 0 or gid 0 is
 * not isolated, whatever the mount permissions happen to say.
 */
export function validateIdentity(uid: number, gid: number): IdentityResolution {
  for (const v of [uid, gid]) {
    if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v) || v < 0) {
      return { ok: false, identity: null, reasonCode: "sandbox-user-not-isolated" };
    }
  }
  if (uid === 0 || gid === 0) return { ok: false, identity: null, reasonCode: "sandbox-user-not-isolated" };
  return { ok: true, identity: { uid, gid }, reasonCode: "ok" };
}

/**
 * Derive the container identity from the OWNER of the authorized host
 * workspace. Never from mission text, a permit, provider output, a CLI flag, or
 * any other caller-supplied value.
 *
 * Why this exists: the container ran as a fixed 10001:10001 while the bind
 * mount was created by `mkdtemp` (mode 0700, owned by the CI runner), so the
 * non-root process could not write to its own workspace and the probe reported
 * workspaceWritable=false. Both obvious shortcuts are wrong - `chmod 0777`
 * makes the workspace world-writable, and running as root defeats the non-root
 * requirement outright. Matching the container identity to the directory's real
 * owner removes the mismatch while keeping mode 0700 AND a non-root process.
 *
 * Fails CLOSED: uid/gid 0 refused, non-integers refused, and a platform where
 * ownership cannot be proven is refused rather than guessed at.
 */
export function resolveTrustedWorkspaceIdentity(workspaceHostPath: string, platform: NodeJS.Platform = process.platform): IdentityResolution {
  // Windows `statSync` reports uid/gid 0 for every file, which is
  // indistinguishable from root. Ownership cannot be proven, so refuse.
  if (platform === "win32") return { ok: false, identity: null, reasonCode: "sandbox-user-not-isolated" };
  if (typeof workspaceHostPath !== "string" || workspaceHostPath.length === 0) return { ok: false, identity: null, reasonCode: "sandbox-user-not-isolated" };

  try {
    const st = statSync(workspaceHostPath);
    return validateIdentity(st.uid, st.gid);
  } catch {
    return { ok: false, identity: null, reasonCode: "sandbox-user-not-isolated" };
  }
}

// ------------------------------------------------------- NETWORK ENFORCEMENT ---

/**
 * The network modes this backend can GENUINELY enforce (§32).
 *
 * Exactly one member, and that is the honest count. `--network none` removes
 * the interface entirely, which really does enforce `denied` and is verified
 * inside a real container by the probe's outbound-connection attempt.
 *
 * Docker's `bridge` is NOT an allowlist. It is unrestricted egress, and using
 * it for `loopback-only`, `provider-only`, or `allowlisted` would grant every
 * destination those policies exist to exclude. Enforcing them needs a real
 * mechanism — an egress proxy, a filtered network namespace, per-destination
 * firewall rules — none of which exists in this repository. Until one does and
 * has been verified INSIDE a container, those policies fail closed rather than
 * being approximated by something broader.
 */
export type EnforcedNetworkMode = "none";

export type NetworkModeResolution = { readonly ok: true; readonly mode: EnforcedNetworkMode; readonly reasonCode: "ok" } | { readonly ok: false; readonly mode: null; readonly reasonCode: SandboxReasonCode };

/**
 * Map a declared policy to a mode this backend can prove it enforces.
 *
 * A policy with no exact mechanism is REFUSED, never downgraded to the nearest
 * available mode in either direction: widening grants destinations the policy
 * excluded, and narrowing would silently break a caller who legitimately needs
 * the network while reporting success.
 */
export function enforcedNetworkModeFor(policy: NetworkPolicy): NetworkModeResolution {
  if (policy === "denied") return { ok: true, mode: "none", reasonCode: "ok" };
  // Unrestricted egress is forbidden outright, not merely unenforceable.
  if (policy === "allowed") return { ok: false, mode: null, reasonCode: "sandbox-network-policy-refused" };
  // loopback-only / provider-only / allowlisted: coherent, legitimate, and
  // unenforceable here. Fail closed.
  return { ok: false, mode: null, reasonCode: "sandbox-network-policy-unenforceable" };
}

// -------------------------------------------------------- ARGUMENT TEMPLATE ---

export interface ContainerRunSpec {
  /**
   * Mount sources are `CanonicalMountSource`, never `string`. The brand is the
   * enforcement for §31: a host path that has not been through
   * `validateMountSource` cannot reach Docker's argv, because it does not type.
   * This builder therefore never canonicalizes, guesses, or re-checks a path —
   * by the time a value gets here it is already proven.
   */
  readonly workspaceHostPath: CanonicalMountSource;
  readonly sourceHostPath: CanonicalMountSource | null;
  readonly probeHostPath: CanonicalMountSource | null;
  readonly cpuLimit: number;
  readonly memoryLimitMb: number;
  readonly pidLimit: number;
  readonly timeoutSeconds: number;
  /**
   * The network mode this backend can actually ENFORCE (§32). Not a boolean:
   * `networkDenied: false` used to mean "anything other than denied", and the
   * builder turned that into `--network bridge` — unrestricted egress standing
   * in for `provider-only`, `loopback-only`, or `allowlisted`. A closed union
   * with one member makes that substitution impossible to express.
   */
  readonly networkMode: EnforcedNetworkMode;
  readonly containerName: string;
  /** Derived INTERNALLY from workspace ownership - never mission-controlled. */
  readonly userIdentity: ContainerUserIdentity;
  /** Fixed command + args INSIDE the container. Never a shell string. */
  readonly command: readonly string[];
}

/**
 * Build the docker argv. Every security flag is unconditional; only paths and
 * numeric limits vary, and those are validated by the caller. There is no code
 * path that can add a caller-supplied flag.
 */
export function buildContainerRunArgs(spec: ContainerRunSpec): string[] {
  const args: string[] = [
    "run",
    "--rm", // disposable: removed on exit, always
    "--name",
    spec.containerName,
    // Identity: never root, no privilege escalation, all capabilities dropped.
    // Identity derived from the workspace OWNER, so the non-root process can
    // write to its own bind mount without the directory being world-writable.
    "--user",
    `${spec.userIdentity.uid}:${spec.userIdentity.gid}`,
    "--security-opt",
    "no-new-privileges",
    "--cap-drop",
    "ALL",
    // Namespaces: never the host's.
    //
    // `--pid` is deliberately OMITTED. Docker's only supported values are
    // `host` and `container:<name|id>`; `private` is not one of them, and
    // passing it made the daemon reject the whole run with exit 125 before the
    // container command executed (bisection stage 3 of run 30694162315).
    // Omitting the flag IS the private-namespace default, so isolation is
    // unchanged - but omission alone is NOT treated as proof: the runtime probe
    // must observe pidNamespaceIsolated === true before any claim is made.
    "--ipc",
    "private",
    // Filesystem: read-only root, tmpfs for the few writable temp paths.
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=64m",
    // Resources.
    "--cpus",
    String(spec.cpuLimit),
    "--memory",
    `${spec.memoryLimitMb}m`,
    "--memory-swap",
    `${spec.memoryLimitMb}m`, // no swap escape hatch
    "--pids-limit",
    String(spec.pidLimit),
    "--ulimit",
    "nofile=256:256",
    "--ulimit",
    "fsize=67108864",
    // No host metadata leakage.
    "--hostname",
    "namla-sandbox",
    "--env-file",
    "/dev/null",
  ];

  // Network: the enforced mode, verbatim. Today the union has exactly one
  // member, so this line can only ever emit `--network none` — no interface at
  // all. There is deliberately no `else` branch that could widen a narrower
  // declared policy into general connectivity.
  args.push("--network", spec.networkMode);

  // Mounts: exactly one writable workspace, plus optional read-only mounts.
  args.push("--mount", `type=bind,source=${spec.workspaceHostPath},target=${CONTAINER_WORKSPACE_MOUNT},readonly=false`);
  if (spec.sourceHostPath) args.push("--mount", `type=bind,source=${spec.sourceHostPath},target=${CONTAINER_SOURCE_MOUNT},readonly=true`);
  if (spec.probeHostPath) args.push("--mount", `type=bind,source=${spec.probeHostPath},target=${CONTAINER_PROBE_MOUNT},readonly=true`);

  args.push("--workdir", CONTAINER_WORKSPACE_MOUNT);
  args.push(approvedImageReference());
  // The command is a fixed argv array — never a shell string.
  for (const c of spec.command) args.push(c);
  return args;
}

/** Flags that must NEVER appear. Asserted by tests against the built argv. */
export const FORBIDDEN_DOCKER_FLAGS: readonly string[] = ["--privileged", "--net=host", "--network=host", "--pid=host", "--ipc=host", "--userns=host", "-v", "--volumes-from", "--cap-add", "--device", "--security-opt=seccomp=unconfined"];

// --------------------------------------------------------------- PROBE MAP ---

export interface ProbeFindings {
  readonly uidNonRoot?: boolean;
  readonly hostRootHidden?: boolean;
  readonly dockerSocketAbsent?: boolean;
  readonly secretsAbsent?: boolean;
  readonly pidNamespaceIsolated?: boolean;
  readonly rootFilesystemReadOnly?: boolean;
  readonly writeOutsideWorkspaceFails?: boolean;
  readonly sourceMountReadOnly?: boolean;
  readonly workspaceWritable?: boolean;
  readonly memoryLimitBytes?: number | null;
  readonly cpuLimitConfigured?: boolean;
  readonly pidLimit?: number | null;
  readonly networkDenied?: boolean;
}

/**
 * Map probe findings to the FIRST unmet guarantee. Order is deliberate: the
 * most fundamental containment failures are reported before resource limits,
 * so a receipt names the worst problem rather than an incidental one.
 */
export function classifyProbe(f: ProbeFindings): SandboxReasonCode {
  if (f.uidNonRoot !== true) return "sandbox-user-not-isolated";
  if (f.dockerSocketAbsent !== true) return "sandbox-docker-socket-detected";
  if (f.hostRootHidden !== true) return "sandbox-host-mount-detected";
  if (f.secretsAbsent !== true) return "sandbox-secret-inheritance-detected";
  if (f.pidNamespaceIsolated !== true) return "sandbox-host-mount-detected";
  if (f.rootFilesystemReadOnly !== true) return "sandbox-root-filesystem-writable";
  if (f.writeOutsideWorkspaceFails !== true) return "sandbox-root-filesystem-writable";
  if (f.sourceMountReadOnly !== true) return "sandbox-host-mount-detected";
  if (f.networkDenied !== true) return "sandbox-network-not-denied";
  if (typeof f.memoryLimitBytes !== "number" || f.memoryLimitBytes <= 0) return "sandbox-memory-limit-unverified";
  if (f.cpuLimitConfigured !== true) return "sandbox-cpu-limit-unverified";
  if (typeof f.pidLimit !== "number" || f.pidLimit <= 0) return "sandbox-pid-limit-unverified";
  // The ONE authorized writable mount must be writable BY THE NON-ROOT
  // container identity. Reporting this as a generic probe failure hid an
  // ownership mismatch behind "something went wrong".
  if (f.workspaceWritable !== true) return "sandbox-workspace-not-writable";
  return "ok";
}

/** Claims are asserted ONLY from probe findings, never assumed from flags. */
export function claimsFromProbe(f: ProbeFindings): SandboxIsolationClaims {
  if (classifyProbe(f) !== "ok") return NO_ISOLATION_CLAIMS;

  // Every claim is written out against the evidence that supports it, rather
  // than returning ALL_ISOLATION_CLAIMS. That shortcut is how a DENIAL probe
  // came to assert `explicitNetworkAllowlist: true` — the constant sets every
  // key true, so adding a claim to the interface silently granted it here with
  // no evidence whatsoever. An explicit map makes an unevidenced claim a thing
  // someone has to write down deliberately.
  return {
    // --- proven INSIDE the container by the probe -------------------------
    dedicatedUser: true, // uidNonRoot
    noHostFilesystemMounts: true, // hostRootHidden
    boundedWorkspaceMountOnly: true, // writeOutsideWorkspaceFails + workspaceWritable
    readOnlySourceMountSupported: true, // sourceMountReadOnly
    cpuLimitEnforced: true, // cpuLimitConfigured (cgroup v2)
    memoryLimitEnforced: true, // memoryLimitBytes > 0 (cgroup v2)
    pidLimitEnforced: true, // pidLimit > 0 (cgroup v2)
    processCountLimitEnforced: true, // same cgroup pids controller
    noHostPidNamespace: true, // pidNamespaceIsolated
    noDockerSocket: true, // dockerSocketAbsent
    noEnvironmentSecretInheritance: true, // secretsAbsent
    disposableFilesystem: true, // rootFilesystemReadOnly + --rm

    // --- proven by the fixed argv template, asserted by deterministic tests ---
    noPrivilegedMode: true, // --privileged can never appear (FORBIDDEN_DOCKER_FLAGS)
    noCredentialMounts: true, // the mount set is built here and is closed
    timeoutEnforced: true, // spawnSync timeout + forceRemove, host-side

    // --- network: the correction this milestone exists for -----------------
    // The probe attempts ONE outbound TCP connection that MUST fail. That
    // proves default-deny and that no host network namespace is shared.
    defaultDenyNetwork: true, // networkDenied
    noHostNetworkNamespace: true, // an outbound connection would succeed otherwise

    // It proves NOTHING about an allowlist. There is no egress proxy, no
    // filtered namespace, no per-destination rule anywhere in this backend, so
    // there is no mechanism whose correctness a probe could even test. Claiming
    // it from a denial result asserted a capability that does not exist.
    // This stays false until a real mechanism is verified inside a container.
    explicitNetworkAllowlist: false,

    // --- verified separately by the caller ---------------------------------
    cleanupAfterExit: true, // forceRemove confirms the container is gone
  };
}

// ----------------------------------------------------------------- BACKEND ---

export interface ContainerBackendOptions {
  readonly runtimeExecutableId?: Extract<TrustedExecutableId, "docker" | "podman">;
  /** Absolute host path of a scratch workspace used only by the probe. */
  readonly probeWorkspaceHostPath?: string;
  /** Absolute host path of the compiled probe directory (mounted read-only). */
  readonly probeScriptHostDir?: string;
  readonly verifyTimeoutMs?: number;
  /**
   * Roots inside which a bind-mount source may live (§31). Supplied by the
   * TRUSTED HOST PROCESS at construction — never by a permit, policy, mission,
   * or provider, because a caller who chooses the root has not been constrained
   * at all. An empty list authorizes nothing and every mount fails closed.
   */
  readonly authorizedMountRoots?: readonly string[];
  /**
   * Root for PROBE mounts, which are build artefacts rather than workspace
   * data. Defaults to the process working directory; probe sources must live
   * inside it and are otherwise subject to every identical check.
   */
  readonly trustedBuildRoot?: string;
}

/**
 * Roots authorized for real EXECUTION (§31).
 *
 * Deliberately does NOT fall back to the requested path. A caller that supplies
 * both the mount source AND the root authorizing it has proven containment and
 * nothing else — `X inside X` is true for every X, so self-authorization is not
 * authorization at all. Absent configuration therefore yields NO authorized
 * root, which makes every execution mount fail closed.
 */
export function executionMountRoots(options: ContainerBackendOptions): readonly string[] {
  return options.authorizedMountRoots ?? [];
}

/**
 * Roots authorized for VERIFICATION, which is trusted differently and for one
 * specific reason.
 *
 * The probe workspace is not caller data: `verifyContainerSandbox` creates it
 * with `mkdtemp` microseconds earlier, hands it to the backend, and deletes it
 * afterwards. It is an ephemeral object of the trusted entry point's own
 * making, so it may authorize itself. That argument does NOT extend to
 * `execute()`, where the path arrives inside a permit built from a policy a
 * caller supplied — hence the two functions, not one shared default.
 *
 * The compiled PROBE directory gets no such treatment: it is authorized against
 * the trusted build root by `probeMountRoots` below, never against itself.
 */
export function verificationWorkspaceRoots(options: ContainerBackendOptions, probeWorkspace: string): readonly string[] {
  return options.authorizedMountRoots ?? [probeWorkspace];
}

/** Roots for probe (build-artefact) mounts. Never a workspace, never itself. */
export function probeMountRoots(options: ContainerBackendOptions): readonly string[] {
  return [options.trustedBuildRoot ?? process.cwd()];
}

export class DockerContainerSandboxBackend implements ContainerSandboxBackend {
  readonly backendId: string;
  readonly isReal = true;
  readonly runtimeExecutableId: Extract<TrustedExecutableId, "docker" | "podman">;
  private lastVerification: SandboxCapabilityReport | null = null;
  private lastStartupDiagnostics: SafeStartupDiagnostics | null = null;

  /** SAFE startup diagnostics for the most recent failed verification. */
  get startupDiagnostics(): SafeStartupDiagnostics | null {
    return this.lastStartupDiagnostics;
  }

  constructor(private readonly options: ContainerBackendOptions = {}) {
    this.runtimeExecutableId = options.runtimeExecutableId ?? "docker";
    this.backendId = this.runtimeExecutableId;
  }

  /**
   * DETECTION ONLY. Returns at most `available-unverified`, and once
   * `verifyIsolation()` has succeeded, returns the verified report it produced.
   */
  detectCapability(): SandboxCapabilityReport {
    if (this.lastVerification && this.lastVerification.capabilityState === "available-and-verified") return this.lastVerification;
    return detectContainerRuntime();
  }

  /** Is the approved image present locally? Never pulls. */
  private imageAvailable(runtimeCommand: string): boolean {
    const out = spawnSync(runtimeCommand, ["image", "inspect", approvedImageReference()], { shell: false, encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true });
    return out.status === 0;
  }

  /**
   * Start ONE real disposable container under production flags and read the
   * probe's findings back. This is the only path to `available-and-verified`.
   */
  verifyIsolation(): SandboxCapabilityReport {
    const unverified = (reason: SandboxReasonCode, detail: string): SandboxCapabilityReport => ({
      backendId: this.backendId,
      capabilityState: reason === "sandbox-runtime-unavailable" ? "unavailable" : "available-unverified",
      available: reason !== "sandbox-runtime-unavailable",
      verified: false,
      detectionMethod: "isolation-probe",
      detectionDetail: truncateUtf8(redactedText(detail, 200), 200).text,
      claims: NO_ISOLATION_CLAIMS,
      safeReasonCode: reason,
    });

    const resolved = resolveTrustedExecutable(this.runtimeExecutableId, {});
    if (!resolved.ok) return unverified("sandbox-runtime-unavailable", "runtime not resolvable");
    const runtime = resolved.value.command;

    // A tag that is not digest-pinned is refused when pinning is required.
    if (REQUIRE_PINNED_IMAGE && !imageIsPinned()) return unverified("sandbox-image-unpinned", "image reference is not digest-pinned");
    if (!this.imageAvailable(runtime)) return unverified("sandbox-image-unavailable", "approved image not present locally");

    const probeDir = this.options.probeScriptHostDir ?? resolve(process.cwd(), "dist", "tools");
    const probeWorkspace = this.options.probeWorkspaceHostPath ?? "";
    if (probeWorkspace.length === 0) return unverified("sandbox-probe-failed", "no probe workspace supplied");

    // §31: every bind-mount source is PROVEN before any argv exists, and before
    // identity is read. The probe workspace is authorized against itself (it was
    // created by this trusted entry point); the probe script directory against
    // the trusted build root. A refusal names the mount fault, never the path.
    const mounts = validateMountSourceSet({
      workspace: probeWorkspace,
      readOnlySource: null,
      probe: probeDir,
      workspaceRoots: verificationWorkspaceRoots(this.options, probeWorkspace),
      probeRoots: probeMountRoots(this.options),
    });
    if (!mounts.ok) return unverified(mounts.reasonCode, "bind-mount source refused");

    // Identity comes from the OWNER of the authorized workspace, never from a
    // caller, and is read from the CANONICAL object that will actually be
    // mounted. If ownership cannot be proven, refuse rather than fall back to a
    // fixed uid that may not match the mount.
    const identity = resolveTrustedWorkspaceIdentity(mounts.sources.workspace);
    if (!identity.ok) return unverified(identity.reasonCode, "workspace ownership could not be proven");

    const containerName = `namla-verify-${process.pid}-${this.verifySequence++}`;
    const args = buildContainerRunArgs({
      userIdentity: identity.identity,
      workspaceHostPath: mounts.sources.workspace,
      sourceHostPath: null,
      probeHostPath: mounts.sources.probe,
      cpuLimit: 1,
      memoryLimitMb: 512,
      pidLimit: 64,
      timeoutSeconds: 60,
      // Verification always runs fully network-denied: the probe's outbound
      // connection attempt must fail for the run to verify at all.
      networkMode: "none",
      containerName,
      command: ["node", `${CONTAINER_PROBE_MOUNT}/containerIsolationProbe.js`],
    });

    // Re-prove every mount source at the LAST instruction before the spawn: a
    // source swapped between validation and use must not be mounted.
    const recheck = this.revalidateMounts(verificationWorkspaceRoots(this.options, probeWorkspace), mounts.sources.workspace, null, mounts.sources.probe);
    if (recheck !== "ok") return unverified(recheck, "bind-mount source changed before use");

    const out = spawnSync(runtime, args, { shell: false, encoding: "utf8", timeout: this.options.verifyTimeoutMs ?? 120000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });

    // Force cleanup regardless of outcome. `--rm` handles the normal path; this
    // covers a timeout that left the container alive.
    const removed = this.forceRemove(runtime, containerName);

    // Classify using EVERY signal spawnSync provides, not just empty stdout.
    // Collapsing all of these into "probe produced no output" made a rejected
    // Docker flag indistinguishable from a real isolation failure.
    const hasStdout = typeof out.stdout === "string" && out.stdout.trim().length > 0;
    let findings: ProbeFindings | null = null;
    let jsonParseFailed = false;
    if (hasStdout) {
      try {
        findings = JSON.parse((out.stdout as string).trim()) as ProbeFindings;
      } catch {
        jsonParseFailed = true;
      }
    }

    if (!findings) {
      this.lastStartupDiagnostics = classifyContainerStartup({
        errorCode: (out.error as NodeJS.ErrnoException | undefined)?.code,
        status: typeof out.status === "number" ? out.status : null,
        signal: (out.signal as string | null) ?? null,
        stdout: typeof out.stdout === "string" ? out.stdout : "",
        stderr: typeof out.stderr === "string" ? out.stderr : "",
        jsonParseFailed,
      });
      return unverified(this.lastStartupDiagnostics.safeReasonCode, describeStartupFailure(this.lastStartupDiagnostics));
    }
    this.lastStartupDiagnostics = null;

    const verdict = classifyProbe(findings);
    if (verdict !== "ok") return unverified(verdict, "isolation property unmet");
    if (!removed) return unverified("sandbox-cleanup-incomplete", "container not removed after exit");

    const verified: SandboxCapabilityReport = {
      backendId: this.backendId,
      capabilityState: "available-and-verified",
      available: true,
      verified: true,
      detectionMethod: "isolation-probe",
      detectionDetail: "all isolation properties verified in a real container",
      claims: claimsFromProbe(findings),
      safeReasonCode: "ok",
    };
    this.lastVerification = verified;
    return verified;
  }

  private verifySequence = 0;

  /**
   * Re-prove already-validated mount sources immediately before a spawn.
   * Returns `"ok"` or the first refusal. Shared by verification and execution
   * so both close the same window in the same way.
   */
  private revalidateMounts(workspaceRoots: readonly string[], workspace: CanonicalMountSource, readOnlySource: CanonicalMountSource | null, probe: CanonicalMountSource | null): SandboxReasonCode {
    const w = revalidateMountSource(workspace, workspaceRoots, "workspace");
    if (!w.ok) return w.reasonCode;
    if (readOnlySource !== null) {
      const s = revalidateMountSource(readOnlySource, workspaceRoots, "readonly-source");
      if (!s.ok) return s.reasonCode;
    }
    if (probe !== null) {
      const p = revalidateMountSource(probe, probeMountRoots(this.options), "probe");
      if (!p.ok) return p.reasonCode;
    }
    return "ok";
  }

  /** Remove the container if it somehow survived. Returns true when gone. */
  private forceRemove(runtime: string, name: string): boolean {
    spawnSync(runtime, ["rm", "-f", name], { shell: false, encoding: "utf8", timeout: 30000, maxBuffer: 65536, windowsHide: true });
    const check = spawnSync(runtime, ["inspect", name], { shell: false, encoding: "utf8", timeout: 30000, maxBuffer: 65536, windowsHide: true });
    return check.status !== 0; // non-zero inspect == not present == removed
  }

  /**
   * Execute under a permit. Refuses unless the permit was issued by the policy
   * gate AND this backend has actually verified isolation. There is no host
   * fallback anywhere in this method.
   */
  execute(permit: SandboxExecutionPermit): SandboxExecutionReceipt {
    const blocked = (reason: SandboxReasonCode): SandboxExecutionReceipt =>
      buildSandboxReceipt({
        backendId: this.backendId,
        capabilityState: this.lastVerification?.capabilityState ?? "available-unverified",
        executionStarted: false,
        executionCompleted: false,
        exitCategory: "blocked",
        timeoutMs: permit.policy.limits.timeoutMs,
        cpuLimit: 0,
        memoryLimitMb: 0,
        pidLimit: 0,
        networkPolicy: "denied",
        mountPolicy: "none",
        cleanupComplete: true,
        blocked: true,
        safeReasonCode: reason,
      });

    if (!isIssuedPermit(permit)) return blocked("sandbox-capability-unverified");
    if (!this.lastVerification || this.lastVerification.capabilityState !== "available-and-verified") return blocked("sandbox-capability-unverified");
    const policyViolation = validateSandboxPolicySpec(permit.policy);
    if (policyViolation !== "ok") return blocked(policyViolation);

    // §32: resolve the declared policy to a mode this backend can actually
    // enforce, BEFORE any argv exists and long before any process. A policy
    // with no exact mechanism is refused here rather than being approximated.
    // The gate refuses these too; this is the backend's own independent check,
    // so a permit obtained under a backend whose claims later changed cannot
    // execute under a widened network.
    const network = enforcedNetworkModeFor(permit.policy.network.policy);
    if (!network.ok) return blocked(network.reasonCode);

    const resolved = resolveTrustedExecutable(this.runtimeExecutableId, {});
    if (!resolved.ok) return blocked("sandbox-runtime-unavailable");

    // §31: the permit's mount paths are CALLER-SUPPLIED and are the sharpest
    // input in this method — they decide which part of the host filesystem the
    // container sees and writes. They are proven against roots this backend was
    // constructed with, never against anything the permit carries. A backend
    // given no authorized roots can prove nothing and refuses every mount.
    const mounts = validateMountSourceSet({
      workspace: permit.policy.mounts.workspaceMountPath,
      readOnlySource: permit.policy.mounts.readOnlySourceMount,
      probe: null,
      workspaceRoots: executionMountRoots(this.options),
      probeRoots: probeMountRoots(this.options),
    });
    if (!mounts.ok) return blocked(mounts.reasonCode);

    // Identity is derived from the CANONICAL workspace, not the caller's string,
    // so ownership is read from the same object that will actually be mounted.
    const runIdentity = resolveTrustedWorkspaceIdentity(mounts.sources.workspace);
    if (!runIdentity.ok) return blocked(runIdentity.reasonCode);

    const containerName = `namla-run-${process.pid}-${this.verifySequence++}`;
    const args = buildContainerRunArgs({
      userIdentity: runIdentity.identity,
      workspaceHostPath: mounts.sources.workspace,
      sourceHostPath: mounts.sources.readOnlySource,
      probeHostPath: null,
      cpuLimit: permit.policy.limits.cpuLimit,
      memoryLimitMb: permit.policy.limits.memoryLimitMb,
      pidLimit: permit.policy.limits.pidLimit,
      timeoutSeconds: Math.ceil(permit.policy.limits.timeoutMs / 1000),
      networkMode: network.mode,
      containerName,
      command: [permit.executableId, ...permit.fixedArguments],
    });

    // Re-prove the mounts at the last instruction before the spawn (TOCTOU).
    const recheck = this.revalidateMounts(executionMountRoots(this.options), mounts.sources.workspace, mounts.sources.readOnlySource, null);
    if (recheck !== "ok") return blocked(recheck);

    const out = spawnSync(resolved.value.command, args, { shell: false, encoding: "utf8", timeout: permit.policy.limits.timeoutMs, maxBuffer: permit.policy.limits.maxOutputBytes + 4096, windowsHide: true });
    const cleanupComplete = this.forceRemove(resolved.value.command, containerName);
    const timedOut = Boolean(out.error && (out.error as NodeJS.ErrnoException).code === "ETIMEDOUT");

    // Classify EXECUTION failures too, not just verification ones. Without
    // this, a mission run that died because Docker rejected a flag was
    // indistinguishable from one that died inside the container, and stderr was
    // discarded outright. Recorded only when the run did not complete cleanly.
    this.lastStartupDiagnostics =
      timedOut || out.error || out.status !== 0
        ? classifyContainerStartup({
            errorCode: (out.error as NodeJS.ErrnoException | undefined)?.code,
            status: typeof out.status === "number" ? out.status : null,
            signal: (out.signal as string | null) ?? null,
            stdout: typeof out.stdout === "string" ? out.stdout : "",
            stderr: typeof out.stderr === "string" ? out.stderr : "",
          })
        : null;

    return buildSandboxReceipt({
      backendId: this.backendId,
      capabilityState: "available-and-verified",
      executionStarted: true,
      executionCompleted: !timedOut && !out.error,
      exitCategory: timedOut ? "timed-out" : out.error ? "backend-error" : out.status === 0 ? "completed" : "non-zero-exit",
      timeoutMs: permit.policy.limits.timeoutMs,
      cpuLimit: permit.policy.limits.cpuLimit,
      memoryLimitMb: permit.policy.limits.memoryLimitMb,
      pidLimit: permit.policy.limits.pidLimit,
      networkPolicy: permit.policy.network.policy,
      mountPolicy: describeMountPolicy(permit.policy.mounts),
      cleanupComplete,
      blocked: false,
      safeReasonCode: cleanupComplete ? "ok" : "sandbox-cleanup-incomplete",
    });
  }
}

/**
 * Whether an unpinned tag is acceptable. Kept false for local/CI bring-up,
 * where the image is BUILT locally and therefore has no upstream digest to
 * pin; a registry-sourced image must set this true and populate IMAGE_DIGEST.
 */
export const REQUIRE_PINNED_IMAGE = false;
