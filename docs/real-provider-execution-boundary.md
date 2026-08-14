# Real provider execution boundary

`src/cognitive/realProviderExecutionPermit.ts` + `realProviderActivation.ts`
(Build Law §19).

## Why this is the first real process exception

Every phase before R2 kept the Section 1 hard boundary "Never run real system
commands" absolute — the Claude/Codex adapters built a fully-specified plan and
always refused. R2 opens the smallest possible door, and only because a human
explicitly authorized it by naming the Law file: one human, one provider, one
ant, one bounded request, one process, one response, then stop. No broader
execution capability is granted.

## The permit

`RealProviderExecutionPermit` is **non-serializable by identity**: its validity
is membership in a module-private `WeakSet`, not any field value. A JSON
round-trip, an object literal, mission data, an ant, the Queen, an environment
variable, a boolean, or an AI-generated object all produce objects that are not
in the WeakSet, so `isValidPermit` rejects them (the demo's "forged permit" case
proves `forgedPermitsAccepted = 0`).

A permit that authorizes REAL execution has `origin: "human-cli"` and can only be
minted with a `HumanConfirmation`, issued by `acquireHumanConfirmation` **only**
for an interactive TTY plus the exact typed phrase, with no argv flag and no
piped stdin. Automated tests mint `origin: "automated-test"` permits and pair
them with the fake driver; the real path (`requireHumanCliOrigin: true`) refuses
any non-`human-cli` permit.

Scope binds provider, missionId, taskId, antId, workspaceId, max input/output
bytes, timeout, `maxInvocations: 1`, and an issued sequence. Every field must
match the request exactly.

## Single-use consumption (the gate order)

`activateRealProvider` runs, in order: provider-is-real → permit valid → scope
matches → not already consumed → (real path) human-confirmed origin → request
bounded/not-oversized. **Every one of these pre-admission refusals returns
without consuming.** The permit is consumed **immediately before** the driver
runs, and stays consumed for every post-spawn outcome — executable missing,
spawn failure, timeout, non-zero exit, malformed output, receipt failure, or
success. A consumed permit refuses on replay (the demo's two replay cases prove
`replayRefusals = 2`). There is no retry with the same permit.

## Honest limitation

This is an **architectural** boundary, not cryptographic protection against
arbitrary trusted local code in the same process. Replay prevention is
process-local single-use only — not durable across a process restart, and no
durable guarantee is claimed. The boundary stops accidental, data-driven, and
AI-object activation, not a human deliberately writing new trusted code.
