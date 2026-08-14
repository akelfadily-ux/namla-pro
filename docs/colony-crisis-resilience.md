# Colony crisis resilience and bad-information resistance

`src/colony/colonyCrisisSuite.ts`. Ten bounded, deterministic, **in-memory**
adversarial scenarios. Each perturbs a bounded local working set and measures
whether the colony **contains** the damage and recovers — using only
decentralized mechanisms. Nothing here is a real adversarial capability; these
are resilience simulations only.

## The ten scenarios (`CRISIS_KINDS`)

1. `sudden-active-worker-loss` — withdraw ~30%; recovery from remaining capacity.
2. `simultaneous-high-demand` — enough distinct local responders cover multiple
   chambers at once.
3. `incorrect-leading-proposal` — a low-quality proposal leads; skeptical local
   reviewers must demote it.
4. `communication-congestion` — flexible ants adapt/move to keep working.
5. `high-failure-in-one-specialty` — repeated failure reduces confidence and is
   flagged unreliable; ants switch.
6. `loss-of-high-reliability-ants` — remove the top quartile; the rest absorb.
7. `contradictory-knowledge` — inject two opposite claims, resolve by evidence.
8. `brood-nursing-surge` — nurture-capable ants respond locally.
9. `cognitive-budget-saturation` — far more claims than slots; the resolver caps
   admission at 30.
10. `proposals-failing-quorum` — a legitimate "no forced pick / minority
    preserved" outcome counts as containment.

Recovery and containment are **real, counted outcomes**. An unreliable claim is
`contained` only when a skeptical, sufficiently-reliable local reviewer scores it
below the bar, or contradiction detection flags it — never by fiat. Demo: 10/10
recovered, 22 unreliable claims contained.

## Bad-information resistance (prompt item 9)

The colony detects and contains bad information through the mechanisms above plus
the peer-review and knowledge layers: evidence requests, reliability history,
contradiction detection, confidence reduction, and preserved alternatives. The
adversarial inputs (overconfident ant, incorrect success claim, misleading
recruitment, stale knowledge, unreliable worker, fatigue, partial team collapse)
are all modeled as bounded local perturbations — no real-world capability is
ever created.

## Guarantees under crisis

Every scenario is typed so it **cannot** use a Queen command
(`usedQueenCommand: false`) or a central assignment (`usedCentralAssignment:
false`), and cognitive activation never exceeds 30. Recovery happens through
local response, reserve/movement, peer review, and reliability history — never
through a controller.

## Status labels

- **Real-mechanism-inspired:** decentralized robustness to worker loss and
  demand spikes is a hallmark of real colonies.
- **Hybrid / digital adaptation:** the specific adversarial injections and the
  containment accounting are engineered resilience tests.
- **Deterministic implementation:** all scenario draws are seeded
  (`crisisDraw`); reruns are identical.
