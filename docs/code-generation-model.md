# Code Generation Model (Phase 3)

Phase 3 lets ants *describe* code changes without gaining any ability to
*make* them. A `CodeProposal` is data: an in-memory object saying what file
would be created or modified, with what content, and why. Nothing in this
phase — or anywhere in the codebase — can put that content on disk.

Authorized by the Phase 3 amendment in
[NAMLA_BUILD_LAW.md](../NAMLA_BUILD_LAW.md). All prior guarantees hold:
read-only filesystem access only through `ProjectInspector`, no command
execution, no network, no autonomous loop, receipts for everything.

## Proposals as data

`CodeProposal` (`src/generation/codeProposal.ts`) carries: ids linking it to
its mission and task, the target relative path, a change kind
(`create`/`modify`), the proposed content or diff, a rationale, the
`SafetyDecision` that allowed it to exist, and the receipt id written at
creation. Two fields are literal-typed:

- `requiresHumanApproval: true` — the type system cannot represent a
  pre-approved proposal.
- `applied: false` — the type system cannot represent an applied proposal.
  Constructing one with `applied: true` is a compile error.

## The approval boundary

A proposal's life in Phase 3 ends at "pending human review". The boundary
has three layers:

1. **Type level** — `applied` is the literal type `false`.
2. **Code level** — there is no apply method on `ProposalQueue`, on
   `ProposalFactory`, on `BuilderAnt`, or anywhere else. This is deliberate:
   the absence of a code path is a stronger guarantee than a method that
   refuses, because a refusing method is one quiet edit away from not
   refusing. (Contrast with Phase 0's `CommandAdapter.refuseExecution`,
   which exists precisely to *prove* refusal; here the stronger form was
   chosen because proposals are the object most tempting to auto-apply.)
3. **Law level** — the Phase 3 amendment forbids adding an apply path
   without a future human-authorized amendment.

## FileBoundaryPolicy and protected-path checks

`ProposalFactory.create` refuses, in order, before SafetyGuard even runs:

1. Target paths outside the project root (`isInsideProjectRoot`).
2. Protected-store paths: **every path segment** (not just the basename) is
   checked with the strict secret-name gate from the Phase 1 classifier
   (`isSecretLikeFilename`), so `.env.local`, `config/credentials.json`, or
   a protected name hidden in a folder segment are all refused. The strict
   gate is used — not the walk gate — because proposing *content for* a
   secret-named file is exactly the risk the strict gate exists for.
3. Empty proposals (no content and no diff).

## SafetyGuard checks

The factory then evaluates `targetRelativePath + rationale + content + diff`
as one text — both `proposedContent` and `proposedDiff` are always included,
so a dangerous diff cannot ride in behind a safe content field. RISKY and
FORBIDDEN refuse (only SAFE and CAUTION pass); that catches dangerous
command text (`rm -rf`, `sudo`, shell/exec patterns), package-manager
instructions (`npm install`, `pip install`, `winget`), `git push`,
delete/remove patterns, and secret-like content, because all of those are
guard indicators.

A consequence, accepted by design: matching is by *substring*, so harmless
words that contain an indicator are refused too. Known examples:
"reinforcement" contains the RISKY indicator `force`; "executed" contains
`exec`; "information" contains `format`; and a documentation sentence using
the word "remove" is refused outright. Proposal wording must avoid these —
the demo's walkthrough content says "boosting" instead of "reinforcement"
for exactly this reason. Over-refusal is the accepted cost of a gate this
simple; a false negative would be worse.

## ReceiptLog connection

Every factory outcome writes a receipt: creation (`completed`, with
proposal id, path, change kind, and safety level in details — the path is
safe to record here because a created proposal has passed every gate) or
refusal (`refused`, reason-coded). Refusal receipts are fully redacted: the
summary carries only a reason phrase, and details carry only the reason
code, the guard's own matched-indicator vocabulary, and non-reversible path
metadata (length plus a short SHA-256 fingerprint for correlation). Raw
refused paths and proposal content never enter the receipt log; the raw
path stays in the returned `ProposalRefusal` object for the caller.
`ProposalQueue` adds receipts for enqueue, refused enqueue (invariant or
duplicate violations), and review refusals.

## BuilderAnt connection

`BuilderAnt.proposeCode(factory, request)` follows the colony's
capability-injection pattern (like `ScoutAnt`'s inspector and `PlannerAnt`'s
engine): the ant cannot construct a `ProposalFactory` itself — the
human-controlled composition root hands it one. The builder returns the
factory's result plus its own receipt-compatible report, with the proposal
explicitly marked unapplied. The `DecompositionEngine`'s propose-build tasks
now carry `expectedOutputKind: "code-proposal"` so Phase 4+ can route a
builder's output shape without guessing.

## ProposalQueue behavior

In-memory only: `enqueue` (with runtime re-verification that `applied` is
false, `requiresHumanApproval` is true, and the safety decision allowed the
proposal — defense in depth against callers that bypass the type system,
plus duplicate-id refusal), `list`, `listPending`, `get`, and `refuse`
(review rejection, receipted). No persistence, no apply, no disk.

## Why nothing touches disk

The generation module imports no fs API — verifiable by grep. The only fs
calls in the entire project remain the five read-only calls inside
`ProjectInspector`. A proposal's content exists in process memory and in
nothing else; when the process ends, it is gone.

## What remains intentionally not implemented

- **Applying proposals** — the whole point of the phase boundary.
- **A human approval UI/flow** — the queue models "pending", but review is
  conceptual until a future phase.
- **Actual code synthesis** — nothing generates content; ants (or future
  LLM adapters, Phase 7) supply it, and this layer gates and records it.
- **Proposal persistence** — in-memory only.
- **Diff application/validation semantics** — `proposedDiff` is carried as
  text, not parsed.
