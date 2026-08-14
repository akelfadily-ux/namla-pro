# Capability C2-B — Exclusive-Create Primitive (Installed, Inactive)

Capability C2-B installs the first real exclusive-create primitive in
source — and does not run it. Every behavioral test drives the full create
lifecycle through a deterministic **injected fake driver**; the real
Node-backed driver is module-private, unreferenced by any exported symbol,
and never invoked. C2-B executes **zero real filesystem writes** and creates
**zero files**.

## Exactly two fs importers

After C2-B the codebase has exactly two source files that import `fs`:

1. `src/inspector/projectInspector.ts` — read-only metadata/content inspection.
2. `src/application/projectFileCreator.ts` — exclusive-create primitive only.

No third fs importer exists, and no write primitive exists outside
`projectFileCreator.ts`.

## Allowed Node calls and their confinement

`projectFileCreator.ts` may import only `openSync`, `writeSync`, `fsyncSync`,
`closeSync` from `fs`, and they appear only inside the module-private
`nodeExclusiveCreateDriver`. `openSync` uses the literal exclusive-create
mode `"wx"` (`O_CREAT | O_EXCL | O_WRONLY`): it never overwrites and never
appends. There is no `mkdir`, `rename`, `copy`, `unlink`, `rm`, `chmod`,
`truncate`, `appendFile`, `writeFile`, or `createWriteStream` anywhere in
`src`.

## No real write occurred; no exported Node-backed execution path

The real driver is `const nodeExclusiveCreateDriver` — declared but never
referenced by any exported function, so no C2-B code path can reach it. A
private counter increments on every real-driver method call; the exported
`getRealNodeDriverInvocationCount()` proves it stayed **0** through all
verification. `createProjectFile` takes the driver as a required injected
parameter; the demo only ever passes a fake (`kind: "fake"`). There is no
top-level execution, no CLI entry, and no C2-C bootstrap here.

## Production runtime isolation

`ColonyEngine`, ants, missions, adapters, and the C2-A bootstrap do not
import or invoke `projectFileCreator`, `writeAuthority`,
`c2WriteAuthorityBootstrap`, or `writeAttemptAdmission`. The production
runtime has no path to a write.

## Final admission sequence

`createProjectFile` enforces, in order: (A) permit identity, (B) C0 approval
and invariants, (C) the strict C2 policy, (D) prepare the exact Buffer once,
(E) recompute the complete-operation fingerprint and the exact-content-byte
fingerprint and re-check the exact byte length, (F) a fresh final C1
inspection supplied immediately before the call, (G) confirm inspection
completed, parent exists and is a real directory, no parent-chain link or
junction, real parent inside the pinned root, target absent, no exact or
case-insensitive collision, target not a link, no mkdir required, then (H)
consume the grant, then (I) begin the injected driver attempt. Gates A–G run
via the pure `evaluateWriteAttemptAdmission`; the exact-byte re-binding is a
defensive re-check before consumption.

## Grant consumption

The grant is consumed **immediately after final revalidation and immediately
before exclusive open** (step H). From that point it stays consumed **whether
the attempt succeeds or fails** — target-exists at open, open failure, write
failure, zero-progress write, partial write, fsync failure, close failure,
and receipt-delivery failure all leave the grant consumed. There is no
automatic retry with the same grant. Pre-admission refusals and final-
inspection blocks consume **nothing**.

## Exclusive-create is existence-atomic, not content-atomic

`openSync(path, "wx")` atomically guarantees the file did not previously
exist — but it creates a zero-byte file first, then content is written. So an
admitted attempt that fails after open may leave a residual artifact:

- write fails before any bytes / zero-progress write → **possible zero-byte** residual;
- partial write then failure → **possible partial** residual;
- full write but fsync or close fails → a file exists whose durability/close
  is unconfirmed → residual reported.

`residualArtifactPossible` and `residualArtifactState` report this
truthfully. **There is no automated cleanup and no delete authority** — a
residual artifact requires **manual human cleanup** (C3 territory).

## Receipt failure cannot erase disk truth

The `FileCreationResult` is the source of truth for disk state. If receipt
delivery fails after a disk result is computed, the result is still returned
with `receiptWriteFailed: true` and `receiptDeliveryState: "failed"`, and the
attempted/open/bytes/persistence/residual fields are preserved. A completed
create whose receipt failed is **not** reported as "no write."

## Replay and threat model

Replay protection is **same-process only**; the `ConsumedApprovalRegistry`
holds no persistence, so **no durable cross-restart replay guarantee** is
claimed. A **malicious concurrent same-user process remains outside the
protected threat model**, and **complete intermediate symlink/junction race
protection is not claimed** — Node exposes no handle-relative (`openat`) or
no-follow guarantee for intermediate path components on the supported
platform.

## The CodeProposal stays immutable

`CodeProposal.applied` remains `false`; the proposal is never mutated. All
lifecycle state lives on the separate immutable `FileCreationResult`.

## C2-C requires separate authorization

C2-C — the only phase permitted to perform **one real integration write**
into `docs/generated/` after separate explicit human authorization — is not
started. C2-B leaves the primitive installed and inactive.
