/**
 * safeMountSource — the ONE authorization boundary for Docker bind-mount
 * sources (§31, Fable S-1: mount confusion).
 *
 * The gap this closes: `buildContainerRunArgs` interpolated caller-supplied
 * host paths straight into `type=bind,source=<path>,target=...`, and
 * `validateSandboxPolicySpec` checked mount FLAGS (hostMounts, socket,
 * credentials) while never looking at `workspaceMountPath` or
 * `readOnlySourceMount` at all. A bind-mount source decides which part of the
 * host filesystem the container can see and write, so accepting one because a
 * caller supplied a string is an authorization decision made by the attacker.
 *
 * Three distinct threats are closed here, and they need different mechanisms:
 *
 *  1. MOUNT-SPEC INJECTION. Docker's `--mount` value is a comma-separated list
 *     of `key=value` pairs. A source containing `,` or `=` is therefore not
 *     one field — it is parsed as ADDITIONAL mount options appended to ours.
 *     `shell: false` does not help: the injection happens inside a single argv
 *     element, below the process boundary. Such a path is refused outright.
 *
 *  2. SYMLINK / JUNCTION SUBSTITUTION. A link planted at, or above, the source
 *     redirects the mount elsewhere. Two independent defences: the source
 *     itself is `lstat`ed and refused if it is a link (this covers Windows
 *     junctions and reparse points, which libuv surfaces as symbolic links),
 *     and containment is decided on `realpath`s, so a link ANYWHERE in the
 *     chain lands the canonical path outside the authorized root and is
 *     refused there.
 *
 *  3. UNAUTHORIZED ROOTS. A syntactically perfect absolute path to `/etc` is
 *     still not mountable. The canonical source must sit inside a root the
 *     TRUSTED HOST PROCESS nominated — never a root supplied by a permit,
 *     policy, mission, or provider.
 *
 * Canonicalization is not normalization-to-acceptance: an unsafe path is never
 * rewritten into an accepted one. Validation either returns the `realpath` — a
 * `CanonicalMountSource`, the only value the argv builder's type will accept —
 * or it fails closed with a specific reason code. Reason codes are fixed
 * tokens; a host path is never returned to a caller, receipt, or diagnostic.
 *
 * No shell, no child process, no network. Containment reuses `pathIsInside`
 * from the workspace kernel so there is exactly one containment implementation.
 */

import { lstatSync, realpathSync } from "fs";
import { isAbsolute } from "path";
import { pathIsInside } from "./safeWorkspacePath";
import type { SandboxReasonCode } from "./sandboxPolicy";

/**
 * A host path PROVEN to be an authorized, canonical, existing directory.
 *
 * The brand is the enforcement: `buildContainerRunArgs` accepts only this type,
 * so a plain string cannot reach Docker's argv without an explicit, greppable
 * cast. Only `validateMountSource` mints one.
 */
export type CanonicalMountSource = string & { readonly __canonicalMountSource: unique symbol };

/**
 * What the mount is for. Roles do NOT relax any check — they exist so a caller
 * cannot accidentally authorize a probe directory against a workspace root, and
 * so refusals can be attributed. Probe mounts are validated against the trusted
 * BUILD root; workspace and source mounts against authorized workspace roots.
 */
export type MountRole = "workspace" | "readonly-source" | "probe";

export type MountSourceValidation =
  | { readonly ok: true; readonly canonicalPath: CanonicalMountSource; readonly role: MountRole; readonly reasonCode: "ok" }
  | { readonly ok: false; readonly canonicalPath: null; readonly role: MountRole; readonly reasonCode: SandboxReasonCode };

/**
 * Characters that cannot appear in a mount source because `--mount` parses its
 * value as `key=value` pairs separated by commas. Also refuses NUL and any C0
 * / DEL control character, which have no place in a legitimate directory path.
 *
 * Note what is deliberately NOT refused: spaces and hyphens are legal in real
 * host paths (`C:\Program Files\...`, `namla-sandbox-verify-abc123`), and
 * refusing them would break ordinary hosts without closing anything.
 */
