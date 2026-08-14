# Ant Skill Passport

`src/academy/skillPassport.ts` (Build Law §20). Every ant carries one persistent,
bounded `SkillPassport`.

## Contents

antId; primary/secondary specialties; per-domain record (level, proficiency, exam
passes, independent reviews, certification state); completed units; verified
projects; test/review/reliability/safety/collaboration/mentorship scores; failure
patterns; remediation status; recent evidence refs; promotion/demotion history.

## Two hard rules

- **No self-certification.** `recordExamEvidence` refuses when the evaluator is
  the student (`selfCertificationBlocked`), so `selfCertifications` stays zero.
- **No promotion without evidence.** `tryPromote` advances a level only when the
  domain has at least one passing exam AND at least one independent review on
  record, plus enough proficiency for the next rank. Without both, the promotion
  is refused and flagged `unsupported` — it never advances the level, so
  `unsupportedPromotions` stays zero. High-level certification (`tryCertify`)
  additionally requires senior+ and multiple independent reviews.

## Bounded and compacted

Evidence refs (at most 8), promotion/demotion history (8 each), failure patterns
(6), primary specialties (3), completed units (24) — each evicts the oldest past
its cap. `passportWithinBounds` re-checks every cap, verified at 300/1,000/10,000.

## V2 pilot evidence

Real Academy Pilot V2 (Build Law §21) updates passports only through the same
evidence-gated rules: a real provider result is evaluated by a different ant and,
via `recordExamEvidence`, records bounded evidence. One provider response can
never promote or certify; **one pilot grants zero certifications**. Promotion
still requires accumulated evidence across multiple missions, and self-grading is
refused.
