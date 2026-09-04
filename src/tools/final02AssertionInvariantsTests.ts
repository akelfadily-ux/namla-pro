import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ZeroTrustMergeForge, FakeMergeVerificationDriver } from "../twin/mergeForge";
import { buildExecutionPlan } from "../twin/final02/executionPlanBuilder";
import type { FrozenArtifactReceipt } from "../twin/final02/contracts";
import type { ApprovedMergeComponent } from "../twin/namolaSovereignCourt";

describe("FINAL-02 Hard Invariants Assertion Tests", () => {
  it("legacy receiveComponents unconditionally throws LEGACY_MERGE_FORGE_DISABLED without workspace or file mutation", () => {
    const driver = new FakeMergeVerificationDriver();
    const forge = new ZeroTrustMergeForge("m-test", driver);
    assert.throws(
      () => forge.receiveComponents([]),
      (err: Error) => err.message === "LEGACY_MERGE_FORGE_DISABLED"
    );
    assert.equal(forge.fileCount, 0);
    assert.equal(forge.materialization, null);
  });

  it("buildExecutionPlan throws BLOCKED / MISSING_AUTHORITATIVE_FILE_OPERATION if operation is missing", () => {
    const mockComponent = {
      componentId: "cmp-1",
      sourceColony: "claude-forge" as const,
      sourceArtifactId: "a1",
      sourceFingerprint: "fp1",
      relativePath: "src/index.ts",
      operation: undefined as unknown as ApprovedMergeComponent["operation"],
      requirementsCovered: [],
      evidenceRefs: [],
      reasonSelected: "selected",
      knownRisks: [],
      requiredMergeTests: [],
    };

    const mockProvenance: FrozenArtifactReceipt = {
      component: mockComponent,
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
      (err: Error) => err.message.includes("BLOCKED / MISSING_AUTHORITATIVE_FILE_OPERATION")
    );
  });

  it("buildExecutionPlan throws error when MODIFY/DELETE/RENAME operation lacks expectedBaselineSha256", () => {
    const mockComponent = {
      componentId: "cmp-1",
      sourceColony: "claude-forge" as const,
      sourceArtifactId: "a1",
      sourceFingerprint: "fp1",
      relativePath: "src/index.ts",
      operation: {
        kind: "MODIFY" as const,
        targetRelativePath: "src/index.ts",
        sourceArtifactSha256: "sha2",
        expectedBaselineSha256: undefined as unknown as string,
      },
      requirementsCovered: [],
      evidenceRefs: [],
      reasonSelected: "selected",
      knownRisks: [],
      requiredMergeTests: [],
    };

    const mockProvenance: FrozenArtifactReceipt = {
      component: mockComponent,
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
      (err: Error) => err.message.includes("BLOCKED / MISSING_AUTHORITATIVE_FILE_OPERATION")
    );
  });
});
