/**
 * sandboxPolicy — the fail-closed boundary for high-risk execution.
 *
 * Running provider-generated code, `npm test`, a build, or any package script
 * is equivalent to executing arbitrary code: a generated `package.json` can put
 * anything in its `scripts`. An allowlist of npm subcommands does not make the
 * underlying script safe, a temp directory is not a sandbox, and a subprocess
 * timeout is not a sandbox.
 *
 * The central design decision is that this module is a POLICY GATE, not an
 * isolation implementation. It answers one question — "is verified isolation
 * available right now?" — and when the answer is no it REFUSES. It never falls
 * back to host execution, because a silent fallback is strictly worse than an
 * error: the caller believes it is sandboxed and behaves accordingly.
 *
 * Three capability states matter, and conflating them is the failure mode this
 * module exists to prevent:
 *
 *   available-and-verified — a backend exists AND its isolation was verified.
 *                            Only this state authorizes high-risk execution.
 *   available-unverified   — a runtime binary was detected, nothing more. A
 *                            `docker --version` that succeeds proves a CLI is
 *                            installed; it proves nothing about cgroup limits,
 *                            namespaces, or network policy. NOT sufficient.
 *   unavailable            — nothing usable. Fail closed.
 *
 * `fake-test-backend` is a fourth state, deliberately outside that ladder: it
 * exists for deterministic tests and can never authorize high-risk execution or
 * be projected as real isolation.
 *
 * This module spawns nothing. Detection uses a bounded `--version` probe via the
 * trusted executable registry; execution is delegated to a backend.
 */

import { resolveTrustedExecutable, type TrustedExecutableId } from "./trustedExecutableRegistry";
import type { NetworkPolicy, DestinationClass } from "./networkPolicy";

export type SandboxCapabilityState = "available-and-verified" | "available-unverified" | "unavailable" | "fake-test-backend";

export type SandboxRiskLevel = "low-risk-deterministic" | "high-risk";

export type SandboxReasonCode =
  | "ok"
  | "sandbox-runtime-unavailable"
  | "sandbox-capability-unverified"
  | "sandbox-host-mount-refused"
  | "sandbox-privileged-refused"
  | "sandbox-docker-socket-refused"
  | "sandbox-host-namespace-refused"
  | "sandbox-credential-mount-refused"
  | "sandbox-network-policy-refused"
  | "sandbox-user-policy-refused"
  | "sandbox-cleanup-policy-refused"
  | "sandbox-limits-missing"
  | "sandbox-human-authorization-missing"
  | "sandbox-fake-backend-not-permitted"
  | "sandbox-unknown-executable"
  // --- container backend verification (§30) --------------------------------
  // Each names ONE isolation property that a real container failed to prove.
  // They exist so a refusal says which guarantee is missing, never merely that
  // "the sandbox did not work".
  | "sandbox-image-unavailable"
  | "sandbox-image-unpinned"
  | "sandbox-user-not-isolated"
  | "sandbox-root-filesystem-writable"
  | "sandbox-host-mount-detected"
  | "sandbox-docker-socket-detected"
  | "sandbox-secret-inheritance-detected"
  | "sandbox-network-not-denied"
  | "sandbox-cpu-limit-unverified"
  | "sandbox-memory-limit-unverified"
  | "sandbox-pid-limit-unverified"
  | "sandbox-cleanup-incomplete"
  | "sandbox-workspace-not-writable"
  | "sandbox-probe-failed"
  // --- bind-mount source validation (§31) -----------------------------------
  // A host path handed to Docker as a bind-mount SOURCE is an authorization
  // decision, not a string. Each code names ONE reason the source could not be
  // proven, so a refusal is never mistaken for an unrelated sandbox fault.
  | "sandbox-mount-source-invalid"
  | "sandbox-mount-source-missing"
  | "sandbox-mount-source-not-directory"
  | "sandbox-mount-source-symlink"
  | "sandbox-mount-source-outside-root"
  | "sandbox-mount-source-untrusted"
  // --- network policy enforceability (§32) ----------------------------------
  // DISTINCT from `sandbox-network-policy-refused`, which means the requested
  // policy is itself forbidden. This one means the policy is coherent and
  // legitimate, but THIS backend has no mechanism that enforces exactly it —
  // so it fails closed instead of being silently widened to something broader.
  | "sandbox-network-policy-unenforceable";

