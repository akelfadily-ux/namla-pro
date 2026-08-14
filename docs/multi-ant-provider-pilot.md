# Multi-ant provider pilot

`src/cognitive/multiProviderPilotPermit.ts` + `src/academy/realAcademyPilot.ts`
(Build Law §21).

## The pilot permit

`MultiProviderPilotPermit` is non-serializable (WeakSet identity), frozen, and
single-use. It is scoped to pilotId, objectiveId, academy domain, difficulty,
allowed provider ids, workspace, cohort-size max, provider-call max, aggregate
input/output byte maxima, per-call timeout, and a bounded step count. Cohort size
and provider calls are clamped to **5** (`MAX_PILOT_COHORT`,
`MAX_PILOT_PROVIDER_CALLS`). It can never be delegated to an ant or a provider —
neither is code that holds one.

The **real** path (`mintHumanPilotPermit`) mints the pilot permit AND one
single-use R2-style **member permit per accepted ant** in one bounded batch from
ONE typed human confirmation. Automated tests use
`mintPilotPermitForAutomatedTest` (automated-test origin + fake driver); the real
Node driver refuses any non-`human-cli` permit.

## Voluntary cohort selection

Tamara publishes a bounded objective; the academy creates local training demand;
qualified ants observe it and **voluntarily** submit claims (scored from their
own proficiency, prerequisite completion, reliability, remediation status,
energy, recent provider use, learning need, and expected benefit). Cognitive
rotation accepts at most 5. The accepted cohort is a strict subset of the
volunteers — `nonVolunteerAssignments`, `tamaraDirectAntAssignments`,
`centralTaskAssignments`, and `queenTaskAssignments` stay zero.

## Provider allocation and governance

The human chooses the allowed pool; ants may express a preference; the resolver
picks only from the allowed pool. **One real call per admitted ant; at most 5
total; no second call per ant; no automatic real retry** — a failed provider
falls back to deterministic remediation only. Aggregate governance is tracked:
provider calls started/completed/failed, aggregate input/output bytes, timeouts,
Claude/Codex counts, deterministic fallbacks, and remaining budget. **Cost is
represented as unknown** unless a provider CLI returns real cost data — no cost
figure is invented.

## Failure containment

Executable missing, quota exceeded, non-zero exit, timeout, malformed/empty/
truncated output, invalid path, evaluation failure, and partial completion are
all handled: one ant's failure never stops the pilot, the failed ant keeps its
identity and failure evidence, unused calls stay unused, completed results stay
valid, and the final report may be partial. No provider output executes a command.
