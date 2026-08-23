# 02 · Canonical mission pipeline

This is the only top-level V2 mission flow.

```mermaid
flowchart TB
  U["Objective"] --> E["EER"]
  E --> L1{"LOOP"} --> P["PLAN"]
  P --> L2{"LOOP"} --> PR["PROTOCOL"]
  PR --> L3{"LOOP"} --> PRO["PRO"]
  PRO --> L4{"LOOP"}
  L4 --> A["COLONY A"]
  L4 --> B["COLONY B"]
  A --> LA{"LOOP A"}
  B --> LB{"LOOP B"}
  LA --> S["SON"]
  LB --> S
  S --> L5{"LOOP"} --> G["LEGGO"]
  G --> L6{"LOOP"} --> M["PROMAX"]
  M --> L7{"LOOP"} --> LAB["NAMLA LAB"]
  LAB --> L8{"LOOP"} --> D["DELIVERY"]
```

## Chronology

1. EER and Plan execute **before** a frozen PlanContract exists.
2. Protocol validates the plan, binds versions/policies, freezes the PlanContract, and creates WorkPackages.
3. Pro owns dispatch. Protocol never dispatches directly.
4. Both colonies execute the same bounded WorkPackage independently.
5. Son receives both results only after their colony-local gates complete.
6. Leggo integrates.
7. ProMax verifies the integrated candidate against the frozen contract and independent checks.
8. Lab packages only an accepted candidate.

## Gate invariant

No major stage transition bypasses NAMLA LOOP.
