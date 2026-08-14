# Runtime Spine

This document is the authoritative description of how a mission runs
through Namla Pro. If any other document disagrees with this one about the
runtime path, this one wins (and the other should be fixed).

## The official runtime path

```
Human mission (ColonyMission)
  -> ColonyEngine.runMission(request)          public API, src/engine/
       -> SafetyGuard                          mission gate (title + raw
                                               instruction); refusal =
                                               receipt + accepted: false
       -> DecompositionEngine                  per-goal task pipelines
                                               (investigate -> plan ->
                                               propose -> verify -> audit),
                                               per-task SafetyGuard gate,
                                               transitive blocking
       -> TaskDependencyGraph                  rejects missing deps and
                                               cycles with receipted
                                               refusals; emits the
                                               topological routing order
       -> AntScheduler                         deterministic per-role
                                               round-robin; hard-capped,
                                               tighten-only step budget;
                                               receipted halt at the cap
       -> ColonySimulation                     the internal, execution-free
                                               runtime engine: virtual
                                               ticks, one task per step
            -> injected capabilities           optional, via the request's
                                               one options object:
                                               ProposalFactory (Phase 3),
                                               ProposalReviewer (Phase 4),
                                               AdapterRegistry with
                                               simulated agents (Phase 7)
       -> ReceiptLog                           every step, skip, halt, and
                                               refusal is receipted
       -> PheromoneBus                         intent/trail/help/success
                                               emissions, decayed per
                                               virtual tick
       -> ColonyMemory                         one non-secret lesson entry
                                               per completed run
  -> MissionRunReport                          status, counts, events,
                                               proposal ids (always
                                               unapplied), full receipt
                                               trail
```

## Who is what

- **`ColonyEngine` (`src/engine/colonyEngine.ts`) is the public entry
  point.** It owns the request/report shapes and delegates to the
  simulation. New code enters here and nowhere else.
- **`ColonySimulation` (`src/simulation/colonySimulation.ts`) is the
  internal runtime engine.** It is execution-free by construction: a
  "step" is an in-memory bookkeeping update. It is not public API; callers
  should not construct it directly.
- **`AntQueen` (`src/core/antQueen.ts`) is a compatibility façade that
  delegates to `ColonyEngine`** (since the Pre-Capability Closure pass).
  `acceptMission` runs the mission through the canonical engine and maps
  the `MissionRunReport` to one legacy-shaped final receipt in the shared
  log. **There is no parallel mission-processing spine.**
  `ColonyOrchestrator` and `TaskRouter` remain on disk as deprecated
  compatibility artifacts (the Build Law forbids deletion) — no canonical
  path constructs them, and they are not an independent runtime.
- **Feature demos are not public entry points.** They are focused
  demonstrations of individual modules (see [demo-map.md](./demo-map.md));
  only `demoEndToEnd.ts` exercises the public API, and only
  `ColonyEngine` is the API.
- **Ant classes (`src/ants/`) are role façades, not the scheduler.** The
  spine schedules *roles* (strings on tasks, matched by `AntScheduler`);
  the twenty ant classes are demo-facing wrappers around injected
  capabilities and do not participate in the engine's task loop.
- **Pheromones are trace/attention data with a report consumer — still not
  decisions.** The spine emits them (human intent, trails, help requests,
  success) and decays them on virtual ticks; since AH2 Step 4D the runtime
  also *reads* them: every run ends with a `PheromoneAttentionSnapshot`
  (counts, types, rounded strength buckets — never topics or payloads) in
  the `SimulationReport` and `MissionRunReport`. Scheduler decisions
  remain deterministic and fully independent of pheromone strength;
  making pheromones decision-driving is a separate future step.

## Ant roles and façade classes

`AntScheduler` schedules role/state **data** — a task carries a required
role string, and the scheduler matches it against registered ant states.
The class files in `src/ants/` are role façades and capability wrappers
around that data model, not the scheduler itself.

[`src/ants/antRoleRegistry.ts`](../src/ants/antRoleRegistry.ts) is the
canonical role metadata source: for each of the twenty roles it records
the category (`engine-active`, `capability-facade`, `legacy-facade`,
`future-facing`), what the role does in the runtime today, which component
canonically owns its function, and the standing of its class file. The
registry is typed `Record<AntRole, AntRoleSpec>`, so full coverage of the
role union is compiler-enforced.

