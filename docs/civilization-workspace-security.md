# Civilization Workspace & Security

A live civilization mission writes only into an **isolated workspace** and never
into the source tree. It reuses the same workspace boundary and security posture
proven by the live-objective runtime (see
[live-objective-workspace-security.md](live-objective-workspace-security.md)).

## Workspace isolation

- Root: `workspaces/namla-civilization/<objective-id>/` (the demo/CLI use
  `workspaces/namla-civilization/civ-projman`).
- Backed by `InMemoryWorkspaceDriver` in tests (no disk writes); the human-only
  real path routes file tools through the authorized `writeLiveObjectiveFile`.
- Caps from the permit: `workspaceFileCap` (≤32), `perFileByteCap` (≤20000 B),
  `totalWorkspaceByteCap` (≤200000 B). Artifacts are applied only after
  independent review.
- No path escapes the workspace root; no source-tree file is created or modified.

## Security in the mission

- The **defensive-security district** raises at least one finding on every run
  (`securityFindings` ≥ 1); the finding is recycled through the waste economy.
- The **security council** reviews the finding as policy.
- **High-risk artifacts** (paths matching service/repo/backend/security/data)
  require two reviewers and the security + tool-permission councils before
  application.
- **No self-review**: an artifact's author can never be one of its reviewers
  (`selfReviewsAccepted` stays 0).

## What the tests prove

`realFilesystemWrites`, `realNetworkCalls`, and `realMcpExecutions` are all 0 in
automated verification — the workspace is in-memory and the MCP executor is a
fake. Real file/verification side effects exist only behind the human-only
`RealMcpExecutionDriver`, which is never constructed during a demo or the golden
harness.

## Pre-run stale-output guard (operational hardening)

Because the run workspace is a fixed `workspaces/namla-civilization/<run-id>/`, a
second real run would otherwise reuse — and silently overwrite — an earlier run's
output. The CLI now runs a read-only `inspectCivilizationWorkspace` before any
confirmation: it reports the resolved path, inside-root status, existing file/byte
count, new-vs-reused, and `staleOutput`. If prior-run output exists the CLI
**refuses** with `stale-workspace-output` and instructs the human to archive or
rename the directory — **nothing is deleted or overwritten**, and no confirmation
or permit is consumed. See [civilization-live-preflight.md](civilization-live-preflight.md).
