# C9E1D — Real EER durable writer

Base commit: `99d7adba5591cb11290658485965a63dc91fd8da`.

C9E1D is the first canonical factory that is actually executed by the new
durable runtime path.

The writer executes the real `EerEngine.evaluateObjective` implementation and
does not use a generic fake `execute()` adapter.

## Successful write

One successful EER step creates exactly two durable fenced operation records:

1. `canonical.factory-output.v2`
   - stores the exact successful `EerExecutionResult`;
   - stable operation identity belongs to the canonical EER step;
   - the operation fingerprint remains bound to the exact completion and output
     fingerprint.

2. `canonical.factory-completion.v2`
   - stores the exact `CanonicalFactoryCompletion`;
   - is independently verifiable by the existing C9D authority.

The writer performs a current claim-fence validation immediately before every
finalization.

After persistence it independently re-reads both durable records. It returns a
completion only if both C9D completion verification and C9E output verification
pass.

## Restart and replay behavior

A complete durable EER step is returned as `REPLAY_COMPLETED` without acquiring
another execution lease.

If a crash occurred after the output was completed but before completion was
completed, the deterministic EER result reuses the existing output operation
and writes only the missing completion. The result is `RECOVERED`.

A conflicting output for the same canonical step cannot create another output
or completion key because C9E1B/C9E1C made both identities step-stable.

## Authority boundary

This writer cannot advance the canonical cursor.

Cursor advancement remains exclusively in
`DurableCanonicalRuntimeOrchestrator`, which must independently verify the
returned durable completion through C9D.

C9E2 will connect this writer and the orchestrator on real PostgreSQL and prove
the complete EER -> LOOP_AFTER_EER transition across process restart.
