# C6 - Productization ToolGateway coordination

## Immutable input and selection

Input commit: `fb8b8d5784da2f864230a77f55971f1a9ee7ff12`.
Input tree: `6c882e8c6a738b6d1db31b491add35806f67d365`.
Donor commit: `44977cf5e6816388a0838d50e4f7eaea0b133224`.
Donor `src/application/tool-gateway.ts` blob:
`c160168c72964cf46f9571786d88bd496f4065aa`.
Reviewed ten-file export SHA-256:
`8e70a57dbe22b8593ecda1e053793d947895e18c30e25f956fd8f299e8737569`.

The donor path is ADAPTED, not copied unchanged or fully runtime-qualified.
This batch supplies coordination against the existing V2 operation-store port.
It does NOT bind a production executor or enable the donor bootstrap/scheduler.
No canonical source, existing domain contract or package manifest is changed.

## Source findings and design decision

The donor uses the Productization StateRepository operation API and optional
worker/token-only ToolExecutionContext, not the V2 lease/claim epoch contract.
It treats COMPLETED as a replay without requiring a complete returned record.
It can receive an empty permission array and perform no policy call. Its timer
only aborts a signal, and the success path after adapter.execute does not check
whether that signal fired. Several failure paths classify uncertainty as
retryable and ignore failure-persistence errors. ToolAdapter.execute is called
directly; naming a tool with a privileged prefix is not a kernel boundary.

C5 is retained unchanged, including its refusal of raw execution and unbound
Git writes. The V2 store already distinguishes CLAIMED, ALREADY_CLAIMED_BY_CALLER,
REPLAY_COMPLETED and REFUSED, and requires full task authority plus claim epoch
for finalization. C6 consumes those existing interfaces rather than copying the
donor SQL schema or creating a second lease/claim authority.

## Adapted component contract

The constructor now accepts ToolGatewayOptions, not the donor's three arguments.
Required dependencies are static tool bindings, C5 policy, a Pick of the existing
PostgresExecutionAuthorityStore claim/complete/fail methods, and an explicit
TrustedToolExecutionBoundary. The boundary is a NEW composition-root port in
this adaptation, not a function claimed to already exist on TrustedKernel.
There is NO default executor, automatic adapter.execute fallback or bootstrap.
Static bindings have a name, revision, input validator and permission mapper;
all methods are captured once. Passing a donor adapter with execute is refused.

Every call requires the complete V2 TaskExecutionAuthority. runId must equal
missionId, task IDs must agree, and local structure/expiry validation precedes
storage. Database-side lease checks remain authoritative. No task lease is
acquired or renewed here. The trusted clock cannot mint durable authority.
Every tool requires a nonempty permission array containing its exact tool
capability; every permission must pass C5. Input, context and generated requests
are detached before asynchronous storage and checked again before dispatch or
returning a stored result. Caller mutation is not a revocation protocol.

C4 fingerprints are reused. A separate V2 operation namespace binds the tool,
revision, task, exact input and generated permission requests to the supplied
authorityScope. The scope is never invented from a tool or task name. Existing
C4, V2 and donor operation identities are not migrated or compared by fallback.
Trace/ant IDs remain correlation data, not operation identity dimensions.

The first transport accepts bounded JSON data: plain/null-prototype records,
dense ordinary arrays, strings, finite numbers other than negative zero,
booleans and null. C4's standalone Date/bytes/bigint support remains unchanged;
those types are deliberately not accepted by this JSON-result gateway. Limits
are depth 40, 8192 visited nodes, 1 Mi UTF-16 units and 1 MiB encoded JSON.
Accessors, proxies, hidden/symbol data, cycles, undefined, NUL and malformed
UTF-16 are refused rather than silently transformed by JSON.stringify.

## Claim, replay and uncertainty

Only CLAIMED at claimEpoch=1 can enter the executor. ALREADY_CLAIMED_BY_CALLER
is in-flight work, not a license to execute twice. An expired RUNNING record
can be reclaimed by the existing store, but its higher epoch is refused here
with RECOVERY_REQUIRED, before execution. The store may have advanced ownership
in that refusal case; no old record is deleted or reset. This conservative
rule sacrifices automatic crash-before-execution recovery until reconciliation
can establish whether effects occurred. It is not a global exactly-once proof.

REPLAY_COMPLETED requires a fully bound completed record and a versioned result
envelope. The envelope binds input identity, tool/revision and an output hash
through the retained V2 codec. A matching data hash detects mismatches but is
NOT a signature, authenticated evidence or protection against a malicious store
that can rewrite both payload and hash. Replay invokes neither executor nor
completion again, and does not debit a budget in this component.

Timeouts, executor throws and malformed/unstorable results are UNKNOWN outcomes.
They latch this instance closed and leave the claim unresolved, without marking
it FAILED as if no effect occurred. A late callback result is not finalized.
The AbortSignal is cooperative: it does not kill a process or stop malicious
synchronous code. Only an explicit trusted REFUSED_BEFORE_EFFECT result can
request FAILED finalization, and that finalization is checked rather than ignored.
Completion failures are never followed by failOperation, a new operation ID,
automatic execution retry or budget refund. A fresh instance may replay an
actually committed completion after its acknowledgement was lost. Finalization
receipts must retain all identity/token/epoch fields of the accepted claim.

## Trust boundaries and work still pending

Constructor dependencies and built-in JS intrinsics are trusted. TypeScript
interfaces and object validation do NOT authenticate injected code. The executor
must independently enforce authenticated permission provenance, current task
and operation fencing, frozen contract, canonical budget, actual workspace,
secret policy and verified sandbox at the effect boundary. C6 does not implement
that executor, debit/reconcile budgets, issue permits, verify signed evidence,
advance the runtime cursor or provide atomicity across external effects and SQL.
A caller must not install a raw ToolAdapter.execute callback as that executor.
Production enablement requires the concrete kernel-bound adapter and its tests.

The donor telemetry/appendEvent integration is not imported in this batch.
No event stream, real-provider execution, new scheduler, database migration,
factory replay or production PostgreSQL/worker-crash qualification is claimed.
All error diagnostics are bounded codes without caller data or tokens.

## Acceptance evidence

productizationToolGatewayTests contains 42 component tests. Its storage port is
an IN-MEMORY TEST DOUBLE that calls the real V2 decision/finalization functions.
Its executor is a recording TEST DOUBLE, not a sandbox or kernel implementation.
Tests cover successful coordination, replay, concurrent instances, uncertain
results, loss of completion acknowledgement, input/permission admission,
receipt substitution, no legacy execution fallback and retained C5 refusals.
The selected C4+C5+C6 tests (40+44+42) passed locally on Linux/Node 22. The local
typecheck used extracted database-client declarations for the isolated source
closure; it was not a build of the entire Windows repository.

The installer requires full repository typecheck/build, this suite and full P0
on the user's tree. It also pins C1-C5 (164 tests), Recovery (298), V2 identity
(22), V2 execution authority (47) and command policy (19). Actual pass/fail belongs
to its new receipt, not to this document or the source export. No staging,
commit, push, branch deletion or remote integration is performed by this batch.
