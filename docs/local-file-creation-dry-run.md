# Local File Creation — C1 Read-Only Dry Run

Capability C1 adds the first **real filesystem contact** to the create
pipeline, and adds it in the safest possible form: read-only metadata
inspection of a proposed create target, followed by a simulated dry-run
decision. C1 creates nothing, mutates nothing, and authorizes nothing.

This document is the authoritative description of what C1 does, what it
deliberately does not do, and why a green dry run is **not** permission to
write. It builds on [local-file-creation-model.md](./local-file-creation-model.md)
(C0, the data contracts).

## What C1 is

- A read-only inspection (`ProjectInspector.inspectCreateTarget`) that
  examines a proposed create target's real filesystem neighborhood using
  metadata operations only.
- A pure evaluator (`src/application/projectCreateDryRun.ts`,
  `evaluateCreateDryRun`) that combines the C0 approval contract, the C0
  structural policy, and the C1 inspection into one dry-run decision and
  writes a canonical receipt.

## What C1 is not

- **Not a write.** No file is created, opened for writing, appended,
  renamed, copied, deleted, or chmod'd. No directory is created.
- **Not write authorization.** A successful dry run means only: *"the
  current read-only inspection found no blocking condition."* It is never
  authority for a write — `authoritativeForWrite`, `writeAuthorized`, and
  `writePerformed` are literal `false` on the result type, so a
  write-authorizing dry run is unrepresentable.
- **Not a grant consumption.** A dry run is not an application attempt; it
  reads the supplied `ConsumedApprovalState` but never marks the grant
  consumed. The grant would be consumed only by a future admitted C2
  application attempt.

## ProjectInspector stays the only fs importer

The core architectural invariant is preserved: **`ProjectInspector` is the
only source module that imports `fs`.** C1's real filesystem contact lives
entirely inside a new narrowly-scoped method on that class,
`inspectCreateTarget`. Neither `src/application/` module (the inspection
types and the dry-run evaluator) imports `fs`; the inspection result is
handed to the evaluator as plain data.

The inspector method uses only read-only metadata primitives already part
of the inspector's allowed surface: `existsSync`, `lstatSync`, `readdirSync`,
and `realpathSync.native`. **No file content is read** — C1 inspects
metadata only.

## What the inspection checks

For a C0-normalized, project-relative target path, `inspectCreateTarget`
determines:

- the lexical target resolves inside the project root;
- the parent chain (target's directory up to the root) stays inside the
  root, and reaches the root (no escape);
- no existing parent-chain component is a symlink, junction, or equivalent
  reparse/link surface (`lstat` + a `realpath` divergence check catch both
  symlinks and junctions);
- the real (link-resolved) parent still resolves inside the project root;
- the parent exists and is a directory (a symlinked "parent" is treated as
  a link surface, not a usable directory — never followed);
- the exact target does not already exist;
- no case-insensitive collision exists in the parent directory;
- the exact target, if present, is not itself a link.

Findings are booleans, counts, and fixed reason codes. **No raw path, raw
filename, file content, directory listing, or filesystem error string ever
enters a receipt or the demo output** — paths appear only as a
non-reversible fingerprint plus a length.

### Case-insensitive collision

Collision detection is directory-listing based, not `existsSync` based, so
it works identically on case-sensitive and case-insensitive filesystems.
The parent's entries are compared to the target basename both
case-sensitively and case-insensitively:

- an **exact** (case-sensitive) match ⇒ `targetExists` ⇒ blocked
  `boundary-target-exists`;
- a **case-variant** match with no exact match ⇒ `caseInsensitiveCollision`
  ⇒ blocked `boundary-case-insensitive-collision`.

So a proposed `docs/RUNTIME-SPINE.md` is refused because the committed
`docs/runtime-spine.md` collides with it, even on a case-sensitive host
where `existsSync` of the exact upper-case name would return false.

### Parent-chain link / reparse refusal

A symlink or junction anywhere in the existing parent chain blocks the dry
run (`boundary-parent-chain-link`). Following such a surface could silently
escape the project root, so C1 refuses rather than resolves through it. The
demo proves this with a **synthetic** injected inspection (no real link is
created).

### Existing-parent requirement, no mkdir authority

The parent directory must already exist and be a real directory. C1 has
**no directory-creation authority** — a missing parent blocks the dry run
(`boundary-parent-missing`); it never creates the parent.

## The dry-run decision

`evaluateCreateDryRun` is fail-closed. It refuses, blocks, or fails on any
of: structural policy failure, C0 approval failure (integrity/scope/replay/
freshness/review drift), corrupted descriptor invariants, incomplete
inspection, or any real filesystem boundary. The `ready` outcome is
reachable only when every gate is clean.

Receipt semantics (canonical `ReceiptLog`):

- **completed** — the dry-run evaluation completed and found no current
  blocker (`readyForFutureWriteReview: true`);
- **refused** — a C0 contract or structural admission failed *before*
  filesystem admission (e.g. integrity tampering);
- **blocked** — an admitted dry run hit a real filesystem boundary
  (collision, case-insensitive collision, link surface, missing parent,
  non-directory parent, root escape);
- **failed** — an actual internal inspection error (fail-closed).

`requiresFreshC2Revalidation` is a literal `true` on every result.

## Rollback remains data only

C1 may carry a `RollbackInstructionPreview` — pure data with
`executed: false`, `requiresSeparateHumanApproval: true`, and
`availableOnlyAfterSuccessfulFutureCreation: true`. There is no delete,
`unlink`, `rm`, or cleanup API anywhere near it. A rollback is only
conceivable after a real creation that C1 cannot perform, and would itself
require separate human approval and a separate law amendment.

## Why a dry run is not write authority

The filesystem is shared, mutable, and racy. Between an inspection and a
write, a target can appear, a parent can be replaced by a symlink, or a
case-variant can be introduced. A dry run captures a **past** observation;
it cannot bind a **future** write. Therefore:

- a green dry run authorizes nothing;
- **C2 must recompute the operation integrity and re-run every filesystem
  check immediately before the exclusive-create**, treating the create
  itself as the atomic gate (e.g. an `O_EXCL`-style exclusive create that
  fails if the target exists), not the earlier inspection.

## Build Law is unchanged

C1 introduces no write capability, so it required **no** amendment to
[NAMLA_BUILD_LAW.md](../NAMLA_BUILD_LAW.md). A real write remains
unrepresentable until a future C2 both adds an exclusive-create path and is
authorized by an explicit law amendment.

## What remains simulated

Everything about *applying* a create: the write itself, directory creation,
grant consumption, rollback execution, and any authority to change the
project. C1 only observes and decides; C2 (behind a law amendment) is where
a single, human-approved, freshly-revalidated exclusive-create could first
become real.
