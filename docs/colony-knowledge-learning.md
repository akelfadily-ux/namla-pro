# Colony knowledge and learning

`src/colony/colonyKnowledgeSystem.ts`. A **bounded, in-memory** knowledge store
(no filesystem, no database). Seven kinds: `verified-pattern, disproven-pattern,
reusable-strategy, known-risk, heuristic, review-evidence, repair-lesson`.

## Admission gates (`proposeKnowledge`)

A contribution is accepted only after passing, in order:

1. **source attribution** — a missing `sourceAntId` is rejected;
2. **confidence threshold** — below `KNOWLEDGE_CONFIDENCE_THRESHOLD` (0.5) is
   rejected. In the mission suite, a contributor's confidence is its **real
   competence** at the category (`1 - responseThreshold`), so ants weak at a task
   genuinely produce rejected proposals — rejection is earned, not scripted;
3. **peer-review signal** — a peer-review score below 0.5 is rejected;
4. **contradiction check** — an opposite-polarity claim on an existing active
   key flags **both** entries `contradicted` and keeps both visible;
5. **versioning** — a matching same-polarity claim reinforces and bumps the
   version;
6. **bounded size** — the store has a hard capacity (`KNOWLEDGE_STORE_CAPACITY =
   64`); at capacity the **stalest** low-value entry retires before a new one is
   admitted.

## The two safety rules

- **Retrieval is capped.** `retrieveRelevantKnowledge` returns only
  task-relevant, active entries, at most `MAX_KNOWLEDGE_RETRIEVAL` (5). No ant
  can ever pull the whole store into local memory — the cap lives at the one
  retrieval site.
- **Contradictions stay visible.** Opposite claims are never silently merged.
  `resolveContradiction` resolves only by the support/refute counts the ants
  themselves produced (never by fiat); the losing claim retires, the winner
  reactivates.

Measured: proposals, accepted, rejected, contradictions detected, reused, stale
retired. Demo: 99 proposals → 45 accepted, 54 rejected, 3 contradictions, 9
reused.

## Status labels

- **Hybrid:** a shared, decaying colony knowledge pool echoes stigmergic
  information sharing, but versioning/contradiction/peer-gating are engineered.
- **Digital adaptation:** the typed entries, confidence gate, and contradiction
  bookkeeping have no direct biological analogue.
- **Postponed:** filesystem or database persistence — deliberately not built;
  the store is deterministic and in-memory only.
