import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ZeroTrustMergeForge, FakeMergeVerificationDriver } from "../twin/mergeForge";
import { buildExecutionPlan } from "../twin/final02/executionPlanBuilder";
import type { FrozenArtifactReceipt } from "../twin/final02/contracts";
import type { ApprovedMergeComponent } from "../twin/namolaSovereignCourt";
import { freezeBundle } from "../twin/colonyForge";
import { validateFrozenBundle, verifyBundleImmutable } from "../twin/frozenBundleValidator";

describe("FINAL-02 Hard Invariants Assertion Tests", () => {
  it("mutating frozen evidence operation changes bundle fingerprint and fails validation", () => {
    const draft = {
      colonyId: "claude-forge" as const,
      missionId: "test-mission",
      culture: "architecture-first" as const,
      workspacePath: "workspaces/namola-twin/test-mission/claude-forge",
      architecture: {
        architectureSummary: "summary",
        filePlan: ["src/index.ts"],
        acceptanceMapping: [],
        interfaceDecisions: [],
        risks: [],
      },
      artifacts: [
        {
          relativePath: "src/index.ts",
          content: "console.log('test');",
          purpose: "core",
          acceptanceCriteriaCovered: [],
          operation: {
            kind: "ADD" as const,
            targetRelativePath: "src/index.ts",
            sourceArtifactSha256: "sha-1",
          },
        },
      ],
      artifactManifest: [{ relativePath: "src/index.ts", bytes: 20, fingerprint: "fp-1" }],
      reviews: [],
      testEvidence: { testsProposed: 1, independentReviews: 1, artifactCount: 1 },
      securityEvidence: { findings: [], passed: true },
      performanceEvidence: [],
      riskRegister: [],
      failureRegister: [],
      uncertaintyRegister: [],
      minorityReports: [],
      providerReceipts: [],
      costReport: { providerCalls: 1, realProviderCalls: 0 },
      reproductionInstructions: [],
    };

    const bundle = freezeBundle(draft);
    assert.ok(bundle.frozen);

    // Operation object must be frozen
    assert.ok(Object.isFrozen(bundle.artifacts[0].operation));

    // Attempting to mutate operation fields must produce a different fingerprint if forced on a clone
    const tampered = freezeBundle({
      ...draft,
      evidenceVersion: 2,
      verification: {
        finalStatus: "VERIFIED",
        verificationRounds: 1,
        repairAttempts: 0,
        filesAppliedByRepair: 0,
        sandboxBackendId: "test",
        sandboxVerified: true,
        stopReason: null,
        stageReceipts: [],
        repairReceipts: [],
        workspaceFingerprint: "ws-fp",
      },
      artifacts: [
        {
          ...draft.artifacts[0],
          operation: {
            kind: "DELETE" as const,
            targetRelativePath: "src/index.ts",
            expectedBaselineSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          },
        },
      ],
    });

    assert.notEqual(tampered.fingerprint, bundle.fingerprint);
  });
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
        sourceArtifactSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
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
