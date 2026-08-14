# Digital Superorganism Metabolism V1

Namla Pro's product model is a **digital superorganism**: a decentralized colony
that performs high-tech work (software, AI, IT, security, data, DevOps) by the
same mechanisms a real ant colony uses to stay alive — but where every biological
resource is a **digital** one. The literal-biology simulator under `src/biology/`
is now a **frozen research reference layer**; the product layer is `src/digital/`.

This milestone (Build Law §23) implements that translation as a *causal* economy,
not a set of decorative counters: every reported number is an event count or a
ledger difference, and the whole system is validated by conservation + causality
invariants.

## Biological → digital mapping

| Biology | Digital |
| --- | --- |
| food / carbohydrate / protein | information / fast context / durable skills + components |
| water | memory, context bandwidth, communication bandwidth |
| oxygen | tools, APIs, permissions, compute, runtime/provider access |
| energy | token budget, compute budget, time budget, money |
| working hands | executing AntAgents + provider-backed cognitive workers |
| trophallaxis | bounded local knowledge/context transfer |
| metabolism | raw information → plans, code, tests, reviews, artifacts |
| CO₂ | errors, failed attempts, hallucinations, rejected proposals |
| waste | dead code, expired context, obsolete knowledge, duplicate artifacts |
| disease | poisoned data, vulns, prompt injection, unreliable knowledge |
| immunity | peer review, testing, security review, evidence validation, sandboxing |
| brood | new/young workers, untrained skills, agents under development |
| maturation | training, exams, mentorship, evidence-based promotion |
| death / retirement | disabled agents, retired strategies, obsolete skills |
| Queen | colony identity, genome, continuity, policy — **never** task assignment |

## Modules

- `digitalTypes.ts` — the 15 conserved resources, task/threat/waste/maturation vocab, deterministic draw.
- `digitalConfig.ts` — the ONE documented profile of tunable parameters.
- `digitalResourceEconomy.ts` — the event-sourced conservation ledger.
- `digitalWorkers.ts` — persistent identities, maturation gates, eligibility, energy.
- `digitalMetabolism.ts` — scout / verify / plan / build / review / test / repair transforms.
- `digitalTrophallaxis.ts` — bounded team-local knowledge/context transfer.
- `digitalImmunity.ts` — threats, traced transmission, quarantine, trust penalty.
- `digitalBrood.ts` — mentored training and evidence-gated promotion.
- `digitalSuperorganismRunner.ts` — the 15-step bounded project orchestrator.
- `digitalSuperorganismReport.ts` — metrics + conservation + causality validation.
- `digitalFidelityMatrix.ts` — the honest fidelity matrix.

## The 15-step scenario

1. Tamara publishes a strategic objective (DATA — not an assignment).
2. Scouts collect raw information.
3. Verification converts raw information into verified knowledge.
4. Proposals compete.
5. A **local quorum** selects a plan.
6. Ants **voluntarily** claim tasks (stable affinity × current demand).
7. A **bounded** set receives revocable tool/compute access (oxygen).
8. Builders create artifacts.
9. Reviewers inspect them (a *different* worker than the builder).
10. Testers create evidence.
11. Failures produce CO₂ / structured waste + technical debt.
12. Repair/cleaner ants recycle the failure into lessons + remediation.
13. Final evidence is produced.
14. Useful knowledge enters the colony store.
15. Stale or bad information is quarantined.

## What makes it *causal*, not decorative

- **Conservation** — for every resource, `quantity == initial + collected + created − consumed − expired − quarantined`; tool-access capacity closes (`available + held == initial`). See [digital-resource-economy.md](digital-resource-economy.md).
- **Causality** — every outcome is backed by a transformation-ledger event chain: no knowledge without a raw source + verification, no artifact without knowledge + compute + tokens + context + tool access, no promotion without evidence, no provider call, no action by a retired worker.
- **Decentralization** — `centralTaskAssignments`, `queenTaskAssignments`, `tamaraDirectAntAssignments`, `globalPlannerDecisions` are all **0**.
- **Bounded hands** — 300 / 1,000 / 10,000 persistent identities, but deep-cognitive concurrency ≤ 30 and real-provider workers ≤ 5 with **0** calls in deterministic runs.

## Demo & verification

`src/examples/demoDigitalSuperorganismV1.ts` runs the 300-identity scenario
deterministically, self-checks 36 expectations (`allExpectationsMet`,
`mismatchCaseIds` empty), and re-verifies conservation + causality at 300 / 1,000
/ 10,000 identities. It is registered in the golden harness
(`demoGoldenOutputs`) with a calibrated baseline.

## Boundaries (frozen for this milestone)

No literal food/water/pathogen extension, no UI, no provider-concurrency
increase, and **no running Claude/Codex from Namla**. Real cognitive providers
remain a separate, human-authorized pilot; here `providerCalls` is literally 0.

## Successor: Digital Superorganism Operations V2 (Build Law §24)

Operations V2 builds a real software mission workflow on this economy: Tamara
publishes an objective, it is metabolized into causal demands, workers voluntarily
build/review/verify/repair a project in an isolated workspace, and the ledger
still closes. See
[digital-superorganism-operations-v2.md](digital-superorganism-operations-v2.md).
