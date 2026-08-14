# Civilization Live Run

The live mission pipeline: `runCivilizationLive(input)` in
`src/civilization/civilizationLiveRunner.ts`. See
[Namla Civilization OS V2](namla-civilization-os-v2-live-mcp.md) for the overview.

## Inputs

`CivLiveInput` carries the consumed-once `CivilizationLivePermit`, the admitted
cohort, an injected `providerDriver` (the V4 `RealLiveProviderDriver` over a
process driver — fake in tests), an injected MCP `executor` (`McpExecutionDriver`),
an injected `verificationDriver`, `defectPresent`, and `approveRepair`.

## Stages

1. **Consume permit** — `consumeCivilizationPermit` (single use; a forged/serialized permit is rejected before any work).
2. **District demand** — the 20 districts publish capability demand; no ant is assigned.
3. **Councils** — 5 national councils (architecture, security, quality, tool-permission, knowledge-validation) reach quorum on policy; the tool-permission council approves capability *categories*, not ants; minority reports recorded.
4. **Provider cognition** — each admitted ant makes exactly one bounded call (`recordCivilizationCall("initial")` → `providerDriver.call({role})`); output normalized to a proposal. Roles map: architecture→architecture, coding/integration/repair→build, others→review.
5. **Bounded MCP** — grants + `mcp.callTool({executor})` within the permit's MCP budget; failures receipted.
6. **Security** — the security district raises ≥1 finding; the security council reviews.
7. **Independent review** — ≥ required reviewers, never self-review; reviewed artifacts applied to the isolated workspace.
8. **Verification** — allowlisted `verificationDriver.run("typecheck"|"test"|"build", …)`; a present defect fails the first run.
9. **Incident + repair** — failure convenes an incident council; if `approveRepair`, one `recordCivilizationCall("repair")` provider call attempts a fix (each real repair needs the separate human phrase); success sets `defectRepaired`.
10. **Close** — final verification green, knowledge accepted, academy evidence updated, provider/MCP health updated, all failures recycled by the waste economy, conserving ledger closed.

## Two entry points, one implementation

The pipeline is factored into two phases around the first verification —
`civLiveSetupPhase` (consume → districts → councils → provider cognition → MCP →
security → review/apply → first verification) and `civLiveFinalizePhase` (repair →
recycle → final verification → knowledge → academy → conservation):

- `runCivilizationLive(input)` — **synchronous**, composes both phases with a
  boolean `approveRepair`. Every automated demo (`demoNamlaCivilizationLiveV2`) and
  the golden harness use this; it emits no logs and its result digest is unchanged.
- `runCivilizationLiveSession(input, hooks)` — **async**, composes the same two
  phases but, only when the first verification failed, awaits `hooks.confirmRepair()`
  for a SEPARATE fresh human authorization between them, and emits redacted stage
  logs. The human `civilization:live` CLI and the `demoCivilizationLiveWiring`
  regression demo use this.

The CLI supplies the real drivers (`RealLiveProviderDriver`→`NodeProviderProcessDriver`,
`RealMcpExecutionDriver`, `RealBackedVerificationDriver`, `RealLiveWorkspaceDriver`
over `ensureCivilizationWorkspace`); the regression demo supplies fakes. Redacted
stage logs (`confirmation-accepted`, `civilization-permit-created`,
`cohort-permits-created`, `workspace-ready`, `councils-ready`,
`provider-request-ready`, `provider-spawn-starting/-completed`,
`mcp-grant-created`, `mcp-call-starting/-completed`, `reviews-completed`,
`artifacts-applied`, `verification-started/-completed`, `incident-created`,
`repair-confirmation-requested`, `repair-provider-starting`, `repair-provider-completed`,
`civilization-live-run-complete`) carry stage names + safe scalars only — never
prompts, credentials, environment, raw provider output, or private AntMind state.

## Counters that must stay zero

`nonVolunteerAssignments`, `centralTaskAssignments`, `queenTaskAssignments`,
`tamaraDirectAntAssignments`, `globalPlannerDecisions`, `selfReviewsAccepted`,
`realProviderCalls`, `realProviderProcessExecutions`, `realMcpExecutions`,
`realNetworkCalls`, `realFilesystemWrites`, `providerBudgetViolations`,
`safetyViolations`.
