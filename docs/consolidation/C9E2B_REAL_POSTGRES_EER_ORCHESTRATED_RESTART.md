# C9E2B — Real PostgreSQL EER orchestrated restart proof

Base commit: `411271f919eda77c03e450c3fa8ae654b2be60f3`.

C9E2B makes the complete C9E2A crash-window scenario mandatory in the real
PostgreSQL release gate.

Process A durably creates the EER recovery checkpoint, executes the real
`EerEngine`, completes `canonical.factory-output.v2` and
`canonical.factory-completion.v2`, but is killed with SIGKILL before cursor
advancement.

PostgreSQL must therefore contain checkpoint version 1 at EER, exactly two
completed EER operations and EER lease epoch 1.

Process B is fresh. It resumes the persisted EER cursor, replays the durable
factory evidence without acquiring another EER lease and lets only the durable
orchestrator persist the transition to `LOOP_AFTER_EER`.

Process C is fresh again. It resumes at `LOOP_AFTER_EER` and independently
re-verifies the durable EER completion and output rather than trusting the
cursor alone.

The mandatory release proof must print:

- `C9E2B_REAL_PG_EER_CRASH_GAP_RESTART=PASS`
- `C9E2B_REAL_PG_CURSOR=LOOP_AFTER_EER`
- `C9E2B_REAL_PG_COMPLETED_OPERATIONS=2`
- `C9E2B_REAL_PG_EER_LEASE_EPOCH=1`

Local P0/source checks are not PostgreSQL proof. The proof is established only
by the pushed GitHub real-PostgreSQL release job.
