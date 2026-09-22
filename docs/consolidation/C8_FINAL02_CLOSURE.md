# C8 — FINAL-02 donor closure

Input checkpoint: `cba1ead1d1b8d206513bf8cdaef0a74846e6613b`.

FINAL-02 donor reviewed: `655f9f2c973437fa58ab7e4e99b963988c1c5f7e`.

Reviewed source package SHA-256:
`84458af088fee8d454d8b37f80735443609a72746150b741d761a8cf7964eb43`.

## Purpose

C8 closes the remaining FINAL-02 donor-path decisions without importing a
second integration runtime beside the canonical V2 runtime.

The donor branch is preserved by immutable commit identity, the prior Git
bundle, and the reviewed source package. A path marked as not imported is not
lost; it is deliberately kept historical rather than activated in the
canonical runtime.

## Findings

### Existing canonical security work wins over donor regressions

Thirteen FINAL-02 paths are already byte-identical to the canonical baseline
and need no copy.

For diverged trusted-executable and verification-sandbox tests, the canonical
tree is stronger. The FINAL-02 donor removes canonical WSL trust-root coverage
and changes typecheck back toward `npx`. C8 retains the canonical trusted Node
toolchain and fixed verification argv.

The canonical P0 runner is retained. FINAL-02 test registration is not copied
wholesale.

### FINAL-02 execution runtime is a parallel authority path

The donor FINAL-02 runtime adds an independent merge coordinator, workspace
manager, materializer, repair loop, verification runner, regression runner,
custom sandbox-receipt verifier and production trust store.

Several of those components perform direct filesystem or child-process work
and rely on a custom verification/trust surface instead of the canonical V2
TrustedKernel, execution-authority store, durable recovery state and frozen
contract boundary.

Importing that runtime would create two effect/authority planes. C8 therefore
does not activate it.

### Donor operation model is not grafted onto canonical Twin evidence

FINAL-02 also changes Twin bundle types so the Sovereign Court operation model
flows backward into colony evidence, changes the v2 bundle fingerprint
projection and adds FINAL-02-specific file-operation semantics.

That model is tied to the rejected FINAL-02 materialization runtime and is not
copied into the canonical Twin evidence model. Canonical V2 already owns
artifact SHA-256 identities, execution authority, frozen contracts and durable
recovery.

### Historical artifacts and validation reports

The donor handoff ZIP, patch, FINAL-02 architecture document and validation
report remain historical donor artifacts. They are not applied or treated as
current release evidence.

## Closure

After C8 all 56 FINAL-02 contribution paths have an explicit disposition:

- exact canonical content: no copy needed;
- canonical implementation retained where donor content regresses or belongs
  to the parallel FINAL-02 execution model; or
- donor-only runtime/test/evidence artifacts preserved historically but not
  activated.

No `HUMAN_REVIEW_REQUIRED` or donor-runner pending decision remains in the
FINAL-02 ledger.

This closes donor-branch reconciliation. It does **not** claim canonical runtime
completion. Trusted-executor wiring from C6, canonical factory/orchestrator
execution/replay, and final release qualification remain separate canonical
work before promotion to `main`.