/** Thrown only where a caller demands a permit it cannot have. */
export class SandboxUnavailableError extends Error {
  readonly safeReasonCode: SandboxReasonCode;
  constructor(reasonCode: SandboxReasonCode = "sandbox-runtime-unavailable") {
    super(reasonCode); // the MESSAGE is the reason code - never a path or command
    this.name = "SandboxUnavailableError";
    this.safeReasonCode = reasonCode;
  }
}

// ------------------------------------------------------------- POLICY SHAPE ---

export interface SandboxLimits {
  readonly cpuLimit: number;
  readonly memoryLimitMb: number;
  readonly pidLimit: number;
  readonly processLimit: number;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

export interface SandboxMountPolicy {
  /** The ONE writable mount: the bounded workspace. */
  readonly workspaceMountPath: string;
  readonly workspaceWritable: boolean;
  /** Optional read-only source mount. */
  readonly readOnlySourceMount: string | null;
  /** Host paths the caller wants mounted. MUST be empty. */
  readonly hostMounts: readonly string[];
  readonly mountDockerSocket: boolean;
  readonly mountCredentials: boolean;
}

export interface SandboxUserPolicy {
  readonly dedicatedUser: boolean;
  readonly runAsRoot: boolean;
}

export interface SandboxNamespacePolicy {
  readonly privileged: boolean;
  readonly hostPidNamespace: boolean;
  readonly hostNetworkNamespace: boolean;
}

export interface SandboxNetworkSpec {
  readonly policy: NetworkPolicy;
  readonly allowlist: readonly DestinationClass[];
}

export interface SandboxCleanupPolicy {
  readonly disposableFilesystem: boolean;
  readonly cleanupAfterExit: boolean;
}

export interface SandboxPolicySpec {
  readonly limits: SandboxLimits;
  readonly mounts: SandboxMountPolicy;
  readonly user: SandboxUserPolicy;
  readonly namespaces: SandboxNamespacePolicy;
  readonly network: SandboxNetworkSpec;
  readonly cleanup: SandboxCleanupPolicy;
  readonly inheritEnvironmentSecrets: boolean;
}

/** The safe defaults: deny everything that is not explicitly required. */
export const DEFAULT_SANDBOX_POLICY: SandboxPolicySpec = {
  limits: { cpuLimit: 1, memoryLimitMb: 1024, pidLimit: 128, processLimit: 64, timeoutMs: 600000, maxOutputBytes: 262144 },
  mounts: { workspaceMountPath: "/workspace", workspaceWritable: true, readOnlySourceMount: null, hostMounts: [], mountDockerSocket: false, mountCredentials: false },
  user: { dedicatedUser: true, runAsRoot: false },
  namespaces: { privileged: false, hostPidNamespace: false, hostNetworkNamespace: false },
  network: { policy: "denied", allowlist: [] },
  cleanup: { disposableFilesystem: true, cleanupAfterExit: true },
  inheritEnvironmentSecrets: false,
};

/** The isolation claims a backend asserts. Every one must hold to be verified. */
export interface SandboxIsolationClaims {
  readonly dedicatedUser: boolean;
  readonly noHostFilesystemMounts: boolean;
  readonly boundedWorkspaceMountOnly: boolean;
  readonly readOnlySourceMountSupported: boolean;
  readonly cpuLimitEnforced: boolean;
  readonly memoryLimitEnforced: boolean;
  readonly pidLimitEnforced: boolean;
  readonly processCountLimitEnforced: boolean;
  readonly timeoutEnforced: boolean;
  readonly defaultDenyNetwork: boolean;
  readonly explicitNetworkAllowlist: boolean;
  readonly noPrivilegedMode: boolean;
  readonly noHostPidNamespace: boolean;
  readonly noHostNetworkNamespace: boolean;
  readonly noDockerSocket: boolean;
  readonly noCredentialMounts: boolean;
  readonly noEnvironmentSecretInheritance: boolean;
  readonly disposableFilesystem: boolean;
  readonly cleanupAfterExit: boolean;
}

/** Nothing is claimed. The honest default when no verified backend exists. */
export const NO_ISOLATION_CLAIMS: SandboxIsolationClaims = {
  dedicatedUser: false,
  noHostFilesystemMounts: false,
  boundedWorkspaceMountOnly: false,
  readOnlySourceMountSupported: false,
  cpuLimitEnforced: false,
  memoryLimitEnforced: false,
  pidLimitEnforced: false,
  processCountLimitEnforced: false,
  timeoutEnforced: false,
  defaultDenyNetwork: false,
  explicitNetworkAllowlist: false,
  noPrivilegedMode: false,
  noHostPidNamespace: false,
  noHostNetworkNamespace: false,
  noDockerSocket: false,
  noCredentialMounts: false,
  noEnvironmentSecretInheritance: false,
  disposableFilesystem: false,
  cleanupAfterExit: false,
};

export interface SandboxCapabilityReport {
  readonly backendId: string;
  readonly capabilityState: SandboxCapabilityState;
  readonly available: boolean;
  readonly verified: boolean;
  /** How this was determined, e.g. "executable-probe" or "not-detected". */
  readonly detectionMethod: string;
  /** Bounded, safe detail. Never a host path or raw command output. */
  readonly detectionDetail: string;
  readonly claims: SandboxIsolationClaims;
  readonly safeReasonCode: SandboxReasonCode;
}

// -------------------------------------------------------------- REQUESTS ---

export interface SandboxExecutionRequest {
  readonly objectiveId: string;
  readonly taskId: string;
  readonly workspaceId: string;
  /** An approved id only - never a mission-provided path or shell command. */
  readonly executableId: TrustedExecutableId;
  readonly fixedArguments: readonly string[];
  readonly policy: SandboxPolicySpec;
  readonly riskLevel: SandboxRiskLevel;
  readonly humanAuthorized: boolean;
}

/** Issued ONLY by SandboxPolicy, only for a verified backend. Frozen, single-use. */
export interface SandboxExecutionPermit {
  readonly objectiveId: string;
  readonly taskId: string;
  readonly workspaceId: string;
  readonly executableId: TrustedExecutableId;
  readonly fixedArguments: readonly string[];
  readonly policy: SandboxPolicySpec;
  readonly backendId: string;
  readonly capabilityState: SandboxCapabilityState;
}

/** Permits actually minted by this module. Identity, not shape, is authority. */
const ISSUED_PERMITS = new WeakSet<SandboxExecutionPermit>();

export function isIssuedPermit(permit: SandboxExecutionPermit): boolean {
  return ISSUED_PERMITS.has(permit);
}

// -------------------------------------------------------------- RECEIPTS ---

export type SandboxExitCategory = "not-started" | "completed" | "non-zero-exit" | "timed-out" | "blocked" | "backend-error";

/** Safe execution metadata ONLY. No prompt, command line, output, or host path. */
export interface SandboxExecutionReceipt {
  readonly backendId: string;
  readonly capabilityState: SandboxCapabilityState;
  readonly executionStarted: boolean;
  readonly executionCompleted: boolean;
  readonly exitCategory: SandboxExitCategory;
  readonly timeoutMs: number;
  readonly cpuLimit: number;
  readonly memoryLimitMb: number;
  readonly pidLimit: number;
  readonly networkPolicy: NetworkPolicy;
  readonly mountPolicy: string;
  readonly cleanupComplete: boolean;
  readonly blocked: boolean;
  readonly safeReasonCode: SandboxReasonCode;
  readonly safeFingerprint: string;
}

function fingerprint(parts: readonly (string | number | boolean)[]): string {
  let h = 0x811c9dc5;
  const s = parts.join("|");
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `sb-${h.toString(16).padStart(8, "0")}`;
}

/** Describe the mount policy as a CLASS, never as host paths. */
export function describeMountPolicy(mounts: SandboxMountPolicy): string {
  if (mounts.hostMounts.length > 0) return "host-mounts-present";
  if (mounts.mountDockerSocket) return "docker-socket-present";
  if (mounts.mountCredentials) return "credential-mounts-present";
  return mounts.readOnlySourceMount ? "bounded-workspace-plus-readonly-source" : "bounded-workspace-only";
}

export function buildSandboxReceipt(input: Omit<SandboxExecutionReceipt, "safeFingerprint">): SandboxExecutionReceipt {
  return { ...input, safeFingerprint: fingerprint([input.backendId, input.capabilityState, input.executionStarted, input.executionCompleted, input.exitCategory, input.timeoutMs, input.cpuLimit, input.memoryLimitMb, input.pidLimit, input.networkPolicy, input.mountPolicy, input.cleanupComplete, input.blocked, input.safeReasonCode]) };
}

// -------------------------------------------------------------- BACKENDS ---

export interface SandboxBackend {
  readonly backendId: string;
  /** True only for a backend that performs REAL isolation. */
  readonly isReal: boolean;
  detectCapability(): SandboxCapabilityReport;
  execute(permit: SandboxExecutionPermit): SandboxExecutionReceipt;
}

/**
 * A real container backend. INTERFACE ONLY - no implementation ships here.
 * Implementing it requires a verified container runtime, and the verification
 * must exercise real cgroup limits, namespaces, and network policy. Until that
 * exists, claiming container isolation would be a lie in a security receipt.
 */
export interface ContainerSandboxBackend extends SandboxBackend {
  readonly runtimeExecutableId: Extract<TrustedExecutableId, "docker" | "podman">;
  /** Must actually verify isolation, not merely that a CLI is installed. */
  verifyIsolation(): SandboxCapabilityReport;
}

/**
 * Detect a container runtime WITHOUT running a container.
 *
 * A successful `--version` proves a CLI binary exists. It does not prove that
 * cgroup limits apply, that namespaces are unshared, or that the network is
 * denied by default. Detection therefore returns at most
 * `available-unverified`, which is deliberately NOT sufficient for high-risk
 * execution. Reaching `available-and-verified` requires a real verification run
 * that this codebase does not perform.
 */
export function detectContainerRuntime(options: { readonly probe?: boolean } = {}): SandboxCapabilityReport {
  for (const id of ["docker", "podman"] as const) {
    const resolved = resolveTrustedExecutable(id, { probeVersion: options.probe === true });
    if (!resolved.ok) continue;
    return {
      backendId: id,
      capabilityState: "available-unverified",
      available: true,
      verified: false,
      detectionMethod: "executable-probe",
      // A version token only - never a host path.
      detectionDetail: resolved.value.version.length > 0 ? resolved.value.version : "detected",
      // NOTHING is claimed: a detected binary proves no isolation property.
      claims: NO_ISOLATION_CLAIMS,
      safeReasonCode: "sandbox-capability-unverified",
    };
  }
  return {
    backendId: "none",
    capabilityState: "unavailable",
    available: false,
    verified: false,
    detectionMethod: "not-detected",
    detectionDetail: "no container runtime found",
    claims: NO_ISOLATION_CLAIMS,
    safeReasonCode: "sandbox-runtime-unavailable",
  };
}

/** The honest backend for a host with no verified runtime. Executes nothing. */
export class UnavailableSandboxBackend implements SandboxBackend {
  readonly backendId = "none";
  readonly isReal = false;

