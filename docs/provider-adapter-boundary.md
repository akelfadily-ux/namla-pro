# Provider adapter boundary (Claude Code / Codex — installed, inactive)

`src/colonyMission/claudeCliAdapter.ts`, `codexCliAdapter.ts`,
`cliCognitiveWorkerBase.ts`, `plannedCliInvocation.ts`. Authorized by
`NAMLA_BUILD_LAW.md` §16/§18.

The Claude Code and Codex adapters are **installed but inactive**. Each
implements the same provider-neutral `CognitiveWorker` contract as the
deterministic worker, so a future authorized phase can attach a real one without
redesign — but today each one:

- is **disabled by default** and never invoked during any automated test;
- **hard-codes** its executable name (never derived from mission text);
- builds a fully-specified `PlannedCliInvocation` — argument template, bounded
  prompt-file delivery, bounded stdin, bounded stdout/stderr, bounded timeout,
  one-shot, no interactive process, no retry loop — and then **always refuses**
  with a safe, redacted receipt;
- uses **no `shell: true`**, captures **no raw environment**, stores **no API
  key** in the repo, and puts **no secret in any receipt**;
- reaches **no real process driver**: there is no `child_process` import
  anywhere in `src/colonyMission/`, so the real Node process driver does not
  exist for demos to reach.

**No mission text ever becomes a command or an argument.** The invocation
argument template is fixed; the prompt is delivered as bounded data, never
spliced into the command line.

## Invocation counters (proven zero)

`realClaudeCalls = 0`, `realCodexCalls = 0`, `realProviderProcessExecutions = 0`.
The R1 demo asserts all three, and the safety invariants re-check that no
`child_process` import and no `shell: true` exist.

## Human-only activation (future)

`npm run colony:real-smoke -- --provider <claude|codex>`
(`src/cli/colonyRealSmokeCli.ts`) requires explicit provider selection and typed
human confirmation, displays the exact ant/task/workspace/limits, and still
refuses at the adapter. No default provider is real; nothing activates
automatically. A first real call would use **exactly one** ant and **one**
request; a first multi-ant phase caps at **five**; the global budget stays
**30**. Not executed in R1.

## Status labels

- **Digital adaptation:** the CLI-invocation contract and refusal-with-plan
  pattern are engineering safety scaffolding, not biology.
- **Postponed:** real provider execution — a separate, explicitly
  human-authorized phase that, per Build Law §1-2, cannot loosen a hard boundary.
