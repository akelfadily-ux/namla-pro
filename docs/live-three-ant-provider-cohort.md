# Live Three-Ant Provider Cohort

The V3 cohort is admitted VOLUNTARILY (Build Law §25). Neither Tamara nor the
Queen names the three ants.

## Admission flow

1. Tamara publishes the software objective and budgets.
2. The colony creates demands.
3. At least eight qualified ants submit voluntary claims (`buildVoluntaryClaimPool`).
4. A deterministic cognitive-rotation contention resolver (`admitLiveCohort`) admits exactly three among the volunteers.
5. Tamara does not name them; the Queen does not name them; no non-volunteer may enter.

## Eligibility + selection evidence

A claim requires SkillPassport eligibility (maturation ≥ qualified), a reliability
threshold, and sufficient energy — the ant self-selects. Each claim carries:
`antId`, `skillEvidence`, `specialization`, `reliability`, `workload`, `energy`,
`recentProviderUsage`, `learningNeed`, `expectedContribution`, and a requested
provider preference. The resolver ranks by a fair blend of contribution,
reliability, low recent provider usage, learning need, and low workload — never by
identity.

## Provider allocation

The human-selected allocation is preferred Claude, Claude, Codex
(`resolveProviderAllocation`); if Codex is not in the allowed pool, the human may
select three Claude. The allocation is bound into the `LiveObjectivePermit`, one
provider per admitted ant.

## Guarantees

`voluntaryLiveClaims >= 8`, `acceptedLiveCohortSize = 3`, the accepted cohort is a
strict subset of the voluntary pool, and `nonVolunteerAssignments`,
`centralTaskAssignments`, `queenTaskAssignments`, `tamaraDirectAntAssignments`,
`globalPlannerDecisions` are all 0.
