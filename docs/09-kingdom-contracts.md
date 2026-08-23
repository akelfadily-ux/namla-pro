# 09 · Kingdom contracts

A universal `execute(work, frozenPlanContract)` signature is incorrect because EER and Plan execute before contract freeze.

## StageContext

```ts
interface StageContextBase {
  authoritativeInputs: readonly string[];
  currentDraftPlan?: DraftPlan;
  policyVersions: readonly string[];
  budgets: RuntimeBudgets;
  evidenceRefs: readonly string[];
  missionStateRef: string;
}

type PreFreezeStageContext = StageContextBase & {
  contractPhase: "PRE_FREEZE";
  frozenPlanContract?: never;
};

type ContractBoundStageContext = StageContextBase & {
  contractPhase: "CONTRACT_BOUND";
  frozenPlanContract: PlanContract;
};
```

EER and Plan consume `PreFreezeStageContext`. Protocol consumes the pre-freeze draft and **produces** the first frozen contract. Pro and every later canonical stage consume `ContractBoundStageContext`. This makes a post-Protocol stage without a frozen PlanContract structurally invalid.

## Stage ownership

- EER: objective → interpreted intent
- Plan: interpreted intent → plan draft
- Protocol: draft → frozen PlanContract + WorkPackages
- Pro: WorkPackages → admitted dispatch and lifecycle
- Colony A/B: package → isolated candidate + claims
- Son: A+B → ComparisonAssessment
- Leggo: comparison/candidates → IntegratedCandidate
- ProMax: candidate → contract-wide Assessment + required checks
- Lab: accepted candidate → delivery package

## Shared verification

GateContract, VerificationPolicy, VerificationProfile, and EvidenceSchema are versioned shared definitions. Upstream preflight reuses the same policy implementation; it does not copy verifier logic.
