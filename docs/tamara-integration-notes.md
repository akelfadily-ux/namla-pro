# Tamara Integration Notes

## Status: not implemented, not designed in detail

Tamara integration is scheduled as **Phase 10** in
[roadmap.md](./roadmap.md), well after execution capability (Phases 3, 8, 9)
and multi-agent simulation (Phase 6) are in place. Nothing in this
repository currently references, connects to, or assumes the existence of
Tamara as a live system. This document exists so that when Tamara
integration is eventually scoped, there is one place recording the open
questions instead of scattering assumptions across the codebase.

## Why Tamara integration comes late in the roadmap

The colony's safety model (`SafetyGuard`, the policy layer, receipts) is
designed to be proven out on lower-stakes, easily-reversible phases first —
read-only inspection, planning, controlled code generation, testing. Any
integration with an external system (Tamara or otherwise) should only happen
once:

1. The colony has a track record of correctly refusing unsafe actions in
   simpler contexts.
2. There is a concrete, reviewed adapter pattern (`ToolAdapter` and its
   descendants) that an external integration can be built on top of, rather
   than as a one-off special case.
3. Execution itself (Phases 8/9) has already had its own dedicated safety
   design pass, since an external integration is very likely to eventually
   want to *do* something, not just observe.

## What "future Tamara integration" likely means

At a conceptual level — without committing to specifics that aren't decided
yet — a Tamara integration would probably take the shape of either:

- A new `ToolAdapter` implementation (alongside `CommandAdapter` and
  `FileAdapter`) that lets ants plan Tamara-directed actions, gated by the
  same `BodyExecutionPolicy` pattern used elsewhere, or
- A new digital sense or pheromone source, if Tamara is primarily a source
  of information/events for the colony to react to rather than a target of
  action.

Both shapes are compatible with the existing architecture without requiring
structural changes — that compatibility is exactly why this document doesn't
need to predict which one it will be yet.

## Open questions to resolve before Phase 10 starts

- What is Tamara, concretely, in terms of API surface, auth model, and
  blast radius if misused?
- Is the integration read-only, write-capable, or both?
- Does it require credentials? If so, `SecretProtectionPolicy` and the "no
  `.env`/credentials" law need an explicit, reviewed answer for how
  credentials would be supplied without ever being read, logged, or stored
  by an ant.
- What is the smallest safe first slice — likely a read-only sense or
  pheromone source, mirroring how Phase 1 (inspector) precedes Phase 3
  (generation) for the local filesystem.

## What NOT to do before Phase 10

Do not add Tamara-specific types, adapters, environment variables, or
credentials to this repository in Phase 0 through Phase 9. This file is a
placeholder for future scoping, not an invitation to start early.
