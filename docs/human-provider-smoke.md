# Human-only provider smoke

`src/cli/colonyRealSmokeCli.ts` (Build Law §19). The only place in Namla Pro
that can run a real Claude/Codex process.

```
npm run colony:real-smoke -- --provider claude
npm run colony:real-smoke -- --provider codex
```

## What it does, in order

1. Requires an **interactive terminal** (`process.stdin.isTTY` and
   `process.stdout.isTTY`); refuses headless/piped invocation.
2. Requires **explicit** `--provider claude` or `--provider codex`.
3. Admits **one** ant through the bounded cognitive budget (peak far under 30).
4. Creates/validates one dedicated smoke workspace
   (`workspaces/provider-smoke/<provider>/<mission>/`).
5. Displays provider, antId, taskId, missionId, workspace, input byte cap,
   output byte cap, timeout, and `invocation count: 1`.
6. Requires the human to type **exactly** `RUN ONE CLAUDE ANT` or
   `RUN ONE CODEX ANT`. It does **not** accept `y`, `yes`, `true`, an argv flag,
   an environment variable, piped stdin, or any AI-generated confirmation.
7. Mints **one** `RealProviderExecutionPermit`, issues **one** bounded request
   through `adapter.executeReal` with the real Node driver, prints a **redacted**
   result, writes a safe receipt + summary, and stops.

## The smoke task (fixed, harmless, cognition-only)

The human's request asks the provider to review a tiny in-memory function
description and return one correctness observation, one edge case, one test
suggestion, and a confidence 0..1. It never asks the provider to edit files, run
commands, or inspect the repository. It contains no credentials, secrets,
personal data, or arbitrary repository content.

## Provider authentication stays external

Namla stores no API key. The real driver relies on the provider CLI's own
already-authenticated local session (e.g. a prior `claude`/`codex` login) and
forwards only a minimal environment name allowlist, dropping any name matching
KEY/TOKEN/SECRET/PASSWORD/CREDENTIAL/COOKIE/PRIVATE. No credential value is read
deliberately, persisted, or logged.

## Not automated, ever

This CLI is never invoked by any test, demo, or build. Confirmation can only
come from a human typing at a TTY. The first real multi-ant phase (3-5 ants,
global budget still 30) requires its own separate explicit human authorization.
