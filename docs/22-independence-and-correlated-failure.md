# 22 · Independence and correlated failure

Two systems agreeing can still be wrong for the same reason.

## Independence dimensions

- algorithm/reasoning method
- implementation path
- provider/model family
- evidence source
- test-generation method
- environment/toolchain

A second run of identical code with identical inputs may detect nondeterminism, but it is **not independent assurance**.

## A/B rule

Agreement increases confidence only when independence is meaningful. Correctness still requires contract verification, attestations, independent assessments, and current GateVerdicts.

## Low-diversity evidence

When required diversity cannot be achieved, record `low-diversity` or equivalent evidence. Whether that blocks the mission depends on the AssuranceProfile and policy; it is not hidden.
