# Digital Trophallaxis

`src/digital/digitalTrophallaxis.ts` is the digital analogue of mouth-to-mouth
food sharing: **bounded, local** knowledge/context transfer between co-located
workers. It is the mechanism by which knowledge spreads through the colony
without a broadcast bus or a central memory dump.

## What may be exchanged

Bounded context summaries, verified-knowledge references, artifact references,
failure summaries, review/test evidence, uncertainty, and help requests — all as
**references with provenance and confidence attached**, never as raw private
worker reasoning.

## Rules (all enforced mechanically)

- **Locality** — only workers on the **same team** may exchange; the network is
  per-team, never all-to-all, so it stays bounded at 300 / 1,000 / 10,000
  identities.
- **Possession** — the sender must actually hold the shared knowledge
  (`holderIds`); you cannot forward what you do not have.
- **Bounded intake** — a receiver with insufficient communication bandwidth
  refuses the transfer (counted as `refused`).
- **Real cost** — each exchange consumes the sender's bandwidth and a little
  shared `workingContext` (a conserving `economy.consume`), plus a touch of the
  receiver's cognitive energy. Sharing is not free.
- **Per-worker cap** — at most `maxTrophallaxisPerWorker` exchanges per round.
- **No broadcast** — the full colony memory is never dumped; each round delivers
  at most one reference to each receiving worker.
- **Provenance travels** — confidence + lineage accompany every reference; stale
  or unverified references may be refused.

## Reuse

Workers that receive a knowledge reference become **reuse candidates**: when such
a worker subsequently builds an artifact, the runner counts `knowledgeReused`.
This ties the "sharing → reuse" chain to real downstream events rather than a
bare counter.

## Evidence

`digitalTrophallaxisEvents > 0` always coincides with `bandwidthConsumed > 0`
(the causal check `trophallaxis-bounded`), and the transfer volume is bounded by
team size × per-worker cap × available bandwidth — never unbounded.
