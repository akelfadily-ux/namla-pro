# Digital Resource Economy

`src/digital/digitalResourceEconomy.ts` is the load-bearing module of Digital
Superorganism Metabolism V1: a strict, **event-sourced conservation ledger** for
the fifteen digital resources. It is the digital analogue of the frozen biology
`ColonyResourceEconomy`.

## The fifteen resources

| # | Resource | Biological analogue | Role |
| --- | --- | --- | --- |
| 1 | `rawInformation` | foraged food | scouted, unverified signal |
| 2 | `verifiedKnowledge` | durable protein | information that passed verification |
| 3 | `workingContext` | carbohydrate | fast consumable context / short-term tokens |
| 4 | `computeCapacity` | oxygen | compute slots |
| 5 | `tokenBudget` | energy | model token budget |
| 6 | `monetaryBudget` | energy | money budget |
| 7 | `toolAccess` | oxygen | bounded, revocable tool/API/permission grants |
| 8 | `skillAssets` | protein | durable individual skills |
| 9 | `reusableComponents` | protein | libraries, tools, tested components |
| 10 | `testEvidence` | immune substrate | evidence from tests/reviews |
| 11 | `trustCapital` | — | reliability accrued through evidence |
| 12 | `technicalDebt` | metabolic load | tracked debt to be serviced |
| 13 | `errorWaste` | CO₂ | failed attempts, rejected work |
| 14 | `staleKnowledge` | waste | expired/obsolete knowledge |
| 15 | `securityRisk` | pathogen load | active threat load |

## The conservation identity

For **every** resource, at all times:

```
quantity == initial + collected + created − consumed − expired − quarantined
```

This holds **by construction**: the only mutators are `collect` (scouted from the
environment), `createVia` (output of an authorized transformation), `consume`,
`expire`, and `quarantine`, and each updates both the running quantity and its
matching accumulator. Therefore nothing appears from nowhere
(`unexplainedResourceCreation === 0`) and nothing vanishes silently.

### Per-resource attributes

Each flowing parcel (`DigitalParcel`) carries **source/provenance, owner, quality,
freshness, confidence, access policy**, and its creation/consumption is a ledger
event with **transformation history** (`transformationLog`). Budgets
(compute/token/money/context) are tracked in aggregate with the same
create/consume discipline. Freshness degradation is modelled by `expire`
(working context going stale) and `staleKnowledge` creation (verified knowledge
ageing).

## Tool access (oxygen) — reserve, never mint

`toolAccess` is a bounded, revocable **capacity**, not a fungible stock. Grants
move capacity from `available` to `held`; releases move it back:

```
available + held == initial   (always)
```

A permit is *reserved*, used, and *returned* — never created. `grantToolAccess`
returns `false` (a counted denial) when capacity is exhausted, so **no ant
receives unrestricted tool access** and the total concurrent permits are bounded.

## Energy / budgets — no infinite work

`computeCapacity`, `tokenBudget`, `monetaryBudget`, and `workingContext` are
**only ever consumed**, never created. When a worker cannot afford a transform's
inputs (`canAfford` is false), it does not act — it rests, reducing scope. This
is why there are no unlimited retries and no unexplained digital energy.

## Validation

`validate()` reconstructs every resource and checks closure within
`DIGITAL_CONSERVATION_TOLERANCE` (1e-6), returning `allClosed`,
`unexplainedResourceCreation`, and `toolAccessClosed`. The report elevates these
into the golden invariants `digitalResourceConservationValid` and
`causalityViolations === 0`.
