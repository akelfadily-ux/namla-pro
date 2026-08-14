# Digital Resource Conservation (Operations V2)

Digital Operations V2 threads the §23 conserving ledger
(`DigitalResourceEconomy`) through the whole software mission, so every real
project proves conservation and causality.

## Conservation

For each of the 15 resources:

```
quantity == initial + collected + created - consumed - expired - quarantined
```

holds by construction; tool-access capacity closes (`available + held ==
initial`). `unexplainedResourceCreation === 0`.

## Causal invariants (all checked in `digitalOperationsReport.ts`)

- **no task without demand** — every artifact's `demandId` is a real demand.
- **no accepted worker without voluntary claim** — `acceptedTaskClaims <= voluntaryTaskClaims`, `nonVolunteerAssignments === 0`.
- **no artifact without consumed resources** — every build receipt consumed knowledge + compute + tokens + context.
- **no applied artifact without review** — `filesApplied <= artifactsReviewed`.
- **no successful objective without test evidence** — `finalObjectivePassed` implies `testEvidence > 0`.
- **no repaired objective without a recorded failure** — `repairRounds > 0` implies `verificationFailures > 0`.
- **no knowledge without source and verification** — every verify receipt consumed raw information.
- **no evidence beyond the work** — Academy evidence updates <= artifacts, bounded strength.
- **no provider call without permit and budget** — real provider calls are 0.
- **no self-review** — reviewer is never the builder.
- **decentralized** — central / Queen / Tamara / global-planner assignments 0.

`causalityViolations` counts any failing check; it is 0 in the demo at 300 / 1,000
/ 10,000 identities. A counter-only demo cannot satisfy these.
