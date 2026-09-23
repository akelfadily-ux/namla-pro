# C9C2 — Canonical post-ProMax assurance factories

Base commit: `d3fec55bc4ab87fbc73347167568811cd9011069`.

C9C2 implements the five previously shell-only post-ProMax factories without
activating them in the canonical registry yet:

- FINAL_SPRINT_COURT
- LIHU
- DEVOPS
- API_INTEGRATION
- SECURITY

## Fail-closed assurance chain

The implementation is deliberately control-plane only. It performs no
filesystem/process/network/deployment/release effect.

The chain is exact and non-skippable:

`PROMAX -> FINAL_SPRINT_COURT -> LIHU -> DEVOPS -> API_INTEGRATION -> SECURITY`

Every stage requires:

1. the exact prior stage prefix;
2. the same mission, candidate and immutable PlanContract identity;
3. the complete prior proof envelopes, not only stage-name strings;
4. fresh re-verification of every prior proof through the trusted durable proof
   authority, which prevents fabricated assurance-state prefixes after restart;
5. a stage-specific PASS assessment with non-empty, unique evidence references;
6. a deterministic SHA-256 fingerprint of that assessment;
7. a proof envelope binding the fingerprint to the exact stage and result ref;
8. independent verification of that exact envelope by
   `CanonicalPostProMaxProofAuthority`.

The authority may not substitute a different proof after verification. State
proof/result references are one-to-one and immutable.

## Input hardening

Assessment/state/proof decoders reject proxies, accessors, sparse/exotic arrays,
duplicate evidence/result references, malformed hashes and out-of-order proof
prefixes. ProMax data is captured before any semantic decision or fingerprint.

## Stage semantics represented by assessment kind

- FINAL_SPRINT_COURT -> `COURT_VERDICT`
- LIHU -> `LIHU_ASSESSMENT`
- DEVOPS -> `RELEASE_QUALIFICATION`
- API_INTEGRATION -> `INTEGRATION_QUALIFICATION`
- SECURITY -> `SECURITY_QUALIFICATION`

C9C2 does not claim that these qualifications were mechanically executed by this
module. The durable proof authority is the trust boundary for those externally
produced results.

Canonical factory-shell/runtime-adapter activation remains deferred to C9C3, so
the active canonical stepper stays fail-closed while C9C2 is reviewed.
