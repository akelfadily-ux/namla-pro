# Live Objective Workspace Security

The V3 live objective writes only inside `workspaces/digital-live-objective/<objective-id>/`
(Build Law §25). Two layers enforce this.

## In-memory boundary (automated)

Automated verification uses `InMemoryWorkspaceDriver` rooted at the live path. It
validates every relative path (`validateWorkspacePath`): no traversal, absolute,
backslash/junction, or protected name (.env, keys, tokens, credentials, ssh,
certs, .git); bounds file count / bytes / total size; attributes every operation
to objectiveId + taskId + antId + receipt with before/after fingerprints; and
reports `realFilesystemWrites === 0`.

## Real-fs surface (human-only)

The real-disk path lives inside the single already-authorized fs-mutation module
`src/cognitive/smokeWorkspace.ts` (never imported by any demo/test):

- `validateLiveObjectiveWorkspaceId` — the workspace id must match `workspaces/digital-live-objective/<id>` exactly.
- `ensureLiveObjectiveWorkspace` — creates the directory, refusing any resolved path that escapes the live root (defense-in-depth vs junctions).
- `writeLiveObjectiveFile` — writes one bounded project file at a validated relative path, rejecting traversal, absolute, protected names, disallowed extensions, oversize, or any resolved path outside the objective root.

This keeps the codebase at exactly three fs importers and two fs-mutation modules.

## Prohibited everywhere

writes to Namla source, traversal, absolute external paths, symlink/junction
escape, .env / credentials / keys / tokens / SSH / browser profiles /
certificates, arbitrary deletion, any Git operation, and provider-created
executables or shell scripts. Every operation carries objectiveId, taskId, antId,
demandId/reviewId (as applicable), receiptId, and before/after fingerprints.
