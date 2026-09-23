import test from "node:test";
import assert from "node:assert/strict";
import { PlanTestFactory, type PlanContractFreezer } from "../v2/planTest/planTestFactory";
import { ProtocolEngine, type ProtocolResult } from "../v2/protocol/protocolEngine";
import { restoreCanonicalFrozenPlanContract } from "../v2/protocol/canonicalFrozenPlanContract";
import type { DraftPlan } from "../v2/types/contracts";
import type { PreFreezeStageContext } from "../v2/types/stageContext";

const MISSION = "c9c1-plan-test";

function plan(): DraftPlan {
  return {
    draftId: "draft-c9c1",
    objective: "Build a bounded TypeScript library",
    tasks: [
      {
        id: "task-source", name: "Source", description: "Create source",
        targetFiles: ["src/index.ts"], dependencies: [],
        capabilityRequirements: ["filesystem.write"],
      },
      {
        id: "task-tests", name: "Tests", description: "Create tests",
        targetFiles: ["tests/index.test.ts"], dependencies: ["task-source"],
        capabilityRequirements: ["filesystem.write", "process.execute"],
      },
    ],
    acceptanceCriteria: [
      {
        id: "ac-tests", description: "Tests pass", verificationMethod: "TEST",
        required: true, requiredRequirementId: "test-verif-suite",
      },
    ],
    riskClassification: "LOW",
    estimatedBudgets: { maxVirtualTicks: 20, maxProviderCalls: 5, maxFixAttempts: 3 },
  };
}

function context(draft: DraftPlan): PreFreezeStageContext {
  return {
    missionId: MISSION,
    authoritativeInputs: ["objective"],
    currentDraftPlan: draft,
    policyVersions: ["policy-v1"],
    budgets: { virtualTicks: 20, providerCalls: 5, maxFixAttempts: 3 },
    evidenceRefs: [],
    missionStateRef: "mission-state-c9c1",
    contractPhase: "PRE_FREEZE",
    projectClass: "TYPESCRIPT_LIBRARY",
  };
}

class FakeFreezer implements PlanContractFreezer {
  public calls = 0;
  public constructor(private readonly result: ProtocolResult) {}
  public freezePlanContract(): ProtocolResult {
    this.calls += 1;
    return this.result;
  }
}

test("C9C1 valid draft produces a restorable canonical frozen contract candidate", () => {
  const draft = plan();
  const result = new PlanTestFactory().validateAndFreezePlan(draft, context(draft));
  assert.ok(result.success, result.reasonCode);
  if (!result.success) return;
  assert.equal(result.readyForFreeze, true);
  assert.equal(result.workPackages.length, draft.tasks.length);
  const restored = restoreCanonicalFrozenPlanContract(result.contractBinding, result.contractIdentity);
  assert.ok(restored.ok, restored.reasonCode);
  if (!restored.ok) return;
  assert.equal(restored.contract.contractHash, result.frozenContract.contractHash);
  assert.equal(Object.isFrozen(result.frozenContract), true);
});

test("C9C1 empty task set is refused before ProtocolEngine", () => {
  const draft = { ...plan(), tasks: [] };
  const fake = new FakeFreezer({ success: false, workPackages: [], reasonCode: "should-not-run" });
  const result = new PlanTestFactory(fake).validateAndFreezePlan(draft, context(draft));
  assert.equal(result.success, false);
  assert.equal(result.reasonCode, "DRAFT_SHAPE_INVALID");
  assert.equal(fake.calls, 0);
});

test("C9C1 duplicate task ids fail closed", () => {
  const base = plan();
  const draft = { ...base, tasks: [base.tasks[0], { ...base.tasks[1], id: base.tasks[0].id }] };
  const result = new PlanTestFactory().validateAndFreezePlan(draft, context(draft));
  assert.equal(result.success, false);
  assert.equal(result.reasonCode, "DUPLICATE_TASK_ID");
});

test("C9C1 dependency on a missing task is refused", () => {
  const base = plan();
  const draft = {
    ...base,
    tasks: [base.tasks[0], { ...base.tasks[1], dependencies: ["task-never-existed"] }],
  };
  const result = new PlanTestFactory().validateAndFreezePlan(draft, context(draft));
  assert.equal(result.success, false);
  assert.equal(result.reasonCode, "DEPENDENCY_TARGET_MISSING");
});

test("C9C1 dependency cycle is refused", () => {
  const base = plan();
  const draft = {
    ...base,
    tasks: [{ ...base.tasks[0], dependencies: ["task-tests"] }, base.tasks[1]],
  };
  const result = new PlanTestFactory().validateAndFreezePlan(draft, context(draft));
  assert.equal(result.success, false);
  assert.equal(result.reasonCode, "DEPENDENCY_CYCLE");
});

