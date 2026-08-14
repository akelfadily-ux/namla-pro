# Example: First Colony Flow

This walks through what happens, conceptually, when a human gives the colony
its first mission. It mirrors [src/examples/demoMission.ts](../src/examples/demoMission.ts).

## 1. The human speaks

> "Write documentation describing how the colony works."

This becomes a `ColonyMission` with two goals: explain ant roles, explain the
safety model.

## 2. The Queen checks safety first

`AntQueen.acceptMission` calls `SafetyGuard.evaluateText` on the mission's
title plus its raw instruction before anything else happens. Neither contains
a forbidden or risky indicator, so the mission evaluates to `SAFE` and is
allowed.

## 3. The Queen announces intent

The Queen emits a `HumanIntentPheromone` onto the `PheromoneBus` with the
mission's title and raw instruction. Any ant that senses this pheromone now
knows what the human wants, without the Queen having to message every ant
individually.

## 4. The mission becomes tasks

`MissionPlanner.planInitialTasks` turns each goal into one `ColonyTask`,
initially in `proposed` status, requiring a `planner` role.

## 5. Tasks are routed

`ColonyOrchestrator.processTasks` re-checks each task's description with
`SafetyGuard`, then asks `TaskRouter` to find an available ant with the
`planner` role. If found, the task becomes `assigned` and a `TrailPheromone`
is emitted marking that an ant is now working in that direction.

## 6. Everything is receipted

Every step — the safety check, each task routing decision, and the mission's
overall outcome — produces an `ActionReceipt` in `ReceiptLog`. Nothing happens
silently.

## 7. What did NOT happen

No file was written. No command ran. The "documentation" goal from this
mission is a planning exercise in Phase 0 — actually producing the
documentation is Phase 3 (safe code generation tasks) work.
