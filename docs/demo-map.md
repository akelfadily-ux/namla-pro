# Demo Map

One demo is canonical; the rest are focused feature demos, each proving one
module's safety scenario — none of them is a public entry point; the
runtime path they orbit is defined in [runtime-spine.md](./runtime-spine.md). All demos run with
`node dist/examples/<name>.js` after `npx tsc`. None of them execute
commands, write files, run git, touch the network, or apply proposals —
they exercise data flows and receipted refusals.

## Canonical

| Demo | Phase | Module | Proves | Expected key output |
|---|---|---|---|---|
| `demoEndToEnd.ts` | AH2 | `engine/` (public API) | The full runtime spine through `ColonyEngine.runMission` only: gate → plan → schedule → simulate → receipts → report; bare run and fully equipped run | `accepted: true`, tasks processed, receipt trail in report, `allProposalsUnapplied: true`, pheromone attention snapshot (counts/buckets, no topics), guarantees block, stable DIGEST printed |

## Focused feature demos

| Demo | Phase | Module | Proves | Expected key output |
|---|---|---|---|---|
| `demoMission.ts` | 0 | `core/antQueen` (compatibility façade) | Legacy Queen API delegating to the canonical engine; a planner-only roster shows unmatched roles blocked/skipped rather than silently assigned | final receipt `approved` with `usedDecompositionEngine: true`, blocked/skip receipts present |
| `demoEngineMissionRefusal.ts` | PCC | `engine/colonyEngine` | Canonical refused-mission path: SafetyGuard refuses before admission; nothing processed, proposed, or acted on; refusal receipted with reason codes | `accepted: false`, `tasksProcessed: 0`, refusal receipt, `receiptCount: 2` |
| `demoCreateApprovalContracts.ts` | C0 | `application/` | Focused contracts-and-integrity demo for Capability C0: table-driven valid + refusal matrix over the approval verifier and structural create policy; zero write authority | `allExpectationsMet: true`, `writeApiCount: 0`, `filesCreatedByCapability: 0`, `executed: false`, `receiptCrashCount: 0` |
| `demoCreateDryRun.ts` | C1 | `application/` + `inspector/` | Read-only create-target dry run: real filesystem metadata inspection (safe absent target ready, existing-target/case-insensitive/missing-parent/synthetic-link boundaries blocked, integrity tampering refused) with zero mutation and no write authority | `allExpectationsMet: true`, `readyCandidateCount: 1`, `blockedCases: 4`, `refusedCases: 1`, `filesCreatedByCapability: 0`, `mutationApiCount: 0`, `grantConsumedByDryRun: false`, `receiptCrashCount: 0` |
| `demoC2AuthorityContracts.ts` | C2-A | `application/` + `bootstrap/` | Conditional authority/admission contracts: trusted permit accepted, forged permit refused, strict C2 policy + exact-byte + C0 approval + injected C1 boundary refusals/blocks, non-mutating creator; zero writes, no permit path from the runtime | `allExpectationsMet: true`, `forgedPermitAcceptedCount: 0`, `grantConsumedByC2A: false`, `writeAttemptCount: 0`, `filesCreatedByCapability: 0`, `filesystemMutationApiCount: 0`, `fsImporterCount: 1`, `exactByteFingerprintLength: 64`, `durableReplayProtection: false`, `receiptCrashCount: 0` |
| `demoC2ExclusiveCreateSimulation.ts` | C2-B | `application/projectFileCreator` (injected fake driver) | Full exclusive-create lifecycle via injected fake driver: pre-admission refusals + final-inspection blocks (no consume), admitted open/write/partial/zero-progress/invalid/fsync/close failures and one success (all consume), receipt-failure preserves disk truth, replay refused; real Node driver never invoked | `allExpectationsMet: true`, `admittedAttemptCount: 11`, `grantsConsumedCount: 11`, `preAdmissionConsumptionCount: 0`, `finalInspectionConsumptionCount: 0`, `residualArtifactCases: 7`, `successfulLifecycleCases: 1`, `realNodeDriverInvocationCount: 0`, `filesCreatedByCapability: 0`, `fsImporterCount: 2`, `exactBytesPreserved: true`, `c2cStarted: false` |
| `demoPheromoneFlow.ts` | 0 | `core/pheromoneBus` + `pheromones/` | Emit, reinforce, decay-to-expiry, query | `before` has the trail, `after` empty (expired) |
| `demoSensesLoop.ts` | 0 | `senses/` | Every sense turns context into a typed reading | eight readings with confidence values |
| `demoSafetyBlock.ts` | 0 | `core/safetyGuard` | FORBIDDEN classification + receipted refusal | `level: FORBIDDEN`, matched indicators, blocked receipt |
| `demoInspector.ts` | 1 | `inspector/` | Read-only walk; skips; receipted refusal of a protected read | skip list incl. tool folders, refusal receipt with redacted details |
| `demoMissionPlanning.ts` | 2 | `planner/` | Decomposition, ordering, safety-blocked pipeline, transitive block | 6 ordered / 5 safety-blocked / 1 dependency-blocked |
| `demoCodeProposal.ts` | 3 | `generation/` | Proposal created+queued; protected-path and dangerous-content refusals | reason codes `protected-path`, `safety-blocked`; `applied: false` everywhere |
| `demoReviewLoop.ts` | 4 | `review/` | Clean review, collision finding, repair proposal, refused unsafe repair | `defects-found` verdict, repair created, refusal `safety-blocked`, all unapplied |
| `demoGitProposal.ts` | 5 | `git/` | Commit-as-data; cast-smuggled push refused; planned actions unexecuted | `push-intent-refused`, 3 planned actions `executed: false`, `pushIntent: false` |
| `demoColonySimulation.ts` | 6 | `simulation/` | Deterministic ticks, round-robin, decay, budget halt | run 1 `completed` (12 ticks, builder alternation), run 2 `halted-budget` with halt receipt |
| `demoAgentAdapters.ts` | 7 | `adapters/` | Simulated exchanges; unsafe prompt refused redacted | `simulated: true` on all responses, refusal with fingerprint-only details |
| `demoBotDesktopPlan.ts` | 8 | `bots/` | Desktop plan as data; narration; protected-surface refusal | plan + narration `simulated: true` / `executed: false`, refusal `protected-surface` |
| `demoAntRoleRegistry.ts` | AH2-4A | `ants/antRoleRegistry` | Canonical role metadata: categories, owners, façade standing; pure data, nothing executed | 20 roles total, 7 engine-active, unknown role rejected |
| `demoSafetyMatcher.ts` | AH2-4E | `policies/textIndicatorMatcher` + `core/safetyGuard` + `secretProtectionPolicy` | Regression matrix: harmless embedded words allowed, dangerous/protected wording refused, boundary mechanics, receipt-crash proofing | `allExpectationsMet: true`, `dangerousRegressionCount: 0`, `receiptCrashCount: 0` |
| `demoReceiptIsolation.ts` | AH2-4F | `core/receiptLog` | Per-instance receipt identity: two logs both start at receipt-1, no cross-log sequence bleed, order preserved, traces stay a separate identity domain | `allExpectationsMet: true`, `crashCount: 0` |
| `demoReceiptStatusSemantics.ts` | AH2-4G | `core/receiptStatusSemantics` | Status semantics matrix (admission vs success, refused vs blocked, blocked vs failed) plus live representatives from real runs; failed honestly reported as modeled-but-not-emitted | `allExpectationsMet: true`, `receiptCrashCount: 0` |
| `demoColonyGenesisG0.ts` | G0 | `colony/` | Colony Genesis foundation: deterministic 13-chamber nest, exactly 300 persistent identities (1 queen-system + 299 workers), complete per-ant local state, zero task assignments, identical rerun from the same seed | 300 identities / 16 invariants passed / `centralTaskAssignments: 0` / `queenTaskAssignments: 0` / `deterministicRerunMatches: true` |
| `demoColonyGenesis.ts` | G1-G7 | `colony/` | The full decentralized colony core over a deterministic 400-tick run: local task choice, pheromones, bounded encounters, reserve activation, local recruitment/quorum, brood lifecycle and nursing (never a Queen assignment), worker aging/retirement, and a bounded ≤30 cognitive budget with no real model call | 300 identities preserved / `centralTaskAssignments: 0` / `queenTaskAssignments: 0` / `observedPeakCognitivelyActiveAnts: 30` / `externalLlmCalls: 0` / `allExpectationsMet: true` |
| `demoColonyScale.ts` | G1-G7 | `colony/` | Same reusable `AntAgent` model and tick loop at 300, 1,000, and 10,000 persistent identities: bounded memory, no O(N²) interaction, deterministic rerun match at every scale, plus a dedicated small-colony proof that population renewal genuinely admits a new identity when the cap has room | `allExpectationsMet: true` at every scale / `peakCognitivelyActive: 30` (capped) / `renewalMechanismProven: true` |
| `demoRealCognitiveColony.ts` | Real Cognitive Ants V1 | `colonyMission/` | Full mission pipeline using ONLY `DeterministicCognitiveWorker`: >=3 scout proposals reach local quorum, ants voluntarily claim build work, a bounded (<=5) cognitive budget admits claimants, artifacts are reviewed before being applied to an isolated mission workspace, one injected defect is genuinely detected and repaired, final verification passes | `quorumReached: true` / `peakCognitiveAnts<=5` / `centralTaskAssignments: 0` / `queenTaskAssignments: 0` / `realClaudeCalls: 0` / `realCodexCalls: 0` / `allExpectationsMet: true` |
| `demoGoldenOutputs.ts` | AH2-5 | `tools/demoGolden` + `tools/demoGoldenBaselines` | Focused semantic regression harness for all demo baselines: runs every demo in-process, digests results, evaluates each against its explicit baseline | `allGoldensPassed: true`, `crashCount: 0`, `baselineCoverageComplete: true` |

