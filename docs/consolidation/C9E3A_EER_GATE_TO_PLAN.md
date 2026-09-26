# C9E3A — Verified EER NAMLA LOOP to PLAN

Base commit: `215c42a0e4ad9b3a424da5a4079b82366e32d66c`.

C9E2 proved that the real EER factory, its durable output/completion records and
the durable cursor survive actual PostgreSQL process loss.

C9E3A now closes the next canonical boundary:

`EER -> LOOP_AFTER_EER -> PLAN`

## Gate evidence

The gate is not supplied with an arbitrary caller-created PASS token.

The runtime first obtains an EER result that has already passed the C9D durable
completion authority and C9E durable-output verification.

From that verified result it derives:

- an immutable ArtifactIdentity whose SHA-256 identity is the exact EER output
  fingerprint;
- an environment identity for the gate verifier;
- a deterministic VALID qualification EvidenceRecord bound to the completion
  operation key, resultRef and output fingerprint.

That exact evidence ID is the required evidence reference passed to NAMLA LOOP.

## Authority

Only `DurableCanonicalRuntimeOrchestrator.evaluateGate()` may persist the
`LOOP_AFTER_EER -> PLAN` cursor transition.

The wrapper cannot directly mutate the recovery checkpoint.

A PASS must produce checkpoint version 3, cursor step version 3 and node PLAN in
PRE_FREEZE phase.

## Recovery

A process restarting at LOOP_AFTER_EER re-verifies durable EER evidence before
the gate and does not acquire another EER execution lease.

A process restarting after the gate CAS already committed recognizes the
persisted PLAN cursor idempotently.

An exhausted loop tick budget yields HUMAN_REQUIRED and leaves the durable cursor
at LOOP_AFTER_EER.

C9E3B will qualify this exact gate transition with real PostgreSQL process
restart before the PLAN writer is added.
