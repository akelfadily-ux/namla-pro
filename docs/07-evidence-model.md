# 07 · Evidence model

Evidence is typed. "Evidence" is not a synonym for "anything an agent said".

## Evidence types

| Type | Meaning | Trust |
|---|---|---|
| `Claim` | assertion from agent/provider | untrusted |
| `Attestation` | mechanically observed fact | trusted according to observation boundary |
| `Assessment` | semantic/policy interpretation | evaluated, not mechanical truth |
| `GateVerdict` | NAMLA LOOP decision | authoritative for that gate/version only |
| `HumanDecisionRecord` | explicit scoped human decision | authority only within recorded scope |
| `EvidenceInvalidationEvent` | append-only record that previous proof is stale | derived from changed bindings |

The Trusted Kernel can create trusted mechanical attestations. It does **not** magically know semantic truth.

## Append-only store

Historical records are never mutated to make them "invalid". Staleness is derived from bindings plus invalidation/supersession events.

## EvidenceDependencyGraph

Each GateVerdict binds to:
- ArtifactIdentity
- relevant input identities
- PlanContract clauses/version where applicable
- policy versions
- EnvironmentIdentity
- required Attestations and Assessments

After change, compute the **minimal stale verification frontier**. In a linear chain this may be one earliest gate; parallel work may produce several frontier gates.
