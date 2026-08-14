# Digital Superorganism Operations V2

Operations V2 turns the §23 digital economy into a **real high-tech mission
workflow**: Tamara publishes one strategic software objective, the ant nation
metabolizes it into digital resource demands, workers voluntarily perform bounded
cognitive work, and the colony creates, reviews, verifies, repairs, and delivers a
project inside an isolated workspace — all conserving and decentralized.

## The pipeline (18 steps)

1. Tamara publishes a `DigitalTechnologyObjective` (DATA).
2. Scouts collect requirements as raw information.
3. Verification converts requirements into knowledge.
4. ≥3 scouts independently propose approaches.
5. A **local quorum** selects a plan (no planner / Queen / Tamara choice).
6. The objective is metabolized into bounded demands (each with a cause).
7. Workers **voluntarily** claim demands; a contention resolver picks among volunteers only.
8. Bounded hands receive tool permit + context + compute + tokens.
9. Builders (some deterministic-cognitive) produce reviewed artifact proposals.
10. Independent reviewers (never the builder) attest them; high-risk needs 2.
11. Reviewed artifacts are applied to the isolated workspace.
12. Verification runs and detects exactly one injected defect.
13. The failure becomes `errorWaste` + `technicalDebt` + a repair demand.
14. A repair ant voluntarily claims the repair; a reviewed repair artifact is applied.
15. Final verification passes.
16. The failure is recycled into reusable knowledge.
17. Bounded Academy evidence is recorded (no instant promotion).
18. The objective is delivered.

## Modules

- `digitalObjective.ts` — the objective contract + demand metabolism.
- `digitalWorkspace.ts` — the bounded, attributed in-memory workspace + boundary.
- `digitalVerification.ts` — the allowlisted verification boundary + fake driver.
- `digitalOperationsRunner.ts` — the 18-step orchestrator.
- `digitalOperationsReport.ts` — metrics + conservation + causality + command center.
- `demoDigitalSuperorganismOperationsV2.ts` — deterministic proof + 300/1k/10k scale.

## Guarantees

- **Decentralized** — `centralTaskAssignments`, `queenTaskAssignments`, `tamaraDirectAntAssignments`, `globalPlannerDecisions`, `nonVolunteerAssignments` all 0.
- **Conserving** — `digitalResourceConservationValid`, `unexplainedResourceCreation === 0`.
- **Causal** — `causalityViolations === 0` (see [digital-resource-conservation.md](digital-resource-conservation.md)).
- **No real action** — `realClaudeCalls`, `realCodexCalls`, `realProviderProcessExecutions`, `realNetworkCalls`, `realFilesystemWrites` all 0; `workspaceBoundaryViolations === 0`.
- **Bounded cognition** — `peakCognitiveWorkers <= 5`.
- **Real defect handling** — one defect injected, detected by verification, recycled through repair, final verification green.

Real provider activation, real-disk workspaces, and real verification execution
remain separate, human-authorized capabilities (see
[digital-review-verification-repair.md](digital-review-verification-repair.md)
and the inert `digital:real-objective` CLI).

## Successor: Live Objective V3 (Build Law §25)

V3 makes the workflow LIVE and human-authorized: exactly three voluntarily
admitted real cognitive ants (Claude/Claude/Codex) build and repair one real
project under explicit human control, at most five real provider calls, no
source-tree writes, independent review before disk, allowlisted verification, and
separate confirmation for each repair call. See
[digital-superorganism-live-objective-v3.md](digital-superorganism-live-objective-v3.md).
