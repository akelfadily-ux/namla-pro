# Live Repair Confirmation

When real verification fails, V4 repair is strictly human-gated (Build Law §26).

## The loop

1. the CLI shows the failure and the exact commands;
2. it requires the separate exact phrase, typed at the TTY:

   `RUN ONE REPAIR ANT`

3. only on an exact match (never y/yes/true/flag/pipe) does it mint ONE fresh
   single-use member permit and make ONE repair provider call;
4. the repair output is normalized, independently reviewed, and applied inside the
   workspace;
5. verification re-runs.

## Caps

At most two repair provider calls, at most two repair rounds, at most five real
provider calls total (three initial + two repair). There is no automatic repair
provider execution and no background continuation — the CLI stops after
completion, a bounded failure, or the five-call cap.

## The human CLI flow

`npm.cmd run digital:live-objective -- --providers claude,claude,codex` requires an
interactive TTY, displays the objective, workspace, three voluntary ants,
providers, byte/file/call/time limits, and exact verification commands, then
requires `RUN DIGITAL OBJECTIVE WITH 3 ANTS`. It mints the scoped live permit,
makes exactly one bounded provider call per admitted ant, normalizes, reviews,
applies approved files, runs allowlisted verification, and enters the repair loop
above. `--dry-run` performs all validation and request building but executes no
process, writes no file, and consumes no live permit.