Several façade classes are legacy or future-facing and intentionally not
deleted (the Build Law forbids deletion; the registry and their header
comments mark their standing instead). Runtime behavior is unchanged in
Step 4A: the registry is metadata, consumed for reporting only.

## Safety text classification

Since AH2 Step 4E, `SafetyGuard` and `SecretProtectionPolicy` classify text
through the canonical matcher
([safety-matching-model.md](./safety-matching-model.md)) with explicit rule
modes (token/phrase/command/path-fragment/substring) instead of raw
substring checks. Embedded-word false positives are reduced
("information", "reinforcement", "executed", "author" no longer trip
short indicators), while every real dangerous/protected case — including
inflected forms — remains refused; the regression matrix demo pins both
directions. Receipt summaries still pass the same canonical protected-text
validation in `ReceiptLog`.

## Receipt semantics

**`ReceiptLog` is the canonical receipt system — the only one.**
`ColonyEngine` and `ColonySimulation` reports carry ReceiptLog receipts;
every gate, factory, reviewer, planner, and adapter writes its refusals and
completions there.

Ant façade classes expose **`AntFacadeTrace`** objects
(`src/ants/antFacadeTrace.ts`) for compatibility and demonstration: local
trace data with a `traceId` (never a `receiptId`), an action, a status, a
safe note code, and — when the underlying injected capability wrote real
receipts — `relatedReceiptIds` pointing at them. A local façade trace is
not a receipt unless it came from ReceiptLog, and nothing in the codebase
mints receipt-shaped objects outside ReceiptLog anymore (mechanically
checked: `receiptId:` is assigned only inside `src/core/receiptLog.ts`).

Step 4C clarified this naming boundary; it did not rewrite façade behavior
into ReceiptLog — façades still do not write to any log themselves.

**Final decision (Pre-Capability Closure):** traces stay façade-local, by
design. `ReceiptLog` records canonical runtime and capability events;
`AntFacadeTrace` records lightweight façade-local activity and links to
real receipts through `relatedReceiptIds`. Automatic trace-to-log
conversion is intentionally not implemented — it would duplicate events
already receipted by the injected capabilities and inflate audit trails.
A future façade action may write a real receipt only when the action is
itself part of the canonical runtime and receives the shared `ReceiptLog`
through explicit injection.

## Receipt status semantics

Since AH2 Step 4G, receipt **status** carries lifecycle/outcome semantics
(admission, success, policy-rejection, boundary-stop, internal-error) and
structured reason codes identify the concrete event. The canonical
registry is `src/core/receiptStatusSemantics.ts`; components must follow
[receipt-status-model.md](./receipt-status-model.md) — in particular the
admission boundary: `refused` means rejected at the door, `blocked` means
an admitted flow was stopped.

## Receipt identity scope

`ReceiptLog` is canonical, and since AH2 Step 4F **every ReceiptLog owns
its own sequence**: the first receipt of any log is deterministically
`receipt-1`, ids are scoped to their log, and creating receipts in one log
never advances another (no module-global counter remains, and identity
uses no randomness, wall-clock, process, or environment input). Components
that need linked receipt ids must share the injected ReceiptLog — which is
how every capability/caller pair in the codebase already works.
`AntFacadeTrace` traceIds remain a separate, non-receipt identity domain.

## Known debt (intentionally unresolved)

Recorded here so nobody mistakes it for accident; each item is deferred to
a later hardening step, on purpose:

1. ~~The `AntQueen`/`ColonyOrchestrator`/`TaskRouter` legacy spine still
   exists alongside the engine~~ — **resolved in the Pre-Capability
   Closure pass**: `AntQueen` delegates to `ColonyEngine`; the orchestrator
   and router are deprecated compatibility artifacts with no canonical
   constructor.
2. ~~`SimulationAntState` duplicates `types/antTypes.AntState`~~ —
   **resolved in AH2 Step 4B**: the scheduler, simulation, and engine now
   consume the canonical `AntState`; `SimulationAntState` survives only as
   a deprecated type alias of it (same type, not a second model).
