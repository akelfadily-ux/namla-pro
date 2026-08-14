# Digital Project Workspace

`src/digital/digitalWorkspace.ts` is the bounded, attributed project workspace for
Digital Operations V2 (Build Law §24). Every objective gets a workspace rooted
ONLY at `workspaces/digital-operations/<objective-id>/`.

## Boundary (mechanical)

`validateWorkspacePath` rejects, with a reason code:

- `..` traversal, absolute paths, drive paths (`C:`)
- backslash / junction tricks, null bytes, `~`
- protected names: `.env`, `*.pem/key/crt/cer/p12/pfx`, `.ssh`, `id_rsa`, anything matching `credential|secret|token|password|apikey`, `.git`, browser profile artifacts
- anything outside the safe `[A-Za-z0-9._/-]` charset

The root guarantees no write ever touches the Namla source tree. There is no Git
action, no remote mutation, and no arbitrary delete.

## Bounds

`DEFAULT_WORKSPACE_LIMITS`: at most 64 files, 20000 bytes per file, 200000 bytes
total. Exceeding any limit is a counted boundary violation, not a silent
overflow.

## Attribution + fingerprints

Every operation (`create`, `modify`, `read`, `apply-artifact`, `store-evidence`)
produces a `WorkspaceReceipt` carrying `objectiveId`, `taskId`, `antId`, the
operation, the relative path, exact before/after fingerprints (FNV-1a), and byte
count. A `modify` is refused unless the file was created inside the same objective
workspace.

## In-memory, real boundary

The automated runtime uses `InMemoryWorkspaceDriver`: a real bounded workspace
model with enforced boundaries and receipts, backed by memory — never disk. It
reports `realFilesystemWrites === 0`, so no ant or provider receives real
filesystem authority in tests. A real-disk driver is a separate human-only
capability that would delegate to the single authorized smoke-workspace fs
surface; it is not wired here and adds no new `fs` importer.