  detectCapability(): SandboxCapabilityReport {
    return detectContainerRuntime();
  }

  execute(): SandboxExecutionReceipt {
    // Structurally incapable of host execution.
    return buildSandboxReceipt({ backendId: this.backendId, capabilityState: "unavailable", executionStarted: false, executionCompleted: false, exitCategory: "blocked", timeoutMs: 0, cpuLimit: 0, memoryLimitMb: 0, pidLimit: 0, networkPolicy: "denied", mountPolicy: "none", cleanupComplete: true, blocked: true, safeReasonCode: "sandbox-runtime-unavailable" });
  }
}

/** All claims true - used ONLY by the fake backend and by verified-backend tests. */
export const ALL_ISOLATION_CLAIMS: SandboxIsolationClaims = Object.freeze(Object.fromEntries(Object.keys(NO_ISOLATION_CLAIMS).map((k) => [k, true])) as unknown as SandboxIsolationClaims);

/**
 * Deterministic backend for automated tests. It performs NO isolation and says
 * so: its capability state is `fake-test-backend`, which the policy gate treats
 * as non-authorizing for high-risk work. It can never be projected as real.
 */
export class FakeSandboxBackend implements SandboxBackend {
  readonly backendId = "fake-test-backend";
  readonly isReal = false;
  executeCallCount = 0;

