# Provider pool and cognitive rotation

`src/academy/providerPoolRotation.ts` (Build Law §20, §8/§9).

## Provider pool

Holds every engine — the deterministic worker plus Claude, Codex, OpenAI,
Anthropic, and local models — with **real engines disabled by default**
(`requiresHumanAuthorization: true`; R2's one-ant boundary still governs real
execution). `select(preferReal)` returns a real engine only when explicitly
enabled AND healthy, otherwise the deterministic worker — so one provider's
failure never stops the colony. Tamara may set provider budgets but never selects
an individual ant.

## Cognitive rotation

Hundreds of persistent ants share a bounded number of slots. `CognitiveRotation`
admits up to `maxSlots` claims per round, specialization- and priority-aware,
with per-ant cooldown for fairness and failure backoff; slots expire at end of
round (stateless admission). The ceiling is clamped to `MAX_COGNITIVE_BUDGET`
(30) — tighten-only, never above. The operational real-provider target is **3-5**
active ants; nothing jumps automatically to 30 or hundreds.

## V2 pilot allocation

Real Academy Pilot V2 (Build Law §21) uses this pool + rotation for live cohorts:
the human chooses the allowed provider pool, ants express a preference, and the
resolver picks only from the allowed pool. Rotation admits at most the pilot
cohort size (≤5); each admitted ant makes at most one real call; a failed
provider falls back to the deterministic worker only (one failure never stops the
pilot). The global cognitive ceiling stays 30.
