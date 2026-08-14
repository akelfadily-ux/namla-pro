/**
 * createTargetBinding — the ONE place a physical create target is derived
 * (§33, Fable S-3: approved target vs written target divergence).
 *
 * The gap this closes: `CreateProjectFileInput` carried a free-form
 * `driverTargetPath: string` that went straight to
 * `driver.openExclusive(...)`. Every other target value in the capability was
 * checked — the descriptor's normalized relative path passed the C2 structural
 * policy, the proposal/descriptor/grant triple passed the C0 approval contract,
 * and the injected inspection gated the filesystem boundary — but the string
 * that actually decided WHICH FILE GETS CREATED was bound to none of them. A
 * caller could have an approval reviewed and granted for path A and open path
 * B, and every receipt would faithfully record path A.
 *
 * A second, quieter divergence sat next to it: nothing ever compared
 * `targetInspection.normalizedRelativePathFingerprint` against the descriptor's
 * path. The inspection was trusted for its boundary FINDINGS while never being
 * proven to be an inspection OF THE TARGET IN HAND, so a clean inspection of an
 * innocuous path could admit a write to a different one.
 *
 * So the physical target is no longer an input at all. It is DERIVED here from
 * two things the capability already trusts:
 *
 *   - an `InspectionBoundProjectRoot`, minted only by `ProjectInspector` after
 *     it has confirmed the root really is an existing directory; and
 *   - `descriptor.normalizedRelativePath`, which the C2 structural policy and
 *     the C0 approval contract have already accepted.
 *
 * and it is then proven to describe the SAME path the inspection examined, by
 * recomputing the fingerprint with `fingerprint()` — the exact helper
 * `ProjectInspector.inspectCreateTarget` uses. No second algorithm.
 *
 * What this does NOT claim: the caller still chooses which project root to
 * operate on, which is inherently theirs to choose. What they can no longer do
 * is approve one path and write another.
 *
 * No fs, no child_process, no network, no wall clock. Containment reuses
 * `isInsideProjectRoot` from the existing file-boundary policy.
 */

import { isAbsolute, resolve, sep } from "path";
import { fingerprint } from "../core/redaction";
import { isInsideProjectRoot } from "../policies/fileBoundaryPolicy";
import type { CreateOperationDescriptor } from "./createCapabilityTypes";
import type { CreateTargetInspection } from "./createTargetInspectionTypes";

/**
 * A project root that a real `ProjectInspector` has confirmed is an existing
 * directory. Branded so a bare string cannot be passed as an authorization
 * root: the sole minting site is `ProjectInspector.inspectionBoundProjectRoot`.
 */
export type InspectionBoundProjectRoot = string & { readonly __inspectionBoundProjectRoot: unique symbol };

/**
 * An absolute path DERIVED inside this boundary from an inspection-bound root
 * plus an approved relative path, and proven to match the inspection. Branded
 * so the exclusive-create driver cannot be handed anything else.
 */
export type TrustedCreateTarget = string & { readonly __trustedCreateTarget: unique symbol };

/** Fixed reason vocabulary. Each names ONE way the binding could not be proven. */
export type CreateTargetBindingReason =
  | "ok"
  | "target-binding-root-untrusted"
  | "target-binding-path-empty"
  | "target-binding-path-absolute"
  | "target-binding-path-traversal"
  | "target-binding-escapes-root"
  | "target-binding-proposal-descriptor-mismatch"
  | "target-binding-fingerprint-mismatch"
  | "target-binding-inspection-unusable";

export type CreateTargetBinding =
  | { readonly ok: true; readonly target: TrustedCreateTarget; readonly pathFingerprint: string; readonly reasonCode: "ok" }
  | { readonly ok: false; readonly target: null; readonly pathFingerprint: string | null; readonly reasonCode: CreateTargetBindingReason };

export interface BindCreateTargetInput {
  readonly projectRoot: InspectionBoundProjectRoot;
  readonly descriptor: CreateOperationDescriptor;
  /** The proposal's own target, cross-checked against the descriptor. */
  readonly proposalTargetRelativePath: string;
  readonly targetInspection: CreateTargetInspection;
}

