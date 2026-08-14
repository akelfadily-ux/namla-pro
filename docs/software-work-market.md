# Software work market

`src/colonyMission/workDemand.ts`. A mission raises temporary local **work
demands** across categories: research, architecture, planning, frontend,
backend, coding, testing, debugging, security, documentation, integration,
review, repair.

## Flow (no central assignment)

1. The mission creates local demand signals per category.
2. Ants observe only locally-relevant demands (eligibility by skill/state).
3. Eligible ants **voluntarily submit claims** — never assigned.
4. A claim carries the ant's own skill, confidence, energy, reliability, and
   estimated effort.
5. A **deterministic contention resolver** (`resolveTaskClaims`) accepts among
   the volunteers only; it may reject or admit, but it can **never select an ant
   that did not volunteer**.
6. Accepted ants may then submit **cognition claims**.
7. The `CognitiveExecutionBudget` admits only bounded claims (≤5 in the demo,
   ≤30 globally).
8. The admitted ant receives one bounded cognitive request.

## The decentralization proof

`acceptedTaskClaims` is always a **subset** of `voluntaryTaskClaims`
(acceptance can never exceed volunteering), which is the demo's mechanical proof
that `nonVolunteerAssignments = 0`. Combined with `centralTaskAssignments = 0`,
`queenTaskAssignments = 0`, and `globalPlannerDecisions = 0`, no work is ever
imposed on an ant. Demo: 767 voluntary claims → 5 accepted, 0 non-volunteer.

## Status labels

- **Real-mechanism-inspired:** voluntary, threshold-gated task engagement extends
  the harvester-ant / response-threshold model already in `src/colony/`.
- **Digital adaptation:** the software work-category taxonomy and the effort
  estimate are engineering, not biology.
