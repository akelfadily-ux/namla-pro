# 17 · Testing strategy

Migration requires four layers:

1. **Baseline preservation** — record the current suites/golden behavior before migration.
2. **Parity proof** — migrated capability preserves required behavior or records an explicitly approved delta.
3. **Security regression** — no retirement while required security proof is missing/red.
4. **V2-native tests** — each new V2 primitive is tested before mission use.

V2-native test targets include:
- PlanContract freeze/version behavior
- MissionState/WorkPackage legal transitions
- EffectiveAuthority deny-by-intersection
- ArtifactIdentity/EnvironmentIdentity binding
- NAMLA LOOP GateVerdict behavior
- evidence invalidation and minimal stale frontier
- A/B isolation
- Protocol→Pro ownership
- concurrency/access-mode barriers
- budget/oscillation policies

For probabilistic or human-judgment stages, tests validate protocol/invariants/provenance rather than pretending semantic outputs are deterministic.
