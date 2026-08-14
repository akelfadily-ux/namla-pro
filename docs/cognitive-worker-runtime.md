# Cognitive worker runtime

`src/colonyMission/cognitiveWorkTypes.ts` defines one provider-neutral
contract every cognitive worker satisfies — `fake`, `claude`, and `codex`
are three implementations of the same shape, and no colony decision module
imports a provider-specific type.

## The contract

`CognitiveWorkRequest` carries exactly what a bounded request needs:
`requestId`, `missionId`, `taskId`, `antId`, `behavioralRole` (scout /
builder / reviewer / tester / repair), bounded `taskDescription` and
`relevantContext`, `acceptanceCriteria`, `allowedWorkspacePaths`,
`maxResponseSize`, `maxAttempts`, `providerName`, and bounded
`safeMetadata`. `CognitiveWorkResponse` carries `summary`,
`artifactProposals`, `reviewObservations`, `verificationSuggestions`,
`confidence`, `usageMetadata`, and an optional `safeFailureCategory`.
Neither type has a field for a credential, a token, or raw environment
data, because nothing in this runtime ever needs one.

## The chokepoint

`CognitiveWorkerRouter` is the one place every request passes through:

1. `CognitiveRequestValidator` bounds the request (length caps, secret-shaped
   content refused, `SafetyGuard` evaluation) before any provider sees it.
2. The registered provider's `submit()` runs.
3. `CognitiveResultValidator` bounds the response — critically, every
   artifact's `targetRelativePath` must fall inside the ORIGINAL request's
   `allowedWorkspacePaths`. A provider cannot expand its own write scope by
   naming a different path in its response.
4. Every outcome — completed, refused, or invalid — is receipted.

## Providers

- **`DeterministicCognitiveWorker`** (`deterministicCognitiveWorker.ts`):
  same request, same response, always. Used by every automated test and
  demo. Content varies by `(behavioralRole, antId, taskId)` — different
  ants proposing for the same task produce genuinely different but
  reproducible content, which is what gives scout-proposal competition
  something real to compete over. Its repair behavior strips a known defect
  marker from whatever broken content it's handed — a real, testable
  algorithm, not a hard-coded success flag.
- **`ClaudeCliAdapter` / `CodexCliAdapter`**: see
  [real-provider-adapters.md](./real-provider-adapters.md). Always refuse.

## Budget

`CognitiveExecutionBudget` is the one deliberately centralized admission
step — mirroring Colony Genesis G7's `resolveCognitionClaims` exactly:
bounded resource admission, never task assignment. An ant's task is already
chosen (it voluntarily claimed work) before this runs; this only decides
whether that ant may additionally use a cognitive worker right now.
Deterministic ordering by score then `antId`. Unlike G7 (stateless,
re-resolved every tick), a mission runs once, so slots are held for the
duration of an ant's cognitive work and explicitly released — "slots
release when work ends" is literal here.

## R1 status

Reaffirmed by Build Law Section 18 as the R1 provider-neutral cognitive runtime.
R1 adds the end-to-end demo `demoRealCognitiveAntsR1` (golden-registered) that
drives this runtime through a full mission. Every automated run uses only
`DeterministicCognitiveWorker`; real provider execution counts stay zero.

## R2 status

Since Real Cognitive Ants R2 (Build Law §19) the Claude/Codex adapters are
CONDITIONALLY executable through `executeReal`, and only through it: it runs one
bounded process via an injected driver, but only after a valid, human-confirmed,
scope-matched, single-use `RealProviderExecutionPermit` passes every gate in
`src/cognitive/realProviderActivation.ts`. The mission-path `submit` still always
refuses. Automated tests inject the `FakeProviderProcessDriver`; the real Node
driver runs only from the human-only `colony:real-smoke` CLI. See
[real-cognitive-ants-r2.md](./real-cognitive-ants-r2.md).
