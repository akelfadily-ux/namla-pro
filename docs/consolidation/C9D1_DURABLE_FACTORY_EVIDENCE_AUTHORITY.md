# C9D1 — Durable canonical factory evidence authority

Base commit: `b5cd16304f706ca18e0fefbf5d436eb91ee51168`.

C9D1 binds the C9B `CanonicalFactoryCompletionAuthority` and the C9C2
`CanonicalPostProMaxProofAuthority` to the existing PostgreSQL execution
authority ledger.

No new table or migration is introduced.

## Verification rule

A completion/proof is accepted only when an existing
`namla_v2_operation_claims` row is already `COMPLETED` and all of the following
match exactly:

- mission;
- deterministic canonical operation key / durable result ref;
- canonical task id;
- canonical authority scope;
- canonical operation type;
- operation input fingerprint recomputed from the exact completion/proof;
- durable JSON result equal to the exact completion/proof value.

Therefore a caller cannot make an in-memory completion/proof authoritative by
calling the verifier. The durable operation must already exist and must have
been finalized through the fenced execution-authority path.

## Read-only boundary

`PostgresExecutionAuthorityStore.readCompletedOperation` is intentionally
read-only. It never acquires/renews a lease, claims an operation or finalizes a
row.

`PostgresCanonicalFactoryEvidenceAuthority` is also verify-only. It exposes no
method capable of creating the evidence it trusts.

Real PostgreSQL process-restart/replay qualification is the next substep C9D2.
