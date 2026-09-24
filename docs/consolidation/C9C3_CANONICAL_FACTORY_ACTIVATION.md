# C9C3 — Atomic canonical factory activation

Base commit: `0d1906b4208c324b6811e2dc6b84f4e0d47fd37f`.

C9C3 atomically activates the six C9C implementations in the canonical shell
and runtime-adapter registries:

- PLAN_TEST
- FINAL_SPRINT_COURT
- LIHU
- DEVOPS
- API_INTEGRATION
- SECURITY

After this cutover all 13 canonical factories are runtime-backed and the
canonical shell-only set is empty.

## Preserved authority boundaries

Activation does not mean "caller may advance at will".

- PLAN_TEST remains `PRE_FREEZE`.
- PLAN_TEST completion advances only to `LOOP_AFTER_PLAN_TEST`.
- The Frozen PlanContract is still established only by a PASS/NEXT verdict at
  that exact gate with the independently pinned immutable contract binding.
- PRO and every later factory remain `CONTRACT_BOUND`.
- C9B's durable `CanonicalFactoryCompletionAuthority` remains mandatory before
  the orchestrator advances any factory cursor.
- C9C2's post-ProMax proof authority remains responsible for verifying the
  exact durable assurance proof chain.
- No legacy `NamlaRuntime`, `PROTOCOL` top-level factory or `COLONY_AB` top-level
  factory is introduced.

## Exact adapter surfaces

- PLAN_TEST -> `PlanTestFactory.validateAndFreezePlan`
- FINAL_SPRINT_COURT -> `FinalSprintCourtFactory.adjudicate`
- LIHU -> `LihuFactory.evaluate`
- DEVOPS -> `DevOpsFactory.qualifyRelease`
- API_INTEGRATION -> `ApiIntegrationFactory.verifyIntegrations`
- SECURITY -> `SecurityFactory.verifySecurity`

This activation changes availability metadata and canonical stepper resolution.
It does not itself execute a factory, deploy, release, perform network calls or
mint TrustedKernel authority.
