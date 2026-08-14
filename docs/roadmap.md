# Roadmap

Namla Pro grows one phase at a time. Every phase inherits the hard boundaries
in [NAMLA_BUILD_LAW.md](../NAMLA_BUILD_LAW.md); none of them are allowed to
loosen those boundaries, only add new capability behind new explicit guards.
`ColonyState.phase` (`src/types/colonyStateTypes.ts`) names each phase so the
colony always knows, in its own state, which capabilities should exist.

## Phase 0 — Empire Foundation (complete as a skeleton)

The full type system, in-memory core services (Queen, orchestrator, planner,
router, safety guard, receipt log, pheromone bus, memory, state), digital
sense skeletons, the pheromone model with decay/reinforcement/query, bot/robot
body abstractions that only ever plan, twenty ant role skeletons, six safety
policies, demo scripts, and this documentation set. Nothing executes.

## Phase 1 — Read-Only Local Project Inspector (BUILT)

Give `ScoutAnt` and the vision/touch senses the ability to actually read
(never write) files inside the project root, so the colony can build a real
picture of a codebase instead of relying on caller-supplied context.

Status: built and verified by inspection (first `tsc` run still pending, as
nothing has been installed). `ProjectInspector` walks the tree read-only
(readdir/lstat, guarded small-text reads), checks every path with
`FileBoundaryPolicy`, skips secret stores, symlinks, ignored folders, and
oversized files, and produces a `ProjectSnapshot` plus receipts.
`ScoutAnt.inspectProject` and the vision/touch senses consume it. See
[inspector-model.md](./inspector-model.md) and the Phase 1 amendment in
[NAMLA_BUILD_LAW.md](../NAMLA_BUILD_LAW.md).

## Phase 2 — Mission Planning Engine (BUILT)

Replace `MissionPlanner`'s one-task-per-goal placeholder with real
decomposition logic: dependency ordering, task sizing, and role assignment
informed by what Phase 1's inspector found.

Status: the `src/planner/` module exists — `DecompositionEngine` turns a
mission plus an optional `ProjectSnapshot` into per-goal pipelines
(investigate → plan → propose build → verification plan → audit) with
dependency edges (`ColonyTask.dependsOnTaskIds`), `TaskDependencyGraph`
rejects cycles and missing dependencies with receipted refusals and produces
the topological routing order, and `rolePicker` assigns roles
deterministically. `AntQueen` uses the engine when a snapshot is provided
and falls back to the Phase 0 planner otherwise;
`PlannerAnt.proposeDecomposition` exposes the engine via capability
injection. See [mission-planning-model.md](./mission-planning-model.md).

## Phase 3 — Safe Code Generation Tasks (BUILT)

Let `BuilderAnt` propose actual code changes as data — with applying them
deliberately deferred to a later, separately human-authorized phase (a
narrower scope than originally sketched here: no `FileAdapter` apply path
exists yet, by design).

Status: the `src/generation/` module exists — `CodeProposal` carries a
proposed change with `requiresHumanApproval: true` and `applied: false` as
literal types; `ProposalFactory` gates creation behind `FileBoundaryPolicy`,
a per-segment protected-path check, and `SafetyGuard`, receipting every
refusal; `ProposalQueue` stores pending proposals in memory and exposes no
apply method at all. `BuilderAnt.proposeCode` uses capability injection, and
the engine's propose-build tasks carry
`expectedOutputKind: "code-proposal"`. See
[code-generation-model.md](./code-generation-model.md) and the Phase 3
amendment in [NAMLA_BUILD_LAW.md](../NAMLA_BUILD_LAW.md).

## Phase 4 — Audit / Test / Repair Loop (BUILT)

Wire `TesterAnt`, `AuditorAnt`, and `RepairAnt` into a real feedback loop:
propose tests, evaluate results, propose fixes, re-check with `SafetyGuard`
at every step.

Status: the `src/review/` module exists — `ProposalReviewer` checks a
`CodeProposal` against a `ProjectSnapshot` (invariants, create-collisions,
modify-existence, size, SafetyGuard re-run) and produces `AuditReport`s;
`TestPlanChecker` validates verification-plan text as data;
`RepairProposalFlow` turns major/critical findings into factory-gated
follow-up proposals. All three ants consume these via injection. The "loop"
runs only when a human-run script calls it — no timers, no schedulers, no
recursion; nothing executes tests or applies proposals. See
[review-loop-model.md](./review-loop-model.md). No law amendment was needed:
review of in-memory data introduces no new capability class.

## Phase 5 — Git Integration (No Push By Default) (BUILT)

Let the colony read Git history and propose commits, with push remaining
disabled by default and requiring explicit, separate human authorization
every time — matching the existing "never push" law rather than replacing
it.

