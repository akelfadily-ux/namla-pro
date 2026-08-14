# Training mission factory

`src/academy/trainingMissionFactory.ts` (Build Law §20). Deterministically
generates bounded learning, practice, and examination missions for every domain
and difficulty (intro/core/advanced/mastery), plus multi-domain project missions.

Missions **vary deterministically by seed** (a variant key selects among fixed
scenario templates), so a colony re-run is reproducible while ants cannot rely on
one memorized answer key across runs. Each mission carries a hidden `qualityBar`
the evaluator scores against — a mastery exam demands more than an intro one, so
`examinationPasses` and `examinationFailures` are both positive from real
difficulty spread.

**Defensive security only.** Security scenarios are inspection/remediation
(unsafe-input detection, access-control review, secret-leak detection,
dependency-risk analysis) — never offensive exploitation or unauthorized access.