/**
 * Lexical shape of the approved relative path.
 *
 * This is intentionally strict and refuses rather than normalizes: collapsing
 * `a/../../b` into an accepted path is precisely how an approved target and a
 * written target diverge while every check still reports success.
 */
function shapeReason(relativePath: unknown): CreateTargetBindingReason {
  if (typeof relativePath !== "string" || relativePath.length === 0) return "target-binding-path-empty";
  if (relativePath.includes("\0")) return "target-binding-path-empty";
  // Absolute in any form: POSIX root, Windows drive, or UNC share.
  if (isAbsolute(relativePath) || /^[A-Za-z]:/.test(relativePath) || relativePath.startsWith("\\\\")) {
    return "target-binding-path-absolute";
  }
  if (relativePath.includes("~")) return "target-binding-path-traversal";
  for (const segment of relativePath.split(/[\\/]/)) {
    if (segment === "..") return "target-binding-path-traversal";
  }
  return "ok";
}

/**
 * Derive and prove the ONE physical target for this create attempt.
 *
 * Order matters: every check that can refuse WITHOUT touching the filesystem
 * runs here, so the caller can complete this before consuming a grant or
 * opening anything. A refusal returns `target: null`, which is what makes it
 * structurally impossible for a caller to proceed on a failed binding.
 */
export function bindCreateTarget(input: BindCreateTargetInput): CreateTargetBinding {
  const refuse = (reasonCode: CreateTargetBindingReason, pathFingerprint: string | null = null): CreateTargetBinding => ({ ok: false, target: null, pathFingerprint, reasonCode });

  const root = input.projectRoot;
  if (typeof root !== "string" || root.length === 0 || !isAbsolute(root)) return refuse("target-binding-root-untrusted");

  const relativePath = input.descriptor.normalizedRelativePath;
  const shape = shapeReason(relativePath);
  if (shape !== "ok") return refuse(shape);

  // The proposal and the descriptor must name the SAME target. They are
  // separate records that travel together; if they ever disagree, which one
  // was approved is undecidable and the only safe answer is neither.
  if (input.proposalTargetRelativePath !== relativePath) return refuse("target-binding-proposal-descriptor-mismatch");

  // The inspection must be usable at all before its findings mean anything.
  if (input.targetInspection.filesystemInspectionCompleted !== true) return refuse("target-binding-inspection-unusable");

  // THE binding: recompute the path fingerprint with the SAME helper
  // ProjectInspector used, and require it to match. This is what proves the
  // inspection in hand is an inspection OF THIS TARGET rather than of some
  // other path that happened to come back clean.
  const pathFingerprint = fingerprint(relativePath);
  if (pathFingerprint !== input.targetInspection.normalizedRelativePathFingerprint) {
    return refuse("target-binding-fingerprint-mismatch", pathFingerprint);
  }
  // Cheap corroboration that also catches a fingerprint collision forged by a
  // hand-built inspection record.
  if (input.targetInspection.normalizedRelativePathLength !== relativePath.length) {
    return refuse("target-binding-fingerprint-mismatch", pathFingerprint);
  }

  // Containment, using the existing file-boundary helper so there is one
  // implementation of "inside the project root" in the codebase.
  const absoluteTarget = resolve(root, relativePath);
  if (!isInsideProjectRoot(absoluteTarget, root)) return refuse("target-binding-escapes-root", pathFingerprint);
  // The root itself is not a create target.
  if (absoluteTarget === resolve(root)) return refuse("target-binding-escapes-root", pathFingerprint);
  // Defence in depth against a separator trick that survived `resolve`.
  if (!absoluteTarget.startsWith(resolve(root) + sep)) return refuse("target-binding-escapes-root", pathFingerprint);

  return { ok: true, target: absoluteTarget as TrustedCreateTarget, pathFingerprint, reasonCode: "ok" };
}