## Digest

`src/tools/demoDigest.ts` normalizes any demo result into stable review
data (counts, statuses, reason codes, invariant flags — ids, timestamps,
and raw text stripped). `demoEndToEnd` prints its digest; future hardening
steps will diff digests against golden copies.

## Ant Intelligence Deepening V1

| Demo | Phase | Module(s) | What it proves | Key facts |
|---|---|---|---|---|
| `demoAntIntelligenceDeepening.ts` | AID-V1 | `colony/antMind` + `localPlanning` + `selfEvaluation` + `peerReviewSystem` + `antTeams` + `colonyKnowledgeSystem` + `mentorshipSystem` + `colonyCrisisSuite` + `antIntelligenceRuntime` | 12 bounded missions + 10-scenario crisis suite + mentorship phase over an evolved 300-identity colony, then 300/1,000/10,000 mind-scale validation; every metric counted from real behavior | 299 distinct cognitive profiles; plans created + revised; calibration error 0.207→0.031; 72 peer reviews with disagreements; 12 teams formed + dissolved; 99 knowledge proposals (45 accepted / 54 rejected / 3 contradictions); 19 mentorships; 10/10 crises recovered; `central=queen=globalPlanner=0`; peak cognitive ≤30; `externalLlmCalls=0`; deterministic rerun matches |

