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
import { resolveTrustedExecutable, revalidateResolvedExecutable, type TrustedExecutableId } from "./trustedExecutableRegistry";
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

/**
 * An IMMUTABLE image identity (S-15).
 *
 * `approvedImageReference()` is `namla-sandbox:v1` — a name and a TAG. A tag is
 * a mutable pointer: `docker build -t namla-sandbox:v1` retargets it to
 * completely different content at any moment, and the CI job builds the image
 * exactly that way. So the reference names WHICH image is wanted; it is not
 * evidence of WHAT was verified.
 *
 * `docker image inspect` reports TWO different digests, and they are not
 * interchangeable. Conflating them is a real defect, not a stylistic one:
 *
 *   Id              The LOCAL IMAGE ID — the digest of the image CONFIG blob.
 *                   Every image present locally has one, including one produced
 *                   by `docker build`, which is how the CI image is made. A
 *                   bare `sha256:<hex>` argument is parsed by the reference
 *                   grammar as an image ID (the grammar requires a NAME before
 *                   `@digest`), so this is the value that can be RUN directly.
 *
 *   RepoDigests[n]  `repository@sha256:<hex>` — the digest of the MANIFEST, as
 *                   content-addressed by a registry. It is populated only after
 *                   a push or a pull; a purely local build has none. The
 *                   manifest is a document that CONTAINS the config digest as a
 *                   field, so hashing it cannot yield that same value: the
 *                   manifest digest and the config digest are necessarily
 *                   different strings for the very same image.
 *
 * Two consequences drive the model below.
 *
 *   1. `sha256:<manifest-digest>` is NOT a valid local run reference. Docker
 *      would look for an image whose ID is that digest and find none, because
 *      the image's ID is its CONFIG digest. Stripping `repository@` and running
 *      the remainder therefore produces a reference to nothing.
 *   2. `RepoDigests` can become populated later — a push of the identical local
 *      image adds one — with the content completely unchanged. Preferring it
 *      would make the identity string change while the image did not, which a
 *      freshness check would then have to report as a content change. That is a
 *      false alarm manufactured by the model itself.
 *
 * So there is exactly ONE canonical content identity: `localImageId`. It is
 * required, it is what execution addresses, and it is what equality compares.
 * `repoDigest` is optional PROVENANCE, retained with its repository context
 * intact and never used as an execution reference. Nothing is ever invented.
 */
export interface ResolvedImageIdentity {
  /**
   * `inspect[].Id`. Always `sha256:<64 hex>`. Never a tag, never a name.
   *
   * THE canonical content identity and the execution reference. Required for
   * every accepted image, and it is the only field equality consults.
   */
  readonly localImageId: string;
  /**
   * `inspect[].RepoDigests[n]`, VERBATIM — `repository@sha256:<64 hex>`, with
   * the repository kept. `null` for a locally built image, which is the real CI
   * case. Provenance only: it is recorded and reported, never run, and never
   * reduced to a bare digest.
   */
  readonly repoDigest: string | null;
}

export type ImageIdentityResolution =
  | { readonly ok: true; readonly identity: ResolvedImageIdentity; readonly reasonCode: "ok" }
  | { readonly ok: false; readonly identity: null; readonly reasonCode: SandboxReasonCode };

/** `sha256:` followed by exactly 64 lowercase hex characters. Nothing else. */
const IMAGE_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

/**
 * The reference an image is EXECUTED by — the local image ID, always.
 *
 * A named function rather than an inline field read, so there is exactly one
 * answer to "what does this run?" and a test can assert that answer directly
 * instead of inferring it from an argv position.
 */
export function imageExecutionReference(identity: ResolvedImageIdentity): string {
  return identity.localImageId;
}

/**
 * Parse `docker image inspect` output into an immutable identity.
 *
 * Fails closed on anything it cannot prove: non-JSON, an empty array, a missing
 * `Id`, or a digest that does not match the exact expected shape. A malformed
 * inspect is not "probably fine" — it is an unknown image, and running an
 * unknown image is the thing this exists to prevent.
 *
 * Pure and exported so the parsing rules are testable without a runtime.
 */
