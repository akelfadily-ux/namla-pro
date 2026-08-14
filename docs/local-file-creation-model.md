# Local File Creation Model (Capability C0)

Namla Pro's first real capability under design is **Human-Approved Local
File Creation**. This document describes **Capability C0**: the pure
contracts and integrity verification that come before any real write.
C0 adds no filesystem, process, network, or execution authority.

## Why create-only precedes modification

Modifying an existing file adds four risks that creation cannot cause:
destructive overwrite, partial write of live content, stale-snapshot
corruption, and rollback-of-prior-content. Create is a strict risk-subset
of modify: an exclusive-create either produces a new file the capability
knew did not exist, or fails leaving nothing changed. Building the
approval + write-boundary machinery on create first lets modify inherit a
proven shape without inheriting proven-untested risks.

## What C0 is (and is not)

C0 is contracts and verification only:

- **`createCapabilityTypes.ts`** — `CreateCapabilityScope`,
  `HumanApprovalGrant`, `ConsumedApprovalState`, `ApprovalDecision`,
  `CreateOperationDescriptor`, `RollbackInstruction`.
- **`proposalIntegrity.ts`** — `computeIntegrityFingerprint` (full
  SHA-256 hex) plus a strictly non-authoritative `displayIntegrityFingerprint`.
- **`projectCreatePolicy.ts`** — structural allowlist and shape checks.
- **`approvalVerifier.ts`** — the pure verifier that stitches the above
  together.
- **`demoCreateApprovalContracts.ts`** — the table-driven regression
  fixture (valid case plus refusal categories, receipt-crash proofing).

C0 contains **zero filesystem capability**: `src/application/` has no fs
import, no write API of any kind, and no execution primitive. The
mechanical invariants in [SAFETY_INVARIANTS.md](../SAFETY_INVARIANTS.md)
enforce this.

## Approval consistency is not proof of human identity

`HumanApprovalGrant.declaredApproverKind: "human"` is a **declaration**
that the runtime uses as data. C0 verifies internal consistency, scope,
and freshness state — it does not, and cannot, cryptographically prove
that a human minted the grant. Real human identity/authentication is
outside C0; it will only ever matter for C2 and can only be introduced
under a separate law amendment.

## Replay protection is process-local (until persistence exists)

Single-use is enforced by supplying a `ConsumedApprovalState` alongside
the grant at verification time. Because no persistence layer exists, the
consumed-grant set lives in whichever caller-supplied structure carries
it, for the lifetime of one process. Any future phase that widens the
guarantee must add persistent replay state under its own approval — until
then, this limitation is honest and documented.

## Integrity binds the whole operation

`computeIntegrityFingerprint` hashes a canonical, length-prefixed
serialization of: proposal id, change kind, normalized project-relative
path, exact UTF-8 content bytes, proposal receipt id, review verdict (or
sentinel), review receipt id (or sentinel), and the
`requiresHumanApproval` invariant. Fields are ordered fixed; absent
optional fields serialize as a fixed sentinel so "no review" and an empty
review string cannot be conflated. **No wall-clock timestamp, absolute
path, credential, environment, or process-specific data enters the hash.**

The shortened redaction fingerprint from `core/redaction.ts` (12 hex
chars) is used **only for display and correlation in receipts**. It is
never used to authorize an operation; the verifier compares full SHA-256
hex strings.

## Structural path validation is not real filesystem validation

`evaluateCreatePolicy` refuses empty, absolute, `..`-containing, empty-
or dot-segmented paths; enforces an allowlisted subdirectory and file
extension; refuses per-segment protected/secret-like names via the
canonical classifier; caps content bytes at `MAX_CREATE_CONTENT_BYTES =
262_144` (a hard-coded constant not reachable from environment, mission
text, ant, adapter, or user runtime config); and refuses non-create
kinds and non-single operations. **It performs no fs call.** A pass here
means the shape is permissible; it does **not** assert that the target
is safe on disk. Symlink checks, existence checks, and parent-chain
inspection are deferred to C1 dry-run.

## Rollback is instruction-only, and deletion is not authorized

`RollbackInstruction` is data: it names the would-be-created path as the
rollback target and carries `executed: false` and
`requiresSeparateHumanApproval: true`. C0 has no delete authority — no
`unlink`, no `rm`, nothing that could act. A future real deletion would
require its own explicit approval and a **separate** NAMLA_BUILD_LAW
amendment; the C0 instruction is a description of what such an operation
would have to do, never a promise that C0 could do it.

## Roadmap and law status

- **C1** — dry-run creator: runs every gate, produces
  `ApplicationReceipt`/`RollbackInstruction`, still performs no write.
- **C2** — one real exclusive-create behind a default-off flag and an
  explicit NAMLA_BUILD_LAW amendment naming the law file.
- **C3** — rollback verification (delete authority is its own amendment).
- **C4** — final security audit.

`NAMLA_BUILD_LAW.md` has **not** been amended for write capability.
Nothing in C0 changed it, and the invariant check confirms it.

## What remains simulated

Everything: no file is written, no path is resolved, no process runs, no
grant is authenticated. C0's promise is narrow — that when C1 and C2
arrive, they will inherit a fingerprint that binds the whole operation, a
verifier that mechanically rejects tampered proposals and replayed
grants, a structural policy that fails closed, and a rollback that is
data, not power.