test("C9C1 traversal-shaped target path is refused as planning data", () => {
  const base = plan();
  const draft = {
    ...base,
    tasks: [{ ...base.tasks[0], targetFiles: ["../escape.ts"] }, base.tasks[1]],
  };
  const result = new PlanTestFactory().validateAndFreezePlan(draft, context(draft));
  assert.equal(result.success, false);
  assert.equal(result.reasonCode, "TARGET_PATH_SHAPE_INVALID");
});

test("C9C1 context cannot silently validate a different draft identity", () => {
  const draft = plan();
  const other = { ...draft, draftId: "draft-other" };
  const result = new PlanTestFactory().validateAndFreezePlan(other, context(draft));
  assert.equal(result.success, false);
  assert.equal(result.reasonCode, "DRAFT_CONTEXT_MISMATCH");
});

test("C9C1 ProtocolEngine refusal remains fail closed", () => {
  const draft = plan();
  const fake = new FakeFreezer({
    success: false, workPackages: [], reasonCode: "fixture-protocol-refusal",
  });
  const result = new PlanTestFactory(fake).validateAndFreezePlan(draft, context(draft));
  assert.equal(result.success, false);
  assert.equal(result.reasonCode, "PROTOCOL_REFUSED");
  assert.equal(result.detailReasonCode, "fixture-protocol-refusal");
  assert.equal(fake.calls, 1);
});

test("C9C1 tampered ProtocolEngine contract hash cannot become a boundary candidate", () => {
  const draft = plan();
  const ctx = context(draft);
  const baseline = new ProtocolEngine().freezePlanContract(draft, ctx);
  assert.ok(baseline.success);
  assert.ok(baseline.frozenContract);
  const fake = new FakeFreezer({
    ...baseline,
    frozenContract: { ...baseline.frozenContract!, contractHash: "0".repeat(64) },
  });
  const result = new PlanTestFactory(fake).validateAndFreezePlan(draft, ctx);
  assert.equal(result.success, false);
  assert.equal(result.reasonCode, "CANONICAL_CONTRACT_CAPTURE_REFUSED");
});

test("C9C1 returned work packages are detached and frozen", () => {
  const draft = plan();
  const ctx = context(draft);
  const baseline = new ProtocolEngine().freezePlanContract(draft, ctx);
  assert.ok(baseline.success);
  const result = new PlanTestFactory(new FakeFreezer(baseline)).validateAndFreezePlan(draft, ctx);
  assert.ok(result.success, result.reasonCode);
  if (!result.success) return;
  assert.equal(Object.isFrozen(result.workPackages), true);
  assert.equal(Object.isFrozen(result.workPackages[0]), true);
  assert.notEqual(result.workPackages, baseline.workPackages);
});
test("C9C1 context binding covers the entire draft, not only id and objective", () => {
  const draft = plan();
  const changed = {
    ...draft,
    tasks: [
      { ...draft.tasks[0], targetFiles: ["src/changed.ts"] },
      draft.tasks[1],
    ],
  };
  const fake = new FakeFreezer({
    success: false,
    workPackages: [],
    reasonCode: "should-not-run",
  });
  const result = new PlanTestFactory(fake).validateAndFreezePlan(changed, context(draft));
  assert.equal(result.success, false);
  assert.equal(result.reasonCode, "DRAFT_CONTEXT_MISMATCH");
  assert.equal(fake.calls, 0);
});

test("C9C1 zero planning ceilings remain valid data and do not mint execution authority", () => {
  const draft = {
    ...plan(),
    estimatedBudgets: {
      maxVirtualTicks: 0,
      maxProviderCalls: 0,
      maxFixAttempts: 0,
    },
  };
  const result = new PlanTestFactory().validateAndFreezePlan(draft, context(draft));
  assert.ok(result.success, result.reasonCode);
  if (!result.success) return;
  assert.equal(result.workPackages.every((wp) => wp.maxAttempts === 0), true);
});

test("C9C1 duplicated Protocol work-package identity is rejected even when array length matches", () => {
  const draft = plan();
  const ctx = context(draft);
  const baseline = new ProtocolEngine().freezePlanContract(draft, ctx);
  assert.ok(baseline.success);
  assert.equal(baseline.workPackages.length, 2);

  const duplicate = structuredClone(baseline.workPackages[0]);
  const fake = new FakeFreezer({
    ...baseline,
    workPackages: [baseline.workPackages[0], duplicate],
  });

  const result = new PlanTestFactory(fake).validateAndFreezePlan(draft, ctx);
  assert.equal(result.success, false);
  assert.equal(result.reasonCode, "PROTOCOL_OUTPUT_INVALID");
});