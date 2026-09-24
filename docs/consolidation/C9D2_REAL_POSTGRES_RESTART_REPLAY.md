# C9D2 — Real PostgreSQL process restart/replay qualification

Base commit: `fe0f2de092ec032c94dea9f41bd13488d90b3e3f`.

C9D2 adds a mandatory real-PostgreSQL release test to the existing
`test:v2:real-postgres-release` runner.

## Qualification sequence

The real release job now:

1. creates an isolated PostgreSQL schema;
2. applies canonical persistence migrations 1 through 4;
3. starts child process A;
4. child A persists a full canonical recovery checkpoint revision plus:
   - one durable canonical factory-completion operation;
   - one durable canonical assurance-proof operation;
5. parent receives a persistence receipt and kills child A with `SIGKILL`;
6. parent verifies the rows are still durable in PostgreSQL;
7. starts a fresh child process B;
8. child B resumes the canonical recovery checkpoint from PostgreSQL;
9. child B reconstructs `PostgresCanonicalFactoryEvidenceAuthority` and
   independently verifies the already-completed factory and assurance proof;
10. only then may the release test report PASS.

The test does not treat a pool reconnect in the same process as a process
restart. Two separate Node processes are required.

## Release-gate status

The source/P0 phase does not claim real PostgreSQL proof. The proof becomes
established only after the pushed commit's mandatory GitHub
`V2 Real PostgreSQL Release` job executes the new test successfully.
