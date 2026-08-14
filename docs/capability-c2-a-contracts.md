# Capability C2-A — Conditional Contracts (No Real Write)

Capability C2-A is the first slice after the C2 enablement security review.
Its job is to lay down the law boundary, the authority separation, the
exact-byte integrity, and the non-mutating admission/creation models for a
**future** real local-file creation — while executing **zero real writes**
and adding **zero filesystem mutation APIs**.

## Review verdict

The C2 enablement security review concluded **GO WITH BLOCKERS**. C2-A
resolves the contract-and-boundary blockers; the real primitive (C2-B) and
the one human-authorized integration write (C2-C) remain separate, later,
explicitly-authorized slices.

## Exact future scope

The single future real-write target is a **direct-child, lowercase-ASCII
Markdown file inside `docs/generated/`**, at most **65,536 UTF-8 bytes**, one
file per admitted attempt, with no directory creation, overwrite, append,
rename, delete, or temporary-file strategy. The scope is pinned mechanically
in `c2CreatePolicy.ts` and in the Build Law C2-A amendment (Section 11).

## Why `docs/generated/README.md` exists

`docs/generated/` is a **human-authored quarantine directory**, created and
committed by a human because Namla cannot create directories. Pre-creating it
(with a README describing the rules) means a future C2-C write has a single,
known, bounded place it could target — and residual artifacts from a failed
future write are quarantined to one auditable directory. C2-A writes nothing
into it.

## Exact-byte content rules

`exactContentBytes.ts` (`prepareExactUtf8Content`) accepts content **verbatim
or refuses it** — it never normalizes, trims, formats, or re-encodes. It
refuses a leading **BOM**, **NUL**, **carriage return** (so approved text uses
exact LF and no CRLF transformation can hide), disallowed **C0 control
characters**, **DEL**, and **unpaired UTF-16 surrogates**. It converts once via
`Buffer.from(content, "utf8")` and binds those exact bytes with a full 64-char
SHA-256 fingerprint (`computeContentBytesFingerprint`). This is an
**additional, independent** binding; it does not replace or weaken the C0
whole-operation fingerprint.

## No transformations after approval

No newline normalization, trimming, formatting, or encoding conversion may
happen after approval. The bytes a future write would emit are exactly the
bytes bound by the fingerprint.

## Approval and authority separation

Approval authorizes one exact proposal's bytes; a **separate**
`WriteAuthorityPermit` authorizes the runtime to attempt a write at all. A
`HumanApprovalGrant` alone is insufficient.

### Permit identity registry

`writeAuthority.ts` recognizes a permit by **identity, not shape**: a
module-private `WeakSet` records permits minted by the trusted bootstrap, and
`isValidWriteAuthorityPermit` returns true only for objects in that set. A
forged object literal with identical fields is **not** in the set and is
rejected. Permits are frozen.

### Architectural, not cryptographic

TypeScript types and module boundaries are **architectural** controls. They do
not defend against arbitrary trusted local code, which could call the internal
mint hook or fabricate objects. The guarantee is narrower and honest: within
Namla's own code only the dedicated bootstrap mints a permit, and **no
production runtime path imports the mint hook or a permit at all**.

### Bootstrap-only minting; production has no permit import path

`c2WriteAuthorityBootstrap.ts` is the only approved minting location. It has no
fs/env/CLI/network import, no top-level execution (importing it mints nothing),
and requires explicit fixed call data — not a caller-provided "enabled"
boolean. `ColonyEngine`, ants, and adapters do **not** import
`writeAuthority`, the bootstrap, `projectFileCreator`, or
`writeAttemptAdmission`; only the C2-A demo imports the bootstrap directly, for
validation.

## Grant remains unconsumed in C2-A

Nothing in C2-A consumes a grant. `consumedApprovalRegistry.ts` defines the
append-only, process-local single-use semantics, but the C2-A admission and
the non-mutating creator never call `consume`. The **future consumption point
is in C2-B/C: immediately after final revalidation and before exclusive
open**, whether the write then succeeds or fails.

## Process-local replay limitation

Replay protection is **process-local**; `durableAcrossRestart` is `false`.
After a process restart the consumed set is empty, so durable cross-restart
replay prevention is **not** provided — that would need a persistence layer,
itself a separate write capability under its own amendment.

## No executable rollback; residual-artifact model

Rollback stays **data-only**; there is no delete authority. The future-write
lifecycle types (`fileCreationTypes.ts`) can honestly represent a failed
attempt that left a **zero-byte or partial residual artifact** requiring human
cleanup, a post-write receipt failure, and whether persistence was confirmed —
without ever mutating the `CodeProposal`. In C2-A every `FileCreationResult` is
literal-typed to a non-attempt.

## Threat-model assumptions

C2-A (and any future C2-B/C) assumes **no malicious concurrent same-user
process** is racing the create, and does **not** claim complete intermediate
symlink/junction race protection — Node exposes no handle-relative
(`openat`) or no-follow guarantee for intermediate path components on the
supported platform.

## C2-B and C2-C require separate authorization

C2-B (installing the real exclusive-create primitive, which will make
`ProjectFileCreator` the second and only other fs importer) and C2-C (one
human-authorized integration write into `docs/generated/`) are separate,
later slices, each requiring its own explicit human authorization. C2-A
activates nothing.
