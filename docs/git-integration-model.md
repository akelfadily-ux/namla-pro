# Git Integration Model (Phase 5)

Phase 5 gives the colony Git *awareness* with zero Git *ability*. Every git
concept in the codebase is data: modeled state, planned-but-unexecuted
actions, and commit proposals awaiting human approval. No git command runs
in Phase 5 — not even read-only ones — and push is forbidden by law
regardless of phase.

Authorized by the Phase 5 amendment in
[NAMLA_BUILD_LAW.md](../NAMLA_BUILD_LAW.md).

## Git-as-data

`src/git/gitStateModel.ts` defines the shapes. The key design choice:
`GitRepoState` is *asserted*, not observed — a human (or a future
authorized phase) supplies what is known about branches; nothing in Phase 5
reads `.git` (the inspector skips that folder entirely) or invokes git to
find out. If the model is wrong, it is wrong the way a whiteboard sketch is
wrong — it cannot damage anything.

## GitReadPlanner: planned actions only

`GitReadPlanner.planReadOnlyInspection` produces `PlannedAction` objects —
the same Phase 0 shape bodies use, built by the same `buildPlannedAction`
helper, with `executed: false` — describing which read-only commands
(`git status`, `git log`, `git diff --stat`) a future phase WOULD run.

Two independent gates refuse dangerous candidates as data: a git-specific
word list (push, commit, add, reset, clean, checkout, rebase, merge, and
the rest of the state/history-changing vocabulary), and a full SafetyGuard
pass — which treats `push` as FORBIDDEN on its own, so the two gates
overlap rather than depend on each other. Refusals are receipted with the
raw candidate text redacted (reason code + length only).

Known limitation, accepted by design: the word list matches bare
substrings, so short entries like `rm`, `gc`, and `mv` will false-positive
on innocent candidates (any command containing "confirm" matches `rm`).
The failure direction is the safe one — a false positive refuses a
read-only command that would have been fine; a false negative would plan a
dangerous one. The three default commands are verified to pass both gates.

## GitCommitProposal: in-memory proposal only

`CommitProposalFactory` bundles *reviewed* `CodeProposal`s into a commit
described as data: message, file list, rationale. Its gates, in order:
smuggled push intent (see below); at least one source proposal, each
re-checked for the `applied === false` / `requiresHumanApproval === true`
invariants; every file path re-checked for shape (project-relative only —
no absolute paths, no ".." traversal; the factory holds no project root, so
this is a structural check defending against hand-built sources) and per
segment against the strict protected-name gate; and SafetyGuard over
message + rationale + file list.
Nothing is staged, no commit runs, nothing is written — the factory imports
no fs and no process API.

## The layered no-push guarantee

1. **Type level** — `GitCommitProposal.pushIntent` is the literal type
   `false`, and `CommitProposalRequest` has no push field at all: a push
   intent is unrepresentable without casts.
2. **Runtime level** — a caller who smuggles `pushIntent` past the compiler
   via an aliased object is refused by the factory's first gate, with a
   receipt (`push-intent-refused`).
3. **Guard level** — `push` and `git push` are FORBIDDEN indicators in
   SafetyGuard, so push-shaped wording in any message, rationale, or
   planned command refuses independently.
4. **Word-list level** — `GitReadPlanner`'s disallowed-operation list
   refuses push candidates before SafetyGuard even runs.
5. **Law level** — the Phase 5 amendment forbids push regardless of phase,
   revocable only by an explicit human instruction naming
   `NAMLA_BUILD_LAW.md` and authorizing a dedicated push policy amendment.
6. **Capability level** — strongest of all: no command-execution API exists
   anywhere in the project, so there is nothing a push instruction could
   even run on.

## Why read-only git commands stay unexecuted in Phase 5

Running `git status` would be harmless in isolation — but it would require
introducing a command-execution capability, and *that* is the dangerous
step, not the particular command. Phase 5 keeps the project's invariant
"zero execution APIs anywhere" intact, which is a much stronger and much
more auditable guarantee than "execution exists but is carefully
filtered." Execution, when it comes, arrives as its own phase with its own
law amendment and its own gates.

## SafetyGuard and ReceiptLog usage

SafetyGuard gates every planned command candidate and every commit
proposal's human-readable text. ReceiptLog records every plan, every
creation, and every refusal. Refusal receipts follow the established
redaction standard: reason codes, counts, lengths, and SHA-256 fingerprints
— never raw refused commands, messages, or paths.

## The receipt reason-literal rule (from the Phase 4 verification)

`ReceiptLog` scans every summary with `looksLikeSecret` and throws on a
match — which means a refusal summary must never *mention* the thing it
refused in vocabulary that overlaps the indicator list. Phase 4's
verification found a Phase 1 refusal reason that said "secret-like" and
therefore crashed instead of receipting. Every summary and reason literal
in `src/git/` was audited against the indicator list before being written:
they say "protected name", "disallowed operation", and "not representable"
instead of the indicator words themselves.

## How ArchivistAnt is wired safely

`ArchivistAnt.assembleCommitProposal(factory, request)` follows the
colony's capability-injection pattern: the ant cannot construct a
`CommitProposalFactory` — the human-controlled composition root hands it
one. The ant returns the factory's result plus its own receipt-compatible
report, with `applied: false` and `pushIntent: false` echoed in the
receipt details.

## What is intentionally not implemented

- **Any git execution** — no status, log, diff, add, commit, or push; no
  command execution API exists to build it on.
- **Reading `.git`** — the inspector deliberately skips it; repo state is
  modeled, not observed.
- **Staging or commit-message files on disk** — nothing is written.
- **Remote awareness** — no remotes, no fetch/pull modeling, no network.
- **Persistence** — commit proposals vanish with the process, like all
  colony data.