3. ~~Ant façade methods return receipt-shaped objects that are not written
   to any `ReceiptLog`~~ — **resolved in AH2 Step 4C**: façade methods now
   return `AntFacadeTrace` objects that reference real receipts by id
   instead of imitating them (see "Receipt semantics" above).
4. ~~Pheromones are write-only~~ — **partially resolved in AH2 Step 4D**:
   the runtime now consumes the bus into a report-only attention snapshot
   (observability). Decision-driving consumption (scheduler input) remains
   deliberately unimplemented.
5. ~~Module-level id counters make ids sequential across log instances~~ —
   **resolved for receipts in AH2 Step 4F**: ReceiptLog owns an
   instance-local sequence. Other module-level counters (task, pheromone,
   memory, planned-action ids) remain process-sequential — cosmetic, and
   left as minor open debt.

## What the report guarantees

- `accepted: false` means the safety gate refused the mission — with a
  receipt in `receipts`, never silently.
- `allProposalsUnapplied` is always `true`: proposals are data
  (`applied: false` is a literal type) and no apply path exists.
- `halted-budget` means the hard step cap stopped the run, receipted.
- Nothing in the path can execute a command, write a file, run git, touch
  the network, or automate a desktop — no such API exists in the project
  (see [SAFETY_INVARIANTS.md](../SAFETY_INVARIANTS.md)).

## Capability C0 — approval contracts (data only)

`src/application/` (Capability C0) models human-approval grants, a
full-operation integrity fingerprint, a structural create-policy, and a
pure approval verifier as data and pure logic. **Approved creation
contracts are not yet connected to real write execution.** The canonical
engine may later receive a create capability only through explicit
injection, and only after a NAMLA_BUILD_LAW amendment (C2). C0 adds no
execution, filesystem mutation, or new capability class of any kind.

## Capability C1 — create-target dry run (read-only)

Capability C1 adds the first real filesystem contact to the create
pipeline, in read-only form. `ProjectInspector.inspectCreateTarget` (still
the only fs importer) inspects a proposed create target's real filesystem
neighborhood using metadata operations only — existence, `lstat`,
directory listing, and `realpath` — reading no file content. The pure
evaluator `src/application/projectCreateDryRun.ts` combines the C0 approval
contract, the C0 structural policy, and that inspection into a fail-closed
dry-run decision, receipted canonically (completed / refused / blocked /
failed). **C1 creates nothing, mutates nothing, and authorizes nothing:**
`authoritativeForWrite`, `writeAuthorized`, and `writePerformed` are
literal `false`, the approval grant is never consumed, rollback stays
non-executable data, and `requiresFreshC2Revalidation` is literal `true`.
A green dry run is only an observation — C2 (behind a law amendment) must
recompute integrity and re-run every filesystem check immediately before
any exclusive-create. See [local-file-creation-dry-run.md](./local-file-creation-dry-run.md).
No NAMLA_BUILD_LAW amendment was required, because C1 adds no write
capability.

## Capability C2-A — conditional contracts (no real write)

Capability C2-A adds contracts and a conditional Build Law boundary
(Section 11) for a **future** single real local-file creation — and adds
**no write primitive**. `src/application/` gains: an exact-byte content
binding (`exactContentBytes.ts`), a strict C2 create policy pinned to a
direct-child lowercase `.md` in `docs/generated/` at ≤ 65,536 bytes
(`c2CreatePolicy.ts`), a default-off `WriteAuthorityPermit` recognized by a
private WeakSet identity registry (`writeAuthority.ts`), a process-local
append-only consumed-grant registry (`consumedApprovalRegistry.ts`),
immutable lifecycle types (`fileCreationTypes.ts`), a pure admission-candidate
evaluator (`writeAttemptAdmission.ts`), and a **non-mutating**
`projectFileCreator.ts` shell (no fs import). Permits are minted **only** by
`src/bootstrap/c2WriteAuthorityBootstrap.ts`; the **production runtime
(`ColonyEngine`, ants, adapters) cannot mint or receive a permit** — no such
import path exists. **`ProjectInspector` remains the only fs importer** and
there are still **zero filesystem mutation APIs**; the "exactly two fs
importers" rule becomes true only in C2-B, after separate authorization.
See [capability-c2-a-contracts.md](./capability-c2-a-contracts.md).

## Capability C2-B — exclusive-create primitive (installed, inactive)

