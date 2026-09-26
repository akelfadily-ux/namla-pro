# C9E2A — EER writer + durable orchestrator vertical slice

Base commit: `53ce11891a0f8bb3fd87400b86f04c07d5d9ab68`.

C9E2A connects the real durable EER writer from C9E1D to the C9B durable
canonical orchestrator.

## Successful canonical path

The production path is now:

`EER`
→ real `EerEngine`
→ `canonical.factory-output.v2`
→ `canonical.factory-completion.v2`
→ independent C9D verification
→ durable recovery CAS
→ `LOOP_AFTER_EER`

The writer still has no cursor mutation capability. Only
`DurableCanonicalRuntimeOrchestrator.commitFactoryCompletion()` performs the
cursor transition.

## Restart windows

C9E2A handles both important restart cases.

### Writer durable, cursor still EER

If output + completion were committed but the process died before the recovery
checkpoint advanced, a fresh orchestrated runtime resumes at EER. The EER writer
replays the exact completed durable operations without acquiring another task
lease, then the orchestrator performs the missing durable cursor transition.

### Cursor already LOOP_AFTER_EER

A fresh process does not simply trust the recovery cursor. It derives the prior
stable EER completion key, re-reads and independently verifies the completion,
re-reads the durable EER output, verifies its binding/fingerprint and restores
the EER result before reporting the step as already advanced.

Tampered durable EER output therefore fails closed on restart.

## Authority boundary

C9E2A does not evaluate the NAMLA LOOP gate and does not advance beyond
`LOOP_AFTER_EER`.

C9E2B will add a mandatory real PostgreSQL child-process restart test for this
exact vertical slice.
