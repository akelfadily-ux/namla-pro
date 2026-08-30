# EXECUTABLE SECURITY THREAT MODEL

## Overview & Five Trust Distinctions

The NAMLA PRO Executable Security Subsystem cleanly separates five distinct operational stages:

1. **Discovery (`resolveTrustedExecutable`)**:
   - Locates potential executable candidates along search paths (PATH, custom search paths).
   - Validates candidate properties: absolute path, regular file (not directory/symlink), accepted basename, and exclusion from generated workspace roots (`workspaceRoots`).

2. **Integrity Sealing (`identity`)**:
   - Measures SHA-256 digests and file size for executed files (e.g. node interpreter + CLI script for `npm`/`npx`).
   - Sealing fingerprints the on-disk state at discovery time to detect TOCTOU modifications prior to process spawning (`revalidateResolvedExecutable`).
   - *Invariant:* A self-measured digest proves only that the file content has not changed since measurement—it does NOT prove authenticity.

3. **Provenance (`provenance`)**:
   - Evaluates POSIX filesystem ownership (`ownerUid === 0` or effective user UID) and non-world/group-mutability (`mode & 0o022 === 0`) for both the candidate file and its containing parent directory.
   - On platforms where POSIX ownership cannot be proven (e.g. Windows), provenance is reported as `unprovable-on-platform`.

4. **Authenticity**:
   - Establishes genuine trust origin beyond operating system UID matching.
   - Requires external verification such as pre-configured trusted installation roots, caller-supplied identity pins (`expectedSha256`), or strict trusted configuration (`requireIdentityPin`).

5. **Execution Authorization (`executionAuthorized`)**:
   - Final gate decision determining whether a candidate may actually be spawned (`probeVersion`, process runner).
   - Provenance alone or identity pins determine authorization status (`decideExecutionAuthorization`).

## Threat Scenario: Same-UID Write Outside `workspaceRoots`

### Scenario Description
1. A generated or malicious workload running under the application UID escapes or obtains host filesystem write access outside its declared `workspaceRoots` directory.
2. It writes a clean executable file owned by the application UID in a directory outside `workspaceRoots` (e.g. `/tmp/attacker_dir/docker`).
3. The directory permissions are set to safe non-writable-by-others mode (`0755`), and the file is owned by the app UID.
4. It places that directory before genuine system directories on `PATH`.
5. The resolver observes correct basename, UID ownership, and safe POSIX mode.

### Mitigations & Hardening Invariant
- **Workspace Exclusion**: Any directory marked under `workspaceRoots` is immediately rejected (`workspace-local-executable-refused`).
- **Identity Pinning Requirement**: When `requireIdentityPin: true` is configured or explicit `expectedSha256` pins are enforced by trusted infrastructure, unpinned candidates created by same-UID workloads outside workspaceRoots are refused with `executable-identity-unpinned` or `hash-mismatch`.
- **Long-Term Invariant**: Generated project content must never be capable of installing or selecting the executable that NAMLA uses as a privileged provider/tool merely because both happen to run under the same operating-system user.

## Human-Only Git Safety Policy

### Critical Prohibition
AUTOMATED AGENTS are strictly forbidden from performing repository-level integration operations:
- `git pull`, `git pull --rebase`
- `git merge`, `git rebase`, `git cherry-pick`, `git am`
- PR auto-merging, squash-and-merge, or updating protected branches (`main`, `master`).

### Human-Only Authority
Only the human repository owner may perform pull, merge, rebase, or integration into main/protected branches. Automated agents work exclusively on dedicated feature branches, producing code changes, tests, and evidence for manual human review and integration.
