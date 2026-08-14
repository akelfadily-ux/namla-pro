# Tamara academy command center

`AcademyCommandCenter` in `src/academy/academyRuntime.ts` (Build Law §20). A real
state projection a future UI can consume — never a decorative animation, never
raw private reasoning.

Exposes: total ants; ants by proficiency; mentors; active teams; promotions;
certifications; cognitive-slot peak and ceiling; enabled real providers;
reliability P50; distinct primary specializations; academy health; failed
missions; remediation queue. All are safe aggregates (counts, distributions,
scalars); no raw `AntMind` content, prompt, or hidden reasoning is exposed.

The `FederationSafeSummary` (see
[tamara-namla-federation-v1.md](./tamara-namla-federation-v1.md)) is the
mission-level analogue Tamara inspects — counts, statuses, and evidence only.

## V2 pilot command center

Real Academy Pilot V2 (Build Law §21) adds `AcademyPilotCommandCenter`
(`realAcademyPilot.ts`), a safe projection of one live pilot: livePilotId,
pilotStatus, academyDomain, cohortClaimCount, acceptedCohortSize, safe cohort
ids, provider assignments, provider calls started/completed/failed, deterministic
fallbacks, evaluations completed/passed/failed, remediation requests, passport
evidence updates, aggregate input/output bytes, provider budget remaining,
human-authorization state, and pilot outcome. It exposes no raw prompt, private
AntMind, provider credential, raw stderr, environment, or unrestricted provider
output.
