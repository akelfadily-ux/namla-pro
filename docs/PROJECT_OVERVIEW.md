# Namla Pro — Project Overview

Technical documentation for a reader who wants to understand the project in 10–15 minutes without reading the source.

---

## 1. Problem

Systems that let AI agents write software face a tension that gets worse as the number of agents grows.

To be useful, an agent must be able to write files, run tests, install packages and invoke tools. Every one of those is arbitrary code execution: `npm test` runs whatever a generated `package.json` puts in `scripts`, and a generated file can be written anywhere the process has permission to write. The usual mitigations — an allowlist of commands, a temporary directory, a subprocess timeout — do not contain arbitrary code. An allowlist of npm subcommands does not make the underlying script safe.

Multiple agents make this harder in three specific ways:

1. **Authority multiplies.** Every additional agent is another path to the same host.
2. **Attribution weakens.** When something goes wrong across a dozen agents, the question "which agent did this, under what authorization?" must be answerable afterwards from a record, not reconstructed.
3. **Coordination cost grows.** Direct messaging between *n* agents scales badly and creates a central component that must be trusted with the full picture.

Most agent frameworks answer the coordination problem and treat containment as a deployment concern. Namla Pro treats them as one problem.

---

## 2. Engineering question

> How can a colony of specialized agents coordinate on a software-engineering mission while every action capable of affecting the host passes through a small number of boundaries that refuse by default and record what they refused?

Three sub-questions follow:

- **Coordination.** Can useful task allocation happen without a central controller holding a global plan?
- **Containment.** Can the set of components with real authority be kept small enough to audit exhaustively?
- **Evidence.** Can the system produce a record that distinguishes "this was verified" from "this was assumed", including for its own security properties?

---

## 3. Design goals

| Goal | Consequence in the code |
|---|---|
| Decentralized coordination, centralized authority | Agents coordinate stigmergically; every real action funnels through a handful of enforcement modules |
| Fail closed, never fall back | No host-execution fallback anywhere; a missing capability is an error, not a downgrade |
| Refusal is the observable behaviour | Every boundary is tested by watching it *refuse*, and non-vacuity is proven by temporarily breaking the fix |
| Evidence over assertion | Receipts carry reason codes and fingerprints, never raw output, host paths or credentials |
| Detection is not verification | A capability may only be claimed if a probe observed it, not because a flag was set |
| Honest reporting | An unknown is `null`, never `0`; an unproven capability is `false`, never assumed |

The last two are the reason several capabilities in this repository are reported as *unavailable* rather than *working*. That is intentional.

---

## 4. Architecture

Two layers with a hard line between them.

### 4.1 Deterministic runtime

Performs no real action. It plans, coordinates, generates proposals and reviews them. It has no filesystem, process or network authority at all, which is why the whole layer can be run offline and reproduced.

- **`ColonyEngine.runMission()`** (`src/engine/colonyEngine.ts`) is the canonical entry point. It accepts a mission, an agent roster and optional snapshot/capabilities, and returns a `MissionRunReport` with the full receipt trail. The older `AntQueen` remains as a compatibility façade delegating to the same engine.
- **Planning** decomposes a mission into ordered tasks.
- **Agents** (`src/ants/`) are specialized and persistent, carrying role, generation, trust level, capabilities and energy.
- **The pheromone bus** (`src/core/pheromoneBus.ts`, `src/pheromones/`) is a signal space with decay, reinforcement and query — the stigmergic coordination substrate.
- **Senses** (`src/senses/`) turn raw context into typed readings so an agent decides from structured local information.
- **Proposals** (`src/generation/`) are data. Nothing self-applies; `applied` is typed `false` until a human-approved path changes it.

### 4.2 Enforcement boundaries

Everything that can touch the host. Small enough to audit exhaustively, and each one fails closed.

| Boundary | Module | Guarantee |
|---|---|---|
| Path containment | `safeWorkspacePath.ts` | One containment implementation; every write, read, delete and rename re-validated immediately before the operation |
| Mount source validation | `safeMountSource.ts` | A Docker bind-mount source is canonical, contained in a separately configured root, not a symlink, and cannot inject mount options |
| Sandbox policy | `sandboxPolicy.ts` | High-risk execution requires `available-and-verified`; issues a single-use permit whose authority is object identity |
| Container backend | `containerSandboxBackend.ts` | Non-root, `no-new-privileges`, all capabilities dropped, private PID/IPC, read-only root, resource limits, network denied |
| Network policy | `verificationSandbox.ts` | Only `denied` is enforceable; narrower-than-open modes are refused rather than widened |
| Outbound provider requests | `safeProviderRequest.ts` | Credentials block a request rather than being redacted and sent; argv and child environment built from fixed templates |
| Secret redaction | `safeRedactor.ts` | Exact registered values scrubbed before pattern matching; fingerprints computed only after redaction |
| Trusted executables | `trustedExecutableRegistry.ts` | Absolute paths only; PATH-shadowed and workspace-local executables refused |
| Process trees | `processTree.ts` | Whole-tree termination with identity verified before signalling |
| File creation | `projectFileCreator.ts` | Exclusive create only; target derived from the approved path and fingerprint-bound to the inspection |

### 4.3 Trust boundaries in order

