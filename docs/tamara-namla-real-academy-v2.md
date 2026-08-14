# Tamara–Namla Real Academy Pilot V2

A bounded LIVE training pilot of **1-5 voluntary ants** through real providers,
at most **5 total real provider calls**, one call per ant — while the full
300-ant nation keeps running deterministically. Authorized by
`NAMLA_BUILD_LAW.md` §21 (extending R2's one-ant door; R2 stays intact).

**300 identities are not 300 provider calls.** A pilot activates at most 5 ants;
the rest continue local/deterministic work, reserve behavior, learning, review,
memory, and coordination. Automated tests make **zero** real calls.

## The pieces

| Module | Role |
|---|---|
| `src/cognitive/multiProviderPilotPermit.ts` | Non-serializable, single-use pilot permit (cohort ≤5, calls ≤5) + per-ant member permits |
| `src/academy/realAcademyPilot.ts` | Cohort selection, provider allocation, per-ant activation gate, independent evaluation, failure containment, command-center |
| `src/cognitive/smokeWorkspace.ts` | The confined `workspaces/academy-pilot/<pilot-id>/` real workspace |
| `src/cli/academyRealPilotCli.ts` | The human-only `academy:real-pilot` entry point |
| `src/examples/demoRealAcademyPilotV2.ts` | Fake-driver verification of the whole lifecycle |

## Tamara sets the objective, never the ants

Tamara publishes the strategic training goal and budget. The academy turns it
into local demand; qualified ants **volunteer**; cognitive rotation accepts at
most 5. The human never names an ant, never bypasses claims/rotation/evaluation/
review/evidence, and never mints permits automatically —
`tamaraDirectAntAssignments`, `centralTaskAssignments`, `queenTaskAssignments`,
and `globalPlannerDecisions` stay zero.

## Provider result is evidence, not authority

Every real result is DATA, evaluated by a **different** ant against the rubric,
and updates only bounded SkillPassport evidence. **One pilot grants zero
certifications**, and one provider response can never promote or certify an ant —
promotion still requires accumulated evidence across multiple missions. No
provider output executes a command.

## Proven (demo, fake driver only)

5-ant cohort (from 151 volunteers), mixed Claude/Codex, 1 quota failure, 1
malformed result, 3 evaluated (2 pass / 1 fail), 3 remediations, 5 passport
evidence updates, 0 certifications, partial outcome — every real
provider/network/fs/process counter zero. Registered as golden
`demoRealAcademyPilotV2`. See
[multi-ant-provider-pilot.md](./multi-ant-provider-pilot.md),
[real-academy-evaluation.md](./real-academy-evaluation.md),
[provider-comparison-policy.md](./provider-comparison-policy.md), and
[academy-pilot-workspace-security.md](./academy-pilot-workspace-security.md).

**The live pilot is human-only and separate.** A human must run it themselves;
it is never executed by any test, demo, or build.