See [ant-intelligence-deepening-v1.md](./ant-intelligence-deepening-v1.md),
[ant-mind-model.md](./ant-mind-model.md),
[local-planning.md](./local-planning.md),
[peer-review-and-teams.md](./peer-review-and-teams.md),
[colony-knowledge-learning.md](./colony-knowledge-learning.md), and
[colony-crisis-resilience.md](./colony-crisis-resilience.md).

## Real Cognitive Ants R1

| Demo | Phase | Module(s) | What it proves | Key facts |
|---|---|---|---|---|
| `demoRealCognitiveAntsR1.ts` | R1 | `colonyMission/missionRunner` + registry/router/budget + `deterministicCognitiveWorker` + `missionWorkspace` (`fakeWorkspaceDriver`) + `proposalCompetition` + `reviewLoop` + `verificationRunner` + `commandCenterState` | Deterministic end-to-end task-manager mission over the provider-neutral bounded cognitive runtime: proposal competition + local quorum, voluntary work market, bounded cognitive admission, artifact review, verification, one injected defect, bounded repair | 300 identities; 3 scout proposals reach quorum (2 rejected); 767 voluntary claims → 5 accepted, `nonVolunteerAssignments=0`; peak cognitive 3 ≤5; 1 defect detected + repaired; `finalVerificationPassed=true`; `central=queen=globalPlanner=0`; `realClaude=realCodex=realProcess=realNetwork=realFsWrite=0` |

