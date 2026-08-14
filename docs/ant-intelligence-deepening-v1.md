# Ant Intelligence Deepening V1

A **second deterministic layer** on top of the committed Colony Genesis G1-G7
core. It makes each of the 300+ persistent ants a substantially richer
autonomous worker — capable of local planning, self-evaluation, peer review,
cooperation, learning, disagreement, and crisis recovery — **before** any real
model is attached. Authorized by `NAMLA_BUILD_LAW.md` Section 17.

Nothing here calls a real Claude, Codex, OpenAI, Anthropic, or local model.
`externalLlmCalls` is literal zero. The intelligence is entirely deterministic,
seed-driven arithmetic over each ant's own bounded local state.

## Where it lives

| Module | Concern |
|---|---|
| `src/colony/antMind.ts` | Bounded `AntMind` + evolving `CognitiveProfile` (15 dims) |
| `src/colony/localPlanning.ts` | Bounded private plans, creation + revision |
| `src/colony/selfEvaluation.ts` | Self-evaluation + confidence calibration |
| `src/colony/peerReviewSystem.ts` | Peer review, pairwise critique, three-ant panels |
| `src/colony/antTeams.ts` | Temporary voluntary teams/guilds |
| `src/colony/colonyKnowledgeSystem.ts` | Bounded in-memory colony knowledge |
| `src/colony/mentorshipSystem.ts` | Mentorship of brood-origin young workers |
| `src/colony/colonyCrisisSuite.ts` | Ten deterministic crisis scenarios |
| `src/colony/antIntelligenceRuntime.ts` | Orchestrator, report, command-center, scale |
| `src/examples/demoAntIntelligenceDeepening.ts` | The proving demo |

It is a **layer beside** the G1-G7 tick runner, not a rewrite of it. The tick
runner is untouched; all prior goldens stay green. Minds are built from the
**evolved** post-run population, so cognition reflects genuine experience.

## The two hard disciplines

**Decentralization.** No object ever receives all ants' private minds. Every
mission runs on a bounded local window of the population (never an all-to-all
scan). `centralTaskAssignments`, `queenTaskAssignments`, and
`globalPlannerDecisions` are all literal zero. A colony observer
(`CommandCenterState`) aggregates safe metrics only — it directs nothing.

**Boundedness.** Every mind surface, plan, review pool, team, and knowledge
retrieval has a hard cap, re-checked at runtime (`mindWithinBounds`,
`planWithinBounds`). Old episodic detail is compacted into summaries, never kept
unbounded. No ant holds the roster, the whole knowledge store, or another ant's
full mind. The layer is O(N), verified at 300 / 1,000 / 10,000 identities.

## What is biological, hybrid, adapted, or hypothesis

- **Real-mechanism-inspired:** response-threshold specialization (Bonabeau et
  al.), reserve labor, brood-driven young-worker development, quorum-style
  reversible commitment for high-impact decisions.
- **Hybrid:** peer review and temporary guilds blend social-insect task
  partitioning with software-team practice; they are not a single-species
  behavior.
- **Digital adaptations (no biological claim):** the 15-dimension cognitive
  profile, confidence calibration, the bounded knowledge store with versioning
  and contradiction flags, the cognitive-budget admission cap.
- **Hypotheses (testable, not asserted):** that these deterministic mechanisms
  meaningfully improve colony decision quality, and that they will transfer
  usefully once a bounded subset of ants receives real LLM cognition.
- **Future real-LLM behavior:** `CognitiveWorkerContract` in
  `cognitiveBudgetSystem.ts` is the provider-ready seam. No implementation
  exists; nothing calls it; `externalLlmCalls` stays zero until a separate,
  explicitly authorized phase.

## Proven metrics (demo, seed 20260721)

300 persistent identities / 299 cognitive profiles / 299 distinct profile
digests; 72 plans created and revised; 1,440 self-evaluations with calibration
error falling 0.207 → 0.031; 72 peer reviews with recorded disagreements and 126
assumptions challenged; 12 teams formed and dissolved; 99 knowledge proposals
(45 accepted, 54 rejected, 3 contradictions, 9 reused); 19 mentorship events
with 12 young workers improved; 10 crisis scenarios all recovered with 22
unreliable claims contained; all 10 task categories represented as primary
specializations; peak cognitive activation 30; every capability-absence counter
zero. See `demo-map.md` and `demoGoldenBaselines.ts` for the asserted subset.
