# Academy evaluation

`src/academy/academyEvaluator.ts` (Build Law §20). Evaluation is done **by a
different ant than the student**, against a fixed 10-dimension rubric
(correctness, completeness, safety, test quality, maintainability, efficiency,
documentation, reasoning evidence, collaboration, constraint adherence), "blind"
(scored from an anonymized attempt quality, not the student's identity).

The attempt's underlying quality is the student's **earned proficiency** blended
with its **real competence** (from its response thresholds) and **reliability**,
minus the mission's difficulty bar, plus a small seeded jitter — never
self-reported. This prevents self-grading (the runtime always supplies a distinct
evaluator), score inflation (scores track real competence, not claims), and rote
memorization (missions vary by seed). The lowest rubric dimension names the
failure category on a fail; an unsafe result (safety below floor) always fails.

Metrics: trainingMissions, examinationMissions, passes, failures, remediations,
promotions, rejectedPromotions, certifications, `selfCertifications: 0`,
`unsupportedPromotions: 0`. High-level certification uses multiple independent
reviewers.
