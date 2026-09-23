# C9C1 — Canonical PLAN_TEST implementation

Base commit: `94df55d6d80afbe5ae14794c6c02a72db2b46043`.

This substep implements PLAN_TEST as a real V2 capability without activating it
in the canonical runtime registry yet.

PLAN_TEST validates plan structure, dependency targets/cycles, target path shape,
non-negative budget ceilings and full DraftPlan/context structural binding;
delegates PlanContract construction to the existing ProtocolEngine; validates
the exact one-to-one WorkPackage projection; captures the immutable contract
bytes through `captureCanonicalFrozenPlanContract`; and returns a canonical
binding + identity pair plus detached WorkPackages.

This is not execution authority. PLAN_TEST does not itself cross
FROZEN_PLAN_CONTRACT, mint permits, touch the filesystem, execute processes,
deploy, or weaken TrustedKernel.

Registry/adapter activation is deliberately deferred until the remaining five
C9C factories exist, so the canonical runtime remains fail-closed throughout
the implementation sequence.
