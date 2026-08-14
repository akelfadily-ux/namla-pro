# Real Cognitive Ants R1

R1 installs a **provider-neutral, bounded cognitive runtime** with a
deterministic end-to-end mission workflow, isolated workspaces, a voluntary
software-work market, proposal competition + local quorum, and a
review/verify/repair loop — with Claude Code / Codex adapters **installed but
inactive**. Authorized by `NAMLA_BUILD_LAW.md` §18 (reaffirming §16).

**Persistent ants are not simultaneous model calls.** The colony holds 300 (or
1,000 / 10,000) persistent identities; at most 5 are cognitively active in the
R1 demo, and the global colony cognitive budget stays 30. No real model is
called: `realClaudeCalls`, `realCodexCalls`, `realProviderProcessExecutions`,
`realNetworkCalls`, and `realFilesystemWrites` are all zero.

## Where it lives (reused, not duplicated)

The R1 runtime is the existing `src/colonyMission/` layer (§16). R1 adds the
deterministic end-to-end demo
[`src/examples/demoRealCognitiveAntsR1.ts`](../src/examples/demoRealCognitiveAntsR1.ts),
this documentation, the §18 authorization, and the R1 invariants.

| Concern | Module(s) | Doc |
|---|---|---|
| Cognitive runtime (registry, router, validators, budget, deterministic worker) | `cognitiveWorker*`, `cognitiveExecutionBudget`, `deterministicCognitiveWorker` | [cognitive-worker-runtime.md](./cognitive-worker-runtime.md) |
| Claude/Codex adapters (inactive) | `claudeCliAdapter`, `codexCliAdapter`, `cliCognitiveWorkerBase`, `plannedCliInvocation` | [provider-adapter-boundary.md](./provider-adapter-boundary.md) |
| Voluntary work market | `workDemand` | [software-work-market.md](./software-work-market.md) |
| Isolated workspace | `missionWorkspace`, `fakeWorkspaceDriver` | [mission-workspace-security.md](./mission-workspace-security.md) |
| Proposal competition + quorum | `proposalCompetition` | this doc |
| Review / verify / repair | `reviewLoop`, `verificationRunner`, `artifactTypes` | [review-test-repair-loop.md](./review-test-repair-loop.md) |
| Command-center state | `commandCenterState` | [command-center-state.md](./command-center-state.md) |
| Orchestration | `missionRunner` | runtime-spine.md |

## The architectural boundary

`src/colony/` stays **pure and deterministic** (no fs, no `child_process`, no
network, no provider code, no credentials). External cognition and mission
execution live entirely under `src/colonyMission/`. **The colony decides
locally; the provider only supplies bounded cognition to an already-selected
ant.** A provider never selects an ant, assigns a task, controls the Queen,
inspects all minds, runs an autonomous loop, or gets unrestricted fs/shell.

## Proven end to end (demo, seed 20260724)

300 identities enter a task-manager mission; **3 scout proposals reach local
quorum** (2 rejected, recorded); **767 voluntary work claims → 5 accepted** with
**0 non-volunteer assignments**; 8 cognition claims admitted under a **peak of 3
≤ 5**; 5 artifacts proposed and reviewed before any workspace apply; **1
deterministic defect injected → detected by verification → 1 repair round →
final verification passes**; 0 workspace boundary violations; 8 deterministic
provider calls; every real-provider / process / network / filesystem counter
zero. Registered as golden `demoRealCognitiveAntsR1`.

## Real activation is human-only and future

`npm run colony:real-smoke -- --provider <claude|codex>` requires explicit
provider selection + typed human confirmation and still refuses at the adapter.
The first real smoke call would activate exactly **one** ant and make exactly
**one** request; a first multi-ant phase caps at **five**; the global budget
stays **30**; the Queen never activates a provider. None of this runs in R1. See
[provider-adapter-boundary.md](./provider-adapter-boundary.md).
