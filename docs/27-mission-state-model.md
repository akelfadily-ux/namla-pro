# 27 · Mission and WorkPackage state model

Runtime state is separate from append-only evidence.

## Mission state machine

The happy path is linear, but recovery is **checkpoint-driven**. `HUMAN_REQUIRED` ends the current autonomous run; an explicit authorized resume does not jump to a fixed stage. It re-enters through `RESUMING`, validates the stored resume checkpoint and current authority, then returns to the stage selected by the recovery plan / minimal stale verification frontier.

```mermaid
stateDiagram-v2
  [*] --> CREATED
  CREATED --> INTERPRETING
  INTERPRETING --> PLANNING
  PLANNING --> CONTRACT_FREEZE
  CONTRACT_FREEZE --> DISPATCHING
  DISPATCHING --> EXECUTING_AB
  EXECUTING_AB --> COMPARING
  COMPARING --> INTEGRATING
  INTEGRATING --> VERIFYING
  VERIFYING --> PACKAGING
  PACKAGING --> COMPLETED

  COMPARING --> RECOVERING: bounded A/B rework
  INTEGRATING --> RECOVERING: integration/cross-cutting failure
  VERIFYING --> RECOVERING: fix or rework
  PACKAGING --> RECOVERING: engineering defect discovered
  RECOVERING --> EXECUTING_AB: stale frontier requires A/B
  RECOVERING --> COMPARING: comparison must rerun
  RECOVERING --> INTEGRATING: integration must rerun
  RECOVERING --> VERIFYING: verification-only frontier
  RECOVERING --> PACKAGING: packaging-only frontier

  PLANNING --> REPLANNING: authorized plan correction
  CONTRACT_FREEZE --> REPLANNING: draft/contract conflict
  DISPATCHING --> REPLANNING: invalid package/plan conflict
  EXECUTING_AB --> REPLANNING: implementation exposes plan conflict
  COMPARING --> REPLANNING: plan conflict
  INTEGRATING --> REPLANNING: plan conflict
  VERIFYING --> REPLANNING: plan conflict
  REPLANNING --> PLANNING

  INTERPRETING --> HUMAN_REQUIRED
  PLANNING --> HUMAN_REQUIRED
  CONTRACT_FREEZE --> HUMAN_REQUIRED
  DISPATCHING --> HUMAN_REQUIRED
  EXECUTING_AB --> HUMAN_REQUIRED
  COMPARING --> HUMAN_REQUIRED
  INTEGRATING --> HUMAN_REQUIRED
  VERIFYING --> HUMAN_REQUIRED
  PACKAGING --> HUMAN_REQUIRED
  RECOVERING --> HUMAN_REQUIRED
  REPLANNING --> HUMAN_REQUIRED

  HUMAN_REQUIRED --> RESUMING: explicit authorized resume
  RESUMING --> INTERPRETING: checkpoint = interpretation
  RESUMING --> PLANNING: checkpoint = planning/replan
  RESUMING --> CONTRACT_FREEZE: checkpoint = contract freeze
  RESUMING --> DISPATCHING: checkpoint = dispatch
  RESUMING --> RECOVERING: checkpoint = post-dispatch stale frontier

  INTERPRETING --> FAILED
  PLANNING --> FAILED
  CONTRACT_FREEZE --> FAILED
  DISPATCHING --> FAILED
  EXECUTING_AB --> FAILED
  COMPARING --> FAILED
  INTEGRATING --> FAILED
  VERIFYING --> FAILED
  PACKAGING --> FAILED
  RECOVERING --> FAILED
  REPLANNING --> FAILED

  CREATED --> CANCELLED
  INTERPRETING --> CANCELLED
  PLANNING --> CANCELLED
  CONTRACT_FREEZE --> CANCELLED
  DISPATCHING --> CANCELLED
  EXECUTING_AB --> CANCELLED
  COMPARING --> CANCELLED
  INTEGRATING --> CANCELLED
  VERIFYING --> CANCELLED
  PACKAGING --> CANCELLED
  HUMAN_REQUIRED --> CANCELLED
```

Illegal transitions fail closed and append transition evidence. A resume checkpoint stores the intended safe re-entry stage plus the artifact/contract/policy identities that must still be current; pre-dispatch checkpoints re-enter their exact validated stage, while post-dispatch recovery uses the minimal stale frontier; it is not a string that can bypass transition validation.

## WorkPackageExecution state machine

```ts
type WorkPackageExecutionState =
  | "READY"
  | "CLAIMED"
  | "EXECUTING"
  | "VERIFYING"
  | "FAILED_FIXABLE"
  | "FAILED_REWORK"
  | "REWORKING"
  | "PASSED"
  | "INTEGRATING"
  | "DONE"
  | "HUMAN_REQUIRED";
```

```mermaid
stateDiagram-v2
  [*] --> READY
  READY --> CLAIMED
  CLAIMED --> EXECUTING
  EXECUTING --> VERIFYING
  VERIFYING --> PASSED
  VERIFYING --> FAILED_FIXABLE
  VERIFYING --> FAILED_REWORK
  FAILED_FIXABLE --> EXECUTING
  FAILED_REWORK --> REWORKING
  REWORKING --> VERIFYING
  PASSED --> INTEGRATING
  INTEGRATING --> DONE
  EXECUTING --> HUMAN_REQUIRED
  VERIFYING --> HUMAN_REQUIRED
  REWORKING --> HUMAN_REQUIRED
```

Each Colony A/B run of the same immutable WorkPackage has its own `WorkPackageExecution` record. Tracked mutable fields include `executionId`, `colonyId`, owner/lease, attempt, budget consumption, ArtifactIdentity refs, evidence refs, and resume checkpoint. The immutable WorkPackage itself has no mutable owner.


## Concurrency-safe state transitions

Mission and execution records carry a monotonically increasing `stateVersion`. Pro (or the trusted runtime coordinator acting for Pro) changes state only through an atomic conditional transition conceptually equivalent to:

```ts
compareAndTransition(recordId, expectedStateVersion, legalTransition)
```

A stale writer, expired/superseded lease, wrong execution identity, or illegal transition is rejected fail-closed and produces transition evidence. Agents/providers never update MissionStateStore directly. Exact persistence/CAS technology is an implementation decision, but the compare-and-transition invariant is architectural.
