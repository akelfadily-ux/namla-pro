# Real Cognitive Ants V1

Connects a bounded subset of the Colony Genesis population to cognitive
workers while preserving the colony architecture. The colony is still
responsible for local task demand, voluntary claims, specialization,
recruitment, local quorum, reserve labor, cognitive-budget admission,
bounded local memory, and receipts/audit — external models (when a future
phase actually attaches one) are temporary cognitive resources a handful of
already-self-selected ants use, never a replacement for the colony.

Authorized by `NAMLA_BUILD_LAW.md` Section 16.

## The honest headline claims

- **300 persistent ants do not mean 300 model calls.** Every ant that isn't
  currently claiming and executing cognitive work is doing ordinary
  deterministic-local behavior, exactly as Colony Genesis G1-G7 already
  established.
- **Default automated tests use the fake worker exclusively.**
  `DeterministicCognitiveWorker` is the only provider `demoRealCognitiveColony.ts`
  and every other automated path ever calls.
- **Real adapters are optional and default-off** — `fake` is the CLI's
  default provider; `claude`/`codex` must be named explicitly and
  confirmed, and even then the adapters always refuse (see
  [real-provider-adapters.md](./real-provider-adapters.md)).
- **Maximum first real cognitive concurrency is 5** — this milestone's
  `CognitiveExecutionBudget` is capped at 5, independent of and well under
  Colony Genesis G7's global 30-slot budget.
- **Provider credentials remain outside the repository.** Nothing in
  `src/colonyMission/` reads, stores, or receipts a credential; the planned
  CLI adapters describe an executable and argument template only.
- **The Queen never activates a provider.** `MissionRunner` never reads the
  Queen record at all; cognitive admission is `CognitiveExecutionBudget`
  resolving already-voluntary claims.
- **The colony chooses tasks before any provider execution.** Every
  cognitive request follows a voluntary claim and a budget admission that
  already happened; a provider is asked to help with work an ant already
  chose, never asked what to do.

## Pipeline

1. Mission enters the colony (`MissionRunner`, built on the reused 300-ant
   `createColonyGenesis` population).
2. At least 3 scout ants independently propose architectures
   ([colony-work-market.md](./colony-work-market.md)); a bounded local
   quorum picks one.
3. Eligible ants observe per-category work demand and voluntarily claim
   build tasks; contention resolves deterministically.
4. Accepted claimants who need it request a cognitive slot; the bounded
   budget admits at most 5 concurrently.
5. Admitted ants call the registered provider
   ([cognitive-worker-runtime.md](./cognitive-worker-runtime.md)) and
   receive structured `ArtifactProposal`s.
6. A reviewer ant checks correctness, architecture, security, workspace
   boundary, and requirements coverage before anything is applied.
7. Adequate artifacts are applied to the isolated mission workspace
   ([mission-workspace-security.md](./mission-workspace-security.md)).
8. Simulated allowlisted verification runs; on failure, a recruited repair
   ant gets the bounded failure context and proposes a fix, bounded to a
   maximum of 3 rounds.

## Deterministic proof

`src/examples/demoRealCognitiveColony.ts` runs this entire pipeline with
only the fake provider and asserts every required behavioral fact —
300/1/299 identities, >=3 scout proposals reaching quorum, >=2 rejected
proposals recorded, positive voluntary/accepted claims, positive cognitive
claims with peak concurrency <=5, positive artifacts/reviews/applied files,
one injected defect genuinely detected and genuinely repaired, final
verification passing, zero workspace-boundary violations, zero real
Claude/Codex/network calls, zero central/Queen assignments.
