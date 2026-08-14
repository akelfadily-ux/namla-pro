# Local planning

`src/colony/localPlanning.ts`. An ant that voluntarily claims work may form a
**private, bounded** `LocalPlan`. Nothing hands it the plan; no global planner
exists; the Queen cannot see or change it. Another ant learns of a plan only
through an explicit bounded review request (`peerReviewSystem.ts`).

## Plan shape (all lists capped)

`goalCode`, `assumptions` (≤4), `substeps` (1–6), `expectedArtifactCode`,
`risks` (≤4), `verificationMethodCode`, `stopConditionCode`,
`helpNeededConditionCode`, `revisionCount` (≤3), `status`, `planConfidence`.

The plan **shape follows the mind**: a more analytical/architectural, persistent
ant plans more substeps; a more cautious ant records more risks and a stricter
verification method; a more curious ant records more assumptions to test; a
low-confidence ant sets a "help-if-uncertain" condition. `planWithinBounds`
re-checks every cap.

## Revision is a real transition

`reviseLocalPlan(plan, trigger)` responds to a real trigger — `failure`,
`peer-risk`, `peer-assumption-challenge`, or `contradiction`:

- a **failure** revision drops the riskiest substep (simplify);
- a **peer-assumption-challenge** adds a verification substep;
- a **peer-risk** or **contradiction** escalates verification to
  `independent-test`;
- every revision records a mitigation and lowers plan confidence, capped at 3
  revisions.

In the demo, a plan that fails peer review is revised — 72 plans created, 72
revised, all within bounds.

## Status labels

- **Hybrid:** private local planning with bounded peer visibility blends
  individual initiative with social-insect indirect coordination.
- **Digital adaptation:** the explicit substep/assumption/risk/verification
  structure is software-engineering practice, not ant behavior.
- **Deterministic implementation:** the only randomness is a small seeded jitter
  (`planDraw`) on plan confidence.
