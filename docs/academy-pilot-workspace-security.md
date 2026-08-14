# Academy pilot workspace security

Build Law §21. The human-only live pilot may write ONLY to
`workspaces/academy-pilot/<pilot-id>/`, enforced by `src/cognitive/smokeWorkspace.ts`
— the second and only other authorized real-fs-mutation module besides
`projectFileCreator.ts`. It is never imported by any automated demo or test
(those use the in-memory fake path).

## Allowed / refused

`ensureAcademyPilotWorkspace` accepts only the strict allowlist pattern
`workspaces/academy-pilot/<pilot-id>` (lowercase id, ≤64 chars), refuses
traversal, absolute paths, and any resolved escape above the pilot root.
`writePilotArtifact` accepts only bounded flat filenames matching
`[a-z0-9-].(json|md|txt)` up to 256 KiB — never a path separator, never an
executable, never a shell script.

The workspace contains only: a training manifest, safe bounded prompt files,
provider result files, evaluation summaries, receipts, and a bounded SkillPassport
evidence export. It never permits: Namla source writes, arbitrary deletion, Git
operations, or access to `.env`/secrets/SSH/browser data. Real stdout/stderr,
environment, and credentials never reach the workspace or a receipt — only
safe, redacted summaries.

## Confinement unchanged

`fs` stays imported in exactly three modules (inspector read-only,
projectFileCreator create-only, smokeWorkspace human-only workspace);
`child_process` stays imported in exactly one (`nodeProviderProcessDriver.ts`).
Automated demos import none of the real-fs or real-process modules.
