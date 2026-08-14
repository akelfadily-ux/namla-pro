# Digital Review, Verification, and Repair

The immune layer of Digital Operations V2 (Build Law §24): independent review,
allowlisted verification, and evidence-backed repair.

## Independent review

Reviewers voluntarily claim review demand and never review their own work (the
`no-self-review` causal invariant). High-risk artifacts (backend, data, security)
require at least 2 independent reviewers. A review yields a decision (approve /
reject / request-changes), identified risks, confidence, and a technical-debt
estimate. Only an approved artifact is applied.

## Allowlisted verification

`digitalVerification.ts` allows only four hard-coded (executable, args) pairs:
`npx.cmd tsc --noEmit`, `npm.cmd test`, `npm.cmd run build`, `npm.cmd run lint`.
`isAllowedVerificationCommand` rejects everything else — no mission-text command,
no arbitrary script, no shell. Automated runs use the deterministic
`FakeVerificationDriver` (no spawn; `realProviderProcessExecutions` and
`realNetworkCalls` stay 0). Real project-command execution requires separate
explicit human authorization and is not wired.

## Failure to waste to repair

A verification failure creates a failure event, `errorWaste`, `technicalDebt`, and
a repair demand caused by the failure (`originKind: failed-verification`). A repair
ant voluntarily claims it, recycles the waste into a reusable lesson (`errorWaste`
becomes `verifiedKnowledge`), services debt, and applies a reviewed repair
artifact. Final verification then passes. The invariants `no-repair-without-failure`
and `no-success-without-test-evidence` keep this honest, and maximum repair rounds
are bounded. No failure disappears silently.
