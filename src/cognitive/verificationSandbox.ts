/**
 * verificationSandbox — the trusted composition boundary that lets a
 * verification command execute THROUGH a sandbox permit (§35, Fable S-5).
 *
 * The gap this closes: `runVerificationCommand` minted a permit and threw it
 * away. It called `authorize(...)`, checked only whether authorization
 * succeeded, and then ran the command with `spawnSync` on the HOST. The gate
 * and the execution path were entirely disconnected — the permit authorized
 * nothing, because nothing ever consumed it.
 *
 * The host spawn was unreachable in practice, but only by accident: the gate
 * was hard-wired to `new SandboxPolicy(new UnavailableSandboxBackend())`, which
 * is detection-only and can never reach `available-and-verified`, so
 * authorization always failed first. That is a fail-closed coincidence, not
 * containment. The moment anyone supplied a verified backend — exactly what
 * this milestone requires — the host path would have gone live. So the host
 * spawn is removed outright rather than left one line away from executing
 * `npm test` from a generated `package.json` directly on the developer's
 * machine.
 *
 * WHO CHOOSES THE BACKEND. Not the caller of a verification command, and never
 * mission or provider text. A trusted composition root builds the backend, has
 * it prove its own isolation, and injects the result. A caller that cannot be
 * given a verified executor passes `null` and verification fails closed — there
 * is no implicit host backend to fall back to.
 *
 * No fs, no child_process, no network in this module.
 */

import { isAbsolute, resolve } from "path";
import { DockerContainerSandboxBackend } from "./containerSandboxBackend";
import { pathIsInside } from "./safeWorkspacePath";
import { DEFAULT_SANDBOX_POLICY, SandboxPolicy, type SandboxAuthorization, type SandboxExecutionPermit, type SandboxExecutionReceipt, type SandboxExecutionRequest, type SandboxPolicySpec } from "./sandboxPolicy";

/**
 * The narrow dependency a verification command needs: authorize, then execute
 * the permit that authorization returned.
 *
 * `SandboxPolicy` satisfies this structurally, so production injects a real
 * policy and tests inject a deterministic fake. Nothing here can construct a
 * backend from a string, and there is deliberately no "default" implementation:
 * an absent executor is an absent capability, not a reason to use the host.
 */
export interface VerificationSandboxExecutor {
  authorize(request: SandboxExecutionRequest): SandboxAuthorization;
  execute(permit: SandboxExecutionPermit): SandboxExecutionReceipt;
}

/**
 * Build the policy for ONE verification command.
 *
 * Two fields matter and both were wrong-by-default before:
 *
 *  - `workspaceMountPath` is a HOST bind-mount source as far as the container
 *    backend is concerned (§31). `DEFAULT_SANDBOX_POLICY` ships the literal
 *    "/workspace", which is a CONTAINER path — reusing it would ask the backend
 *    to mount a host directory that does not exist. The real, already-trusted
 *    workspace directory is bound in instead, and it still has to survive S-1's
 *    canonical mount-source validation against roots the BACKEND was
 *    constructed with. This function grants no authorization; it only states
 *    which directory the command is about.
 *
 *  - `network.policy` stays "denied". S-2 established that this backend can
 *    genuinely enforce exactly one network mode, and a verification command has
 *    no business reaching the network. Anything wider would be refused by the
 *    gate anyway, and silently requesting it would be a lie in the receipt.
 */
export function buildVerificationSandboxPolicy(workspaceHostPath: string): SandboxPolicySpec {
  return {
    ...DEFAULT_SANDBOX_POLICY,
    mounts: {
      ...DEFAULT_SANDBOX_POLICY.mounts,
      // The REAL host workspace, not the container-side "/workspace" default.
      workspaceMountPath: workspaceHostPath,
      workspaceWritable: true,
      readOnlySourceMount: null,
      hostMounts: [],
      mountDockerSocket: false,
      mountCredentials: false,
    },
    network: { policy: "denied", allowlist: [] },
    inheritEnvironmentSecrets: false,
  };
}

