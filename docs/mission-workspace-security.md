# Mission workspace security

A mission workspace is a bounded, isolated area under
`workspaces/<mission-id>/`. `MissionWorkspace` (`missionWorkspace.ts`)
never writes anything until it has been PROPOSED as data first — the same
discipline the C0-C2 capability stack already uses for project files.

## Boundary checks (`checkWorkspaceBoundary`)

Every proposed path is checked before it is even queued:

- empty path, absolute path (`C:\` or leading `/`), and `..` traversal
  segments are all refused.
- any path starting with `src/`, `docs/`, or naming
  `NAMLA_BUILD_LAW.md`/`SAFETY_INVARIANTS.md` is refused —
  Namla source is never a mission write target.
- a path under `workspaces/` that does not start with THIS mission's own
  `workspaces/<mission-id>/` prefix is refused — one mission can never
  reach another's workspace.
- the basename is checked with `isSecretLikeFilename`
  (`src/inspector/fileClassifier.ts`) — the same strict gate the project
  inspector already uses for content reads. `.env`, `secret`, `token`,
  `credential`, `password`, `apikey`, certificate, and SSH-shaped names are
  all refused, not a second, drifted copy of that list.
- content is capped at `MAX_MISSION_FILE_BYTES` (200,000 bytes).

Every refusal is receipted with the reason code; nothing fails silently,
and `workspaceBoundaryViolationCount` is a real, reportable metric.

## Propose, then apply

`MissionWorkspace.propose()` records a `ProposedFileOperation` (with a
content fingerprint) only after the boundary check passes.
`applyProposed()` writes each queued operation through the injected
`WorkspaceDriver` and returns the list of `AppliedFileOperation` records —
both proposed and applied history stay queryable for the mission's
lifetime.

## The driver is pluggable, and only the fake one is ever used

`WorkspaceDriver` is a three-method interface (`write`, `read`, `list`).
`FakeWorkspaceDriver` — an in-memory `Map` — is the only implementation
anywhere in this codebase, used by every demo, test, and CLI path. No real
filesystem write happens through this system. A real driver is a separate,
future, separately-authorized capability (see
[real-provider-adapters.md](./real-provider-adapters.md) for why real
execution and real writes both stay gated the same way), the same staged
pattern Capability C2-B already established for `docs/generated/`: build
the real primitive under its own review, prove `realFilesystemWriteCount`
stays 0 everywhere it's actually exercised.

## Never Namla source, never a secret, never outside the mission

Combined, these three checks mean a builder ant's artifact — however it was
produced, fake provider or (refused) real one — can never resolve to a path
outside its own mission's workspace, can never target Namla's own source or
law files, and can never be named like a credential store. This is checked
mechanically on every proposal, not asserted in a comment.

## R1 status

Reaffirmed by Build Law Section 18. The R1 demo runs entirely on the in-memory
`FakeWorkspaceDriver` (`realFilesystemWrites = 0`, `workspaceBoundaryViolations =
0`): one workspace per mission under `workspaces/<mission-id>/`, validated
relative ids, no traversal / absolute / symlink escape, no access to secrets or
Namla source, every file op linked to missionId/taskId/antId.

## R2: the human-only smoke workspace

Real Cognitive Ants R2 (Build Law §19) adds `src/cognitive/smokeWorkspace.ts`,
the second (and only other) authorized real-fs-mutation module beside
`projectFileCreator.ts`. It can ONLY create `workspaces/provider-smoke/<claude|
codex>/<mission>/` under the repo root — a strict allowlist regex refuses
traversal, absolute paths, source-tree paths, and protected names, and a
resolved-path check refuses any escape above the smoke root. It writes only a
bounded request manifest (ids and caps, never prompt content) and a safe
redacted result summary (never raw stdout/stderr, environment, or credentials).
It is never imported by any automated demo or test; automated verification uses
the in-memory fake workspace. No source-tree write, no `.env`/secret access, no
Git action.
