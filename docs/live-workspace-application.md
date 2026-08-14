# Live Workspace Application

`RealLiveWorkspaceDriver` (`src/cognitive/liveRealDrivers.ts`) applies only
reviewed, approved files to the real isolated workspace (Build Law §26).

## Root and delegation

The workspace is rooted only at `workspaces/digital-live-objective/<objective-id>/`.
Real writes are NOT done in this module: it delegates to the already-authorized
`smokeWorkspace` boundary (`ensureLiveObjectiveWorkspace`, `writeLiveObjectiveFile`),
so `fs` mutation stays confined to exactly two modules and no new `fs` importer is
added.

## Allowed vs prohibited

Allowed: create the objective workspace; create reviewed project files; modify
only files created inside the same objective workspace; read/list bounded files;
store manifests, normalized results, reviews, verification evidence, receipts.

Prohibited: writes to Namla source; traversal; absolute external paths;
symlink/junction escape; .env, credentials, tokens, keys, SSH, browser data,
certificates; arbitrary deletion; Git; executable/shell-script generation; any
access outside the objective workspace.

## Records

Every real write records objectiveId, taskId, antId, the target path, a before
fingerprint, an after fingerprint, and the exact byte count (a receipt). Provider
output never writes files directly — only the driver, and only after independent
review. The driver satisfies the runner's `LiveWorkspaceApplier` contract, so the
same pipeline runs on either the in-memory (tests) or real (human) workspace.
