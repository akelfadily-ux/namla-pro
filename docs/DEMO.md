# Namla Pro — Reviewer Demo

A five-minute hands-on validation. Everything below runs offline: **no credentials, no network, no container runtime, no paid provider.** Nothing outside the OS temporary directory is written.

Requires Node 20 or newer.

---

## 1. Build

```bash
npm install
npm run typecheck
npm run build
```

`npm run typecheck` runs TypeScript in strict mode and must report zero errors. `npm install` fetches only two dev dependencies (TypeScript and `@types/node`); the project has no runtime dependencies.

---

## 2. Run the safe demonstration

```bash
npm run demo
```

This submits a mission the demo itself defines through the canonical public runtime (`ColonyEngine.runMission`), shows the proposal pipeline and the safety classifier, then asks five independent security boundaries to do something unsafe and records what each one did.

Expected output:

```json
{
  "missionRequested": {
    "missionId": "mission-reviewer-demo",
    "title": "Document the runtime spine for new operators",
    "objective": "Write operator documentation describing how a mission flows through the canonical runtime and which review steps it passes.",
    "goals": [ "Describe the canonical mission path end to end", "Summarize the review steps a proposal passes before it is accepted" ],
    "rosterRoles": ["scout", "planner", "builder", "tester", "auditor", "messenger"]
  },
  "coordination": {
    "missionId": "mission-reviewer-demo",
    "missionAccepted": true,
    "missionStatus": "completed",
    "tasksBlockedBySafety": 0,
    "participatingAgents": [
      "auditor-reviewer", "builder-reviewer", "messenger-reviewer",
      "planner-reviewer", "scout-reviewer", "tester-reviewer"
    ],
    "tasksProcessed": 11,
    "ticksUsed": 11,
    "receiptsWritten": 16,
    "pheromonesActive": 13,
    "semanticallyDeterministic": true
  },
  "reviewPipeline": {
    "proposalsCreated": 2,
    "proposalsApplied": 0,
    "allProposalsUnapplied": true
  },
  "safetyDecision": {
    "benignRequestLevel": "SAFE",
    "benignRequestAllowed": true,
    "destructiveRequestLevel": "FORBIDDEN",
    "destructiveRequestAllowed": false,
    "destructiveRefusalReasons": ["forbidden-indicators", "forbidden-indicators", "risky-indicators"]
  },
  "containment": {
    "workspaceEscapeRefused": "path-traversal",
    "highRiskExecutionRefused": "sandbox-runtime-unavailable",
    "verificationWithoutSandboxRefused": "sandbox-runtime-unavailable",
    "credentialInPromptRefused": "provider-request-secret-blocked",
    "registeredSecretRedacted": true
  },
  "environment": {
    "containerRuntimeState": "unavailable",
    "containerRuntimeVerified": false
  },
  "boundariesObservedRefusing": 5,
  "allBoundariesHeld": true
}
```

`containerRuntimeState` will read `available-unverified` instead of `unavailable` on a machine with Docker installed. That is the correct result: detection is not verification, and `containerRuntimeVerified` stays `false` either way.

---

## 3. What to observe

**** is the demo's own INPUT — the objective it submitted. It is reported separately from the runtime's outputs so the two are never confused; the runtime does not return an objective, and none is reconstructed.

**Coordination** shows the multi-agent runtime actually running, every figure read from the returned `MissionRunReport`:

- `participatingAgents` — the specialized workers that actually took part, read from the receipt trail rather than the roster, so it reports who *participated* and not merely who was available. The division of labour (scout, planner, builder, tester, auditor, messenger) is the colony model in practice.
- `tasksProcessed: 11` over `ticksUsed: 11` — the mission was decomposed and worked by those agents across discrete ticks, with `tasksBlockedBySafety: 0`.
- `pheromonesActive: 13` — agents coordinated through the stigmergic signal space, not by direct messaging.
- `receiptsWritten: 16` — every step produced an evidence record.
- `semanticallyDeterministic: true` — the demo is run twice and the two *digests* are compared. Runs are not byte-identical (receipt ids are UUIDs, timestamps are wall-clock, counters are process-global); what is stable is the meaning — counts, statuses, reason codes and invariant flags. This is the same digest mechanism the golden harness uses.

**The proposal pipeline** shows generated code treated as data: `proposalsCreated: 2` were produced and `proposalsApplied: 0` were applied. `allProposalsUnapplied: true` is the load-bearing field — nothing self-applies. A system that applied its own proposals would report `false` here.