Status: the `src/git/` module exists — git modeled entirely as data.
`GitRepoState` is asserted (never read from a real repo), `GitReadPlanner`
produces `executed: false` PlannedActions for read-only commands and
refuses state-changing candidates through two independent gates, and
`CommitProposalFactory` bundles reviewed CodeProposals into
`GitCommitProposal`s with `pushIntent`/`applied` hard-typed `false`.
`ArchivistAnt.assembleCommitProposal` uses capability injection. No git
command runs in Phase 5 — not even read-only ones — because introducing a
command-execution capability, not the particular command, is the dangerous
step. Push is forbidden by law regardless of phase. See
[git-integration-model.md](./git-integration-model.md) and the Phase 5
amendment in [NAMLA_BUILD_LAW.md](../NAMLA_BUILD_LAW.md).

## Phase 6 — Multi-Agent Simulation (BUILT)

Introduce bounded multi-ant activity governed by `AutonomousLoopPolicy`
budgets instead of the Phase 0 placeholder of zero — as deterministic
virtual-tick simulation, not real concurrency.

Status: the `src/simulation/` module exists — `SimulationClock` (virtual
ticks, advancing only under a human-run script), `AntScheduler`
(deterministic per-role round-robin with a hard-coded step ceiling of 100
that callers can tighten but never raise), and `ColonySimulation` (the full
Queen → engine → scheduler → pheromone → receipt chain over one mission,
with optional injected Phase 3/4 capabilities producing reviewed
placeholder proposals). Budget exhaustion halts with a receipt; skips
consume budget so starved runs terminate. The default autonomous budget
remains zero outside the simulation module. See
[simulation-model.md](./simulation-model.md) and the Phase 6 amendment in
[NAMLA_BUILD_LAW.md](../NAMLA_BUILD_LAW.md).

## Phase 7 — Tool Adapters for Claude Code / Codex / Kimi / Local Scripts (BUILT)

Formalize `ToolAdapter` implementations that let external AI coding agents
act as ants inside the colony — sensing pheromones, receiving tasks, and
producing receipts — under the same `SafetyGuard` every native ant obeys.

Status: the `src/adapters/` module exists — adapters as simulated data
contracts only. `AgentAdapterBase` owns four unskippable gates (kind,
purpose, SafetyGuard on the outgoing request, SafetyGuard re-check of the
canned response) and the established receipt redaction;
`SimulatedAgentAdapter` gives each of the four tool identities a
deterministic canned voice and can turn a build task into a factory-gated
placeholder `CodeProposal`; `AdapterRegistry` is injection-only.
`ColonySimulation` accepts an optional registry so simulated agents supply
builder output, with the Phase 6 placeholder as fallback. Every response is
`simulated: true` by literal type; no credentials, endpoints, network, or
process access is modeled, by law. See
[agent-adapter-model.md](./agent-adapter-model.md) and the Phase 7
amendment in [NAMLA_BUILD_LAW.md](../NAMLA_BUILD_LAW.md).

## Phase 8 — Bot Desktop Automation (IN PROGRESS)

Give `BotBody` a real (heavily sandboxed, explicitly approved) execution path
for desktop automation — approached, like every capability, as simulation
first: Phase 8 models desktop actions as planned data with no execution
path at all; a real sandboxed path remains future work behind its own
amendment.

Status: the `src/bots/` module exists — `DesktopActionPlan`/`Step` types
whose vocabulary cannot express coordinates, handles, or screenshots, with
`simulated: true` / `executed: false` / `requiresHumanApproval: true` as
literal types; `DesktopActionPlanner` gates plans through a
protected-surface deny list (credential prompts, terminals, settings,
deletion dialogs, payment screens, inboxes, ...) plus SafetyGuard, with
redacted refusal receipts; `BotBodySimulator` narrates plans as data and
re-checks invariants at runtime. See
[bot-desktop-model.md](./bot-desktop-model.md) and the Phase 8 amendment
in [NAMLA_BUILD_LAW.md](../NAMLA_BUILD_LAW.md).

## Phase 9 — Robot or IoT Abstraction Layer

Give `RobotBody` a real backing for physical or IoT actuation, with safety
requirements at least as strict as Phase 8's, since physical actions are
harder to undo.

## Phase 10 — Tamara Integration

See [tamara-integration-notes.md](./tamara-integration-notes.md) for what is
currently known and not yet decided about this integration.

## Phase 11 — Server / Cloud Colony

Move the colony from a single in-memory process to a persisted,
network-reachable service, with real authentication and access control
replacing the current "trusted by construction" local-only model.

## Phase 12 — Distributed Ant Empire with Permission Zones

Support multiple colonies or multiple zones within one colony, each with its
own permission boundary, so different projects, teams, or trust levels can
share infrastructure without sharing blast radius.

## How to propose the next phase

Each phase should start as its own prompt: name the phase, name the specific
files it changes or adds, and state explicitly which Phase 0 safety
guarantees remain unchanged. See the end of the Phase 0 delivery report for a
suggested Phase 1 prompt.
