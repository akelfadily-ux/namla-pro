# Bot / Robot Body Model

A "body" is how an ant would eventually act in the world beyond planning and
communicating. Namla Pro separates *deciding* (ants, senses, pheromones,
missions) from *acting* (bodies), because the safety requirements for acting
are much stricter, and because the same decision-making colony should
eventually be able to drive very different kinds of bodies.

## Two body kinds today, more later

- **`BotBody`** (`src/bodies/botBody.ts`) — a software-only body. This is
  the eventual target for desktop automation (Phase 8): clicking, typing,
  running tools on a computer.
- **`RobotBody`** (`src/bodies/robotBody.ts`) — a placeholder for a future
  physical or IoT body (Phase 9): a device with sensors and actuators in the
  physical world.

Both share the same interface shape: a `plan()` method that takes an
action description and returns a `PlannedAction`. Neither has a fundamentally
different Phase 0 behavior — they both only ever plan.

## Adapters: how a body would reach a specific capability

- **`ToolAdapter`** (`src/bodies/toolAdapter.ts`) — the shared base helper
  every adapter uses to build a well-formed `PlannedAction`.
- **`CommandAdapter`** (`src/bodies/commandAdapter.ts`) — how a body would
  run a shell command. In Phase 0 it *always* refuses, via
  `refuseExecution()`, using `CommandSafetyPolicy` to explain in the
  refusal's description whether the command was also on the forbidden list.
- **`FileAdapter`** (`src/bodies/fileAdapter.ts`) — how a body would read or
  write a file. In Phase 0 it never touches the real filesystem; it checks
  `FileBoundaryPolicy` and returns a `PlannedAction` describing what it would
  have done.

## The `PlannedAction` contract

Every body/adapter interaction produces a `PlannedAction`
(`src/types/bodyTypes.ts`):

```ts
interface PlannedAction {
  actionId: string;
  kind: PlannedActionKind; // file-read | file-write | file-delete |
                            // command-execute | network-call |
                            // ui-interaction | device-actuation
  description: string;
  targetPath?: string;
  targetCommand?: string;
  requestedByAntId: string;
  plannedAt: string;
  requiresHumanApproval: boolean;
  executed: false; // literal type — not just a default value
}
```

The `executed` field is typed as the **literal** `false`, not `boolean`. This
is a deliberate TypeScript-level guarantee: nothing in Phase 0 can construct a
`PlannedAction` with `executed: true` without the type system itself
rejecting it. Turning on real execution in a later phase requires visibly
changing this type, not flipping a runtime flag.

## `BodyExecutionPolicy`: the single execution switch

`src/policies/bodyExecutionPolicy.ts` defines
`PHASE_0_EXECUTION_ENABLED = false as const` and an `assertExecutionAllowed()`
guard that throws whenever called in Phase 0. No Phase 0 code path calls the
guard, because no execution path exists at all — the guard is defined now so
that the first future phase to add real execution must route through it. There
is exactly one flag; it is not environment-configurable, not a settings
toggle, and not something an ant can change at runtime.

## Why bodies matter for the long-term vision

The ant colony metaphor extends naturally to physical and semi-physical
workers: a "worker ant" today plans a code change; a future "worker ant"
might plan a desktop automation step (Phase 8) or a robot/IoT actuation
(Phase 9). By fixing the `plan()`-only contract now, every future body
implementation has to prove it fits the same shape — a `PlannedAction` that
a human or a stricter policy layer can review — before it can ever execute
anything.