  constructor(private readonly state: SandboxCapabilityState = "fake-test-backend") {}

  detectCapability(): SandboxCapabilityReport {
    return {
      backendId: this.backendId,
      capabilityState: this.state,
      available: this.state !== "unavailable",
      verified: this.state === "available-and-verified",
      detectionMethod: "fake",
      detectionDetail: "deterministic test backend - performs NO real isolation",
      claims: this.state === "available-and-verified" ? ALL_ISOLATION_CLAIMS : NO_ISOLATION_CLAIMS,
      safeReasonCode: this.state === "available-and-verified" ? "ok" : this.state === "unavailable" ? "sandbox-runtime-unavailable" : this.state === "available-unverified" ? "sandbox-capability-unverified" : "sandbox-fake-backend-not-permitted",
    };
  }

  execute(permit: SandboxExecutionPermit): SandboxExecutionReceipt {
    this.executeCallCount += 1;
    return buildSandboxReceipt({ backendId: this.backendId, capabilityState: this.state, executionStarted: true, executionCompleted: true, exitCategory: "completed", timeoutMs: permit.policy.limits.timeoutMs, cpuLimit: permit.policy.limits.cpuLimit, memoryLimitMb: permit.policy.limits.memoryLimitMb, pidLimit: permit.policy.limits.pidLimit, networkPolicy: permit.policy.network.policy, mountPolicy: describeMountPolicy(permit.policy.mounts), cleanupComplete: true, blocked: false, safeReasonCode: "ok" });
  }
}

// ---------------------------------------------------------------- GATE ---

export type SandboxAuthorization = { readonly ok: true; readonly permit: SandboxExecutionPermit; readonly receipt: SandboxExecutionReceipt } | { readonly ok: false; readonly permit: null; readonly receipt: SandboxExecutionReceipt };

/** Validate the requested policy itself. Returns the first violation, or "ok". */
export function validateSandboxPolicySpec(policy: SandboxPolicySpec): SandboxReasonCode {
  const { mounts, namespaces, user, network, cleanup, limits } = policy;
  if (mounts.hostMounts.length > 0) return "sandbox-host-mount-refused";
  if (mounts.mountDockerSocket) return "sandbox-docker-socket-refused";
  if (mounts.mountCredentials) return "sandbox-credential-mount-refused";
  if (namespaces.privileged) return "sandbox-privileged-refused";
  if (namespaces.hostPidNamespace || namespaces.hostNetworkNamespace) return "sandbox-host-namespace-refused";
  if (!user.dedicatedUser || user.runAsRoot) return "sandbox-user-policy-refused";
  if (policy.inheritEnvironmentSecrets) return "sandbox-credential-mount-refused";
  // Default-deny: anything beyond an explicit allowlist is refused outright.
  if (network.policy === "allowed") return "sandbox-network-policy-refused";
  if (network.policy === "denied" && network.allowlist.length > 0) return "sandbox-network-policy-refused";
  if (!cleanup.disposableFilesystem || !cleanup.cleanupAfterExit) return "sandbox-cleanup-policy-refused";
  if (limits.cpuLimit <= 0 || limits.memoryLimitMb <= 0 || limits.pidLimit <= 0 || limits.processLimit <= 0 || limits.timeoutMs <= 0) return "sandbox-limits-missing";
  return "ok";
}

/**
 * Which VERIFIED isolation claim a given network policy depends on (§32).
 *
 * The point of this mapping is that "the sandbox was verified" is not one fact
 * but many, and networking is the place where treating it as one fact does real
 * damage: the baseline probe proves a container cannot reach the network at
 * all, which says nothing whatsoever about whether a narrower-than-open policy
 * could be enforced if the network were opened.
 *
 * Three outcomes, deliberately distinct rather than one nullable claim name:
 *
 *   denied       → claim `defaultDenyNetwork`      (a real, probe-verified fact)
 *   allowlisted  → claim `explicitNetworkAllowlist` (a destination allowlist)
 *   loopback-only / provider-only
 *                → NO MECHANISM. These are not "allowlisting" and must not be
 *                  satisfied by the allowlist claim. `loopback-only` means the
 *                  container may reach 127.0.0.1 and nothing else;
 *                  `provider-only` means exactly one external service. A
 *                  general destination allowlist proves NEITHER, so tying them
 *                  to `explicitNetworkAllowlist` would silently authorize them
 *                  the day an unrelated allowlist proxy shipped. They stay
 *                  blocked until each has its own verified claim.
 *   allowed      → FORBIDDEN. No claim exists or could exist that permits
 *                  unrestricted egress from a sandbox.
 */
export type NetworkEnforcementRequirement = { readonly kind: "claim"; readonly claim: keyof SandboxIsolationClaims } | { readonly kind: "no-mechanism" } | { readonly kind: "forbidden" };

export function requiredNetworkEnforcement(policy: NetworkPolicy): NetworkEnforcementRequirement {
  switch (policy) {
    case "denied":
      return { kind: "claim", claim: "defaultDenyNetwork" };
    case "allowlisted":
      return { kind: "claim", claim: "explicitNetworkAllowlist" };
    case "loopback-only":
    case "provider-only":
      return { kind: "no-mechanism" };
    case "allowed":
      return { kind: "forbidden" };
  }
}

/**
 * Is `policy` actually enforceable by a backend making these claims?
 *
 * Returns `"ok"` or the precise refusal. A backend that has merely been
 * "verified" is NOT sufficient authority: the specific claim the policy relies
 * on must itself be true. Anything else would let a baseline verification
 * authorize a networking mode nothing enforces.
 */
export function networkPolicyEnforceable(policy: NetworkPolicy, claims: SandboxIsolationClaims): SandboxReasonCode {
  const required = requiredNetworkEnforcement(policy);
  if (required.kind === "forbidden") return "sandbox-network-policy-refused";
  if (required.kind === "no-mechanism") return "sandbox-network-policy-unenforceable";
  if (claims[required.claim] !== true) return "sandbox-network-policy-unenforceable";
  return "ok";
}

/**
 * The gate. High-risk execution is authorized ONLY under a verified backend;
 * every other capability state refuses BEFORE any process is created, and there
 * is no host-execution fallback anywhere in this function.
 */
export class SandboxPolicy {
  constructor(private readonly backend: SandboxBackend) {}

