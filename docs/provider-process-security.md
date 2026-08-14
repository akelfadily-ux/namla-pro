# Provider process security

`src/cognitive/nodeProviderProcessDriver.ts` (Build Law §19) — the one and only
module in Namla Pro that imports `child_process`, and the only real
process-spawning code. It is never imported by any automated demo or test.

## Confinement

- **One child process, one shot.** `spawnSync` with `shell: false`. No detached
  process, no background process, no process tree, no interactive session, no
  retry loop.
- **Hard-coded executable map.** The executable is chosen only from
  `{ claude: "claude", codex: "codex" }` by an enum key — never a user path,
  never mission text. No mission or task text is ever converted into the
  executable name or a CLI argument; the argument list is a fixed literal from
  the adapter, and the prompt is delivered as bounded stdin data.
- **Bounded everything.** stdin is truncated to the permit's input cap; stdout
  and stderr are truncated to their caps with truncation flags; the timeout
  kills the child (`SIGKILL`), mapped to a `timed-out` failure category.
- **Safe exit mapping.** Missing executable → `executable-missing`; spawn error
  → `spawn-failed`; timeout → `timed-out`; non-zero exit → `non-zero-exit`;
  otherwise `none` (or `output-truncated`).

## Environment handling

The driver **never enumerates or logs `process.env`.** It reads a small NAME
allowlist by key (PATH/HOME/USERPROFILE/SystemRoot/TEMP/TMP/LANG/APPDATA/…) and
drops any name matching KEY/TOKEN/SECRET/PASSWORD/CREDENTIAL/COOKIE/PRIVATE. No
credential value is read deliberately, passed on purpose, persisted, or logged.
Provider authentication remains entirely external (the provider CLI's own
session).

## Receipts and output

Raw stdout/stderr, environment, and credentials **never reach a receipt.**
Receipts (via `realProviderActivation.ts`) carry the safe parsed summary, a
failure category, counts, an output fingerprint, exit code, and truncation/
timeout flags only. The parsed provider output is **DATA** — it enters the
existing review-gated workflow and is never applied or executed automatically
(`providerOutputParser.ts` never evaluates JavaScript, never runs a returned
command, and never trusts a returned file path).
