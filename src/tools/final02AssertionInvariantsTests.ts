import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ZeroTrustMergeForge, FakeMergeVerificationDriver } from "../twin/mergeForge";
import { buildExecutionPlan } from "../twin/final02/executionPlanBuilder";
import type { FrozenArtifactReceipt } from "../twin/final02/contracts";

describe("FINAL-02 Hard Invariants Assertion Tests", () => {
  it("legacy receiveComponents throws LEGACY_MERGE_FORGE_DISABLED immediately", () => {
    const driver = new FakeMergeVerificationDriver();
    const forge = new ZeroTrustMergeForge("m-test", driver);
    assert.throws(
      () => forge.receiveComponents([] as any),
      (err: any) => err.message === "LEGACY_MERGE_FORGE_DISABLED"
    );
  });

  it("buildExecutionPlan throws BLOCKED / MISSING_AUTHORITATIVE_FILE_OPERATION if operation is missing", () => {
    const mockProvenance: FrozenArtifactReceipt = {
      component: {
        componentId: "cmp-1",
        sourceColony: "claude-forge",
        sourceArtifactId: "a1",
        sourceFingerprint: "fp1",
        relativePath: "src/index.ts",
        // operation explicitly omitted
      } as any,
      sourceColony: "claude-forge",
      sourceArtifactId: "a1",
      relativePath: "src/index.ts",
      exactContent: "console.log('hi');",
      fnvFingerprint: "fp1",
      sha256Digest: "sha1",
      frozenBundleVersion: 2,
      verified: true,
    };

    assert.throws(
      () =>
        buildExecutionPlan(
          "MERGE_APPROVED_COMPONENTS",
          [mockProvenance.component],
          [],
          [mockProvenance],
          [],
          "m-test",
          "baseline-sha",
          "baseline-digest",
          []
        ),
      (err: any) => err.message.includes("BLOCKED / MISSING_AUTHORITATIVE_FILE_OPERATION")
    );
  });

  it("buildExecutionPlan throws error when MODIFY/DELETE/RENAME operation lacks expectedBaselineSha256", () => {
    const mockProvenance: FrozenArtifactReceipt = {
      component: {
        componentId: "cmp-1",
        sourceColony: "claude-forge",
        sourceArtifactId: "a1",
        sourceFingerprint: "fp1",
        relativePath: "src/index.ts",
        operation: {
          kind: "MODIFY",
          targetRelativePath: "src/index.ts",
          sourceArtifactSha256: "sha2",
          // expectedBaselineSha256 omitted
        },
      } as any,
      sourceColony: "claude-forge",
      sourceArtifactId: "a1",
      relativePath: "src/index.ts",
      exactContent: "console.log('hi');",
      fnvFingerprint: "fp1",
      sha256Digest: "sha1",
      frozenBundleVersion: 2,
      verified: true,
    };

    assert.throws(
      () =>
        buildExecutionPlan(
          "MERGE_APPROVED_COMPONENTS",
          [mockProvenance.component],
          [],
          [mockProvenance],
          [],
          "m-test",
          "baseline-sha",
          "baseline-digest",
          []
        ),
      (err: any) => err.message.includes("BLOCKED / MISSING_AUTHORITATIVE_FILE_OPERATION")
    );
  });
});
