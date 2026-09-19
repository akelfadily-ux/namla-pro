# C2 - Productization budget validation and supervisor contract

Canonical input: `82d6b88485099c5c9271f51ba2b22bfee5657345`.
Input tree: `1dd05a6ac907b6e256865bd749b34405c3a7b994`.
Donor: `44977cf5e6816388a0838d50e4f7eaea0b133224`.

## Selected contribution and provenance

| Donor path | Donor blob | Treatment |
|---|---|---|
| src/application/budget-controller.ts | 636afafd329802412cc3303248d1126c32f16404 | Adapted in place as an observed-usage validator; not an exact byte copy |
| src/application/supervisor.ts | 313ed9b07ba56d17da2ca4a8541fd0e34b76dfae | Exact source copy; interfaces only |

The existing C1 domain types and errors are reused unchanged. No new domain model,
provider adapter, database repository, policy engine, scheduler or runtime is installed.

## Why the budget source is adapted

The donor validates five of the nine optional BudgetLimits fields. In particular,
maxModelCalls, maxToolCalls, maxRuntimeMs and maxIterations are not validated.
It compares usage fields without first validating a complete usage snapshot.
For example, a NaN maxModelCalls or NaN usage.modelCalls makes the donor's >=
comparison false instead of refusing the malformed value. An invalid Date similarly
produces NaN elapsed time. These are findings in the donor implementation, not
allegations that the existing canonical V2 budget code has these defects.

C2 validates all nine optional limits and requires all six BudgetUsage fields.
Counters must be nonnegative safe integers; observed cost must be finite and
nonnegative. Combined input/output token arithmetic must remain a safe integer.
startedAt must be a plain valid Date, with no own properties, at or after epoch and
not later than the captured current time. Invalid clocks and malformed records
are refused with ConfigurationError without echoing supplied values.
Only own enumerable data fields on plain/null-prototype records are accepted.
Ordinary getters are rejected without invocation. Reflection errors are refused;
this is not a promise that JavaScript Proxy traps cannot run during reflection.

The donor's supported usage checks keep their >= semantics: reaching a configured
limit is rejected with BudgetExceededError. Its caps on cost, tokens, agents,
concurrency and depth are retained. Calls, tools, runtime and iterations gain type
and safe-integer validation; no arbitrary additional upper allowance is invented.
Undefined/omitted optional limits remain unconfigured, not defaulted or replenished.
Error messages are intentionally sanitized rather than kept byte-for-byte.

## Authority and scope boundaries

- This component checks observed usage only. It returns void, does not reserve or
  debit a budget, does not create an execution permit, and is not race-free admission.
- It cannot check a proposed action's cost against concurrent reservations. Durable
  reservation/reconciliation and canonical budget/lease checks remain required at wiring.
- maxIterations, maxAgents, maxConcurrency and maxDepth are validated configuration
  only: BudgetUsage has no corresponding measurements. Their enforcement is NOT claimed.
- Optional limits here do not relax any existing mandatory canonical V2 budget.
- Supervisor is only a typed review port. approved=true is not authentic gate evidence,
  a verified receipt or authority to advance a canonical task.
- No adapter translates donor TaskStatus into canonical mission state in C2.
- V2 kernel, identity hashing, leases, recovery, loop gates and frozen-contract pins
  remain unchanged. No second active runtime or scheduler is added.

## Other reviewed sources: not selected in C2

operation-fingerprint.ts (donor blob 7d85c9128c9e6f5016fb3a0722c6654b904bfdbc)
uses a donor-specific JSON envelope and represents BigInt as an ordinary object.
That representation can alias literal {$type:"bigint", value:"..."} input.
It is not copied and not substituted for the canonical operation identity format.
Any gateway integration must explicitly reconcile identity formats; existing records
must not be silently rehashed. Its ledger entry remains open, not counted as resolved.

policy-engine.ts, gate-engine.ts, the donor scheduler, NamlaLoop, bootstrap and old
PostgreSQL repository are not imported. Their capabilities must be reconciled with
canonical authority rather than installed as competing authorities. These C2 exclusions
are not evidence that every feature in those donor files is already supplied by V2.

## Test evidence and completion claims

productizationBudgetControllerTests.ts adds 30 component tests. They cover donor
cost semantics, configured thresholds, all limit-field validation, usage shape and
arithmetic, Date/clock checks, accessors, mutation and dependency boundaries.
The two original budget cases in applicationEngineTests.ts are retained as focused
cases; the rest of that broad donor suite is not copied because it requires unselected
PolicyEngine, ToolGateway and NamlaLoop implementations.

Typecheck, build, the focused suite and the full P0 gate are required by the C2 script.
The receipt outside the repository records actual counts and hashes after success.
This document describes selected source scope; it never declares an unrun test passed.
No real provider, database, server restart or orchestrator replay is tested by C2.

Cumulative source selection after C2: 9 of the 50 Productization paths (8 exact donor
copies across C1/C2 and 1 adapted source). 41 donor paths still need decisions.
FINAL-02 is unchanged: 13 paths identical to the original baseline, 43 still under review.
No branch, worktree, bundle, ignored file or database deletion is approved.
