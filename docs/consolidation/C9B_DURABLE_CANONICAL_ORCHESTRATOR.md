# C9B — Durable canonical runtime orchestrator

Base commit: `df3a4d8e4956345da8ed896a82e977f98ab91e27`.

C9B adds the durable control-plane orchestrator over the existing 10E5 stepper
and 10E6 recovery checkpoint/session.

## What is now durable

The orchestrator creates or explicitly resumes the complete recovery snapshot:

- exact canonical cursor;
- loop budget balances;
- all external NAMLA LOOP livelock counters;
- lifetime failure count;
- immutable Frozen PlanContract binding after the exact PLAN_TEST boundary.

Factory advancement requires a `CanonicalFactoryCompletionAuthority`. A caller
cannot advance a factory by supplying `FACTORY_COMPLETED` directly. The
completion authority must verify a durable result reference and output
fingerprint bound to the current mission, factory, checkpoint revision and
cursor step.

NAMLA LOOP evaluation uses the persisted state. Missing/stale evidence increments
and persists exactly one consecutive failure plus lifetime failure accounting.
PASS resets the active gate counter and advances exactly one canonical node.

The Frozen PlanContract is accepted only on
`LOOP_AFTER_PLAN_TEST -> PRO`, and only when its bytes verify against an
independent external identity pin.

## What C9B deliberately does not claim

C9B is not a generic factory execution engine and does not persist heterogeneous
factory outputs itself. The completion-authority port must be backed by durable
factory operation/result records in the next factory-runtime step.

The six shell-only factories remain fail-closed:

- PLAN_TEST
- FINAL_SPRINT_COURT
- LIHU
- DEVOPS
- API_INTEGRATION
- SECURITY

The legacy `NamlaRuntime` is not wired into this path.

Real PostgreSQL process restart/replay qualification of the orchestrator remains
a later release gate; C9B focused tests use the existing recovery-store contract.
