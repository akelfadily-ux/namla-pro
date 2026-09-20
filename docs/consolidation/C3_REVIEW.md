# C3 - Productization gate aggregation and agent identifiers

Canonical input: `aed0fd1bfd737a4062ab7682e75f009174646711`.
Input tree: `2f2904f8b7b15b3d9fe9b3847ff2897ab3abeed7`.
Donor: `44977cf5e6816388a0838d50e4f7eaea0b133224`.

## Selected contributions

| Donor path | Donor blob | Treatment |
|---|---|---|
| src/application/gate-engine.ts | 4ed9b6a351eb9bf39c83368520739bc48411dee6 | Adapted local check aggregation; not a canonical gate authority |
| src/application/ant-allocator.ts | a1eba86775bdbb7ab6c5d0bf35ea0adc745feb28 | Adapted opaque ID generation; no agent registration or task dispatch |

Both sources are adapted, not exact copies. The C1 domain interfaces, errors and
types are reused unchanged. C2 and all canonical V2 source files remain unchanged.
No donor NamlaLoop, scheduler, service, PolicyEngine, ToolGateway, model gateway,
bootstrap or PostgreSQL implementation is implicitly selected by this batch.

## GateEngine: source finding and compatibility

The donor checks result.passed by truthiness and its static summary uses
results.length > 0 && results.every(...). Therefore a truthy nonboolean verdict
can count as success; a sparse nonempty array can also return true without any
result being inspected. These are component findings in the donor, not findings
about the existing canonical NamlaLoopGate.

C3 preserves the public GateContext, GateResult, Gate and GateEngine method shapes,
sequential execution, stop-on-first-false behavior, empty evaluation returning [],
and propagation of callback errors. It changes malformed-data behavior: reports
must be dense ordinary arrays, each result must have exactly the five declared
own enumerable data fields, passed must be a boolean, and reason must be a string.
Evidence and requiredFixes must be dense string arrays. Extra, symbol, hidden,
ordinary accessor and custom-prototype result fields are refused. Plain
null-prototype result records remain valid. Result gate names must match their
registered callback. Repeated configuration or report names are refused.

Configuration names and callback references are captured at construction, including
ordinary class methods with their instance binding. Configuration getters are not
invoked. Later mutation of the caller's registration list cannot add a check or
replace a captured callback. The callback object itself is not frozen and may have
state. Output result records and nested diagnostic arrays are detached and frozen;
the returned result collection retains the donor's mutable array API.

Configuration errors use ConfigurationError; malformed callback results use
GateRejectedError; callback/promise exceptions propagate. The static passed()
summary returns false for malformed reports. Diagnostic labels do not echo supplied
values. Proxy reflection traps can still run, and Promise resolution can inspect
thenables before result validation. This is NOT a sandbox for hostile JavaScript.

## Agent identifiers: source finding and format change

The donor uses only taskId.slice(0,8), ignores runId, and also truncates UUIDs in
its task-less branch. Distinct tasks with the same first eight characters therefore
have the same donor identifier for a given role, as do identical task IDs across runs.

C3 retains the allocation API and deterministic task-bound behavior, but binds the
full role/run/task tuple using SHA-256 over an unambiguous JSON array with a distinct
NAMLA_PRODUCTIZATION_ANT_ID domain and version 2. Task-less allocations use a full
random UUID nonce in that envelope. The resulting label is ant-<role>-v2-<64 hex>.
Role must be a declared AntRole. Run and supplied task IDs must be nonempty strings
without control characters; a missing optional task is different from an invalid
supplied task. Identity bytes are not trimmed or Unicode-normalized before hashing.

This changes identifier format deliberately. It does NOT make a claim of absolute
collision impossibility and does not replace canonical operationIdentity hashing.
These labels are not permission tokens, execution IDs or fencing epochs. Allocation
does not claim a task, enforce concurrency or create a registry entry. Existing
persisted agent IDs must be read as stored during resume; no silent ID re-generation,
rewrite or migration is introduced. Consumers that parse the old short suffix need
explicit adaptation when selected; C3 does not claim their compatibility was proven.

## Single-runtime authority boundary

A GateEngine passed() result is a structural summary only. A caller can construct a
structurally valid positive report. It is not evidence authenticity, proof that all
required checks ran, a frozen-contract binding or an execution permit. Trusted check
callbacks receive the original context as in the donor; C3 does not validate a
workspace, contain plugin effects or guarantee a callback cannot mutate its context.
No production callbacks are installed or invoked by this batch's component tests.
Canonical NAMLA LOOP, kernel, leases, CAS, budgets, signatures and delivery checks
remain the only existing authority paths and are not replaced or weakened.

## Evidence and remaining work

productizationGateAllocatorTests.ts adds 32 component tests, including concrete
regressions for the two donor pitfalls, asynchronous ordering and registry capture,
false/malformed/error paths, detached diagnostics, allocation scope, input handling
and dependency checks. These do not exercise providers, databases, factory effects
or orchestrator replay. Full repository typecheck/build/P0 must run at integration;
actual results and hashes belong to the external run receipt, not a prewritten PASS.

Cumulative source selection after C3: 11 of 50 Productization paths, consisting of
8 exact donor sources and 3 adaptations across C1/C2/C3. 39 donor paths remain open.
FINAL-02 remains unchanged: 13 identical baseline paths and 43 under review.
No source branch, worktree, ignored file, database or retained backup may be deleted
on the strength of this component batch. Next: reconcile policy, identity and
gateway boundaries before importing effectful application services.