export interface VerificationSandboxConfig {
  /** The real host workspace the command runs against. Created by a trusted driver. */
  readonly workspaceHostPath: string;
  /**
   * Roots inside which a verification workspace may live — a SEPARATE trusted
   * configuration authority from the workspace itself.
   *
   * This distinction is the whole point. Passing the requested workspace as its
   * own root would make containment vacuous: `X inside X` holds for every X, so
   * it would prove containment and authorize nothing. The roots describe where
   * verification workspaces are ALLOWED to be (e.g. the `workspaces/` base
   * directory the deployment owns); the workspace says which one this run uses.
   * Two authorities, and the requester supplies only the second.
   */
  readonly authorizedMountRoots: readonly string[];
  /**
   * Scratch directory the backend uses to PROVE isolation before anything runs.
   * Supplied by the composition root; `null` means isolation cannot be proven
   * here, so no executor is produced.
   */
  readonly probeWorkspaceHostPath: string | null;
  /** Root for the compiled probe mount. Defaults to the process working directory. */
  readonly trustedBuildRoot?: string;
}

/**
 * Is `workspaceHostPath` authorized by a SEPARATELY configured root?
 *
 * Pure and exported so the two-authority rule is observable on its own, without
 * a container runtime. Folding it into `composeVerificationSandbox` alone would
 * make it untestable here: that function also returns `null` when Docker is
 * absent, so a host without Docker would "pass" a self-authorization test for
 * entirely the wrong reason.
 *
 * The rule: the workspace must be strictly INSIDE a configured root, never
 * equal to one. Equality is the collapse this guards against — `X inside X`
 * holds for every X, so a caller supplying both values would prove containment
 * and authorize nothing.
 */
export function workspaceAuthorizedByConfiguredRoots(workspaceHostPath: string, authorizedMountRoots: readonly string[]): boolean {
  if (typeof workspaceHostPath !== "string" || workspaceHostPath.length === 0) return false;
  const roots = authorizedMountRoots.filter((r) => typeof r === "string" && r.length > 0 && isAbsolute(r));
  if (roots.length === 0) return false;
  const workspaceReal = resolve(workspaceHostPath);
  return roots.some((root) => {
    const realRoot = resolve(root);
    return workspaceReal !== realRoot && pathIsInside(realRoot, workspaceReal);
  });
}

/**
 * ONE trusted lifecycle: construct the backend, make it prove its own
 * isolation, and only then wrap it in a policy.
 *
 * Returns `null` — never a permissive stand-in — when isolation cannot be
 * proven. Callers must treat `null` as "verification is unavailable", which is
 * the honest outcome on a host with no container runtime. A backend is never
 * constructed per verification call; the composition root builds one and reuses
 * it.
 *
 * `authorizedMountRoots` comes from trusted CONFIGURATION and is deliberately
 * not derived from the workspace — never from a permit, a spec, or mission text
 * (§31). The workspace must lie inside a configured root; a workspace that is
 * merely equal to whatever root accompanied it authorizes nothing.
 */
export function composeVerificationSandbox(config: VerificationSandboxConfig): VerificationSandboxExecutor | null {
  if (typeof config.workspaceHostPath !== "string" || config.workspaceHostPath.length === 0) return null;
  // Isolation must be PROVEN, and proving it needs a scratch workspace the
  // probe can write to. Without one there is nothing to verify against, so no
  // executor exists.
  if (typeof config.probeWorkspaceHostPath !== "string" || config.probeWorkspaceHostPath.length === 0) return null;

  // The requested workspace must be CONTAINED by a separately configured root,
  // and must not simply be one. Without this the two authorities collapse into
  // the caller's single value and the containment check proves nothing.
  if (!workspaceAuthorizedByConfiguredRoots(config.workspaceHostPath, config.authorizedMountRoots)) return null;
  const roots = config.authorizedMountRoots.filter((r) => typeof r === "string" && r.length > 0 && isAbsolute(r));

  const backend = new DockerContainerSandboxBackend({
    probeWorkspaceHostPath: config.probeWorkspaceHostPath,
    trustedBuildRoot: config.trustedBuildRoot,
    // The CONFIGURED roots, plus the scratch workspace this composer created
    // for the isolation probe. The requested workspace is never a root.
    authorizedMountRoots: [...roots, config.probeWorkspaceHostPath],
  });

  const report = backend.verifyIsolation();
  if (report.capabilityState !== "available-and-verified" || !report.verified) return null;

  return new SandboxPolicy(backend);
}
