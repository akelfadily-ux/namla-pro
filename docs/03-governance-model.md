# 03 · Governance and ownership

## One decision owner per concern

| Decision | Owner |
|---|---|
| interpret objective | EER |
| draft plan | Plan |
| freeze contract / cut WorkPackages | Protocol |
| dispatch / lifecycle transition decisions / admission | Pro |
| build independent candidates | Colony A/B |
| compare A vs B | Son |
| integrate | Leggo |
| contract-wide verification | ProMax |
| package delivery | Namla Lab |
| permit real authority | Trusted Kernel / authorized human or Build Law mechanism |
| PASS / FAIL / HUMAN_REQUIRED | NAMLA LOOP using GateContract |
| persistence of versioned mission + WorkPackageExecution lifecycle/ownership/budget-consumption state | Mission State Plane |

Two modules must not own the same decision.

## DONE law

A stage is not DONE because it finished local work. It is DONE only when its output has a current `GateVerdict(PASS)` bound to the relevant ArtifactIdentity, contract/policy versions, environment identity, required attestations, and assessments.

## Human authority

Human decisions are explicit scoped records. They do not silently convert untrusted claims into facts and do not bypass hard security policy.

## Lifecycle ownership clarification

Pro decides legal orchestration transitions under policy; `MissionStateStore` records the current state and counters. The store does not independently decide the next stage. Budget ceilings/admission authority belong to the Trust/Authority plane; current allocation and consumption are runtime state.
