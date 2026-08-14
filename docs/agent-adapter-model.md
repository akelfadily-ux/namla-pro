# Agent Adapter Model (Phase 7)

Phase 7 teaches the colony the *idea* of external worker tools — Claude
Code, Codex, Kimi, local scripts — without giving it any way to reach one.
An adapter here is a data contract: a named identity, a capability profile,
a safety-gated request shape, and a deterministic canned response marked
`simulated: true`. Nothing dials out; nothing spawns; nothing runs.

Authorized by the Phase 7 amendment in
[NAMLA_BUILD_LAW.md](../NAMLA_BUILD_LAW.md).

## Adapters-as-contracts

`AgentRequest` and `AgentResponse` (`src/adapters/agentAdapterTypes.ts`)
define what a colony↔agent exchange *is*: ids, purpose, prompt text,
response text, the safety decision that allowed it, and the receipt that
recorded it. `AgentCapabilityProfile` describes what a real adapter would
need to declare — supported purposes and permission names — with
`credentialsMode: "not-modeled"`, `networkAccess: false`, and
`processAccess: false` as literal types. The contract is the deliverable;
the integration is a future phase's problem.

## Why simulated adapters come before real integrations

The colony's machinery around an agent — gating its requests, receipting
its exchanges, reviewing its proposals, bounding its steps — is exactly the
machinery that must already work before a real agent is attached, because a
real agent is the first component whose *output* the colony does not
control. Phase 7 proves the harness with a tame stand-in: canned lookup
tables that behave like an agent-shaped source of text. When a real
integration arrives (its own phase, its own amendment), it inherits gates
that have already been exercised.

## The four tool identities

Claude Code, Codex, Kimi, and local-script exist as `AgentKind` values with
display names and canned voices — nothing more. They are future tool
identities, reserved and shaped, not connected.

## `simulated: true` as a hard boundary

Every response and every profile carries `simulated` as the literal type
`true`. Code cannot construct — or even describe — a non-simulated response
in Phase 7 without casts, and the law forbids adding one.

## Safety gates on the exchange

`AgentAdapterBase.handle` owns four gates no subclass can skip: kind match,
supported purpose, SafetyGuard over agent kind + purpose + requested
capability + prompt text (RISKY/FORBIDDEN refuse), and a SafetyGuard
re-check of the canned response text before it is returned. The response re-check turns the
write-time audit of canned text into an enforced property — if a future
edit slipped an indicator word into a canned line, the exchange would
refuse rather than emit it.

## Receipt redaction, and why prompts are never stored raw

Exchange receipts carry ids, kinds, purposes, and text *lengths*; refusals
add a reason code and a SHA-256 fingerprint of the prompt. Raw prompt text
never enters the receipt log: a refused prompt is by definition dangerous
wording, and even an accepted prompt may embed mission context that the
audit trail does not need. The reason-literal discipline (Phase 4) applies:
every summary and reason string in the adapters module is audited against
the `SecretProtectionPolicy` indicator list — including traps like
"informative", which contains the indicator `format` and is avoided in
canned text.

## Why credentials are not modeled

A field that exists gets filled. Modeling `apiKey?: string` in Phase 7
would create the exact place a future mistake would put a real key — so
the type system refuses the concept: `credentialsMode: "not-modeled"` is
the whole story, by law.

## Why no network / process / terminal / API call exists

The adapters module imports `crypto` (ids and fingerprints), the core
safety/receipt services, and the proposal factory — nothing else. The
project-wide invariant stands: no fetch, no http, no child_process, no
worker, no timer, anywhere. Simulated adapters did not bend that invariant;
they are its beneficiaries.

## AdapterRegistry and dependency injection

The registry stores adapters built by the human-controlled composition
root; it constructs nothing. `ColonySimulation` accepts a registry as an
optional injected capability — same pattern as the inspector, engines, and
factories before it. Missing kinds refuse with a receipt.

## How ColonySimulation uses adapters safely

When a registry is injected, a build task becomes a simulated exchange: the
task description (already engine-gated) is the prompt, the canned response
becomes the body of a factory-gated placeholder `CodeProposal`
(`applied: false`, like every proposal), and the exchange lands in the
event log and receipts. Without a registry, the Phase 6 placeholder path
runs unchanged. Determinism is preserved because canned text is a lookup,
not a generation.

## What is intentionally not implemented

- **Real integration with any agent** — no client, no protocol, no
  endpoint, no auth. That is Phase 7's boundary, not its backlog.
- **Prompt engineering** — prompts are task descriptions, not crafted
  templates.
- **Response variation** — one canned line per kind and purpose; realism
  is not the point, harness-proving is.
- **Streaming, retries, timeouts, rate limits** — all meaningless without
  a real call, all deferred to the phase that adds one.
- **Persistence** — exchanges vanish with the process.
