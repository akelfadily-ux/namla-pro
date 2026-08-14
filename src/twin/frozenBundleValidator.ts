/**
 * frozenBundleValidator — validates that a frozen SolutionBundle is complete and
 * immutable, and provides the ONLY sanctioned way to "change" a frozen bundle:
 * an amendment that produces a NEW amendment receipt while leaving the original
 * frozen bundle and its digest untouched.
 *
 * No fs, no child_process, no network, no wall clock.
 */

import { bundleCanonicalProjection, fnv1a } from "./twinColonyTypes";
import type { ColonyEvidenceBundle } from "./twinColonyTypes";

export interface FrozenBundleValidation {
  readonly valid: boolean;
  readonly issues: readonly string[];
  readonly fingerprintMatches: boolean;
  readonly frozen: boolean;
  readonly deepFrozen: boolean;
}

/** Validate a frozen bundle: complete sections + recomputed fingerprint + deep freeze. */
export function validateFrozenBundle(bundle: ColonyEvidenceBundle): FrozenBundleValidation {
  const issues: string[] = [];
  if (!bundle.frozen) issues.push("not-frozen");
  if (bundle.artifacts.length === 0) issues.push("no-artifacts");
  if (bundle.artifactManifest.length !== bundle.artifacts.length) issues.push("manifest-artifact-mismatch");
  if (bundle.reviews.length === 0) issues.push("no-independent-review");
  if (bundle.reviews.some((r) => r.selfReview)) issues.push("self-review-present");
  if (bundle.testEvidence.artifactCount !== bundle.artifacts.length) issues.push("test-evidence-mismatch");
  if (!bundle.securityEvidence) issues.push("no-security-evidence");
  if (bundle.performanceEvidence.length === 0) issues.push("no-performance-evidence");
  if (bundle.riskRegister.length === 0) issues.push("no-risk-register");
  if (bundle.uncertaintyRegister.length === 0) issues.push("no-uncertainty-register");
  if (bundle.reproductionInstructions.length === 0) issues.push("no-reproduction-instructions");
  if (bundle.costReport.realProviderCalls !== 0) issues.push("unexpected-real-provider-call");

  const recomputed = fnv1a(bundleCanonicalProjection(bundle));
  const fingerprintMatches = recomputed === bundle.fingerprint;
  if (!fingerprintMatches) issues.push("fingerprint-mismatch");
  const deepFrozen = Object.isFrozen(bundle) && Object.isFrozen(bundle.artifacts) && Object.isFrozen(bundle.artifactManifest);
  if (!deepFrozen) issues.push("not-deep-frozen");

  return { valid: issues.length === 0, issues, fingerprintMatches, frozen: bundle.frozen, deepFrozen };
}

/** True iff the bundle's stored digest still matches its content (no silent change). */
export function verifyBundleImmutable(bundle: ColonyEvidenceBundle): boolean {
  return Object.isFrozen(bundle) && fnv1a(bundleCanonicalProjection(bundle)) === bundle.fingerprint;
}

export interface BundleAmendmentReceipt {
  readonly amendmentId: string;
  readonly baseColonyId: string;
  readonly baseFingerprint: string;
  readonly reason: string;
  readonly addedNote: string;
  readonly amendmentFingerprint: string;
  /** Always true — the original frozen bundle is never mutated by an amendment. */
  readonly originalUnchanged: boolean;
}

/**
 * Create an amendment to a frozen bundle. The original is NOT mutated; a separate
 * receipt records the intended change with its own fingerprint and a back-link to
 * the base digest. Callers must treat the base bundle as immutable evidence.
 */
export function amendFrozenBundle(bundle: ColonyEvidenceBundle, reason: string, addedNote: string): BundleAmendmentReceipt {
  const before = bundle.fingerprint;
  const amendmentFingerprint = fnv1a(`${before}|amend|${reason}|${addedNote}`);
  // Verify the base bundle's digest is unchanged after producing the amendment.
  const originalUnchanged = Object.isFrozen(bundle) && fnv1a(bundleCanonicalProjection(bundle)) === before;
  return { amendmentId: `amend-${amendmentFingerprint}`, baseColonyId: bundle.colonyId, baseFingerprint: before, reason, addedNote, amendmentFingerprint, originalUnchanged };
}