See [real-cognitive-ants-r1.md](./real-cognitive-ants-r1.md) and the linked R1
docs (cognitive-worker-runtime, provider-adapter-boundary, software-work-market,
mission-workspace-security, review-test-repair-loop, command-center-state).

## Real Cognitive Ants R2

| Demo | Phase | Module(s) | What it proves | Key facts |
|---|---|---|---|---|
| `demoRealProviderActivationR2.ts` | R2 | `cognitive/realProviderActivation` + `realProviderExecutionPermit` + `providerProcessDriver` (fake) | The human-only provider execution boundary across 22 cases (permit forgery/scope/consume/replay refusals, every process failure path, fake Claude+Codex success), fake driver only | 22/22 cases; `forgedPermitsAccepted=0`; `preAdmissionPermitConsumption=0`; `replayRefusals=2`; `realClaude=realCodex=realProcess=0`; `sourceTreeWrites=0`; `workspaceBoundaryViolations=0`; `central=queen=globalPlanner=0` |

See [real-cognitive-ants-r2.md](./real-cognitive-ants-r2.md),
[real-provider-execution-boundary.md](./real-provider-execution-boundary.md),
[human-provider-smoke.md](./human-provider-smoke.md), and
[provider-process-security.md](./provider-process-security.md).

## Tamara–Namla Federation V1 + Ant Academy V1

| Demo | Phase | Module(s) | What it proves | Key facts |
|---|---|---|---|---|
| `demoAntAcademyV1.ts` | Fed/Academy V1 | `academy/*` + `federation/*` + reused `colonyMission`/`colony` | 300-ant academy across 18 domains: training + independent-evaluator exams, evidence-gated promotion, mentorship, a multi-domain project, certification; plus a Tamara objective the colony self-organizes; 300/1,000/10,000 scale | 18 domains; passes+failures; promotions+rejections; certifications; `selfCertifications=0`; `unsupportedPromotions=0`; teams/reviews/verification/repair; diversity maintained; peak cognition ≤30; `central=queen=tamaraDirect=globalPlanner=0`; `realClaude=realCodex=realNetwork=realFs=process=0` |

See [tamara-namla-federation-v1.md](./tamara-namla-federation-v1.md) and
[ant-academy-v1.md](./ant-academy-v1.md) (+ the six linked academy docs).

## Real Academy Pilot V2

| Demo | Phase | Module(s) | What it proves | Key facts |
|---|---|---|---|---|
| `demoRealAcademyPilotV2.ts` | Pilot V2 | `cognitive/multiProviderPilotPermit` + `academy/realAcademyPilot` + `providerProcessDriver` (fake) | A 5-ant voluntary cohort trains through the fake provider driver: mixed Claude/Codex, quota + malformed failures, independent evaluation with one failure, remediation, bounded evidence updates, zero certifications, partial outcome | 5 cohort from 151 volunteers; `quotaFailures=1`; `malformedResults=1`; eval 2 pass/1 fail; `certificationsGranted=0`; `nonVolunteer=tamaraDirect=central=queen=globalPlanner=0`; `realClaude=realCodex=realProcess=realFs=realNet=0` |

See [tamara-namla-real-academy-v2.md](./tamara-namla-real-academy-v2.md) and its
linked pilot docs.

## demoDigitalSuperorganismV1 (Build Law §23)

`src/examples/demoDigitalSuperorganismV1.ts` — the deterministic Digital
Superorganism Metabolism V1 proof. Runs a 300-identity high-tech project
(information → knowledge → plan → artifacts → review → test → waste → repair),
self-checks 36 expectations (`allExpectationsMet`, empty `mismatchCaseIds`), and
re-verifies conservation + causality at 300 / 1,000 / 10,000 identities. Proves
`digitalResourceConservationValid`, `unexplainedResourceCreation === 0`,
`causalityViolations === 0`, `providerCalls === 0`, `peakCognitiveWorkers ≤ 30`,
and all central/queen/tamara/global-planner assignments === 0. Registered in the
golden harness (32nd demo).

