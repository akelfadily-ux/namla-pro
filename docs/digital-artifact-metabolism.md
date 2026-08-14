# Digital Artifact Metabolism

In Digital Operations V2, builders convert knowledge into `ArtifactProposal`s and
only reviewed, approved proposals reach the workspace (Build Law §24).

## Every artifact proposal carries

`proposalId`, `objectiveId`, `taskId`, `antId`, `demandId`, `targetRelativePath`,
`operation`, content fingerprint, consumed-context reference, tool-permit
reference, reason, confidence, acceptance-criteria references, `requiresReview:
true`, a `highRisk` flag, and (for the one seeded defect) `defectInjected`.

## Every artifact requires real inputs

A build is a conserving `economy.transform("build", ...)` that consumes
`verifiedKnowledge` + `workingContext` + `computeCapacity` + `tokenBudget` and
produces `reusableComponents`. If any prerequisite (accepted claim, tool permit,
sufficient budget) is missing, the builder refuses or waits — there is no artifact
without a worker, context, compute, tool permit, accepted claim, and a causal
demand. The causal invariant `no-artifact-without-resources` checks every build
receipt.

## Provider output is not an applied artifact

A deterministic-cognitive worker may call a fake provider to generate bounded
content (DATA only, counted as `deterministicProviderCalls`), but that content is
an artifact PROPOSAL — it becomes an applied file only after independent review
approves it and the workspace boundary accepts it. Real providers write no files.

## Supported artifact kinds

source file, test file, documentation, configuration, schema, API contract,
component, review comment, repair patch.
