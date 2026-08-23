# 18 · Observability and metrics

Two surfaces are intentionally separate:

- **EvidenceStore** — immutable historical claims, attestations, assessments, verdicts, invalidations, receipts, HumanDecisionRecords.
- **Mission State Plane** — current lifecycle, owners/leases, attempts, budgets, resume checkpoints.

Useful telemetry:
- First Pass Yield per gate
- failure class distribution
- repair/rework counts
- stale-frontier breadth
- budget exhaustion
- low-diversity frequency
- A/B disagreement rate
- ProMax independent-check defect discovery
- HUMAN_REQUIRED frequency

**FPY is telemetry, never proof of correctness.** Quality gates are contract correctness, security, required tests, evidence validity/freshness, artifact integrity, and policy compliance.