export function parseImageIdentity(inspectStdout: string): ImageIdentityResolution {
  const unresolved = (reasonCode: SandboxReasonCode): ImageIdentityResolution => ({ ok: false, identity: null, reasonCode });
  if (typeof inspectStdout !== "string" || inspectStdout.trim().length === 0) return unresolved("sandbox-image-unavailable");

  let parsed: unknown;
  try {
    parsed = JSON.parse(inspectStdout.trim());
  } catch {
    return unresolved("sandbox-image-unavailable");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return unresolved("sandbox-image-unavailable");
  const entry = parsed[0] as { readonly Id?: unknown; readonly RepoDigests?: unknown };
  if (typeof entry !== "object" || entry === null) return unresolved("sandbox-image-unavailable");

  // The local image ID is MANDATORY. No image is accepted without one, because
  // it is the only value this backend can both compare and run.
  if (typeof entry.Id !== "string" || !IMAGE_DIGEST_PATTERN.test(entry.Id)) return unresolved("sandbox-image-unavailable");

  // Optional registry provenance, kept WHOLE. Only a digest naming this
  // repository is retained — one belonging to some other repo says nothing
  // about this image — and it is stored exactly as the runtime reported it,
  // repository included, so it can never be mistaken for a runnable reference.
  let repoDigest: string | null = null;
  if (Array.isArray(entry.RepoDigests)) {
    for (const candidate of entry.RepoDigests) {
      if (typeof candidate !== "string") continue;
      const at = candidate.indexOf("@");
      if (at <= 0) continue;
      if (candidate.slice(0, at) !== IMAGE_REPOSITORY) continue;
      if (!IMAGE_DIGEST_PATTERN.test(candidate.slice(at + 1))) continue;
      repoDigest = candidate;
      break;
    }
  }

  return { ok: true, identity: { localImageId: entry.Id, repoDigest }, reasonCode: "ok" };
}

/**
 * Do two resolved identities name the same immutable CONTENT?
 *
 * `localImageId` ALONE decides, and that is the security-correct rule in both
 * directions:
 *
 *   Different content can never compare equal. The image ID is the digest of
 *   the config, which names every layer; different content yields a different
 *   ID. There is no way to change what the image contains and keep the ID.
 *
 *   Provenance alone must never masquerade as a content change. A push of the
 *   identical image populates `RepoDigests` without altering a single byte of
 *   it. Comparing that field too would report a content change where none
 *   happened, and a freshness check that cries wolf is one that gets relaxed.
 */
export function sameImageIdentity(a: ResolvedImageIdentity | null, b: ResolvedImageIdentity | null): boolean {
  if (a === null || b === null) return false;
  return a.localImageId === b.localImageId;
}

/**
 * Whether a cached VERIFIED capability report may still be reported (S-15).
 *
 * The freshness gate for every PUBLIC capability query, and deliberately pure:
 * it decides using only the cached report, the identity that report was about,
 * and the identity resolved right now.
 *
 * The one property that matters is structural, not behavioural: the only report
 * this function can ever hand back is the `cached` object it was given. There
 * is no branch that builds a report, so a freshness check can INVALIDATE stale
 * verification but can never CREATE verification for an image whose isolation
 * was never proven. Detection remains incapable of verifying, which is the rule
 * this whole module exists to hold.
 *
 * `resolveCurrent` is a thunk because resolving costs a subprocess. It is
 * called only when there is a verified claim that could actually be stale, so
 * an unverified backend performs no inspect at all.
 */
export interface VerificationFreshness {
  /** `cached` when it may still stand, `null` when the caller must re-detect. */
  readonly report: SandboxCapabilityReport | null;
  /** True when the stale claim must be dropped from backend state. */
  readonly invalidate: boolean;
}

export function freshVerificationReport(cached: SandboxCapabilityReport | null, verifiedIdentity: ResolvedImageIdentity | null, resolveCurrent: () => ImageIdentityResolution): VerificationFreshness {
  // Nothing verified is cached: there is nothing to return and nothing to drop,
  // and no reason to spend a subprocess finding that out.
  if (cached === null || cached.capabilityState !== "available-and-verified") return { report: null, invalidate: false };

  // A verified claim that does not name the image it was about is unprovable by
  // construction. S-15 requires the two to move together, so an unpaired claim
  // is treated as corrupt state and dropped rather than trusted.
  if (verifiedIdentity === null) return { report: null, invalidate: true };

  const current = resolveCurrent();
  // The approved reference no longer resolves at all — the image was removed,
  // the runtime is gone, or the inspect was malformed. Absence is not proof of
  // sameness, so the claim cannot stand.
  if (!current.ok) return { report: null, invalidate: true };
  if (!sameImageIdentity(current.identity, verifiedIdentity)) return { report: null, invalidate: true };

  return { report: cached, invalidate: false };
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
  /**
   * S-15: the resolved LOCAL IMAGE ID (`sha256:<64 hex>`) this run must use —
   * always via `imageExecutionReference()`, never a hand-picked field.
   *
   * Required, and deliberately not defaulted to `approvedImageReference()`: a
   * default would let a caller that never resolved an identity silently run the
   * mutable tag again, which is the whole defect. Every caller states which
   * exact image content it proved.
   */
  readonly imageRef: string;
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

  // S-15: never pull. The approved image is built locally and inspected; a
  // silent pull could substitute entirely different content for the same name.
  // Stated explicitly even though running by immutable id already makes a pull
  // impossible — a reader should not have to infer the absence of a fetch.
  args.push("--pull", "never");

  // S-15: the IMMUTABLE local image ID, never `approvedImageReference()`.
  //
  // This line used to push the tag, which meant the daemon re-resolved the name
  // at run time — so isolation could be proven against one image and the work
  // then run against whatever the tag pointed at moments later. Passing the
  // image ID closes that window structurally rather than merely detecting it
  // afterwards: a `sha256:…` ID cannot be repointed, and it is precisely the
  // identity form the locally built CI image actually has.
  args.push(spec.imageRef);
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

/** The probe timeout used when the trusted construction site states none. */
export const DEFAULT_PROBE_TIMEOUT_MS = 120000;

/** Bound on EACH host-side helper spawn (image inspect, remove, re-inspect). */
export const PROBE_HELPER_TIMEOUT_MS = 30000;

/**
 * The signal every host-side spawn in this backend is killed with on timeout.
 *
 * S-14: this is `SIGKILL`, not the `SIGTERM` default, and the difference is
 * what makes the timeout mean anything. `spawnSync` sends `killSignal` when the
 * timeout expires and then KEEPS WAITING for the child to exit; Node escalates
 * to SIGKILL only if the first kill call itself errors, not if the signal is
 * delivered and ignored. A `docker` CLI that traps SIGTERM could therefore hold
 * the caller past its own timeout indefinitely, which is exactly the silence
 * S-14 removes.
 *
 * SIGKILL cannot be caught, blocked, or ignored on POSIX. On Windows libuv
 * routes every signal to `TerminateProcess`, which is equally unconditional
 * (measured: a child with SIGTERM/SIGINT/SIGHUP handlers still died at the
 * bound). So termination of the DIRECT child no longer depends on that child
 * cooperating.
 *
 * What this does NOT establish: an absolute elapsed-time ceiling. Delivery and
 * reaping are the kernel's, not this module's — an uninterruptible-sleep child,
 * a stalled filesystem, or a descheduled process can still add real time that
 * nothing here owns or measures. The claim is about the TERMINATION REQUEST
 * being unrefusable, not about the clock.
 */
export const PROBE_KILL_SIGNAL = "SIGKILL" as const;

/**
 * The cumulative CONFIGURED subprocess timeout budget for one
 * `verifyIsolation()`: probe + image inspect + remove + re-inspect.
 *
 * Deliberately named as a configured budget rather than a wall-clock ceiling.
 * It is the sum of the timeouts this module sets, and it is meaningful because
 * every one of those spawns is bounded and killed uncatchably — no step waits
 * forever on a child's cooperation. It is NOT a proof of maximum elapsed real
 * time: this code owns the timers it configures, not the OS scheduling and
 * process-reaping boundary underneath them.
 */
export function configuredTimeoutBudgetMs(probeTimeoutMs: number): number {
  return probeTimeoutMs + PROBE_HELPER_TIMEOUT_MS * 3;
}

/**
 * The outcome of proving the probe's bound — `ok` with a usable timeout, or a
 * refusal that names WHICH kind of fault the configured value is. Mirrors the
 * `IdentityResolution` / `NetworkModeResolution` shape already used here.
 */
export type ProbeTimeoutResolution =
  | { readonly ok: true; readonly timeoutMs: number; readonly reasonCode: "ok" }
  | { readonly ok: false; readonly timeoutMs: null; readonly reasonCode: Extract<SandboxReasonCode, "sandbox-limits-missing" | "sandbox-limits-invalid"> };

/**
 * Resolve the isolation probe's timeout, or `null` when it cannot be bounded
 * (S-14).
 *
 * `spawnSync`'s `timeout` is not merely advisory, and two of its edge cases are
 * silent in opposite directions — both verified against this Node runtime
 * rather than assumed:
 *
 *   timeout: 0        NO timer is armed. The probe waits for the container
 *                     FOREVER. Measured: a 1500 ms child ran to completion with
 *                     no error and no signal. `?? DEFAULT` never caught this,
 *                     because 0 is not nullish — so a single misconfigured
 *                     field turned the one bounded step that proves isolation
 *                     into an unbounded one.
 *   -1 / NaN /        `spawnSync` THROWS ERR_OUT_OF_RANGE. `verifyIsolation()`
 *   Infinity / 1.5    is contractually total — it returns a capability report —
 *                     and its caller `composeVerificationSandbox` has no catch,
 *                     so the throw would escape the composition root as a crash
 *                     instead of the honest "isolation could not be proven".
 *
 * Both are the same failure: a probe whose bound cannot be established. So the
 * bound is proven HERE, before any container exists, and an unprovable one
 * fails closed. `sandbox-limits-missing` is the existing canonical code for
 * exactly this — the limits that would make execution bounded are absent — so
 * no new vocabulary is introduced.
 */
export function resolveProbeTimeoutMs(configured: number | undefined): ProbeTimeoutResolution {
  if (configured === undefined) return { ok: true, timeoutMs: DEFAULT_PROBE_TIMEOUT_MS, reasonCode: "ok" };
  // Absent-or-zero is "no bound was set" — the same meaning `sandbox-limits-missing`
  // already carries for a zero limit elsewhere in the gate.
  if (typeof configured !== "number" || configured === 0) return { ok: false, timeoutMs: null, reasonCode: "sandbox-limits-missing" };
  // Set, but unusable: negative, NaN, Infinity, or fractional. Calling any of
  // these "missing" would misdescribe a field that is plainly present.
  if (!Number.isFinite(configured) || configured < 0 || !Number.isInteger(configured)) return { ok: false, timeoutMs: null, reasonCode: "sandbox-limits-invalid" };
  return { ok: true, timeoutMs: configured, reasonCode: "ok" };
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
/**
 * Roots that must never supply the container RUNTIME EXECUTABLE (§38).
 *
 * Every entry comes from trusted construction: `authorizedMountRoots` is where
 * untrusted workspaces are allowed to live, and `trustedBuildRoot` (defaulting
 * to the process working directory) is where generated and mounted build
 * artefacts sit. An executable found inside either is refused, because the
 * territory a workspace is mounted from is exactly the territory an attacker
 * can write into.
 *
 * Nothing here reads a permit, policy, mission or provider value. That is the
 * whole point: S-3 established that a caller who supplies both the path and the
 * authority for that path has authorized itself, and the same rule applies to
 * choosing which directories are considered untrusted.
 */
export function untrustedExecutableRoots(options: ContainerBackendOptions): readonly string[] {
  const roots = [...(options.authorizedMountRoots ?? [])];
  if (options.trustedBuildRoot) roots.push(options.trustedBuildRoot);
  return roots;
}

export function probeMountRoots(options: ContainerBackendOptions): readonly string[] {
  return [options.trustedBuildRoot ?? process.cwd()];
}

export class DockerContainerSandboxBackend implements ContainerSandboxBackend {
  readonly backendId: string;
  readonly isReal = true;
  readonly runtimeExecutableId: Extract<TrustedExecutableId, "docker" | "podman">;
  private lastVerification: SandboxCapabilityReport | null = null;
  /** S-15: the exact immutable image isolation was proven against. */
  private verifiedImageIdentity: ResolvedImageIdentity | null = null;

  /**
   * S-15: safe, immutable provenance for whatever is currently verified.
   *
   * `null` until an isolation proof succeeds, and `null` again the moment that
   * proof is invalidated. A content address is not a secret — it names public
   * content and carries no path, credential, or command.
   */
  get verifiedImage(): ResolvedImageIdentity | null {
    return this.verifiedImageIdentity;
  }

  /**
   * Drop verification evidence that can no longer be true.
   *
   * Both fields move together on purpose: leaving `lastVerification` set while
   * the identity it was about is gone would recreate the exact defect S-15
   * closes, one layer down.
   */
  private invalidateVerification(): void {
    this.lastVerification = null;
    this.verifiedImageIdentity = null;
  }
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
   * DETECTION ONLY. Returns at most `available-unverified`, and returns a
   * previously verified report ONLY while that report is still FRESH (S-15).
   *
   * The freshness check is why this is not a plain cache read. `verifyIsolation`
   * proves a property of one image; the approved reference is a mutable tag, so
   * the tag can be retargeted immediately afterwards. Until this check existed,
   * any caller asking `detectCapability()` — without ever calling `execute()` —
   * was handed `available-and-verified` for content that was no longer there.
   * Re-checking only inside `execute()` closed the execution path and left the
   * QUERY path answering with evidence about a different image.
   *
   * The distinction that must not blur: this may INVALIDATE verification, and
   * can never CREATE it. `freshVerificationReport` can only ever return the
   * cached object, and the fallback is `detectContainerRuntime()`, whose two
   * possible states are `available-unverified` and `unavailable`. There is no
   * path here that produces `available-and-verified`.
   */
  detectCapability(): SandboxCapabilityReport {
    const freshness = freshVerificationReport(this.lastVerification, this.verifiedImageIdentity, () => this.currentImageIdentity());
    if (freshness.invalidate) this.invalidateVerification();
    if (freshness.report !== null) return freshness.report;
    return detectContainerRuntime();
  }

  /**
   * Resolve the approved reference's identity RIGHT NOW, resolving the trusted
   * runtime first.
   *
   * Used by the freshness gate, which runs outside `verifyIsolation()` and so
   * has no already-resolved runtime to borrow. An unresolvable or unauthorized
   * runtime is reported as an unresolved identity rather than throwing: the
   * caller's question is "is the verified image still there?", and "the runtime
   * is gone" is a truthful no.
   */
  private currentImageIdentity(): ImageIdentityResolution {
    const resolved = resolveTrustedExecutable(this.runtimeExecutableId, { workspaceRoots: untrustedExecutableRoots(this.options) });
    if (!resolved.ok || !resolved.value.executionAuthorized) return { ok: false, identity: null, reasonCode: "sandbox-runtime-unavailable" };
    return this.resolveImageIdentity(resolved.value.command);
  }

  /**
   * Resolve the approved reference to its IMMUTABLE identity, right now (S-15).
   *
   * This replaces a check that asked only "did inspect exit 0?" and threw the
   * output away — so the one command that could have said WHICH image was
   * present reported merely that something was. Nothing pulls: `image inspect`
   * is a purely local query, and a missing image is a refusal rather than a
   * fetch.
   */
  private resolveImageIdentity(runtimeCommand: string): ImageIdentityResolution {
    const out = spawnSync(runtimeCommand, ["image", "inspect", approvedImageReference()], { shell: false, encoding: "utf8", timeout: PROBE_HELPER_TIMEOUT_MS, killSignal: PROBE_KILL_SIGNAL, maxBuffer: 1024 * 1024, windowsHide: true });
    if (out.status !== 0) return { ok: false, identity: null, reasonCode: "sandbox-image-unavailable" };
    return parseImageIdentity(typeof out.stdout === "string" ? out.stdout : "");
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

    // S-14: prove the probe's bound FIRST — before the runtime is resolved and
    // long before a container exists. A probe that cannot be bounded must not
    // be started at all: starting it and discovering the problem later is the
    // very hang this check removes, and there would then be a live container to
    // clean up as well.
    const probeTimeout = resolveProbeTimeoutMs(this.options.verifyTimeoutMs);
    if (!probeTimeout.ok) return unverified(probeTimeout.reasonCode, "probe timeout is not a usable bound");
    const probeTimeoutMs = probeTimeout.timeoutMs;

    // §38: the runtime executable is resolved against the TRUSTED HOST CONTEXT
    // this backend was constructed with, never with an empty one. Before S-9
    // this read `resolveTrustedExecutable(this.runtimeExecutableId, {})`, so a
    // `docker` planted inside an authorized mount root — territory that exists
    // precisely to hold untrusted workspaces — was eligible to be executed.
    // The roots come from construction (`authorizedMountRoots`,
    // `trustedBuildRoot`), NOT from a permit, policy, mission or provider: a
    // caller who supplies its own exclusion list has excluded nothing.
    const resolved = resolveTrustedExecutable(this.runtimeExecutableId, { workspaceRoots: untrustedExecutableRoots(this.options) });
    if (!resolved.ok) return unverified("sandbox-runtime-unavailable", "runtime not resolvable");
    // §38: DISCOVERED is not AUTHORIZED. Where the platform cannot prove
    // ownership and no trusted identity pin is configured, the runtime is
    // resolvable but must not be executed.
    if (!resolved.value.executionAuthorized) return unverified("sandbox-runtime-unavailable", "runtime not authorized for execution");
    const runtime = resolved.value.command;

    // TOCTOU: re-prove the runtime binary immediately before it is used.
    if (revalidateResolvedExecutable(resolved.value) !== "ok") return unverified("sandbox-runtime-unavailable", "runtime identity changed");

    // A tag that is not digest-pinned is refused when pinning is required.
    if (REQUIRE_PINNED_IMAGE && !imageIsPinned()) return unverified("sandbox-image-unpinned", "image reference is not digest-pinned");
    // S-15: resolve the approved TAG to the exact immutable content it names
    // right now. Everything below is proven about THIS identity, and the
    // container is started by it rather than by the tag.
    const imageIdentity = this.resolveImageIdentity(runtime);
    if (!imageIdentity.ok) return unverified(imageIdentity.reasonCode, "approved image identity could not be resolved locally");

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
      // S-15: start the container by the LOCAL IMAGE ID just resolved, not the
      // tag — and not a repository digest, which is not a local run reference.
      imageRef: imageExecutionReference(imageIdentity.identity),
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

    // §38: and the RUNTIME BINARY too, at the same last instruction. The
    // resolution above is followed by an image-inspect spawn before reaching
    // here, so re-proving once at resolution time would leave this spawn the
    // furthest from its check. Mounts and executable are now both re-proved
    // immediately before the container starts.
    if (revalidateResolvedExecutable(resolved.value) !== "ok") return unverified("sandbox-runtime-unavailable", "runtime identity changed before use");

    // S-14: `probeTimeoutMs` is the proven bound from the top of this method —
    // a finite positive integer, never the raw option. This is the ONE place
    // the probe's timeout is decided.
    const out = spawnSync(runtime, args, { shell: false, encoding: "utf8", timeout: probeTimeoutMs, killSignal: PROBE_KILL_SIGNAL, maxBuffer: 4 * 1024 * 1024, windowsHide: true });

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
      // S-14: a probe that produced no findings is exactly where a TIMEOUT
      // lands — and a timed-out container is the case most likely to survive
      // `--rm`. `removed` was computed above but consulted only on the success
      // path below, so "timed out, cleaned up" and "timed out, container still
      // running" reported identically. A surviving container is the more
      // urgent and more actionable fact, so it is reported; the timeout itself
      // is not lost, because `lastStartupDiagnostics` still carries the
      // `container-timeout-killed` category and is appended here as safe
      // scalars (category, exit, signal, fingerprint — never raw output).
      if (!removed) return unverified("sandbox-cleanup-incomplete", `container not removed after failed probe: ${describeStartupFailure(this.lastStartupDiagnostics)}`);
      return unverified(this.lastStartupDiagnostics.safeReasonCode, describeStartupFailure(this.lastStartupDiagnostics));
    }
    this.lastStartupDiagnostics = null;

    const verdict = classifyProbe(findings);
    if (verdict !== "ok") return unverified(verdict, "isolation property unmet");
    if (!removed) return unverified("sandbox-cleanup-incomplete", "container not removed after exit");

    // S-15: verification is EVIDENCE ABOUT ONE IMAGE. Record which one, so a
    // later execution can prove it is still that image and not merely that a
    // verification once happened.
    this.verifiedImageIdentity = imageIdentity.identity;

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
    spawnSync(runtime, ["rm", "-f", name], { shell: false, encoding: "utf8", timeout: PROBE_HELPER_TIMEOUT_MS, killSignal: PROBE_KILL_SIGNAL, maxBuffer: 65536, windowsHide: true });
    const check = spawnSync(runtime, ["inspect", name], { shell: false, encoding: "utf8", timeout: PROBE_HELPER_TIMEOUT_MS, killSignal: PROBE_KILL_SIGNAL, maxBuffer: 65536, windowsHide: true });
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

    // §38: same trusted context as verifyIsolation, for the same reason.
    const resolved = resolveTrustedExecutable(this.runtimeExecutableId, { workspaceRoots: untrustedExecutableRoots(this.options) });
    if (!resolved.ok) return blocked("sandbox-runtime-unavailable");
    if (!resolved.value.executionAuthorized) return blocked("sandbox-runtime-unavailable");

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
    // S-15: RE-RESOLVE the approved reference and require it to be the exact
    // image isolation was proven against.
    //
    // Verification proves a property of ONE image. The reference naming it is a
    // mutable tag, so between `verifyIsolation()` and here it can be rebuilt or
    // retargeted — and the old `available-and-verified` claim would still have
    // been accepted, because nothing looked. Stale evidence is not evidence:
    // this fails closed rather than running content nothing has verified.
    const currentImage = this.resolveImageIdentity(resolved.value.command);
    if (!currentImage.ok) {
      this.invalidateVerification();
      return blocked(currentImage.reasonCode);
    }
    if (!sameImageIdentity(currentImage.identity, this.verifiedImageIdentity)) {
      // The claim is not merely unusable for THIS call — it is false from now
      // on. Dropping it stops `detectCapability()` continuing to report a
      // verified state for an image that no longer exists here.
      this.invalidateVerification();
      return blocked("sandbox-image-identity-changed");
    }

    const args = buildContainerRunArgs({
      userIdentity: runIdentity.identity,
      workspaceHostPath: mounts.sources.workspace,
      sourceHostPath: mounts.sources.readOnlySource,
      probeHostPath: null,
      // The verified content address, never the tag. Same single answer to
      // "what does this run?" that verification used.
      imageRef: imageExecutionReference(currentImage.identity),
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

    // §38: and re-prove the runtime EXECUTABLE too. Mount identity was already
    // rechecked here; the binary about to be spawned was not.
    if (revalidateResolvedExecutable(resolved.value) !== "ok") return blocked("sandbox-runtime-unavailable");

    const out = spawnSync(resolved.value.command, args, { shell: false, encoding: "utf8", timeout: permit.policy.limits.timeoutMs, killSignal: PROBE_KILL_SIGNAL, maxBuffer: permit.policy.limits.maxOutputBytes + 4096, windowsHide: true });
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