Capability C2-B installs the first real exclusive-create primitive inside
`src/application/projectFileCreator.ts`, which becomes the **second (and only
other) fs importer** — importing only `openSync`/`writeSync`/`fsyncSync`/
`closeSync`, with `openSync` restricted to the literal `"wx"` (exclusive-
create, never overwrite/append). The real Node-backed driver is **module-
private, unreferenced by any export, and never invoked**; a read-only
`getRealNodeDriverInvocationCount()` proves it stayed at 0. `createProjectFile`
runs the full admission sequence (permit → C0 approval → strict C2 policy →
exact bytes → fresh final C1 inspection → confirm), consumes the grant
immediately before open (and it stays consumed on any admitted failure), and
drives the create through an **injected** driver — the demo passes only a
fake, so **no real filesystem write executes and no file is created**. The
result models partial/zero-byte residual artifacts and receipt-after-write
failures truthfully without erasing disk truth. Production runtime
(`ColonyEngine`, ants, missions, adapters) has no import path to the creator
or a permit. C2-C — the only phase permitted one real integration write — is
not started and requires separate explicit authorization. See
[capability-c2-b-exclusive-create.md](./capability-c2-b-exclusive-create.md).

## Colony Genesis — a second runtime (G0-G7, Build Law §§12-15)

`src/colony/` is a **separate runtime beside** the spine described above,
never a replacement for it. Everything documented in this file — the
mission gate, decomposition, `AntScheduler`, `ColonySimulation`, the
`MissionRunReport` — remains exactly as specified and remains the only
path that reaches the C0–C2-B capability stack.

Colony Genesis exists because that spine is a **mission pipeline**: its
loop iterates tasks and calls `nextAntForRole(role)`, a global function
with full population access that hands an ant to a task. A colony works
the other way round — each ant chooses locally from what it can observe.
The two models cannot share a scheduler, so they do not share one.

The separation is mechanical rather than aspirational. `src/colony/`
imports nothing from `src/simulation/` or `src/planner/`, and nothing from
`TaskRouter`, `ColonyOrchestrator`, or `MissionPlanner`; the import
boundary is grep-verified in `SAFETY_INVARIANTS.md`. Colony Genesis
receives no capability by injection and has no entry point in
`ColonyEngine`.

**G0 adds no real-world authority.** It builds a deterministic 13-chamber
nest graph and exactly 300 persistent identities (1 Queen-system + 299
worker-capable), validates them, and stops. The Queen holds no
task-assignment, routing, quorum-selection, or population-memory authority
— each is typed as the literal `false` and re-checked at runtime against
casts. This never changes across any later phase.

**G1-G7 add a bounded, deterministic per-tick behavior loop, still with no
real-world authority.** Every ant chooses its own next state from only its
own local observations (G1-G3); reserve ants run the same loop, engaging
later only because their thresholds are elevated (G4); recruitment and
local quorum sensing never produce a global tally or declared winner (G5);
brood are a small, separately bounded record type that only ever becomes a
real persistent identity when the population cap has room — which it never
does in any fixed-population demo in this repo (G6); and a per-tick
cognitive budget admits at most 30 ants for a label that changes nothing
about what they do, never a real model call (G7).
`centralTaskAssignments` and `queenTaskAssignments` stay literal-zero
through every phase; there is still no filesystem write, no network call,
no process execution, and no LLM call anywhere in `src/colony/`.

See [colony-genesis-g0.md](./colony-genesis-g0.md),
[colony-genesis-g6-g7.md](./colony-genesis-g6-g7.md), and
[colony-scalability.md](./colony-scalability.md).

## Real Cognitive Ants V1 — a third, bounded runtime (Build Law §16)

`src/colonyMission/` sits ON TOP of Colony Genesis, not inside it —
`src/colony/` is not modified by this layer. It gives the same reused
300-identity population real missions: voluntary work claims against each
ant's own G0 skill tendencies, scout-proposal local quorum, a bounded
(≤5-concurrent) cognitive-execution budget, and an artifact
propose→review→verify→repair loop against an isolated mission workspace.