```
human confirmation (typed phrase, interactive TTY)
  → single-use permit, scoped to provider/mission/task/agent/workspace
  → policy gate: capability must be available-and-verified
  → container: non-root, read-only root, no network, one writable mount
  → receipt: reason codes and fingerprints only
```

A request that fails at any stage stops there. There is no path that continues with reduced guarantees.

---

## 5. Execution model

Three execution modes, deliberately distinct:

| Mode | What runs | Where it is used |
|---|---|---|
| **Deterministic** | Nothing real. In-memory simulation. | All 41 golden demos, `npm run demo`, most of the test suite |
| **Gated real** | Real processes, files or providers behind a permit | Live CLIs, requiring typed human confirmation |
| **Verified sandboxed** | Real execution inside a proven container | CI only at present |

The reason the distinction is enforced in types rather than convention: `simulated`/`executed` flags are literal types on the relevant records, so a simulated result cannot be typed as an executed one.

### Deterministic vs real

A demo reporting `realProviderCalls: 0`, `realNetworkCalls: 0`, `realFilesystemWrites: 0` and `processExecutions: 0` is making a checked claim, not a stylistic one — those counters are incremented by the real drivers, so a non-zero value would surface. The Twin Empire demo reports all four as zero.

---

## 6. Major subsystems

- **`colony/`, `colonyMission/`** — colony lifecycle, genesis, scaling, and mission execution with cognitive workers.
- **`civilization/`** — district and council coordination, and an MCP execution layer with real and fake drivers.
- **`digital/`** — objective runtime, verification, review and repair loops.
- **`twin/`** — Twin Empire differential verification (below).
- **`academy/`** — agent training, evaluation and skill passports.
- **`application/`, `inspector/`** — approval contracts and read-only project inspection.

### Twin Empire

The most substantial single result. Two isolated colonies (`claude-forge`, `codex-crucible`) receive the same objective and work independently. Each produces a **frozen evidence bundle**; a **silent witness** observes receipts for cross-colony leakage; the bundles are **cross-examined**, contradictions are surfaced and decisive tests generated; and a **court** renders one decision on evidence.

It additionally checks properties most agent systems do not:

- **Fabricated test evidence detection** — a colony claiming a test passed without evidence is caught.
- **Leakage quarantine** — cross-colony information flow is detected and blocked.
- **Conservation and causality** — unexplained resource creation is flagged.
- **Delivery claim labelling** — no unlabelled claim reaches a customer-facing summary.

Provider cognition is deliberately not connected: bundles come from deterministic forges, so the isolation, freeze, witness and court mechanics can be proven with zero real action.

---

## 7. Current evidence

| Evidence | Result |
|---|---|
| TypeScript (strict) | 0 errors |
| P0 security gate | 398 passed, 0 failed, 3 skipped (20 suites) |
| Golden regression harness | 41 demos, 1128 expectation checks, 0 failures |
| CI matrix | `ubuntu-latest`, `windows-latest`, `macos-latest` — all green |
| Container isolation | Verified inside a real container on the ubuntu CI leg: `available-and-verified` (*Real container sandbox (isolation verification)* job in `.github/workflows/p0-security.yml`) |
| Scope | 360 TypeScript files, ~66,000 lines, 49 demos |

The three local skips are Windows file-symlink privilege limitations; on the POSIX CI legs a skip in those tests is treated as a failure, so they cannot silently vanish.

### Methodology note

Security fixes in this project follow a discipline worth stating: after a fix, the fix is **temporarily reverted** and the new tests must fail. A test that passes both with and without the fix proves nothing. This caught at least one genuinely vacuous test — a self-authorization check that passed on a machine without Docker for entirely the wrong reason.

---

## 8. Limitations

- **Experimental alpha.** Not production software; not a production autonomous coding platform.
- **Simulation is not evidence about the real world.** The deterministic layer proves the coordination logic behaves as specified. It does not show that agents produce good software.
- **Live provider execution is blocked.** `provider-only` networking has no enforcement mechanism here and fails closed rather than being approximated by an unrestricted bridge.
- **Verification is unavailable outside CI.** No production composition root supplies a verified sandbox yet.
- **The container image is not digest-pinned.**
- **Architectural debt.** Overlapping orchestration across `colony`, `colonyMission`, `civilization`, `digital` and `twin`, documented in `runtime-spine.md`.
- **Open security findings.** Redaction pattern coverage and heuristic secret detection remain unresolved.
- **Single-author research prototype**, developed against a self-imposed build law rather than an external standard.

---

## 9. Future work

Ordered by what would most increase what the system can honestly claim:

1. **Egress enforcement** — a real mechanism (filtered namespace, egress proxy, per-destination rules) so `provider-only` becomes enforceable rather than refused. This is what currently blocks live provider execution under the sandbox.
2. **Digest-pinned images** so the verified container is provably the one that was tested.
3. **A production composition root** that can supply a verified sandbox outside CI.
4. **Consolidating orchestration** onto the canonical spine and retiring legacy paths.
5. **Completing the remaining security findings** (redaction coverage, heuristic secret detection).
6. **Empirical evaluation** — whether multi-agent differential verification actually produces better software than a single agent, which the architecture enables but has not measured.

Item 6 is the one that would turn this from an engineering prototype into a research result.