## demoDigitalSuperorganismOperationsV2 (Build Law §24)

`src/examples/demoDigitalSuperorganismOperationsV2.ts` — the deterministic proof
that Tamara's software objective becomes reviewed, tested, repaired software. 300
identities (1 queen + 299 workers), fake workspace + verification drivers, a
full-stack task-manager objective. Injects exactly one defect, detects it via
verification, recycles the failure through repair, and delivers. Self-checks 49
expectations (`allExpectationsMet`, empty `mismatchCaseIds`) and re-verifies
conservation + causality at 300 / 1,000 / 10,000. Proves all real-action counters
0, `workspaceBoundaryViolations === 0`, `causalityViolations === 0`, and all
central/queen/tamara/global-planner assignments 0. Registered in the golden
harness (33rd demo).

## demoDigitalLiveObjectiveV3 (Build Law §25)

`src/examples/demoDigitalLiveObjectiveV3.ts` — the deterministic fake-live proof
of the human-authorized three-ant live objective. 300 identities, voluntary
cohort of 3, fake provider/verification drivers, in-memory live workspace.
Exercises the happy planning/build/review flow (one isolated provider failure, one
detected defect, one approved repair, final verification green) plus 24 guard
cases (missing/forged permit, wrong objective/workspace/cohort, non-volunteer,
provider mismatch, oversized/malformed output, invalid path, self-review, review
rejection, permit replay, provider-call and repair-call budgets). Proves
`acceptedLiveCohortSize: 3`, `providerCallsStarted: 3`, `repairCalls: 1`,
`finalObjectivePassed: true`, all real-action counters 0, `safetyViolations: 0`,
empty `mismatchCaseIds`. Registered in the golden harness (34th demo).

## demoDigitalLiveObjectiveV4Wiring (Build Law §26)

`src/examples/demoDigitalLiveObjectiveV4Wiring.ts` — proves the REAL live wiring
is reachable and correct through the FAKE process driver, making zero real calls.
Drives `RealLiveProviderDriver` (permit → consume → process → parse) with a
role-aware fake process driver: three provider calls, review-before-apply, one
detected defect, one confirmed repair, final verification green. 15 guard cases
(no permit, provider mismatch, single-use, malformed output, automated-permit
blocked from the real Node driver without executing, provider-call caps 3+2=5,
repair-requires-confirmation, self-review refused) and 14 expectations; all
real-action counters 0. Registered in the golden harness (35th demo).

## demoNamlaCivilizationLiveV2 (Civilization OS V2 — Live MCP Settlement)

The deterministic all-fakes proof of the live civilization mission: 299 settlement
workers, ≥15 voluntary live claims, a 3-ant admitted cohort (codex, codex,
claude) over the V4 `RealLiveProviderDriver` on a role/provider-aware **fake**
process driver, a `FakeMcpExecutionDriver` (one isolated tool failure), an
in-memory workspace, and a fake verification driver run with `defectPresent` +
`approveRepair`. 41 self-checks cover cohort ≤5, ≤8 provider calls, no
central/queen/tamara/global-planner assignment, no self-review, one verification
failure → incident → one confirmed repair → final green, and every `real*`
counter 0. Registered in the golden harness. See
[namla-civilization-os-v2-live-mcp.md](namla-civilization-os-v2-live-mcp.md).

## demoCivilizationLiveCleanup (Civilization OS V2 — live process-cleanup regression)

Fake-driver proof that a live civilization run leaves nothing running. It drives
`runCivilizationLiveSession` across three terminal shapes — clean success, failure
+ confirmed repair, and failure + rejected repair — and proves for each (26 checks
total) that the `CivilizationLivePermit` is consumed and NOT reusable, every MCP
grant issued was revoked (`grantsIssued === grantsRevoked`), no real
provider/MCP/filesystem/network action occurred, and the fake process driver left
no lingering process; plus that a readline opened via `askOnce` closes immediately
and a cleared watchdog never fires. Async, standalone (not in the sync golden
harness). See [civilization-live-preflight.md](civilization-live-preflight.md).
