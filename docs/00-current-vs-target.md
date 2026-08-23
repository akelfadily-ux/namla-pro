# 00 · Current implementation vs target V2

This document prevents the most dangerous documentation error: describing TARGET architecture as though it is CURRENT code.

## CURRENT — multiple implementation families

The current repository contains several substantial orchestration/runtime families. They are not represented as one import chain unless source evidence proves one.

```mermaid
flowchart LR
    CLI["CLI entry points"] --> ENG["src/engine/ColonyEngine"]
    ENG --> SIM["src/simulation/ColonySimulation"]

    CLI --> CM["src/colonyMission/*"]
    CLI --> DIG["src/digital/*"]
    CLI --> CIV["src/civilization/*"]
    CLI --> TWIN["src/twin/*"]
    CLI --> ACAD["src/academy/*"]

    COL["src/colony/*<br/>separate substantial colony runtime family"]

    COG["src/cognitive/*<br/>provider execution · sandbox · permits · network · workspace"]
    APP["src/application/*<br/>approval / write-boundary primitives"]
    CORE["src/core/*<br/>SafetyGuard · ReceiptLog · shared primitives"]
    GATE["src/gateway/*<br/>provider / gateway components"]

    CM -. selected services .-> COG
    DIG -. selected services .-> COG
    CIV -. selected services .-> COG
    TWIN -. selected services .-> COG
    ACAD -. selected services .-> COG
```

Important factual constraints:

- `ColonyEngine` currently delegates to `src/simulation/colonySimulation.ts`; therefore `src/simulation/` is not an immediate deletion target.
- `src/colony/` is a separate substantial family with ant intelligence, mind, population, teams, budgets, lifecycle, knowledge, invariants, and related code. It requires a rescue audit.
- `src/cognitive/safeProviderRequest.ts` is the outbound provider-request boundary. `liveProviderExecution.ts` imports and uses it.
- Current CLI/runtime paths do not all pass through `ColonyEngine`.

## TARGET — one runtime

```mermaid
flowchart TB
    OBJ["User Objective"] --> R["NamlaRuntime"]
    R --> CP["Control Plane"]
    CP --> AB["Colony A ∥ Colony B"]
    AB --> V["Son → Leggo → ProMax → Lab"]
    R --- LOOP["NAMLA LOOP"]
    R --- TK["Trusted Kernel"]
    R --- EV["Evidence Plane"]
    R --- ST["Mission State Plane"]
```

V2 permits extensions and workers, but **not additional top-level runtimes**.

## Migration state

V2 is a target architecture. Migration uses:

`RESCUE → EXTRACT → REPLACE → VERIFY → REMOVE`

A legacy component is removed only after its replacement has dependency proof, required parity proof, security-regression proof, and recorded evidence.
