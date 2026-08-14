# Live Provider Wiring

`src/cognitive/liveProviderExecution.ts` connects the existing pieces into one
real provider call per ant (Build Law §26).

## Sequence per ant

1. the ant voluntarily claimed work and was admitted to the cohort;
2. the human-approved provider assignment is validated (`permit.provider === input.providerId`);
3. a scoped single-use `RealProviderExecutionPermit` is looked up for the ant;
4. a bounded `ProviderProcessSpec` is built (fixed executable id, fixed argument template, bounded stdin prompt, timeout, workspace cwd);
5. the permit is CONSUMED immediately before spawn (`consumePermit`);
6. exactly one process runs via the injected `ProviderProcessDriver`;
7. bounded stdout is captured;
8. stdout is parsed to a bounded `RawProviderPayload` and normalized to data;
9. the process stops; no provider can trigger another provider; there is no retry.

## Fixed invocation

`shell:false`, an executable chosen only from the hard-coded map (`claude` /
`codex`), a fixed argument list per provider (never built from mission text), the
prompt delivered on bounded stdin (never as a CLI argument), bounded
stdout/stderr, a timeout, no detached mode, no interactive session, no retry loop.
The repository is never exposed to providers — only the objective workspace cwd.

## Real counters key off the driver

`RealLiveProviderDriver` increments `realProviderProcessExecutions`,
`realClaudeCalls`, and `realCodexCalls` ONLY when the injected process driver
`isReal`. Automated tests inject `FakeProviderProcessDriver`, so those stay 0
through the exact same wiring. A defense refuses any automated-test-origin permit
against the real Node driver (`non-human-permit`), so a demo can never reach real
execution.

## Provider modes

Human-selected pools: `claude,claude,codex`, `claude,claude,claude`,
`codex,codex,codex`, `claude,codex,codex`. Providers are never silently
substituted. An unavailable provider records a failure (`executable-missing`),
does not retry automatically, and allows partial cohort completion; a real
replacement requires new human confirmation.

## Codex invocation (Windows stdin-timeout fix)

Codex is a NON-interactive `exec` run whose bounded prompt is the single FINAL
POSITIONAL argument, with EMPTY, immediately-closed stdin:

`codex exec --ephemeral --json <BOUNDED_PROMPT>`

The executable stays hard-coded (`codex`), the flags are fixed, `shell:false`
means the positional prompt can never become a flag, and the timeout / byte caps
/ single-use permit / workspace cwd / call caps are all retained. (The earlier
shape — `codex exec --json` with the prompt on stdin — hung on Windows because
Codex waited on stdin with no positional prompt.) Claude is unchanged: fixed
flags with the prompt delivered on stdin.

Codex `--json` emits JSONL (one JSON object per line: `thread.started`,
`turn.started`, `item.completed`, `turn.completed`). `parseCodexJsonl` splits
stdout into non-empty lines, parses each independently, skips malformed lines
safely, and extracts the final result from the `item.completed` whose
`item.type === "agent_message"` (`item.text`) — never evaluating the text, running
commands, or trusting paths, and enforcing the byte cap. Exit semantics: exit 0 +
agent_message → completed; exit 0 + none → `missing-provider-result`; non-zero →
`non-zero-exit`; timeout → `timed-out`; malformed → `malformed-provider-output`;
oversized → `provider-output-too-large`. stderr warnings (model-cache, deprecated
flags, shortened skill descriptions) never fail an exit-0 result; only a safe
warning count and truncation flag are recorded, never raw stderr.
