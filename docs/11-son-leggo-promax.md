# 11 · Son, Leggo, ProMax

These are intentionally different roles.

## Son — comparison

Produces `ComparisonAssessment`:
- agreements
- disagreements
- missing criteria
- contradictory assumptions
- evidence gaps
- correlated-failure risk
- criterion-by-criterion strength

Son never reduces "A == B" to "correct".

## Leggo — integration

- merges compatible validated pieces
- respects declared WorkPackage access modes
- preserves traceability to source artifacts and contract criteria
- surfaces unresolved Son findings
- never edits the PlanContract
- never invents missing evidence

## ProMax — strongest verification

ProMax verifies the integrated candidate against:
- every acceptance criterion
- expected artifacts
- negative requirements
- security requirements
- evidence freshness
- ArtifactIdentity and EnvironmentIdentity
- unresolved Son findings
- independent tests/checks not solely produced by A/B
- integration correctness

Typical CRITICAL assurance may include contract-derived negative tests, property/invariant checks, independent test generation, and security checks.
