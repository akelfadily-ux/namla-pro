# Ant Academy V1

A real curriculum and training runtime (`src/academy/`) covering 18 technology
domains across software, IT, data, AI, DevOps, and DEFENSIVE security.
Authorized by `NAMLA_BUILD_LAW.md` §20. Deterministic and in-memory; no real
provider, network, filesystem write, or process execution.

## Domains (18)

frontend, backend, databases, mobile, testing, debugging, devops, cloud,
defensive-security, data-engineering, ai-ml, agent-engineering, architecture,
documentation, product-management, it-operations, code-review, security-review.
Each maps to an existing work-market category, so training uses the same
voluntary claim + eligibility machinery as every other colony demand.

## Proficiency levels (earned, never counted)

trainee, junior, worker, specialist, senior, mentor, master. A level is **earned
from evidence** (`skillPassport.tryPromote`), never assigned from a counter. See
[ant-skill-passport.md](./ant-skill-passport.md).

## The training loop (per domain)

Each domain derives a bounded curriculum (skill tree with prerequisites,
learning/practice/examination missions per difficulty, rubric, failure
categories, remediation path, mentorship and graduation requirements). Ants
**volunteer** for missions; the accepted claimant is the student; a **different**
ant evaluates it; passing exams plus an independent review unlock evidence-gated
promotion; failures trigger remediation. A multi-domain project runs through the
existing `MissionRunner`; mentorship pairs experienced ants with trainees; some
ants reach senior and are certified.

## Proven (demo, seed 20260728)

18 domains; 72 training + 36 exam missions; 20 passes / 16 failures; 16
remediations; 46 promotions / 36 rejected; 7 certifications; 0 self-certifications;
0 unsupported promotions; mentorship, teams, and a project (reviews, verification,
repair); specialization diversity maintained; peak cognition 3 (at most 30).
Registered as golden `demoAntAcademyV1`. See
[academy-evaluation.md](./academy-evaluation.md),
[training-mission-factory.md](./training-mission-factory.md),
[project-based-ant-training.md](./project-based-ant-training.md),
[provider-pool-and-rotation.md](./provider-pool-and-rotation.md), and
[tamara-academy-command-center.md](./tamara-academy-command-center.md).

## Operations V2: real project work feeds the Academy (Build Law §24)

Completed, independently reviewed work in Digital Operations V2 produces BOUNDED
SkillPassport evidence (frontend, backend, database, testing, debugging, security,
architecture, documentation, teamwork, review, repair). The rules are unchanged
in kind: no instant promotion, no self-certification, one project alone cannot
create a master certification, evidence enters only after independent evaluation,
and failures also enter remediation history. `academyEvidenceUpdates` is a bounded
count of evidence entries, never a promotion. See
[digital-superorganism-operations-v2.md](digital-superorganism-operations-v2.md).