// eslint-disable-next-line no-control-regex
const MOUNT_SPEC_HOSTILE = /[,=\u0000-\u001f\u007f]/;

/**
 * Lexical shape check. Deliberately does NOT refuse `~`: unlike a shell-bound
 * relative path, `~` in an ABSOLUTE path is an ordinary directory name, and
 * Windows 8.3 short names (`RUNNE~1`) legitimately contain it. There is no
 * shell anywhere in this path (`shell: false` throughout), so no expansion can
 * occur. Refusing it would break real Windows hosts for no security gain.
 */
function shapeReason(candidate: unknown): SandboxReasonCode {
  if (typeof candidate !== "string" || candidate.length === 0) return "sandbox-mount-source-invalid";
  if (MOUNT_SPEC_HOSTILE.test(candidate)) return "sandbox-mount-source-invalid";
  if (!isAbsolute(candidate)) return "sandbox-mount-source-invalid";
  // `..` is refused EXPLICITLY rather than collapsed. Silently normalizing a
  // traversal into an accepted path is precisely the "do not normalize an
  // unsafe path into an accepted one" failure mode.
  for (const segment of candidate.split(/[\\/]/)) {
    if (segment === "..") return "sandbox-mount-source-invalid";
  }
  return "ok";
}

/** Canonicalize the authorized roots. A root that cannot be proven is dropped. */
function canonicalRoots(authorizedRoots: readonly string[]): readonly string[] {
  const out: string[] = [];
  for (const root of authorizedRoots) {
    if (typeof root !== "string" || root.length === 0 || !isAbsolute(root)) continue;
    try {
      const real = realpathSync(root);
      if (lstatSync(real).isDirectory()) out.push(real);
    } catch {
      // An unprovable root authorizes nothing.
    }
  }
  return out;
}

/**
 * Validate ONE bind-mount source against the roots the trusted host process
 * authorized. Returns the canonical path to hand to Docker, or a fixed reason.
 *
 * `authorizedRoots` must come from the host process (CI entry point, backend
 * construction), NEVER from a permit, policy, mission, or provider — an
 * attacker who can choose the root has not been constrained at all. An empty
 * or wholly unprovable root list authorizes nothing and fails closed.
 */
export function validateMountSource(candidate: unknown, authorizedRoots: readonly string[], role: MountRole): MountSourceValidation {
  const refuse = (reasonCode: SandboxReasonCode): MountSourceValidation => ({ ok: false, canonicalPath: null, role, reasonCode });

  const shape = shapeReason(candidate);
  if (shape !== "ok") return refuse(shape);
  const path = candidate as string;

  const roots = canonicalRoots(authorizedRoots);
  if (roots.length === 0) return refuse("sandbox-mount-source-outside-root");

  // lstat, NOT stat: a symlinked source must be refused, not followed. This is
  // also the Windows junction / reparse-point check — libuv reports those as
  // symbolic links.
  let entry;
  try {
    entry = lstatSync(path);
  } catch {
    return refuse("sandbox-mount-source-missing");
  }
  if (entry.isSymbolicLink()) return refuse("sandbox-mount-source-symlink");
  if (!entry.isDirectory()) return refuse("sandbox-mount-source-not-directory");

  // The canonical path is what Docker will actually mount, and what containment
  // is decided on. Comparing a LEXICAL path against a real root is what lets an
  // aliased parent through, so both sides are realpaths.
  let canonical: string;
  try {
    canonical = realpathSync(path);
  } catch {
    return refuse("sandbox-mount-source-untrusted");
  }

  // A realpath can differ from the input; re-check it as a mount-spec field.
  if (MOUNT_SPEC_HOSTILE.test(canonical) || !isAbsolute(canonical)) return refuse("sandbox-mount-source-invalid");

  if (!roots.some((root) => pathIsInside(root, canonical))) return refuse("sandbox-mount-source-outside-root");

  // Confirm the canonical object is STILL a real directory and still not a
  // link. This narrows the window in which the object could be swapped between
  // the checks above and the spawn.
  try {
    const settled = lstatSync(canonical);
    if (settled.isSymbolicLink()) return refuse("sandbox-mount-source-symlink");
    if (!settled.isDirectory()) return refuse("sandbox-mount-source-not-directory");
  } catch {
    return refuse("sandbox-mount-source-untrusted");
  }

  return { ok: true, canonicalPath: canonical as CanonicalMountSource, role, reasonCode: "ok" };
}

