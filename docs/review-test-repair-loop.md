# Review, verification, and repair loop

`src/colonyMission/reviewLoop.ts`, `verificationRunner.ts`, `artifactTypes.ts`,
orchestrated by `missionRunner.ts`.

## Artifact proposals

A builder ant produces structured artifact proposals (create/modify workspace
file, test file, documentation, configuration, review comment, repair proposal).
Each carries a target relative path, change kind, exact content (or bounded
patch), a fingerprint, a reason, an acceptance-criteria reference, confidence,
and a review requirement. **No artifact is applied before independent review**,
and an ant **cannot review its own artifact** (the reviewer is a different ant);
high-risk artifacts require multiple independent reviews.

## Reviewers

Reviewer ants inspect correctness, architecture, security, workspace boundary,
and acceptance criteria, and may request evidence or tests. A review reaching
`adequate` is what lets the workspace apply the artifact — nothing else does.

## Verification (test-only driver)

Tester ants execute **only an injected verification-driver abstraction**. Every
automated run uses `FakeVerificationRunner`, a deterministic, content-based
simulation. A `RealVerificationRunner` exists for a future phase behind a
hard-coded allowlist and, like the CLI adapters, **always refuses** — no real
process command executes in any automated test. **Mission text never becomes a
command.**

## Bounded repair

When verification fails, the runner publishes a `repair`-category demand; repair
ants **volunteer**; one admitted repair ant receives a **bounded failure
summary** (not the whole colony state) and proposes a fix that is reviewed and
applied. Repair is capped at **3 rounds** — no unbounded retry. Demo: 1 injected
defect → detected → 1 repair round → final verification passes.

## Status labels

- **Hybrid:** independent review and bounded repair blend social-insect
  error-correction with software engineering practice.
- **Digital adaptation:** the typed artifact/review/verification contracts are
  engineering scaffolding.
- **Postponed:** real verification command execution (allowlisted, future,
  separately authorized).
