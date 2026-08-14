# Mission Planning Model (Phase 2)

Phase 2 replaces the placeholder one-task-per-goal planner with a real
mission decomposition system. It changes how well the colony can *plan* —
it does not change what the colony can *do*, which remains: observe
(read-only, Phase 1) and propose. Nothing in Phase 2 executes, writes,
installs, pushes, or loops.

## The pieces

- **`src/planner/decompositionEngine.ts`** — turns a `ColonyMission` (plus an
  optional Phase 1 `ProjectSnapshot`) into a dependency-linked task pipeline
  per goal, safety-gates every task, and produces an ordered result with
  receipts.
- **`src/planner/taskDependencyGraph.ts`** — validates the dependency
  structure: no missing references, no cycles; produces the topological
  order used for routing.
- **`src/planner/rolePicker.ts`** — deterministic keyword rules that assign
  each task a `requiredRole`.
- **`ColonyTask.dependsOnTaskIds`** (new field in
  `src/types/taskTypes.ts`) — the dependency edges.
- **`ColonyTask.expectedOutputKind`** (added in Phase 3) — what shape of
  output a task produces: `"analysis"`, `"code-proposal"` (a `CodeProposal`
  data object, see [code-generation-model.md](./code-generation-model.md)),
  or `"report"`.

## Mission decomposition

For each `MissionGoal`, the engine generates a five-stage pipeline, each
stage depending on the previous:

```
investigate  ->  plan  ->  propose build  ->  verification plan
                                   \               |
                                    +--->  review & audit
```

Two mission-level tasks bracket the goal pipelines:

- When a `ProjectSnapshot` is provided, an opening **"Investigate the
  project snapshot"** task is created, and every goal's investigation
  depends on it — planning starts from what the project actually looks
  like, not from assumptions. The snapshot's real counts (files, folders,
  skipped items) are embedded in the task description.
- A closing **"Report mission outcome to the human"** task depends on every
  goal's audit task, so the mission always ends with a human-facing summary
  — or visibly fails to, if audits were blocked.

## Dependency graphs and ordering

`TaskDependencyGraph.validate` runs two checks, refusing with a receipt on
failure:

1. **Missing dependencies** — every `dependsOnTaskIds` entry must reference
   a task in the set. Dangling references mean the plan is incoherent;
   refused with receipt (`refused`, ids in details).
2. **Cycles** — ordering uses Kahn's algorithm: repeatedly emit tasks whose
   dependencies are all already emitted. If tasks remain when nothing more
   can be emitted, those tasks form a cycle; the graph is refused with a
   receipt naming the cycle's task ids. A cyclic plan can never be
   scheduled, and silently dropping the cycle would hide a planning bug —
   so the whole graph is rejected loudly instead.

When valid, the emitted sequence is the topological order — the routing
order the Queen uses.

## Role picking

`pickRole` matches task text against ordered keyword rules; first match
wins; no match falls back to `worker`. Assignments: guard for safety checks,
messenger for human reports, scout for investigation, planner for
decomposition, auditor for review, builder for construction proposals,
tester for verification plans, memory for memory/receipt tasks, strategist
for roadmap/strategy, repair for fixes.

Rule order is load-bearing and documented in the file itself: e.g. the audit
task's text mentions "the build and verification proposals", so `auditor`
must be checked before `builder` and `tester`; the mission report mentions
"receipts to review", so `messenger` must be checked before `auditor` and
`memory`. The picker assigns responsibility, not capability — whatever role
is picked, the task still passes SafetyGuard, and no role can execute
anything.

## SafetyGuard gating

Every generated task is evaluated on `title + description` before it enters
the graph. Three layers of gating apply to a planned task by the time an ant
sees it:

1. **Mission level** — `AntQueen.acceptMission` evaluates the mission's
   title and raw instruction (Phase 0 behavior, unchanged).
2. **Planning level (new)** — the engine evaluates each generated task;
   blocked tasks are marked `rejected`, receipted, and excluded. Tasks that
   depend (directly or transitively) on a rejected task are marked
   `blocked` — a pipeline poisoned at any stage cannot partially run.
3. **Routing level** — `ColonyOrchestrator.processTasks` re-evaluates each
   task it routes (Phase 0 behavior, unchanged).

A consequence worth knowing: because the final human-report task depends on
every goal's audit, one forbidden goal transitively blocks the report task
too. That is deliberate — a mission with a poisoned goal ends in visible
blocked receipts, not a cheerful summary that omits the refusal.

## Receipt production

The engine writes: one receipt per safety-blocked task (id-based summary,
reasons in details — task text is never echoed into summaries, since blocked
text often contains the very indicators `ReceiptLog` refuses); one refusal
receipt if the graph is invalid (from the graph validator, plus the engine's
own); and one summary receipt per decomposition with ordered/blocked counts.
`PlannerAnt.proposeDecomposition` and `AntQueen.acceptMission` add their own
receipts on top.

## ProjectSnapshot usage

The snapshot is consumed, never required: `AntQueen.acceptMission` takes it
as an optional third argument. With a snapshot, the Phase 2 engine plans
against observed reality; without one, the Phase 0 `MissionPlanner` fallback
runs exactly as before, so nothing that worked in Phase 0 changed behavior.
Like the inspector itself (Phase 1) and the engine handed to `PlannerAnt`,
the snapshot is injected by the human-controlled composition root — ants and
planners acquire no ambient authority.

## What is still not implemented

- No task *execution* of any kind — a routed task is an assignment, and the
  assigned roles only produce proposals and receipts.
- No LLM or heuristic content analysis — decomposition is structural
  (per-goal pipelines), not semantic understanding of the goal text.
- No re-planning, progress tracking, or feedback loop (Phase 4 territory).
- No persistence — plans, receipts, and snapshots live in memory only.
- No concurrency or scheduling — the topological order is a list, not a
  scheduler.

## Why this is still not autonomous execution

Planning output is data: `ColonyTask` objects with statuses and receipts.
Nothing consumes that data to *act* — there is no executor, no loop
(`AutonomousLoopPolicy` budget is still zero), no timer, and no code path
from a planned task to a filesystem write, command, or network call, because
no such capability exists anywhere in the codebase. The engine runs when a
human-run script calls it, produces its plan, and stops.