The one new capability class this layer touches — real process execution
to invoke Claude Code CLI or Codex CLI — is a Section 1 hard boundary, and
Section 2 forecloses loosening a hard boundary by amendment at all. The
adapters (`claudeCliAdapter.ts`, `codexCliAdapter.ts`) construct a fully
specified planned invocation and always refuse, exactly like
`src/bodies/commandAdapter.ts` already does for shell commands; the tester
ant's verification step gets the identical treatment. Every automated
path — the deterministic demo, the CLI's default provider — uses only
`DeterministicCognitiveWorker` and an in-memory workspace driver.

See [real-cognitive-ants-v1.md](./real-cognitive-ants-v1.md) and
[real-provider-adapters.md](./real-provider-adapters.md).

## Semantic golden verification

Since AH2 Step 5, the public runtime path (and every focused demo) is
verified by semantic goldens: `demoGoldenOutputs` runs all demos
in-process and checks each digest against an explicit baseline
([golden-output-model.md](./golden-output-model.md)). Golden verification
adds no runtime capability — the tooling is pure evaluation over
already-redacted digests.

## The canonical demo

[`src/examples/demoEndToEnd.ts`](../src/examples/demoEndToEnd.ts) drives
the public API only: one bare run (engine module alone) and one fully
equipped run (snapshot + injected capabilities through the single options
object), and prints a stable digest for future golden-output checks.

## Ant Intelligence Deepening V1 — a second layer, not a spine change

The intelligence layer (Build Law §17) does **not** run through the mission
spine above and does **not** modify the G1-G7 colony tick runner. It is a
separate deterministic driver (`antIntelligenceRuntime.runAntIntelligenceDeepening`)
that first runs the real G1-G7 tick loop to *evolve* a population, then derives a
bounded `AntMind` per worker and drives bounded local missions plus a ten-scenario
crisis suite. No object receives all ants' private minds; every mission works on a
bounded local window; the three decentralization counters
(`centralTaskAssignments`, `queenTaskAssignments`, `globalPlannerDecisions`) stay
literal zero, and no real cognition provider is called. See
[ant-intelligence-deepening-v1.md](./ant-intelligence-deepening-v1.md).

## Real Cognitive Ants R1 — a bounded mission layer beside the colony

The Real Cognitive Ants runtime (`src/colonyMission/`, Build Law §16/§18) is a
third layer, alongside the mission spine and the Colony Genesis tick runner. Its
`MissionRunner` sequences one mission end to end — proposal competition + local
quorum, the voluntary work market, bounded cognitive-budget admission, artifact
review, verification, and bounded repair — **without assigning anything**: every
choice was submitted voluntarily by an ant (a claim, a proposal, a commitment),
and the runner only sequences and records, exactly as `colonyTickRunner` does for
Colony Genesis. `centralTaskAssignments` and `queenTaskAssignments` are
literal-zero types on its report; `globalPlannerDecisions` and
`nonVolunteerAssignments` are zero by construction. Provider adapters are
installed but inactive; automated runs use only the deterministic worker and the
in-memory workspace driver. See [real-cognitive-ants-r1.md](./real-cognitive-ants-r1.md).

## Real Cognitive Ants R2 — the human-only provider door

R2 (Build Law §19) does not touch the mission spine or the colony tick runner.
It adds a human-only path that is never reached by any automated flow: the
`colony:real-smoke` CLI admits one ant through the bounded cognitive budget,
requires an interactive TTY and an exact typed phrase, mints one non-serializable
`RealProviderExecutionPermit`, and calls `adapter.executeReal` →
`activateRealProvider`, which validates the permit, consumes it immediately
before spawning exactly one bounded provider process via the real Node driver,
parses the output as DATA, writes a safe receipt, and stops. Automated demos use
the fake driver and never spawn a process. `centralTaskAssignments`,
`queenTaskAssignments`, and `globalPlannerDecisions` remain zero; the global
cognitive budget remains 30. See [real-cognitive-ants-r2.md](./real-cognitive-ants-r2.md).

## Tamara–Namla Federation V1 + Ant Academy V1 — strategic + training layers

