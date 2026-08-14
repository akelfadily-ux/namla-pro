# Inspector Model (Phase 1)

The Read-Only Local Project Inspector is Phase 1's single new capability: a
human-authorized way for the colony to actually observe the project tree it
lives in, instead of relying on caller-supplied context. It is the first and
only place in Namla Pro where real filesystem APIs are called, and it is
read-only by construction.

Authorized by the Phase 1 amendment in
[NAMLA_BUILD_LAW.md](../NAMLA_BUILD_LAW.md). Everything else from Phase 0 is
unchanged: no writes, no command execution, no network, no secrets, receipts
for everything including refusals.

## The pieces

- **`src/inspector/inspectorTypes.ts`** — `ProjectSnapshot` and its parts:
  observed folders and files (with sizes, extensions, modification times),
  `SkippedItem`s (what was deliberately not observed, and why),
  `InspectionRisk`s, and summary counts. Also `isProjectSnapshotLike`, the
  structural guard senses use to accept a snapshot through their untyped
  context bag.
- **`src/inspector/fileClassifier.ts`** — every skip rule in one file:
  ignored folder names, secret-like filename indicators, safe text
  extensions.
- **`src/inspector/projectInspector.ts`** — the walker itself, plus the one
  guarded content-reading method (`readSmallTextFile`).

## Allowed operations

- `fs.readdirSync` — list a directory's entries.
- `fs.lstatSync` — size, type, and modification time of an entry, without
  following symlinks.
- `fs.readFileSync` — only inside `readSmallTextFile`, and only after every
  guard below has passed.

That is the complete list. No write API (`writeFile`, `mkdir`, `rm`,
`rename`, `chmod`, ...) is imported or called anywhere in the inspector.

## Forbidden and skipped

The inspector skips, without opening:

- **Ignored folders:** `node_modules`, `.git`, `dist`, `build`, `out`,
  `coverage`, `.cache`, `.next`, `.turbo`, `.claude`, `tmp`, `temp`. These
  are tool internals, build outputs, and caches — high volume, no
  architectural signal, and (in `.git`'s and `.claude`'s case) not the
  colony's business.
- **Secret-like filenames:** there are two gates, with different strictness.
  The **walk gate** (`isSecretLikeFilenameForWalk`) decides what appears in
  the tree listing: anything containing `.env` or `id_rsa`, or with a
  key-material extension (`.pem`, `.key`, `.pfx`, `.p12`, `.crt`, `.der`,
  `.keystore`, `.jks`), is never listed, sized, or opened — plus any
  non-source file whose name contains `secret`, `token`, `credential`,
  `password`, api-key variants, private-key variants, or `auth.`. Project
  **source code** (`.ts`/`.js`) whose name merely *mentions* a secret
  concept — like this project's own `secretProtectionPolicy.ts` — IS listed,
  because hiding it would give the colony an incomplete snapshot of its own
  safety layer. The **read gate** (`isSecretLikeFilename`, used by
  `readSmallTextFile`) stays strict: any filename mentioning a secret
  concept is refused for content reads, source code included. Real secret
  stores are blocked by both gates; the only loosening is that
  secret-*named* source files are visible in the tree.
- **Oversized files:** anything above `maxFileSizeBytes` (default 1 MB) is
  recorded as skipped, never read.
- **Symlinks:** never followed, ever. A symlink inside the project root can
  point outside it, so following one would silently escape the boundary that
  `FileBoundaryPolicy` enforces on paths. Symlinks are recorded as skipped
  and surface as a `caution` risk in the snapshot.

## FileBoundaryPolicy enforcement

Every path — every directory entry during the walk, and the target of every
`readSmallTextFile` call — is checked with
`isInsideProjectRoot(path, projectRoot)` from
[fileBoundaryPolicy.ts](../src/policies/fileBoundaryPolicy.ts) **before** any
filesystem call touches it. Anything outside resolves to a `SkippedItem`
(reason `outside-project-root`) or a refused receipt; it is never read.

## Size limits

- `maxFileSizeBytes` (default 1,000,000): files above this never enter the
  snapshot's file list.
- `maxReadFileBytes` (default 262,144): `readSmallTextFile` refuses anything
  larger.
- `maxEntries` (default 5,000): a runaway guard on the walk itself; if hit,
  the snapshot is marked incomplete via a `warning` risk.

## Secret protection in `readSmallTextFile`

Content reading has five gates, in order: boundary check, secret-like
basename check, safe-text-extension allowlist, symlink/regular-file check,
size limit — plus one content gate after reading: if the content contains a
PEM key block marker (`-----BEGIN`), the content is discarded and the read is
refused. The broad keyword list is *not* applied to content, because this
project's own safety documentation legitimately contains words like "secret"
and "token"; the PEM marker is the high-signal, low-false-positive check.

Refusal receipts are fully redacted (matching the Phase 3 `ProposalFactory`
standard): the refused path never appears in the receipt summary — because
`ReceiptLog` itself rejects secret-like summaries by throwing, and a refusal
must always produce a receipt, not a crash — and details carry only
non-reversible metadata (path length plus a short SHA-256 fingerprint for
correlation), never the raw path. Successful reads may record their path in
details, since an allowed path has passed every gate.

## ReceiptLog connection

The inspector takes a `ReceiptLog` in its constructor and writes one receipt
per `inspect()` call (status `completed`, with counts, or `refused` if the
root itself is invalid) and one receipt per `readSmallTextFile` call —
success or refusal, never silent. Skip decisions during a walk are recorded
in the snapshot's `skipped` array rather than as individual receipts, so one
inspection produces one receipt plus a full in-snapshot audit trail instead
of thousands of receipt entries.

## ScoutAnt connection

`ScoutAnt.inspectProject(inspector)` is the colony-facing entry point. The
key design point is **capability injection**: an ant cannot construct
filesystem access on its own — a human (or the composition root acting on
human instruction) must build the `ProjectInspector` and hand it over. The
scout returns the snapshot plus its own receipt-compatible report, and the
inspector's own receipt lands in the shared `ReceiptLog`.

## Vision and touch sense connection

`visionSense.see` and `touchSense.touch` now accept `context.snapshot`. When
a real `ProjectSnapshot` is present (checked structurally with
`isProjectSnapshotLike`), vision reports observed folders and files, and
touch reports the observed file paths as contacted — both at higher
confidence (0.9) than caller-asserted context (0.7), because the data was
actually observed. The Phase 0 behavior (caller-supplied `structures` /
`paths` arrays) remains as the fallback, so nothing that worked before
changed.

## Why this is still not autonomous execution

- The inspector runs only when explicitly invoked by a human-run script or a
  human-composed flow; there is no loop, no scheduler, and no trigger that
  makes it run on its own (`AutonomousLoopPolicy`'s budget is still zero).
- It observes; it cannot act. No write, no command, no network path exists
  anywhere in the inspector or in anything it calls.
- Ants gain no ambient authority: the capability exists only when injected,
  and everything it does lands in the `ReceiptLog`.

Phase 1 changes what the colony can *know*, not what it can *do*.
