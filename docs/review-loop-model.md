# Review Loop Model (Phase 4)

Phase 4 adds the Audit/Test/Repair Loop — with the crucial caveat that the
"loop" is a human turning a crank, not the system spinning. Everything in
this phase is analysis over data that already exists in memory:
`CodeProposal` objects, `ProjectSnapshot` data, verification-plan text, and
`AuditFinding`s. Nothing is run, applied, written, or scheduled.

## Review-as-data

The three reviewers consume data and produce data:

- **`ProposalReviewer`** (`src/review/proposalReviewer.ts`) — reviews a
  `CodeProposal` against a `ProjectSnapshot` and produces an `AuditReport`.
- **`TestPlanChecker`** (`src/review/testPlanChecker.ts`) — checks
  verification-plan *text* for shape (concrete checks, expected outcomes,
  scope) and produces an `AuditReport`. It never runs a test.
- **`RepairProposalFlow`** (`src/review/repairProposalFlow.ts`) — turns a
  defect finding into a follow-up `CodeProposal` via the Phase 3
  `ProposalFactory` — a proposal to fix a proposal, itself never applied.

## Proposal review boundaries

`ProposalReviewer.review` checks, in order: invariants (a proposal claiming
`applied !== false` or `requiresHumanApproval !== true` was cast past the
type system — review is refused outright with a critical finding);
create-collision (create-kind targets must not already exist in the
snapshot); modify-existence (modify-kind targets must exist); size sanity
(content + diff within a review cap, and not empty); and a full SafetyGuard
re-run over path + rationale + content + diff, which defends against
hand-built proposals that never went through the factory. Guard failure is
a critical finding and a refused verdict.

## Finding severities

Using the existing `AuditSeverity` scale: `info`/`minor` are notes for the
human (a short test plan, a missing outcome statement); `major` is an
actionable defect (collision, missing modify target, oversized or empty
body); `critical` refuses the review (invariant violation, SafetyGuard
failure). `RepairProposalFlow` only acts on `major` and `critical` — notes
do not spawn work orders.

## Test-plan checking as data only

`TestPlanChecker` runs three shallow heuristics over the plan text: does it
name a concrete check (check/confirm/assert/compare language), does it state
an expected outcome, does it define scope. The heuristics are deliberately
shallow and documented as such — they catch empty or hand-wavy plans, not
subtly wrong ones. The plan text never enters a receipt (only its length).

## The repair proposal chain

finding → `RepairAnt.requestRepairProposal` → `RepairProposalFlow` →
`ProposalFactory` → new `CodeProposal` (or a redacted refusal). Because the
revision goes through the same factory as every proposal, it inherits every
gate — boundary, protected paths, SafetyGuard — and the same receipt
redaction. A repair proposal for a repair proposal is possible only if a
human explicitly runs the chain again; nothing re-invokes it.

## Receipt redaction rules

Same standard as Phase 3 (now also applied retroactively to the Phase 1
inspector's refusal receipts): refusal receipts carry reason codes, the
guard's own indicator vocabulary, counts, severities, ids, and
non-reversible metadata (lengths, short SHA-256 fingerprints) — never raw
refused paths, proposal content, or plan text. Review receipts never carry
the proposal's path at all, because reviewed proposals may be hand-built
and their paths untrusted. Findings reference proposals by id and receipt
id, not by path.

## Why there is still no loop

Every function in `src/review/` executes once per explicit call and
returns. There are no timers, schedulers, watchers, background workers,
`while` loops over work queues, or recursion between review and repair —
`RepairProposalFlow` calls the factory and stops; it never calls the
reviewer, and the reviewer never calls the flow. `AutonomousLoopPolicy`'s
budget remains zero. The demo (`src/examples/demoReviewLoop.ts`) is the
only driver, and it is a human-run script.

## Why no NAMLA_BUILD_LAW amendment is needed

The law's amendments gate new *capability classes*: touching the filesystem
(Phase 1), representing proposed changes (Phase 3). Phase 4 reads objects
already in memory and produces other objects in memory — a strict subset of
what any code in the project could already do. No new boundary is crossed,
so no amendment exists; this paragraph is the explicit record of that
reasoning.

## What is intentionally not implemented

- **Real test execution** — no test runner, no process spawning; Phase 4
  judges plans and proposals as text and structure only.
- **Automatic re-review or repair recursion** — the chain runs once per
  human invocation.
- **Semantic review** — no understanding of whether proposed content is
  *correct*, only whether it is coherent with the snapshot and safe.
- **Persistence** — findings, reports, and proposals still vanish with the
  process.
- **Follow-up task generation** — findings could feed the
  DecompositionEngine, but no such wiring exists yet; adding it belongs to
  a later phase alongside a human-approval flow.
