# Architecture

## What Namla Pro is

Namla Pro is an experimental multi-agent system for software engineering. It
models a software colony after a real ant colony: many small specialized
workers (ants), indirect coordination through scent trails (electronic
pheromones), a small set of structured perceptions (digital senses), a single
accountable ruler who accepts missions (the Queen), and a hard safety layer
that every action must pass through before it is allowed to happen.

**Current state.** The repository contains two layers with a hard line between
them. A *deterministic runtime* plans, coordinates, generates proposals and
reviews them, and performs no real action — it is the layer exercised by the
41 golden demos and by `npm run demo`. Separately, a small set of *enforcement
boundaries* carries real authority: workspace containment, mount-source
validation, the sandbox policy gate, a real Docker container backend, the
outbound provider boundary, and process-tree termination. Those boundaries
execute real code, and each fails closed.

This document describes that current architecture. For how the project reached
it, see [Historical evolution](#historical-evolution) at the end; for what is
implemented versus planned, see the status table in the
[README](../README.md#implementation-status); for a shorter route in, see
[PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md). See
[NAMLA_BUILD_LAW.md](../NAMLA_BUILD_LAW.md) for the non-negotiable rules and
[roadmap.md](./roadmap.md) for the phase plan.

## Why an ant colony model

Traditional single-agent AI coding assistants concentrate all reasoning,
planning, and action in one place. That is simple at small scale, but it does
not scale to many cooperating workers, and it gives no natural seams for
safety review, specialization, or partial autonomy. Ant colonies solve
exactly this class of problem in nature:

- **No single point of total knowledge.** Each ant only needs to sense its
  local situation and react to trails other ants left behind.
- **Specialization without central scheduling.** Roles (scout, builder,
  guard, nurse, ...) let different kinds of work happen without one
  generalist trying to do everything.
- **Indirect coordination (stigmergy).** Ants communicate by changing their
  shared environment (pheromone trails) rather than by direct messaging,
  which scales better and survives individual ants failing.
- **Emergent resilience.** No single ant is critical; the colony adapts as
  trails strengthen, fade, or redirect.

Namla Pro borrows this model deliberately, not decoratively: pheromone decay,
reinforcement, and querying in this codebase are a real (if simple)
implementation of stigmergic coordination, not just themed naming.

## The core building blocks

- **AntIdentity / AntState** (`src/types/antTypes.ts`) — who an ant is: role,
  generation, trust level, capabilities, current energy.
- **Digital senses** (`src/senses/`) — structured perception: vision,
  hearing, smell, touch, taste, memory, time, risk. Every sense turns raw
  context into a typed `SenseReading`.
- **Electronic pheromones** (`src/pheromones/`, `src/core/pheromoneBus.ts`) —
  the shared, decaying, reinforceable signal space ants use to coordinate.
- **Missions and tasks** (`src/types/missionTypes.ts`,
  `src/types/taskTypes.ts`) — a mission is human intent; tasks are the
  colony's decomposition of that intent.
- **AntQueen** (`src/core/antQueen.ts`) — the single entry point: accepts a
  mission, checks safety, plans, routes, and receipts the outcome.
- **SafetyGuard** (`src/core/safetyGuard.ts`) — classifies any text or
  planned action as SAFE, CAUTION, RISKY, or FORBIDDEN.
- **ReceiptLog** (`src/core/receiptLog.ts`) — an append-only, in-memory
  record of every attempted action, approved or blocked.
- **ColonyMemory** (`src/core/colonyMemory.ts`) — non-secret, long-lived
  facts the colony wants to recall.
- **Bot/robot bodies** (`src/bodies/`) — the abstraction for how an ant would
  eventually act in the world. They still only ever return a
  `PlannedAction`; nothing is executed. This layer remains planning-only.
- **Ant roles** (`src/ants/`) — twenty concrete ant classes, one per role,
  each producing receipt-shaped output.
- **Policies** (`src/policies/`) — the specific, checkable rules SafetyGuard
  and the adapters lean on: command safety, file boundaries, secret
  protection, pheromone safety, body execution, and autonomous loop budgets.

## How a mission flows through the colony

```
Human instruction
      |
      v
  AntQueen.acceptMission
      |  SafetyGuard.evaluateText (mission level)
      |  emits HumanIntentPheromone
      v
  MissionPlanner.planInitialTasks
      |  one ColonyTask per MissionGoal
      v
  ColonyOrchestrator.processTasks
      |  SafetyGuard.evaluateText (task level)
      |  TaskRouter.route -> assigns to an available ant by role
      |  emits TrailPheromone on success, BlockedActionPheromone on refusal
      v
  ReceiptLog
      |  one receipt per safety check, per routing decision, and a final
      |  mission-level receipt
      v
  Human (or ReporterAnt) reviews receipts and pheromones
```

At no point in this flow does anything touch the real filesystem, a shell, or
the network. `BotBody`, `RobotBody`, `CommandAdapter`, and `FileAdapter` exist
as typed placeholders so the *shape* of future execution is already decided,
but `PlannedAction.executed` remains hard-typed to `false`.

## Module boundaries

- `src/types/` has no logic and no imports from other `src/` folders — it is
  pure shape.
- `src/core/` depends on `src/types/`, `src/pheromones/`, and
  `src/policies/`. It is the only place that wires services together.
- `src/senses/`, `src/pheromones/`, `src/bodies/`, `src/ants/` each depend on
  `src/types/` and `src/policies/`, but not on each other, keeping them easy
  to reason about in isolation.
- `src/policies/` depends only on `src/types/` (where needed) and Node's
  built-in modules — it is the lowest layer other than types.
- `src/examples/` is the only place allowed to import broadly across the
  tree, since its job is to demonstrate integration.
- `src/inspector/` (Phase 1) depends on `types/`, `policies/`, and `core/`
  (`ReceiptLog`). `ScoutAnt` and the vision/touch senses may consume an
  injected inspector or its `ProjectSnapshot`; no other module may call the
  filesystem. See [inspector-model.md](./inspector-model.md).
- `src/planner/` (Phase 2) depends on `types/`, `core/` (`SafetyGuard`,
  `ReceiptLog`), and `inspector/` types. `AntQueen` consumes the
  `DecompositionEngine` when given a snapshot; `PlannerAnt` receives one by
  injection. See [mission-planning-model.md](./mission-planning-model.md).
- `src/generation/` (Phase 3) depends on `types/`, `core/`, `policies/`, and
  the `inspector/` classifier. It imports no fs API: proposals are data.
  `BuilderAnt` receives a `ProposalFactory` by injection. See
  [code-generation-model.md](./code-generation-model.md).
- `src/review/` (Phase 4) depends on `types/`, `core/`, `generation/`, and
  `inspector/` types. Pure analysis over in-memory data; no fs API, no new
  capability class. Tester/Auditor/Repair ants receive reviewers by
  injection. See [review-loop-model.md](./review-loop-model.md).
- `src/git/` (Phase 5) depends on `types/`, `core/`, `generation/` types,
  `bodies/` (the PlannedAction helper), and the `inspector/` classifier.
  Git is modeled as data; no git command runs and push is unrepresentable.
  `ArchivistAnt` receives the commit factory by injection. See
  [git-integration-model.md](./git-integration-model.md).
- `src/simulation/` (Phase 6) depends on `types/`, `core/`, `policies/`,
  `planner/`, and optionally injected `generation/`/`review/`/`adapters/`
  capabilities. Virtual time only, hard-capped step budget, deterministic
  scheduling; advances only under a human-run script. Since AH2 Step 4B
  the scheduler consumes the canonical `AntState` from `types/antTypes.ts`
  (`SimulationAntState` is a deprecated alias). See
  [simulation-model.md](./simulation-model.md).
- `src/adapters/` (Phase 7) depends on `types/`, `core/`, and `generation/`.
  Simulated agent data contracts only: canned deterministic responses,
  `simulated: true` by literal type, no credentials or endpoints modeled,
  no network or process API imported. Registered by injection into an
  `AdapterRegistry`. See [agent-adapter-model.md](./agent-adapter-model.md).
- `src/bots/` (Phase 8) depends on `types/` and `core/` only. Desktop
  automation as simulated planned data: human-language targets (no
  coordinates, handles, or screenshots representable), a protected-surface
  deny list, and a narrating simulator. Distinct from `src/bodies/` (the
  original planning abstractions, still planning-only). See
  [bot-desktop-model.md](./bot-desktop-model.md).
- `src/engine/` (Architecture Hardening 2) is the **public runtime API
  layer**: `ColonyEngine.runMission` is the single entry point, delegating
  to the `simulation/` spine and re-exporting the request/report types.
  Since the Pre-Capability Closure pass, `AntQueen` is a compatibility
  façade that itself delegates to the engine — there is no parallel
  mission spine, and `ColonyOrchestrator`/`TaskRouter` are deprecated
  compatibility artifacts. For the runtime path itself — including the
  role of ant façades, pheromones-as-trace-data, and the intentionally
  open debt — [runtime-spine.md](./runtime-spine.md) is authoritative.
- `src/colony/` (Colony Genesis G0-G7, Build Law §§12-15) is a **separate
  runtime**, not part of the mission pipeline. It depends only on itself —
  it imports **nothing** from `src/simulation/`, `src/planner/`,
  `core/taskRouter`, `core/colonyOrchestrator`, or `core/missionPlanner`,
  and that import boundary is grep-verified in `SAFETY_INVARIANTS.md`. G0
  builds a deterministic 13-chamber nest graph and exactly 300 persistent
  identities (1 Queen-system + 299 worker-capable `AntAgent` records). G1-G5
  add a bounded, deterministic per-tick behavior loop: chamber-local task
  stimulus and pheromones, bounded encounters, response-threshold task
  choice with learning/forgetting, reserve activation, and local
  recruitment/quorum with no global tally or winner. G6-G7 add brood
  lifecycle (bounded, population-cap-gated, never AntAgents until admitted),
  worker aging/retirement, generation transitions, and a bounded per-tick
  cognitive budget (≤30, never a real model call). Every phase keeps
  `centralTaskAssignments` and `queenTaskAssignments` literal-zero and adds
  no real-world authority of any kind. The C0–C2-B capability stack runs in
  parallel and is untouched. See [colony-genesis-g0.md](./colony-genesis-g0.md),
  [colony-genesis-g6-g7.md](./colony-genesis-g6-g7.md),
  [colony-scalability.md](./colony-scalability.md), and
  [ant-colony-biological-model.md](./ant-colony-biological-model.md).
- `src/colonyMission/` (Real Cognitive Ants V1, Build Law §16) is a bounded
  mission layer built ON TOP of Colony Genesis — `src/colony/` itself is
  untouched. It gives the reused 300-identity population real missions: a
  provider-neutral cognitive-worker contract, a deterministic fake provider
  used by every automated path, a software work market reusing each ant's
  own G0 `skillTendencies`, scout-proposal local quorum, a bounded (≤5
  concurrent) cognitive-execution budget, and an artifact
  propose→review→verify→repair loop against an isolated, boundary-checked
  mission workspace. Claude Code CLI and Codex CLI adapters exist as fully
  specified planned invocations that always refuse actual execution —
  real process execution is a Section 1 hard boundary, not amendable, and
  this layer does not attempt to loosen it. See
  [real-cognitive-ants-v1.md](./real-cognitive-ants-v1.md),
  [cognitive-worker-runtime.md](./cognitive-worker-runtime.md),
  [real-provider-adapters.md](./real-provider-adapters.md),
  [colony-work-market.md](./colony-work-market.md), and
  [mission-workspace-security.md](./mission-workspace-security.md).
- `src/ants/antRoleRegistry.ts` (AH2 Step 4A) is the **canonical role
  metadata registry**: category, runtime use, and canonical owner for all
  twenty roles, compiler-enforced to cover the full `AntRole` union. The
  individual ant class files remain compatibility façades, marked as such
  in their headers, and each now carries a `colonyGenesisStanding` field
  recording that Colony Genesis does not route through them.
- **`ReceiptLog` is the canonical receipt system** (AH2 Step 4C). Ant
  façade methods return `AntFacadeTrace` compatibility metadata
  (`src/ants/antFacadeTrace.ts`) — traces reference real receipts by id
  and are not a second receipt system.
- **Pheromones are attention/trace data with a report consumer** (AH2
  Step 4D): `pheromoneAttentionSnapshot.ts` aggregates the bus into safe
  counts/buckets for `SimulationReport`/`MissionRunReport`. Not yet a
  scheduler input — scheduling stays independent of pheromone strength.
- **`src/policies/textIndicatorMatcher.ts` is the canonical low-level
  indicator matcher** (AH2 Step 4E): explicit per-rule match modes,
  consumed by `SafetyGuard` and `SecretProtectionPolicy`; domain deny
  lists retain their own focused semantics. See
  [safety-matching-model.md](./safety-matching-model.md).
- **`ReceiptLog` owns instance-local identity state** (AH2 Step 4F): each
  log's receipt sequence starts at 1, deterministically; ids are scoped to
  their log, and linked receipts require a shared injected log.
- **`receiptStatusSemantics.ts` is the canonical semantic registry for
  receipt statuses** (AH2 Step 4G): lifecycle categories per status,
  compiler-enforced full-union coverage. See
  [receipt-status-model.md](./receipt-status-model.md).
- **`src/tools/demoGolden.ts` + `demoGoldenBaselines.ts` are the semantic
  regression layer** (AH2 Step 5): pure golden evaluation over demo
  digests, driven by `src/examples/demoGoldenOutputs.ts`. See
  [golden-output-model.md](./golden-output-model.md).
- **`src/application/`** (Capability C0) contains data-only approval and
  integrity contracts for future human-approved local file creation. No
  write authority exists: no fs import, no execution primitive, and no
  law amendment has enabled writes. See
  [local-file-creation-model.md](./local-file-creation-model.md).
- **`src/application/` + `ProjectInspector.inspectCreateTarget`**
  (Capability C1) add a read-only create-target dry run: real filesystem
  **metadata** inspection (existence, `lstat`, listing, `realpath` — no
  content read) inside the inspector (still the only fs importer), plus a
  pure fail-closed dry-run evaluator (`projectCreateDryRun.ts`). C1 creates
  nothing, mutates nothing, authorizes no write, and consumes no grant;
  `authoritativeForWrite`/`writeAuthorized`/`writePerformed` are literal
  `false`. No law amendment was required. See
  [local-file-creation-dry-run.md](./local-file-creation-dry-run.md).
- **`src/application/` + `src/bootstrap/`** (Capability C2-A) add
  **conditional contracts only** for a future single real create — with **no
  write primitive**: exact-byte content binding (`exactContentBytes.ts`), a
  strict C2 create policy (`c2CreatePolicy.ts`), a default-off
  identity-checked `WriteAuthorityPermit` (`writeAuthority.ts`, minted only
  by `c2WriteAuthorityBootstrap.ts`), a process-local consumed-grant registry
  (`consumedApprovalRegistry.ts`), immutable lifecycle types
  (`fileCreationTypes.ts`), a pure admission evaluator
  (`writeAttemptAdmission.ts`), and a **non-mutating** `projectFileCreator.ts`
  (no fs import). The **production runtime cannot mint or receive a permit**;
  `ProjectInspector` **remains the only fs importer** and filesystem mutation
  APIs stay at **zero**. The Build Law C2-A amendment (Section 11) defines the
  future boundary but activates nothing; C2-B/C need separate authorization.
  See [capability-c2-a-contracts.md](./capability-c2-a-contracts.md).
- **`src/application/projectFileCreator.ts` + `exclusiveCreateDriver.ts`**
  (Capability C2-B) install the first real exclusive-create primitive —
  **installed but inactive**. `projectFileCreator.ts` becomes the **second
  (and only other) fs importer**, importing only `openSync`/`writeSync`/
  `fsyncSync`/`closeSync` with `openSync` restricted to `"wx"`. The real Node
  driver is module-private and never invoked (proven by a read-only
  invocation counter); `createProjectFile` runs the full admission sequence,
  consumes the grant immediately before open (and on any admitted failure),
  and drives the create through an **injected** driver — tests use only a
  fake, so **no real write executes and no file is created**. Residual-
  artifact and receipt-failure truths are modeled without erasing disk state.
  Production runtime has no import path to the creator or a permit; C2-C (one
  real write) needs separate authorization. See
  [capability-c2-b-exclusive-create.md](./capability-c2-b-exclusive-create.md).

- `src/colony/` also carries the **Ant Intelligence Deepening V1** layer
  (Build Law §17): `antMind`, `localPlanning`, `selfEvaluation`,
  `peerReviewSystem`, `antTeams`, `colonyKnowledgeSystem`, `mentorshipSystem`,
  `colonyCrisisSuite`, and the `antIntelligenceRuntime` orchestrator. It is a
  second deterministic layer over the G1-G7 tick runner (which it does not
  modify): it evolves a population, derives one bounded `AntMind` per worker,
  and drives bounded local missions + a crisis suite exercising planning,
  self-evaluation/calibration, peer review, teams, knowledge learning, and
  mentorship. It adds **no** real model, network, fs, process, timer, Queen
  authority, central assignment, or global planner — `externalLlmCalls`,
  `centralTaskAssignments`, `queenTaskAssignments`, and `globalPlannerDecisions`
  are all zero, and cognition stays capped at 30. See
  [ant-intelligence-deepening-v1.md](./ant-intelligence-deepening-v1.md).

- `src/colonyMission/` + `src/cli/` are the **Real Cognitive Ants** runtime
  (Build Law §16/§18): a provider-neutral bounded cognitive worker runtime
  (registry, router, request/result validators, execution budget, deterministic
  worker), Claude Code / Codex CLI adapters that are **installed but always
  refuse** (no `child_process` import exists here), an isolated mission workspace
  on an injected driver, a voluntary software-work market, proposal competition
  with local quorum, and a review/verify/repair loop. It sits **outside**
  `src/colony/` (which stays pure/deterministic) and reaches the colony only to
  read its locally-decided demand, claims, and commitments — a provider supplies
  bounded cognition to an already-selected ant and never selects, assigns,
  controls the Queen, or gains fs/shell authority. See
  [real-cognitive-ants-r1.md](./real-cognitive-ants-r1.md).

- `src/cognitive/` is the **Real Cognitive Ants R2** boundary (Build Law §19):
  the human-only real provider execution surface, entirely separate from the
  deterministic `src/colony/` and the provider-neutral `src/colonyMission/`. It
  holds the non-serializable `RealProviderExecutionPermit`, the process-driver
  contract with a deterministic fake driver, the ONE real `child_process`
  importer (`nodeProviderProcessDriver.ts`, `spawnSync`/`shell:false`/env-
  filtered), the bounded output parser, the activation gate
  (`realProviderActivation.ts`), and the confined smoke workspace
  (`smokeWorkspace.ts`). Nothing here runs from an automated test — only from
  the human-only `colony:real-smoke` CLI, after a typed-phrase TTY confirmation,
  for exactly one ant / one request / one process. See
  [real-cognitive-ants-r2.md](./real-cognitive-ants-r2.md).

- `src/federation/` + `src/academy/` are the **Tamara–Namla Federation V1** and
  **Ant Academy V1** layers (Build Law §20), both deterministic and in-memory.
  `federation/` holds the strategic bridge: a `TamaraObjective` and a
  `TamaraAuthorityRecord` whose worker powers are literal-`false`, so Tamara
  leads strategy but can never assign an ant, pick a quorum winner, read private
  minds, or mint permits — an objective becomes local DEMAND run through the
  existing `MissionRunner`. `academy/` holds an 18-domain curriculum, bounded
  `SkillPassport`s, a deterministic training-mission factory, an independent
  evaluator (never the student), evidence-gated promotion/certification, a
  provider pool (real engines disabled by default), and cognitive rotation
  clamped to the global 30. No real provider/network/fs/process; every
  decentralization counter stays zero. See
  [tamara-namla-federation-v1.md](./tamara-namla-federation-v1.md) and
  [ant-academy-v1.md](./ant-academy-v1.md).

- Real Academy Pilot V2 (Build Law §21) adds `src/cognitive/multiProviderPilotPermit.ts`,
  `src/academy/realAcademyPilot.ts`, and `src/cli/academyRealPilotCli.ts`: a
  bounded live training pilot of 1-5 VOLUNTARY ants through real providers (≤5
  total calls, one per ant), extending R2's one-ant door without widening any
  other boundary. The pilot permit is non-serializable/single-use/human-only;
  each accepted ant gets a scope-bound member permit; real results are
  independently evaluated and update only bounded SkillPassport evidence (zero
  certifications from one pilot). Automated demos use the fake driver + fake
  workspace, so every real provider/network/fs/process counter is zero. See
  [tamara-namla-real-academy-v2.md](./tamara-namla-real-academy-v2.md).

## Digital superorganism layer (`src/digital/`, Build Law §23)

The product architecture is the **digital superorganism**: colony biology
translated into a causal digital economy for software/AI/IT/security/data/DevOps
work. `src/digital/` holds a conserving 15-resource ledger
(`digitalResourceEconomy`), digital metabolism (scout/verify/plan/build/review/
test/repair), bounded team-local trophallaxis, revocable tool-access (oxygen),
consumed-only budgets (energy), CO₂/waste recycling, defensive disease/immunity,
evidence-gated brood maturation, and a 15-step runner. It imports no fs, process,
network, or clock. The literal-biology layer (`src/biology/`) is a frozen
reference (§22). See
[digital-superorganism-metabolism-v1.md](digital-superorganism-metabolism-v1.md).

## Digital operations layer (`src/digital/` V2, Build Law §24)

Digital Superorganism Operations V2 adds a real software mission workflow on the
§23 economy: `digitalObjective` (Tamara objective + demand metabolism),
`digitalWorkspace` (bounded, attributed in-memory project workspace),
`digitalVerification` (allowlisted verification + fake driver),
`digitalOperationsRunner` (18-step orchestrator), and `digitalOperationsReport`
(conservation + causality + safe command-center). Tamara publishes; the colony
proposes, claims, builds, reviews, verifies, repairs, and delivers. No real
provider/process/network/filesystem action; conservation and causality validated.
See [digital-superorganism-operations-v2.md](digital-superorganism-operations-v2.md).

## Live objective layer (`src/cognitive/liveObjectivePermit.ts` + `src/digital/live*.ts`, Build Law §25)

Digital Superorganism Live Objective V3 adds the human-authorized three-ant live
runtime: a non-forgeable `LiveObjectivePermit`, voluntary cohort admission
(`liveCohort`), provider-output normalization (`liveProviderNormalization`), the
live pipeline (`liveObjectiveRunner` with fake drivers for tests), a safe command
center + safety checks (`liveObjectiveReport`), the human-only TTY CLI
(`digitalLiveObjectiveCli`), and the real-fs live workspace confined to the
existing `smokeWorkspace` surface. Zero real action in automated tests. See
[digital-superorganism-live-objective-v3.md](digital-superorganism-live-objective-v3.md).

## Live driver wiring (Build Law §26)

Digital Superorganism Live Objective V4 wires the real path: `RealLiveProviderDriver`
(`src/cognitive/liveProviderExecution.ts`) runs one bounded process per ant
through the injected `ProviderProcessDriver`; `RealLiveWorkspaceDriver` and
`RealBackedVerificationDriver` (`src/cognitive/liveRealDrivers.ts`) delegate real
writes to `smokeWorkspace` and verification to `runVerificationCommand`, which
since S-5 executes ONLY through an injected sandbox permit and has no host
execution path at all; the completed human CLI adds `--dry-run` and a
confirmed repair loop. The runner's workspace is abstracted behind
`LiveWorkspaceApplier` so fake and real workspaces both fit. Automated tests keep
every real-action counter 0. See
[digital-superorganism-live-objective-v4.md](digital-superorganism-live-objective-v4.md).

## Civilization OS V2 — live MCP settlement

The Civilization OS (20 districts, MCP nervous system, councils, academy,
knowledge/waste economies, voluntary labor market) is connected to bounded live
cognition and tools without a central planner. Provider cognition reuses the V4
`RealLiveProviderDriver`; MCP tool execution routes through an injectable
`McpExecutionDriver` (default = the unchanged V1 simulation; V2 = a fake in tests
or the human-only `RealMcpExecutionDriver` over `smokeWorkspace` /
`runVerificationCommand`). Authority is a consumed-once, non-serializable
`CivilizationLivePermit`. Every automated real-action counter stays 0. See
[namla-civilization-os-v2-live-mcp.md](namla-civilization-os-v2-live-mcp.md).

## Historical evolution

The architecture above is the current one. It grew from a much smaller
starting point, and the phase language that appears elsewhere in `docs/` is
best read as a record of that growth rather than as a description of today.

**Phase 0 — foundation (superseded).** The repository began as a typed
skeleton: shared interfaces, in-memory services, a safety guard, a receipt
log, and a pheromone bus. Nothing executed a real command, wrote a real file,
or touched the network, and the README described the project that way for a
long time. That description is no longer accurate: real execution boundaries
now exist, are exercised, and are tested on a three-OS CI matrix.

**Phases 1–7 — capability, still without real authority.** Read-only project
inspection, mission planning, code proposals as data, review/test/repair
analysis, git modelled as data with push unrepresentable, bounded
deterministic colony simulation, and simulated agent adapters. Everything
added in this period is still simulation: it produces plans and proposals,
never actions.

**Phase 8 onward — real boundaries.** The substantive change was introducing
components with genuine authority, each behind an enforcement boundary: a
guarded exclusive-create file writer, real process spawning through a single
trusted module, provider CLI invocation behind a human-confirmed single-use
permit, and workspace containment over the real filesystem.

**Security hardening (P0, then the Fable findings S-1…S-5).** The most recent
work was a sequence of audited security milestones, each proving one property
and each verified in CI:

| Milestone | Property established |
|---|---|
| P0 | Workspace containment, trusted executables, process-tree termination, honest network accounting, byte-correct output handling |
| Container sandbox V1 | A real Docker backend whose isolation is verified by a probe running *inside* the container |
| S-1 | Every Docker bind-mount source is canonical, contained, and cannot inject mount options |
| S-2 | Network policy is truthful: only `denied` is enforceable, and no narrower mode is silently widened to a bridge |
| S-3 | The file a create attempt opens is bound to the approved and inspected target |
| S-4 | The environment secret registry is actually populated in production |
| S-5 | Verification executes only through a sandbox permit; no host execution path remains |

Two consequences of that sequence are visible in the current system and are
deliberate. Several capabilities became *less* available rather than more —
`provider-only` networking and sandboxed verification now fail closed —
because the honest position is that an unenforceable policy should be refused
rather than approximated. And the bodies/desktop layer (`src/bodies/`,
`src/bots/`) never advanced past planning: it still only produces
`PlannedAction` values, and no mouse, keyboard, window, or screen API exists.