/**
 * Re-validate immediately before spawning, and require the canonical path to be
 * UNCHANGED.
 *
 * TOCTOU honesty — this NARROWS the validation-to-spawn substitution window; it
 * does NOT eliminate TOCTOU, and nothing here should be read as claiming it
 * does. The Docker CLI accepts a path, not a file descriptor, so the object can
 * still be swapped between this final check and the daemon's own resolution.
 * Closing that residual window would require an atomic open-and-mount
 * (fd-passing) API that the CLI does not expose, so it is out of reach of this
 * architecture and is stated as a known residual risk rather than papered over.
 *
 * What it DOES close is the long window — everything between first validation
 * and the spawn — by re-proving existence, object type, link status,
 * containment in the same authorized root, and canonical identity, and failing
 * closed on any change.
 */
export function revalidateMountSource(previous: CanonicalMountSource, authorizedRoots: readonly string[], role: MountRole): MountSourceValidation {
  const again = validateMountSource(previous, authorizedRoots, role);
  if (!again.ok) return again;
  if (again.canonicalPath !== previous) return { ok: false, canonicalPath: null, role, reasonCode: "sandbox-mount-source-untrusted" };
  return again;
}

/**
 * Validate every mount source for one container run. Fails on the FIRST
 * refusal so the reason names the actual cause. `null` sources stay `null` —
 * an absent optional mount is not a validation failure.
 */
export interface MountSourceSet {
  readonly workspace: CanonicalMountSource;
  readonly readOnlySource: CanonicalMountSource | null;
  readonly probe: CanonicalMountSource | null;
}

export type MountSourceSetResult = { readonly ok: true; readonly sources: MountSourceSet; readonly reasonCode: "ok" } | { readonly ok: false; readonly sources: null; readonly reasonCode: SandboxReasonCode };

export function validateMountSourceSet(input: {
  readonly workspace: unknown;
  readonly readOnlySource?: unknown;
  readonly probe?: unknown;
  readonly workspaceRoots: readonly string[];
  readonly probeRoots: readonly string[];
}): MountSourceSetResult {
  const workspace = validateMountSource(input.workspace, input.workspaceRoots, "workspace");
  if (!workspace.ok) return { ok: false, sources: null, reasonCode: workspace.reasonCode };

  let readOnlySource: CanonicalMountSource | null = null;
  if (input.readOnlySource !== null && input.readOnlySource !== undefined) {
    const r = validateMountSource(input.readOnlySource, input.workspaceRoots, "readonly-source");
    if (!r.ok) return { ok: false, sources: null, reasonCode: r.reasonCode };
    readOnlySource = r.canonicalPath;
  }

  let probe: CanonicalMountSource | null = null;
  if (input.probe !== null && input.probe !== undefined) {
    // Probe mounts are BUILD artefacts, so they are authorized against the
    // trusted build root rather than a workspace root. They are still subject
    // to every other check without exception.
    const p = validateMountSource(input.probe, input.probeRoots, "probe");
    if (!p.ok) return { ok: false, sources: null, reasonCode: p.reasonCode };
    probe = p.canonicalPath;
  }

  return { ok: true, sources: { workspace: workspace.canonicalPath, readOnlySource, probe }, reasonCode: "ok" };
}

/** True when the path is shaped such that it could corrupt a `--mount` value. */
export function isMountSpecHostile(value: string): boolean {
  return MOUNT_SPEC_HOSTILE.test(value);
}

