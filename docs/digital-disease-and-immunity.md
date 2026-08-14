# Digital Disease and Immunity

`src/digital/digitalImmunity.ts` translates pathogens + social immunity into the
digital domain. It is **defensive only** — there is no offensive security
capability anywhere in Namla.

## Threats (digital disease)

`ThreatKind` covers prompt injection, poisoned knowledge, secret leakage,
malicious artifacts, vulnerable dependencies, false-success claims, unreliable
provider output, unsafe command suggestions, and stale architectural
assumptions. A threat enters the colony as real `securityRisk`, **collected** from
the environment (a legitimate source event, like a pathogen exposure) — never
minted from nowhere.

## Traceable local transmission

A poisoned parcel can poison a **co-located** parcel along a traced exposure path
(`tryTransmitThreat` returns a `TransmissionEdge` with `fromParcelId`,
`toParcelId`, `tick`). Transmission is never global: it follows the same locality
as verification and trophallaxis, so the spread is bounded and auditable
(`transmissionEdges`).

## Immune responses

- **Security workers** (senior-only `securing` task) detect local risk.
- **Quarantine** — `quarantineThreat` moves the risk and any poisoned material
  into the ledger's `quarantined` sink (`securityRiskQuarantined`,
  `quarantinedArtifacts`); it never deletes history.
- **Independent review + test evidence** — the review/test transforms are the
  everyday immune inspection; a poisoned or low-confidence artifact is far more
  likely to be rejected.
- **Contradiction detection** — `detectFalseSuccess` flags a high-confidence
  claim contradicted by weak evidence.
- **Reduced trust** — `penalizeTrust` downgrades a worker that produced or
  forwarded a threat (evidence-driven, bounded).
- **Remediation** — every detection records a `remediationActions` event.
- **Provider isolation + human approval** — real providers stay capped and
  human-gated (see the federation + provider docs); this milestone makes **0**
  provider calls.

## Boundaries

No offensive capability, no exploitation, no attack tooling. The immune system
only **detects, isolates, downgrades, and remediates** — and keeps immutable
audit references rather than silently deleting anything.
