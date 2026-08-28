/**
 * src/twin/final02/frozenArtifactResolver.ts — Frozen evidence artifact resolver for FINAL-02.
 *
 * Resolves exact immutable artifact bytes ONLY from authoritative FINAL-01 frozen bundles.
 * Fails closed on missing evidence, unfrozen bundles, or fingerprint mismatches.
 * NO working-tree fallbacks, NO synthesized source code, NO placeholder comments.
 */

import { createHash } from "node:crypto";
import type { ApprovedMergeComponent } from "../namolaSovereignCourt";
import type { ColonyEvidenceBundle } from "../twinColonyTypes";
import { fnv1a } from "../twinColonyTypes";
import { validateColonyRelPath } from "../colonyWorkspace";
import type { FrozenArtifactReceipt } from "./contracts";

export function computeSha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export type FrozenArtifactResolveResult =
  | { readonly ok: true; readonly receipt: FrozenArtifactReceipt }
  | { readonly ok: false; readonly reasonCode: string; readonly componentId: string };

/**
 * Resolves an ApprovedMergeComponent to its exact immutable frozen artifact bytes.
 */
export function resolveFrozenArtifact(
  component: ApprovedMergeComponent,
  claudeBundle: ColonyEvidenceBundle | null,
  codexBundle: ColonyEvidenceBundle | null
): FrozenArtifactResolveResult {
  const componentId = component.componentId;

  // 1. Validate relative path safety
  if (validateColonyRelPath(component.relativePath) !== "ok") {
    return { ok: false, reasonCode: "invalid-path-traversal", componentId };
  }

  // 2. Locate target frozen evidence bundle
  const bundle = component.sourceColony === "claude-forge"
    ? claudeBundle
    : component.sourceColony === "codex-crucible"
    ? codexBundle
    : null;

  if (!bundle) {
    return { ok: false, reasonCode: "missing-source-colony-bundle", componentId };
  }

  if (!bundle.frozen) {
    return { ok: false, reasonCode: "source-bundle-not-frozen", componentId };
  }

  if (bundle.evidenceVersion !== 2) {
    return { ok: false, reasonCode: "unsupported-evidence-version", componentId };
  }

  // 3. Locate exact artifact proposal
  const artifact = bundle.artifacts.find(
    (a) => a.relativePath === component.relativePath || a.relativePath === component.sourceArtifactId
  );

  if (!artifact) {
    return { ok: false, reasonCode: "artifact-not-found-in-frozen-bundle", componentId };
  }

  // 4. Recompute fingerprints and verify against sourceFingerprint
  const computedFnv = fnv1a(`${artifact.relativePath}|${artifact.content}`);
  const computedSha256 = computeSha256(artifact.content);

  if (computedFnv !== component.sourceFingerprint) {
    return { ok: false, reasonCode: "artifact-fingerprint-mismatch", componentId };
  }

  const receipt: FrozenArtifactReceipt = Object.freeze({
    component,
    sourceColony: component.sourceColony,
    sourceArtifactId: component.sourceArtifactId,
    relativePath: component.relativePath,
    exactContent: artifact.content,
    fnvFingerprint: computedFnv,
    sha256Digest: computedSha256,
    frozenBundleVersion: 2,
    verified: true,
  });

  return { ok: true, receipt };
}
