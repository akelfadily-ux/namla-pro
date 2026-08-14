# Tamara–Namla Federation V1

Tamara is the **sovereign strategic layer**; Namla is the **decentralized
workforce nation**. The bridge (`src/federation/`) is the only doorway between
them. Authorized by `NAMLA_BUILD_LAW.md` §20.

## Tamara leads strategy; she cannot assign individual ants

A `TamaraObjective` carries objectiveId, title, desired outcome, constraints,
priority, risk level, budget units, a bounded tick limit, required skills,
acceptance criteria, human-approval requirements, an allowed provider pool, a
max cognitively-active-ants cap, a max real-provider-calls cap, a workspace
policy, and safe metadata.

`FederationBridge.submitObjective` validates the objective and transforms it into
**local demand** — a scout task plus one build task per required skill — then
runs it through the EXISTING decentralized `MissionRunner` (scout proposals →
local quorum → voluntary claims → bounded cognitive admission → artifacts →
review → verification → repair). Nothing assigns a task to an ant.

Tamara's powers are typed on `TamaraAuthorityRecord`: she **may** publish
objectives, set budgets, define constraints, approve boundaries, inspect safe
summaries, accept/reject final results, pause missions, and reduce provider
budgets (reduce-only). She **may not** directly assign an ant, pick a quorum
winner, read private minds, bypass the market/review/safety, mint permits, or
make unlimited provider calls — each is a literal `false`/`0`, re-checked by
`tamaraHoldsNoWorkerAuthority`.

## Safe summaries only

Tamara sees `FederationSafeSummary` — counts, statuses, and outcome evidence
(scout proposals, quorum, claims, artifacts, reviews, verification, repair,
peak cognition, remaining budget) — never a private `AntMind`.

## Metrics (demo)

`tamaraObjectivesReceived 1`, `colonyMissionsCreated 1`, `voluntaryClaims > 0`,
and `nonVolunteerAssignments = centralTaskAssignments = queenTaskAssignments =
tamaraDirectAntAssignments = 0`. Hundreds of persistent identities are **not**
hundreds of simultaneous model calls; automated flows use the deterministic
worker, and real-provider training requires separate explicit authorization
under R2's one-ant boundary.

## Digital metabolism: Tamara publishes, never assigns (Build Law §23)

In Digital Superorganism Metabolism V1, Tamara's role is unchanged in kind: she
**publishes a strategic objective and budget** (step 1 of the digital runner) as
DATA. She does not select worker identities, bypass voluntary claims, or assign
tasks. `tamaraDirectAntAssignments`, `centralTaskAssignments`,
`queenTaskAssignments`, and `globalPlannerDecisions` all remain literally 0 in
`demoDigitalSuperorganismV1`. See
[digital-superorganism-metabolism-v1.md](digital-superorganism-metabolism-v1.md).

## Operations V2: Tamara publishes a software objective (Build Law §24)

In Digital Superorganism Operations V2, Tamara publishes ONE
`DigitalTechnologyObjective` (title, requirements, acceptance criteria, budgets,
caps) and may accept or reject the final delivered software. She still may not
name ants, assign tasks, select the quorum winner, bypass claims/reviews/tests/
budgets, mint permits, or bypass human confirmation. `tamaraObjectivesReceived`
is 1 and `tamaraDirectAntAssignments` remains 0 in
`demoDigitalSuperorganismOperationsV2`. See
[digital-superorganism-operations-v2.md](digital-superorganism-operations-v2.md).
