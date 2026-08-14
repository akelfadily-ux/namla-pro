# Digital Operations Command Center

`digitalOperationsReport.ts` projects a safe command-center view of a running
objective (Build Law §24, §14). It exposes summaries only — never raw private
AntMind content, provider credentials, raw environment, or unrestricted provider
output.

## Projected fields

`objectiveStatus`, `activeDemands`, `voluntaryClaims`, `acceptedWorkers`,
`cognitiveSlotsPeak`, `providerCalls` (deterministic), `proposals`,
`quorumReached`, `artifactsProposed`, `reviews`, `verificationRuns`, `failures`,
`repairRounds`, `technicalDebt`, `wasteRecycled`, `securityQuarantines`,
`workspaceFiles`, `academyEvidence`, and `finalAcceptance`.

Each value is an event count or a ledger difference from the run — there is no
free text, no credential, and no private reasoning. The projection is what a
Tamara-facing dashboard would consume: enough to observe and accept or reject the
outcome, nothing that would let her (or anyone) assign an ant, pick the quorum
winner, or read a private mind.

## Live objective command center (Build Law §25)

`liveObjectiveReport.ts` projects the V3 live-objective command center (safe
summaries only): `liveObjectiveId`, `liveStatus`, `voluntaryClaimPool`,
`acceptedCohort`, `providerAssignments`, `providerCalls`, `providerFailures`,
`normalizedResults`, `pendingReviews`, `approvedArtifacts`, `rejectedArtifacts`,
`workspaceFiles`, `verificationCommands`, `verificationResults`,
`repairConfirmations`, `repairRounds`, `technicalDebt`, `waste`, `finalOutcome`,
and `humanAuthorizationState`. No raw private AntMind, provider credentials, raw
environment, or unrestricted provider output. See
[digital-superorganism-live-objective-v3.md](digital-superorganism-live-objective-v3.md).