**The safety decision** shows the classifier discriminating rather than merely refusing. The same `SafetyGuard` is given two inputs: an ordinary engineering request is admitted (`SAFE`, allowed), and a destructive one is refused (`FORBIDDEN`, not allowed) with named reason codes. Showing only a refusal would not prove it discriminates; showing only an acceptance would not prove it refuses.

**Containment** is the most important section. Each field is a **reason code returned by a boundary that refused**, not a hard-coded string:

| Field | What was attempted | Why the refusal matters |
|---|---|---|
| `workspaceEscapeRefused` | write to `../../etc/passwd` from an authorized workspace | path traversal out of a bounded workspace |
| `highRiskExecutionRefused` | run `npm test` under the sandbox gate | arbitrary code execution without verified isolation |
| `verificationWithoutSandboxRefused` | run a verification command with no sandbox injected | no host-execution fallback exists |
| `credentialInPromptRefused` | send a prompt containing an API key to a provider | the request is blocked entirely, not redacted and sent |
| `registeredSecretRedacted` | print a registered credential value into text | exact-value scrubbing works where pattern matching would not |

A boundary that has only ever been observed succeeding proves nothing. `allBoundariesHeld: true` means all five were observed **refusing**.

`allBoundariesHeld: true` additionally requires the run to have been semantically deterministic and to have applied nothing.

---

## 4. Run the security suite

```bash
npm run test:p0
```

Expected: **398 passed, 0 failed, 3 skipped** across 20 suites, ending with

```
P0 security gate PASSED on <platform>: 398 passed, 0 failed, 3 skipped.
```

The three skips are Windows file-symlink privilege limitations, each carrying an explicit reason. They are **not** skipped on Linux or macOS — `.github/workflows/p0-security.yml` treats a skip in those tests as a failure on the POSIX legs, so a platform-limited test cannot quietly disappear.

To see the semantic regression harness — 41 demos checked against recorded baselines:

```bash
node dist/examples/demoGoldenOutputs.js
```

Expected: `"allGoldensPassed": true` with 1128 expectation checks and 0 failures.

---

## 5. Architecture files worth reading

If you read nothing else, read these five:

1. [`src/engine/colonyEngine.ts`](../src/engine/colonyEngine.ts) — the canonical runtime. One public entry point, `runMission(request)`, returning a report with the full receipt trail.
2. [`src/cognitive/sandboxPolicy.ts`](../src/cognitive/sandboxPolicy.ts) — the policy gate. Shows the three capability states and why only `available-and-verified` authorizes execution.
3. [`src/cognitive/containerSandboxBackend.ts`](../src/cognitive/containerSandboxBackend.ts) — the real container backend, and the argument template with every isolation flag.
4. [`src/cognitive/safeMountSource.ts`](../src/cognitive/safeMountSource.ts) — a representative trust boundary: how a host path is proven before Docker ever sees it.
5. [`docs/runtime-spine.md`](./runtime-spine.md) — which runtime path is canonical, what is legacy, and which architectural debt is deliberately still open.

For the wider picture, [`docs/PROJECT_OVERVIEW.md`](./PROJECT_OVERVIEW.md) then [`docs/architecture.md`](./architecture.md).

---

## 6. What is intentionally disabled

None of the following runs in the demo path, and none should be run during a review:

| Command | Why it is excluded |
|---|---|
| `npm run twin:live` | Real Twin Empire execution — invokes paid provider CLIs and mutates a workspace |
| `npm run twin:resume` | Resumes a real live run |
| `npm run civilization:live` | Real multi-agent live session with provider calls |
| `npm run digital:live-objective` | Real live objective with workspace mutation |
| `npm run academy:real-pilot` | Real provider pilot |
| `npm run colony:real-smoke` | Real provider smoke test |

Each requires an interactive TTY and an exactly-typed human confirmation phrase, and each mints a single-use permit scoped to one provider, mission, task, agent and workspace. They are excluded here because they cost money and touch the host — not because they are unfinished.

Two things additionally fail closed on a normal machine, by design rather than by omission:

- **Verification commands** (`typecheck`, `test`, `build` inside the sandbox) refuse, because no production composition root can currently supply a *verified* sandbox. You will see `sandbox-runtime-unavailable`.
- **Provider execution under the sandbox** refuses, because `provider-only` networking has no enforcement mechanism in this backend and an unrestricted Docker bridge is not accepted as a substitute.

Real container isolation is verified in CI only — see the `real-container-sandbox` job in [`.github/workflows/p0-security.yml`](../.github/workflows/p0-security.yml).