  get backendId(): string {
    return this.backend.backendId;
  }

  capability(): SandboxCapabilityReport {
    return this.backend.detectCapability();
  }

  authorize(request: SandboxExecutionRequest): SandboxAuthorization {
    const cap = this.backend.detectCapability();
    const blockedReceipt = (reason: SandboxReasonCode): SandboxAuthorization => ({
      ok: false,
      permit: null,
      receipt: buildSandboxReceipt({
        backendId: cap.backendId,
        capabilityState: cap.capabilityState,
        executionStarted: false,
        executionCompleted: false,
        exitCategory: "blocked",
        timeoutMs: request.policy.limits.timeoutMs,
        // A blocked request claims NO limits: reporting them would imply they
        // were applied by something, and nothing ran.
        cpuLimit: 0,
        memoryLimitMb: 0,
        pidLimit: 0,
        networkPolicy: "denied",
        mountPolicy: "none",
        cleanupComplete: true,
        blocked: true,
        safeReasonCode: reason,
      }),
    });

    // 1. The requested policy must itself be safe, whatever the backend is.
    const policyViolation = validateSandboxPolicySpec(request.policy);
    if (policyViolation !== "ok") return blockedReceipt(policyViolation);

    // 2. Low-risk deterministic work never needs a container - and never gets a
    //    permit from here either, so it cannot be mistaken for sandboxed work.
    if (request.riskLevel === "low-risk-deterministic") {
      return blockedReceipt("ok");
    }

    // 3. High risk requires a VERIFIED backend. Everything else fails closed.
    if (cap.capabilityState === "unavailable") return blockedReceipt("sandbox-runtime-unavailable");
    if (cap.capabilityState === "fake-test-backend") return blockedReceipt("sandbox-fake-backend-not-permitted");
    if (cap.capabilityState === "available-unverified") return blockedReceipt("sandbox-capability-unverified");
    if (!cap.verified) return blockedReceipt("sandbox-capability-unverified");

    // 4. §32: a verified BASELINE is not authority over every network policy.
    //    The specific claim the requested policy depends on must itself be
    //    true, or nothing here may issue a permit — no process is created, and
    //    the broader mode is never substituted for the narrower request.
    const networkViolation = networkPolicyEnforceable(request.policy.network.policy, cap.claims);
    if (networkViolation !== "ok") return blockedReceipt(networkViolation);

    if (!request.humanAuthorized) return blockedReceipt("sandbox-human-authorization-missing");

    const permit: SandboxExecutionPermit = Object.freeze({
      objectiveId: request.objectiveId,
      taskId: request.taskId,
      workspaceId: request.workspaceId,
      executableId: request.executableId,
      fixedArguments: Object.freeze([...request.fixedArguments]),
      policy: request.policy,
      backendId: cap.backendId,
      capabilityState: cap.capabilityState,
    });
    ISSUED_PERMITS.add(permit);

    return {
      ok: true,
      permit,
      receipt: buildSandboxReceipt({ backendId: cap.backendId, capabilityState: cap.capabilityState, executionStarted: false, executionCompleted: false, exitCategory: "not-started", timeoutMs: request.policy.limits.timeoutMs, cpuLimit: request.policy.limits.cpuLimit, memoryLimitMb: request.policy.limits.memoryLimitMb, pidLimit: request.policy.limits.pidLimit, networkPolicy: request.policy.network.policy, mountPolicy: describeMountPolicy(request.policy.mounts), cleanupComplete: false, blocked: false, safeReasonCode: "ok" }),
    };
  }

