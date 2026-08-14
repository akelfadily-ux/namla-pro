# Peer review, local challenge, and temporary teams

## Peer review — `src/colony/peerReviewSystem.ts`

Ants challenge each other's plans locally. Eleven typed interactions:
`request-review, approve, reject, question-assumption, identify-risk,
propose-alternative, request-evidence, request-test, report-contradiction,
request-repair, transfer-knowledge`.

Rules, all enforced in `runPeerReview`:

- reviewers **volunteer** by relevant local skill (the cognitive dimension that
  matches the plan's category) plus energy — no central reviewer assignment;
- the subject is **removed from the pool first**, so an ant can never approve
  its own work (`selfReviewAttemptBlocked` records the attempt);
- reviewer **reputation weights** the verdict but never guarantees acceptance —
  acceptance is trust-weighted approvals vs objections, and one high-rep
  reviewer cannot force it;
- reviewers **disagree**: when both an approval and an objection are recorded,
  disagreement is counted and the **minority opinion is preserved**
  (`minorityOpinions`);
- **high-risk work** (≥3 risks) requires multiple independent reviews before it
  can be accepted;
- every review references a **fixed reason code**, never free text, so review
  memory stays bounded and safe;
- the reviewer pool is capped (`MAX_REVIEWERS = 5`) — a review never scans the
  population.

### Decentralized reasoning structures

- `pairwiseCritique` — exactly two minds, no aggregator.
- `threeAntReviewPanel` — three independent minds; consensus only on
  trust-weighted majority; dissent counted and preserved.

No object receives all ants' private thoughts.

## Temporary teams — `src/colony/antTeams.ts`

Six kinds: `research-pair, architecture-council, builder-reviewer-pair,
test-and-repair-group, security-inspection-group, documentation-group`.

- teams form only through **voluntary recruitment** (`tryFormTeam`): a candidate
  joins on its own skill, social trust, and energy — no Queen team, no central
  worker assignment; too few volunteers → **no team** (a real null outcome);
- teams are **temporary and bounded** (`MAX_TEAM_SIZE = 5`);
- `advanceTeam` runs cooperation rounds: aligned members raise cohesion and yield
  **successful cooperation**; a strong skill spread causes **disagreement**,
  lowers cohesion, and can **split** the team; completing the work or a cohesion
  collapse **dissolves** it;
- there is **no permanent hierarchy** — every team ends.

Measured: teams formed, average team size, dissolutions, disagreements,
successful and failed cooperation.

## Status labels

- **Real-mechanism-inspired:** task partitioning and transient work groups occur
  in social insects.
- **Hybrid / digital adaptation:** typed peer review, reputation-weighted
  acceptance, and named guild kinds are software-team practice, not ant biology.
- **Deterministic implementation:** all reviewer/team draws are seeded
  (`reviewDraw`, `teamDraw`).