Build Law §20 adds two deterministic layers beside the mission spine, the colony
tick runner, and the R2 provider door. The federation bridge
(`src/federation/`) is the only Tamara→colony doorway: an objective is validated
and transformed into local demand run through the existing `MissionRunner` —
Tamara never enters an ant's decision path (`tamaraDirectAntAssignments` is
zero). The academy (`src/academy/`) trains the 300-ant colony across 18 domains
with independent evaluators, evidence-gated promotion (never self-certified),
mentorship, projects, and certification, sharing a rotation clamped to the global
cognitive budget of 30. Automated flows use the deterministic worker only; real
provider training requires separate explicit authorization under the R2 one-ant
boundary. See [tamara-namla-federation-v1.md](./tamara-namla-federation-v1.md).

## Real Academy Pilot V2 — the bounded live training door

Build Law §21 adds a second human-only real-provider door beside R2's one-ant
smoke. `academy:real-pilot` requires an interactive TTY and the exact dynamic
phrase `RUN TAMARA NAMLA PILOT WITH N ANTS`, selects a voluntary cohort of 1-5,
mints one pilot permit plus one member permit per ant, and runs
`runAcademyPilot`: one real call per ant via the real Node driver, independent
evaluation of each result, bounded SkillPassport evidence updates, and a stop.
Automated flows use the fake driver and make zero real calls; Tamara never names
an ant; one pilot grants no certification. See
[tamara-namla-real-academy-v2.md](./tamara-namla-real-academy-v2.md).

## Digital superorganism runner (Build Law §23)

`src/digital/digitalSuperorganismRunner.ts` is the bounded high-tech project
spine: it threads the conserving `DigitalResourceEconomy` through the 15-step
scenario (objective → scout → verify → quorum plan → voluntary claims → bounded
tool access → build → review → test → waste → repair → evidence → store →
quarantine). It performs no real execution — `providerCalls` is 0, deep-cognitive
concurrency ≤ 30 — and `digitalSuperorganismReport.ts` validates conservation +
causality on every run. Entry demo: `demoDigitalSuperorganismV1`.

## Digital operations runner (Build Law §24)

`src/digital/digitalOperationsRunner.ts` runs a full software objective:
requirements to raw information to verified knowledge to competing proposals to a
local quorum to bounded voluntary claims to reviewed artifacts to verification to
one detected defect to repair to delivery — threading the conserving
`DigitalResourceEconomy` and an isolated in-memory workspace. Zero real action
(`realClaudeCalls`/`realCodexCalls`/`realProviderProcessExecutions`/`realNetworkCalls`/
`realFilesystemWrites` all 0). Entry demo:
`demoDigitalSuperorganismOperationsV2`; inert human-only CLI:
`digital:real-objective`.

## Live objective runner (Build Law §25)

`src/digital/liveObjectiveRunner.ts` drives the human-authorized three-ant live
objective: consume the live permit, one initial provider call per ant
(architecture/build/review), normalize to data, independent review (never self),
apply approved artifacts to the isolated workspace, allowlisted verification, and
one separately-approved repair round. Injected `LiveProviderDriver` /
`VerificationDriver` / workspace are FAKE in tests (zero real action). Entry demo:
`demoDigitalLiveObjectiveV3`; human-only CLI: `digital:live-objective`.

## Live driver wiring (Build Law §26)

V4 connects the live runner to real drivers: `RealLiveProviderDriver` (permit →
consume → one process → parse), `RealLiveWorkspaceDriver` (reviewed writes via
`smokeWorkspace`), and `RealBackedVerificationDriver` (allowlisted spawn via the
one `child_process` module). The human CLI (`digital:live-objective`) orchestrates
provider calls → normalization → review → application → verification → confirmed
repair, with `--dry-run` for a no-real-action preview. Automated proof:
`demoDigitalLiveObjectiveV4Wiring` (fake drivers, zero real calls).

## Civilization OS V2 (live MCP settlement) on the spine

The civilization runtime reuses the same spine: the conserving
`DigitalResourceEconomy`, `createDigitalWorker` persistence, and the V4
real-provider seam (`RealLiveProviderDriver` over an injected process driver).
V2 adds the non-forgeable `CivilizationLivePermit` (cohort ≤5, ≤8 provider calls),
an injectable `McpExecutionDriver` on the MCP nervous system (fake in tests,
human-only real), and the human CLI `civilization:live` (`--dry-run` + exact
phrase). Automated proof: `demoNamlaCivilizationLiveV2` — fake drivers, zero real
calls. See [namla-civilization-os-v2-live-mcp.md](namla-civilization-os-v2-live-mcp.md).
