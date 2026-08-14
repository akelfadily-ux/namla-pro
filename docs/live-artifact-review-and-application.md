# Live Artifact Review and Application

In V3, no artifact reaches disk straight from a provider (Build Law §25).

## Normalization first

Every real provider response is normalized (`normalizeProviderResult`) into
bounded, structured DATA: `proposalId`, `antId`, `providerId`, `taskId`,
`summary`, `assumptions`, `filesProposed` (validated relative paths + bounded
content + fingerprints), `risks`, `testSuggestions`, `confidence`, `uncertainty`,
`safeFailureCategory`, and truncation status. It REJECTS malformed output,
executable-command requests, oversized output, unsupported/absolute/source-tree/
traversal paths, and secret-like content — surfacing a safe failure category
instead of an artifact.

## Independent review

Each artifact requires: the original provider-backed ant, an independent reviewer
that is NOT the producer, a workspace-boundary check, a content-size check, a
fingerprint, an acceptance-criteria check, a security check, and an approval
record. An ant can never approve its own artifact (`selfReviewsAccepted` is 0).
High-risk artifacts (service/repo/backend/security/data) require two reviewers. A
rejected artifact creates a failure event, `errorWaste`, `technicalDebt`, and a
repair demand.

## Application

Only approved proposals are applied, workspace-only, via the boundary-enforcing
driver: exclusive-create for new files, bounded overwrite only for files created
in the same objective workspace, no source-tree writes, no unreviewed patch, and
a receipt recording actual bytes and fingerprints. A partial or bad artifact is
reported for human cleanup — never silently deleted.