  /** Run under a permit this gate issued. A forged permit object is refused. */
  execute(permit: SandboxExecutionPermit): SandboxExecutionReceipt {
    if (!isIssuedPermit(permit)) {
      return buildSandboxReceipt({ backendId: this.backend.backendId, capabilityState: "unavailable", executionStarted: false, executionCompleted: false, exitCategory: "blocked", timeoutMs: 0, cpuLimit: 0, memoryLimitMb: 0, pidLimit: 0, networkPolicy: "denied", mountPolicy: "none", cleanupComplete: true, blocked: true, safeReasonCode: "sandbox-capability-unverified" });
    }
    return this.backend.execute(permit);
  }
}

// ------------------------------------------------------ COMMAND CENTRE ---

export interface SandboxProjection {
  readonly sandboxBackend: string;
  readonly sandboxCapabilityState: SandboxCapabilityState;
  readonly sandboxVerified: boolean;
  readonly sandboxAvailable: boolean;
  readonly sandboxNetworkPolicy: NetworkPolicy;
  readonly sandboxMountPolicy: string;
  readonly sandboxLimits: string;
  readonly sandboxExecutionBlocked: boolean;
  readonly sandboxReasonCode: SandboxReasonCode;
}

/**
 * Project the sandbox position for a command centre. It must never read as
 * "sandboxed" unless a verified backend exists: `sandboxExecutionBlocked` is
 * true for every state except `available-and-verified`.
 */
export function projectSandbox(cap: SandboxCapabilityReport, policy: SandboxPolicySpec = DEFAULT_SANDBOX_POLICY): SandboxProjection {
  const verified = cap.capabilityState === "available-and-verified" && cap.verified;
  return {
    sandboxBackend: cap.backendId,
    sandboxCapabilityState: cap.capabilityState,
    sandboxVerified: verified,
    sandboxAvailable: cap.available,
    // With no verified backend, no network policy is ENFORCED by anything; the
    // honest projection is the safe default, never a claim of enforcement.
    sandboxNetworkPolicy: verified ? policy.network.policy : "denied",
    sandboxMountPolicy: verified ? describeMountPolicy(policy.mounts) : "none",
    sandboxLimits: verified ? `cpu=${policy.limits.cpuLimit} mem=${policy.limits.memoryLimitMb}MB pid=${policy.limits.pidLimit} timeout=${policy.limits.timeoutMs}ms` : "none-enforced",
    sandboxExecutionBlocked: !verified,
    sandboxReasonCode: verified ? "ok" : cap.safeReasonCode,
  };
}

/** Honest one-liner. Never prints "sandboxed" without a verified backend. */
export function describeSandbox(p: SandboxProjection): string {
  return p.sandboxVerified ? `sandboxed backend=${p.sandboxBackend} ${p.sandboxLimits}` : `NOT SANDBOXED (${p.sandboxCapabilityState}) reason=${p.sandboxReasonCode}`;
}
