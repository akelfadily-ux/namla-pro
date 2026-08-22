# 24 · Mission budgets and anti-livelock

## Hierarchy

`MissionBudget → StageBudget → WorkPackageBudget → LoopBudget → ProviderCallBudget`

Children cannot exceed allocation.

A trusted parent may reallocate **remaining** budget only when:
- total mission ceiling is not exceeded
- authority permits it
- reason is recorded
- evidence records the reallocation

Agents/providers cannot self-expand budgets.

## Authority vs runtime state

The Trust/Authority plane owns budget ceilings, admission rules, and whether a bounded reallocation is authorized. `MissionStateStore` records current allocations, reservations, and consumption. Recording a larger number in runtime state never grants additional authority.

## Oscillation policy

Do not hard-code one universal "two failures / three failures" rule. Versioned policy defines bounded parameters such as:

- `maxEquivalentFailures`
- `maxRepeatedArtifactStates`
- `maxRepairCycles`
- `maxReworkCycles`

Equivalent failure signatures and repeated artifact hashes/states are tracked. Policy exhaustion yields `HUMAN_REQUIRED` or `REPLAN` according to failure class.
