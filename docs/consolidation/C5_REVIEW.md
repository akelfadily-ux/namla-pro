# C5 - Productization policy preflight

## Source decision and preserved baseline

Canonical input: `c71c0bedbd96893ff81162d3bcb01f40861cbe69`.
Input tree: `a21af5ef99ecd1eefd6cf047853ee6b0978eac98`.
Donor: `44977cf5e6816388a0838d50e4f7eaea0b133224`.
Adapted donor path: `src/application/policy-engine.ts`.
Original donor blob: `5794b64afd831e253d45b80c21ea3c2a2a85ce8b`.

This is an explicit adaptation, not an exact source copy and not runtime wiring.
C1-C4, all canonical V2 modules, command classifiers, security tests, package
manifests and lockfiles remain byte-for-byte unchanged by this apply step.
One focused suite is added to the existing P0 runner, without replacing it.

## Findings in the supplied source

The donor reads only its optional third `gitOp` argument. It does not inspect
`request.gitOperation` itself, although that field exists in PermissionRequest.
The resource-string Git check omits the `tool:shell` capability family. A global
`*` can therefore return successfully before that request is actually checked.
Its capability globs accept arbitrary string prefixes rather than boundary-
aware namespace patterns. Both filesystem `/*` and `/**` are implemented as
unbounded descendant scopes. Path resolution can depend on ambient `cwd`.

The retained `isForbiddenCommand` source explicitly describes itself as a text
classifier, not a shell parser or substitute for execution containment. Returning
false is not permission. C5 does not modify, duplicate, or wrap it into an allow
list. Rather, raw execution requests are refused at this preflight boundary.
The existing 19 classifier tests remain registered and must still pass.

## New, deliberately narrower preflight contract (version 2)

- Inputs are bounded plain data records with exact required/optional fields.
  Proxy inputs, accessors, inherited/hidden/symbol fields and sparse permission
  arrays are rejected without evaluating supplied getters or reflection traps.
  Up to 256 permission strings are accepted; capabilities are lower-case,
  dot/colon-delimited identifiers up to 256 characters, resources up to 4096.
- Generic capabilities use exact, global `*`, or delimiter-ending `.*` / `:*`
  namespace grants. Arbitrary prefix globs such as `tool:git*` are not accepted.
  Resource-pattern grants in C5 are defined only for filesystem capabilities.
  Opaque resources on other capabilities do not become shell or path syntax.
- Raw shell/command/process/exec/Docker/GitHub families are not supported by this
  preflight, even with `*`. This is a route restriction, not a claim that those
  capabilities do not exist elsewhere in the canonical runtime.
- Both `request.gitOperation` and the legacy third argument are inspected.
  Conflicting descriptors fail closed. A Git-family capability must agree with
  the descriptor's action; resource strings cannot override or accompany it.
- Read-only Git descriptors admit status, bounded log count, and diff against
  either the default comparison or a full 40/64-character lowercase object ID.
  Symbolic refs, arbitrary options and raw command strings are not accepted.
  Existence of the object/repository is left to the eventual trusted executor.
- Human-only integration kinds remain refused. Commit/branch/checkout are also
  refused HERE until a reviewed branch-bound write adapter exists. This does not
  change the user's manual Git workflow or the canonical kernel's policy.
- `authorizeGitOperation` is descriptor admission only. It neither checks grants
  nor resolves a repository; `authorize` additionally checks grants and the root.

## Filesystem contract and compatibility changes

Filesystem and Git preflight require an explicitly configured, existing absolute
workspace directory, independent of request/permission data. No default root is
inferred from cwd, a request, or a wildcard. Filesystem roots and `.git` roots are
refused. The directory identity is captured and rechecked per scoped request.
The exported `canonicalizePath(path, workspaceRoot)` requires that second value;
its donor one-argument ambient-cwd form now refuses instead of silently widening.

Resource paths are checked by the existing `resolveWorkspacePath`. C5 adds a
stricter link-free admission: symlinks/junctions beneath the configured root,
including contained and dangling links, and special files are refused. Relative
and in-root absolute paths can be used. Parent traversal, encoded paths, UNC/
device/alternate-stream forms and `.git` path components are rejected before
scoped matching. Missing ordinary paths may be checked, but are never created.
`/*` means immediate children; `/**` means strict descendants; exact scopes match
one path. Global grants still cannot escape the configured root.

These are observations, NOT race-free filesystem operations. They do not provide
an open-file capability, protect all hard-link/alias/mount races, authenticate
permission provenance, prove branch identity, or replace the kernel's secret,
artifact and IO checks. Built-in JavaScript/Node intrinsics and the calling
adapter's truthful capability classification are trusted in this component.
A malicious in-process adapter is not sandboxed by this class.

## Integration boundary and acceptance evidence

Successful `authorize` returns void only. No permit, claim, receipt, replay,
lease, persistent permission or human approval is created. Executors must obtain
canonical authority independently and revalidate at the actual effect boundary.
No ToolGateway, ModelGateway, scheduler, provider, database or factory is wired.
The narrower route/descriptor/path formats must be reconciled explicitly when
those consumers are selected. Do not bypass refusals to make donor tests pass.

`productizationPolicyEngineTests.ts` contains 44 tests of preflight semantics,
input admission, raw/typed Git refusal, grants, actual scoped path observations,
directory-link refusal and non-authority behavior. Command-shaped fixtures are
inert strings; no such command is run. Filesystem fixtures are created inside
uniquely named test directories and only those owned fixtures are cleaned up.
Directory-link tests use directory symlinks on POSIX and junctions on Windows;
failure to create a required fixture is a failed test, not a silently skipped one.

The apply step runs typecheck, build, the new suite and the complete existing P0
runner. It verifies the unchanged suite inventory and counts for C1-C4 (120),
Recovery (298), V2 operation identity (22) and command classification (19).
Actual pass/fail evidence belongs to the generated C5 receipt. Neither this
review nor a source selection means the product or branch consolidation is done.
