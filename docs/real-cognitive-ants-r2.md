# Real Cognitive Ants R2 — human-only bounded provider execution

R2 installs the **first real process-execution door** in Namla Pro, and makes it
the smallest possible one: **one human, one provider, one ant, one bounded
request, one process, one response, then stop.** Authorized by
`NAMLA_BUILD_LAW.md` §19 (the first amendment that touches the Section 1
hard boundary, and only because a human explicitly authorized it there).

**Automated real execution stays zero.** Every demo, test, and build uses the
`DeterministicCognitiveWorker` and the `FakeProviderProcessDriver`. The real
Node driver and the real smoke workspace are reached only by the human-only
`colony:real-smoke` CLI.

## The modules (new boundary: `src/cognitive/`)

| Module | Role |
|---|---|
| `realProviderExecutionPermit.ts` | Non-serializable, WeakSet-identity, single-use permit + TTY/typed-phrase confirmation |
| `providerProcessDriver.ts` | Driver contract + `FakeProviderProcessDriver` (demos) |
| `nodeProviderProcessDriver.ts` | The **only** `child_process` importer; one-shot `spawnSync`, `shell:false`, env-filtered |
| `providerOutputParser.ts` | Bounded, safe parse of provider stdout — output is DATA, never authority |
| `realProviderActivation.ts` | The gate: validate → consume-before-spawn → run → parse → safe receipt |
| `smokeWorkspace.ts` | The human-only real smoke workspace (2nd of two authorized fs-mutation modules) |
| `src/cli/colonyRealSmokeCli.ts` | The human-only entry point |
| `src/examples/demoRealProviderActivationR2.ts` | Fake-driver verification of all 22 cases |

## What R2 proves (demo, fake driver only)

22 cases, all pass: missing/forged permit and every scope mismatch refuse
(WeakSet identity + exact scope match); an already-consumed permit refuses on
replay; every process failure path (executable missing, spawn failure, timeout,
non-zero exit, oversized stdout/stderr, malformed output) fails safely with the
permit consumed; a receipt failure after success keeps the permit consumed; fake
Claude and Codex success lifecycles complete. Counters: `forgedPermitsAccepted
0`, `preAdmissionPermitConsumption 0`, `replayRefusals 2`, `realClaudeCalls 0`,
`realCodexCalls 0`, `realProviderProcessExecutions 0`, `sourceTreeWrites 0`,
`workspaceBoundaryViolations 0`, `central=queen=globalPlanner 0`. Registered as
golden `demoRealProviderActivationR2`.

## The exact permitted scope

- one explicitly human-selected provider (`claude` or `codex`);
- one cognitive ant, already admitted through voluntary claim + bounded
  cognitive-budget admission (peak far under the global 30);
- one bounded request, one bounded result;
- one human-invoked CLI command requiring an interactive TTY and the exact typed
  phrase;
- a dedicated smoke workspace under `workspaces/provider-smoke/<provider>/<mission>/`;
- immediate termination afterward — no loop, no retry, no second request.

See [real-provider-execution-boundary.md](./real-provider-execution-boundary.md),
[human-provider-smoke.md](./human-provider-smoke.md), and
[provider-process-security.md](./provider-process-security.md).
