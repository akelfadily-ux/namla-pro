# SAFETY INVARIANTS

Every mechanically verifiable safety invariant of Namla Pro, with the exact
command to re-verify it. Run these from the repository root (Git Bash /
POSIX shell; `grep` required). Every future phase's verification pass should
run this checklist and paste the results.

Convention: **PASS** means the command's output matches the stated
expectation exactly.

## 1. Filesystem

**Exactly three files import fs** — expect exactly three lines:
```
grep -rln 'from "fs"' src --include="*.ts"
```
Expected: `src/application/projectFileCreator.ts` (C2-B exclusive-create),
`src/inspector/projectInspector.ts` (read-only), and
`src/cognitive/smokeWorkspace.ts` (R2 human-only smoke workspace; Build Law §19).
No fourth fs importer. The R2 addition is **not a weakening**: the source tree is
still never written — `smokeWorkspace.ts` can only create
`workspaces/provider-smoke/...` and refuses traversal/absolute/source/protected
paths, and it is never imported by any automated demo or test.

**fs mutation APIs are confined to exactly two authorized modules** — expect
matches ONLY in `projectFileCreator.ts` (`openSync`/`writeSync`/`fsyncSync`/
`closeSync`) and `smokeWorkspace.ts` (`mkdirSync`/`writeFileSync`), and nowhere
else:
```
grep -rlnE "writeFile|writeFileSync|appendFile|mkdirSync|rmSync|unlinkSync|renameSync|copyFileSync|createWriteStream|truncateSync|chmodSync|openSync|writeSync" src --include="*.ts"
```
Expected exactly: `src/application/projectFileCreator.ts` and
`src/cognitive/smokeWorkspace.ts`.

## 2. Execution, network, time

**child_process is IMPORTED in exactly one module** — expect exactly one line,
the real provider process driver (Build Law §19). (Other cognitive files
mention the boundary in comments; the mechanical guarantee is about the import,
so this greps the import form.)
```
grep -rlnE 'from "child_process"|require\(["'"'"']child_process' src --include="*.ts"
```
Expected exactly: `src/cognitive/nodeProviderProcessDriver.ts` (uses
`spawnSync` with `shell: false`).

**No shell / exec / fork call anywhere** — expect no output:
```
grep -rnE "shell:\s*true|\bexecSync\b|\bexec\(|\bfork\(" src --include="*.ts"
```

**Zero network APIs** — expect no output:
```
grep -rnE "fetch\(|http\.|https\.|WebSocket|XMLHttpRequest|axios|net\.|dgram" src --include="*.ts"
```

**Zero timers / watchers** — expect no output (source comments deliberately
avoid naming these APIs so this check stays zero-output):
```
grep -rnE "setTimeout|setInterval|setImmediate|fs\.watch|watchFile" src --include="*.ts"
```

**Zero Worker threads** — expect no output:
```
grep -rnE "worker_threads|new Worker\(" src --include="*.ts"
```

**Zero git / package-manager execution in src** — expect no output (the
strings appear only in indicator lists and docs, never as executed
commands, which the child_process check above already precludes):
```
grep -rnE "execSync\(.*(git|npm|pip|winget)|spawn\(.*(git|npm|pip|winget)" src --include="*.ts"
```

## 3. Literal-typed safety fields

Each of these greps must find the literal type (not `boolean`):

```
grep -n "applied: false;" src/generation/codeProposal.ts src/git/gitStateModel.ts
grep -n "requiresHumanApproval: true;" src/generation/codeProposal.ts src/git/gitStateModel.ts src/bots/desktopActionTypes.ts
grep -n "simulated: true;" src/adapters/agentAdapterTypes.ts src/bots/desktopActionTypes.ts
grep -n "pushIntent: false;" src/git/gitStateModel.ts
grep -n "executed: false;" src/types/bodyTypes.ts src/bots/desktopActionTypes.ts
```
Expected: at least one match per file per field (desktopActionTypes carries
the simulated/executed pair on plans, steps, and narration lines). Also
expect NO occurrence of `executed: true` anywhere:
```
grep -rn "executed: true" src --include="*.ts"
```

## 4. Budgets

**Default autonomous budget is zero:**
```
grep -n "MAX_AUTONOMOUS_STEPS_PHASE_0 = 0" src/policies/autonomousLoopPolicy.ts
```

**Simulation budget is hard-capped (code constant, tighten-only):**
```
grep -n "SIMULATION_MAX_VIRTUAL_STEPS = 100" src/policies/autonomousLoopPolicy.ts
grep -n "Math.min" src/simulation/antScheduler.ts
```

**`process.env` is read in exactly one module** — Namla behavior is never
environment-configured; the only reader is the real provider driver (Build Law
§19), which reads named values by key (never enumerates) to forward a minimal
allowlist to the child process, dropping credential-shaped names:
```
grep -rln "process\.env\[" src --include="*.ts"
```
Expected exactly: `src/cognitive/nodeProviderProcessDriver.ts`. No module uses
`process.env` to configure Namla's own runtime behavior.

## 5. Receipt discipline

**Summary literals avoid SecretProtectionPolicy indicators** (the
reason-literal rule: `ReceiptLog` throws on summaries matching
`looksLikeSecret`, so no summary literal may contain these substrings even
in harmless sentences) — expect no output:
```
grep -rhoE 'summary: [`"'"'"'][^`"'"'"']*[`"'"'"']' src --include="*.ts" | grep -iE "secret|token|credential|password|private key|api key|apikey|\.env|-----begin|authorization"
```

**Refusal receipts carry redacted metadata only.** Refused paths, prompts,
commands, and messages appear as lengths and fingerprints via the shared
helper — expect `src/core/redaction.ts` plus its four consumers:
```
grep -rln "from \"../core/redaction\"" src --include="*.ts"
```
Expected: `src/adapters/agentAdapterBase.ts`,
`src/generation/proposalFactory.ts`, `src/git/commitProposalFactory.ts`,
`src/inspector/projectInspector.ts`

**Receipt minting is ReceiptLog-only** (AH2 Step 4C). Ant façades return
`AntFacadeTrace` objects with `traceId`s; the old pseudo-receipt pattern of
minting `` receiptId: `receipt-...` `` template ids outside the log must
not reappear — expect no output:
```
grep -rn 'receiptId: `' src --include="*.ts"
```
(Interfaces declare `receiptId: string` fields and consumers copy real ids
into them; only `src/core/receiptLog.ts` assigns new ones.)

**Capability C0 remains data-only** — the `src/application/` module set
imports no `fs` and no other capability primitive, the integrity authority
uses full SHA-256 (not the shortened display fingerprint), the approval
verifier binds proposal id + path + content + change kind + review
metadata into the fingerprint, the grant scope is fixed to a single file,
the C0 demo advertises zero writes and executed:false, and no
NAMLA_BUILD_LAW create-write amendment exists:
```
grep -rln "from \"fs\"\|from 'fs'" src/application
grep -c "computeIntegrityFingerprint" src/application/proposalIntegrity.ts
grep -c "\"create-one-project-file\"" src/application/createCapabilityTypes.ts
grep -c "writeApiCount: 0\|filesCreatedByCapability: 0" src/examples/demoCreateApprovalContracts.ts
grep -c "create-one-project-file" NAMLA_BUILD_LAW.md
```
Expected: no output from the first (no fs imports in `src/application/`);
`1` from the second; `1` from the third; `2` from the fourth; `0` from
the fifth.

**Capability C1 remains a read-only dry run** — the C1 application modules
(the dry-run evaluator and the inspection types) import no `fs`; the only
filesystem contact is `ProjectInspector.inspectCreateTarget`, still the
sole fs importer; the dry-run result is literal-typed as non-writing and
non-authoritative; the evaluator never consumes the grant; there is no
directory-creation authority anywhere; the demo advertises zero writes and
zero mutation; the dry-run harness is process-free; and no NAMLA_BUILD_LAW
write amendment exists:
```
grep -rln "from \"fs\"\|from 'fs'" src/application
grep -c "simulated: true;" src/application/projectCreateDryRun.ts
grep -c "executed: false;" src/application/projectCreateDryRun.ts
grep -c "writePerformed: false;" src/application/projectCreateDryRun.ts
grep -c "writeAuthorized: false;" src/application/projectCreateDryRun.ts
grep -c "authoritativeForWrite: false;" src/application/projectCreateDryRun.ts
grep -c "requiresFreshC2Revalidation: true;" src/application/projectCreateDryRun.ts
grep -c "consumedGrantIds" src/application/projectCreateDryRun.ts
grep -rnE "mkdirSync|mkdir\(|mkdtemp" src --include="*.ts"
grep -c "filesCreatedByCapability: 0\|mutationApiCount: 0" src/examples/demoCreateDryRun.ts
grep -nE "child_process|spawn\(|exec\(|execSync" src/examples/demoCreateDryRun.ts
grep -cE "inspectCreateTarget|create-one-project-file" NAMLA_BUILD_LAW.md
```
Expected: no output from the first (no fs imports in `src/application/`);
`1` from each of the six literal-field greps; `0` from the `consumedGrantIds`
grep; no output from the `mkdir` grep; `2` from the demo grep; no output
from the harness `child_process` grep; `0` from the Build Law grep.
(`ProjectInspector.inspectCreateTarget` reads metadata only — existence,
`lstat`, listing, and `realpath` — and no file content; the only content
read in the inspector remains the Phase 1 `readSmallTextFile`, which C1 does
not use.)

**Capability C2-A contracts remain intact** — the strict C2 policy, the
exact-byte refusals, and the default-off permit minted only by the bootstrap
are unchanged; the production runtime cannot reach the authority/creator
modules; only the bootstrap references the internal mint hook (besides its
defining module); and neither the admission evaluator nor the bootstrap
consumes a grant (consumption is a C2-B creator behavior — see the C2-B
block); the Build Law C2-A amendment exists and defers activation to a
separately-authorized C2-C; and the quarantine directory exists:
```
grep -nE "from \"fs\"|from 'fs'|process\.env|child_process|http|https|net\.|fetch\(" src/bootstrap/c2WriteAuthorityBootstrap.ts
grep -rnE "writeAuthority|c2WriteAuthorityBootstrap|projectFileCreator|writeAttemptAdmission" src/engine src/ants src/adapters --include="*.ts"
grep -rln "mintWriteAuthorityPermitInternal" src --include="*.ts"
grep -rnE "\.consume\(" src/application/writeAttemptAdmission.ts src/bootstrap
grep -c 'C2_ALLOWED_DIRECTORY = "docs/generated/"' src/application/c2CreatePolicy.ts
grep -c 'C2_ALLOWED_EXTENSION = ".md"' src/application/c2CreatePolicy.ts
grep -c "MAX_C2_CREATE_BYTES = 65536" src/application/c2CreatePolicy.ts
grep -cE "bom-not-allowed|nul-not-allowed|carriage-return-not-allowed|control-char-not-allowed|unpaired-high-surrogate|unpaired-low-surrogate" src/application/exactContentBytes.ts
grep -c "Capability C2-A conditional amendment" NAMLA_BUILD_LAW.md
grep -c "separate explicit human instruction" NAMLA_BUILD_LAW.md
ls docs/generated/README.md
node dist/examples/demoC2AuthorityContracts.js
```
Expected: no output from the bootstrap grep; no output from the engine/ants/
adapters grep; the mint-hook grep returns exactly
`src/application/writeAuthority.ts` and
`src/bootstrap/c2WriteAuthorityBootstrap.ts`; no output from the `.consume(`
grep (admission and bootstrap never consume); `1` from each of the
directory/extension/byte-cap greps; `6` (or more) from the exact-byte-refusal
grep; `1` from each Build Law grep; the `ls` shows the README; and the demo
reports `allExpectationsMet: true`, `forgedPermitAcceptedCount: 0`,
`grantConsumedByC2A: false`, `filesCreatedByCapability: 0`, and
`receiptCrashCount: 0`.

**Capability C2-B installs the exclusive-create primitive (inactive)** —
`ProjectFileCreator` is the second fs importer and imports ONLY
`openSync`/`writeSync`/`fsyncSync`/`closeSync`; `openSync` uses the literal
`"wx"`; those four call forms appear only inside `projectFileCreator.ts`; the
real Node driver is module-private (`nodeExclusiveCreateDriver`, named only
there) with no exported execution path and no top-level invocation; the
production runtime has no import path to the creator; and the demo drives the
full lifecycle with an injected fake driver, so the real driver is never
invoked and no real write executes:
```
grep -rln 'from "fs"' src --include="*.ts"
grep -c 'import { openSync, writeSync, fsyncSync, closeSync } from "fs"' src/application/projectFileCreator.ts
grep -c 'openSync(' src/application/projectFileCreator.ts
grep -c '"wx"' src/application/projectFileCreator.ts
grep -rlnE "openSync\(|writeSync\(|fsyncSync\(|closeSync\(" src --include="*.ts"
grep -rln "nodeExclusiveCreateDriver" src --include="*.ts"
grep -rnE "projectFileCreator|createProjectFile|getRealNodeDriverInvocationCount|nodeExclusiveCreateDriver" src/engine src/ants src/adapters --include="*.ts"
node dist/examples/demoC2ExclusiveCreateSimulation.js
```
Expected: the first grep returns exactly `src/application/projectFileCreator.ts`
and `src/inspector/projectInspector.ts`; `1` from the projectFileCreator fs
import grep; `openSync(` and `"wx"` each appear (`>= 1`) in
projectFileCreator; the authorized-call grep and the
`nodeExclusiveCreateDriver` grep each return ONLY
`src/application/projectFileCreator.ts`; no output from the engine/ants/
adapters grep (no production import path); and the demo reports
`allExpectationsMet: true`, `admittedAttemptCount: 11`,
`grantsConsumedCount: 11`, `preAdmissionConsumptionCount: 0`,
`finalInspectionConsumptionCount: 0`, `replayRefusalCount: 3`,
`residualArtifactCases: 7`, `receiptFailureCases: 1`,
`successfulLifecycleCases: 1`, `exactBytesPreserved: true`,
`realNodeDriverInvocationCount: 0`, `realFilesystemWriteExecutionCount: 0`,
`filesCreatedByCapability: 0`, `fsImporterCount: 2`,
`unauthorizedFsImporterCount: 0`, `unauthorizedMutationApiCount: 0`,
`durableReplayProtection: false`, `c2cStarted: false`, and
`receiptCrashCount: 0`. `NAMLA_BUILD_LAW.md` is unchanged from C2-A (no C2-B
amendment).

**AntQueen delegates to the canonical engine** (Pre-Capability Closure) —
the façade constructs the engine and no independent planner/orchestrator/
router/decomposition construction remains in it:
```
grep -c "new ColonyEngine" src/core/antQueen.ts
grep -nE "new (MissionPlanner|ColonyOrchestrator|TaskRouter|DecompositionEngine)" src/core/antQueen.ts
```
Expected: `1` from the first; no output from the second. (The canonical
refused-mission behavior is guarded by the demoEngineMissionRefusal golden
inside the harness check below.)

**Golden tooling is pure and complete** (AH2 Step 5) — the evaluator and
baselines import no capability (evaluator: one type import; baselines: one
type import), the harness invokes runners by direct import (no
subprocess), and every demo has a baseline (the harness reports
`baselineCoverageComplete` and fails otherwise):
```
grep -c "^import" src/tools/demoGolden.ts src/tools/demoGoldenBaselines.ts
grep -nE "child_process|spawn|exec" src/examples/demoGoldenOutputs.ts
node dist/examples/demoGoldenOutputs.js
```
Expected: `1` for each tools file; no output from the subprocess grep; and
harness output with `"allGoldensPassed": true`, `"crashCount": 0`,
`"baselineCoverageComplete": true`.

**Receipt status semantics are defined once, over the full union** (AH2
Step 4G) — the registry is typed `Record<ReceiptStatus, ...>` (coverage is
compiler-enforced) and no second semantics table exists:
```
grep -n "Record<ReceiptStatus, ReceiptStatusMeaning>" src/core/receiptStatusSemantics.ts
grep -rln "ReceiptStatusCategory =" src --include="*.ts"
```
Expected: one match from the first; only
`src/core/receiptStatusSemantics.ts` from the second. (Status literals at
create sites are validated by the TypeScript union itself.)

**Receipt identity is instance-local** (AH2 Step 4F) — no module-level
mutable receipt counter exists anywhere, and ReceiptLog owns a private
sequence:
```
grep -rn "receiptCounter" src --include="*.ts"
grep -n "private sequence" src/core/receiptLog.ts
```
Expected: no output from the first command; one match from the second.
(The pseudo-receipt regression check below remains the guard against
minting receipt ids anywhere else.)

**Canonical safety policies use the shared matcher** (AH2 Step 4E) — both
canonical policies import it, and neither uses raw ad-hoc substring
matching anymore (domain deny lists elsewhere legitimately keep their own
semantics; this check is scoped to the two canonical files):
```
grep -l "textIndicatorMatcher" src/core/safetyGuard.ts src/policies/secretProtectionPolicy.ts
grep -n "includes(" src/core/safetyGuard.ts src/policies/secretProtectionPolicy.ts
```
Expected: both file names from the first command; no output from the
second.

**Attention snapshot is pure and leak-free** (AH2 Step 4D) — a single
type-only import, and no topic/payload fields in its output:
```
grep -c "^import" src/pheromones/pheromoneAttentionSnapshot.ts
grep -nE "topic|payload" src/pheromones/pheromoneAttentionSnapshot.ts
```
Expected: `1`, and the second grep matches only the comment explaining the
exclusion.

## 6. Adapters

**No credential/auth/url/endpoint fields modeled** — expect only the doc
comment stating the prohibition and the `credentialsMode: "not-modeled"`
literal:
```
grep -inE "apikey|api_key|token|credential|password|secret|endpoint|url|auth" src/adapters/agentAdapterTypes.ts
```

## 7. Runtime cast-defense

**Shared invariant helper in use** — expect three consumers:
```
grep -rln "holdsCoreProposalInvariants" src --include="*.ts"
```
Expected: `src/generation/codeProposal.ts` (definition),
`src/generation/proposalQueue.ts`, `src/review/proposalReviewer.ts`,
`src/git/commitProposalFactory.ts`

## 8. Full verification

Typecheck and demos (requires the declared devDependencies installed):
```
npx tsc --noEmit && npx tsc
for d in dist/examples/demo*.js; do node "$d" > /dev/null && echo "$d OK"; done
```
Expected: clean typecheck, eleven OK lines.

## 9. Colony Genesis G0 (`src/colony/`)

Colony Genesis is a **second runtime** (Build Law §12). These checks prove it
stays separate from the central mission pipeline and adds no real authority.

**No import of the central mission pipeline** — expect no output for each:
```
grep -rn "from \"\.\./simulation/\|from \"\.\./planner/" src/colony --include="*.ts"
grep -rnE "AntScheduler|DecompositionEngine|rolePicker|TaskDependencyGraph|TaskRouter|ColonyOrchestrator|MissionPlanner|ColonySimulation" src/colony --include="*.ts"
```

**No filesystem access at all in `src/colony/`** — expect no output:
```
grep -rnE "require\(.fs.\)|from \"fs\"|from 'fs'|node:fs" src/colony --include="*.ts"
```

**No fs mutation, process, network, timer, or Worker APIs** — expect no output:
```
grep -rnE "writeFile|appendFile|mkdirSync|rmSync|unlinkSync|renameSync|copyFileSync|createWriteStream|truncateSync|child_process|execSync|spawn\(|fetch\(|http\.|https\.|WebSocket|setTimeout|setInterval|setImmediate|worker_threads|new Worker\(" src/colony --include="*.ts"
```

**No wall clock and no ambient randomness in colony logic** — expect no output
(all colony randomness comes from the seeded `createSeededRandom`):
```
grep -rnE "Date\.now|new Date\(|Math\.random" src/colony --include="*.ts"
```

**No module-level mutable counters** — expect no output (identity is derived
from the ant's index, never from ambient process state):
```
grep -rnE "^(let|var) " src/colony --include="*.ts"
```

**Population budget is law-fixed** — expect `300`, `1`, `299`:
```
grep -oE "COLONY_(POPULATION_SIZE|QUEEN_IDENTITY_COUNT|WORKER_COUNT) = [0-9]+" src/colony/antPopulation.ts
```

**Queen holds no authority** — expect four literal `false` fields plus the
literal-zero assignment counter:
```
grep -cE "(taskAssignmentAuthority|routingAuthority|quorumSelectionAuthority|populationMemoryAccess): false;" src/colony/queenContinuitySystem.ts
grep -c "queenTaskAssignments: 0;" src/colony/queenContinuitySystem.ts
```
Expected: `4` and `1`.

**Genesis authority counters are literal zero types** — expect six:
```
grep -cE "(centralTaskAssignments|queenTaskAssignments|externalLlmCalls|realFilesystemWrites|networkCalls|processExecutions): 0;" src/colony/colonyGenesis.ts
```
Expected: `6`.

**The demo proves the population and decentralization facts at runtime** —
expect `true`:
```
node -e "const r=require('./dist/examples/demoColonyGenesisG0.js').runDemoColonyGenesisG0(); console.log(r.totalPersistentAnts===300 && r.queenIdentities===1 && r.workerIdentities===299 && r.uniqueAntIds===300 && r.nestConnected===true && r.centralTaskAssignments===0 && r.queenTaskAssignments===0 && r.deterministicRerunMatches===true && r.allExpectationsMet===true && r.receiptCrashCount===0 && r.dangerousRegressionCount===0)"
```

## 10. Colony Genesis G1–G3 (`src/colony/`, Build Law §13)

These checks prove the local behavior loop (task stimulus, pheromones,
encounters, response-threshold choice, movement, specialization) stays
decentralized, bounded, and deterministic, and that G4/G5/G6/G7 remain
un-implemented. Sections 1–9 above still apply unchanged to this code.

**Tick loop is bounded by a code constant, not configurable** — expect one
match at or below `1000`:
```
grep -n "COLONY_TICK_HARD_CAP = " src/colony/colonyTickRunner.ts
```

**No G4/G5/G6/G7 authority leaks into this pass** — expect no output for
each (scoped to the G1-G3 files themselves; pre-existing G0 files legitimately
declare `quorumSelectionAuthority: false` and reserve a `quorumThreshold`
genome field for a not-yet-implemented future phase, so are not in scope
here):
```
grep -rnE "activationMode\s*=\s*.(deterministic-local|llm-eligible|llm-active)." src/colony --include="*.ts"
grep -rnE "quorumWinner\s*=|recruitmentWinner|tandemRun\(|activateReserve\(" src/colony/taskStimulusField.ts src/colony/pheromoneField.ts src/colony/encounterNetwork.ts src/colony/responseThresholdSystem.ts src/colony/localTaskChoice.ts src/colony/antMovement.ts src/colony/colonyTickRunner.ts src/colony/colonyRunReport.ts
```

**Every pheromone type has at least one decision site** — expect a count
equal to `COLONY_PHEROMONE_TYPES.length` (10):
```
node -e "const {PHEROMONE_DECISION_SITES}=require('./dist/colony/pheromoneField.js'); console.log(Object.keys(PHEROMONE_DECISION_SITES).length)"
```

**The demo proves the decentralized-behavior facts at runtime** — expect
`true`:
```
node -e "const r=require('./dist/examples/demoColonyGenesis.js').runDemoColonyGenesis(); console.log(r.totalPersistentAnts===300 && r.uniqueAntIds===300 && r.ticksExecuted===400 && r.localTaskDecisions>0 && r.centralTaskAssignments===0 && r.queenTaskAssignments===0 && r.encounters>0 && r.movementCount>0 && r.pheromonesDeposited>0 && r.pheromonesRead>0 && r.pheromonesReinforced>0 && r.pheromonesDecayed>0 && r.taskSwitchCount>0 && r.specializationChanges>0 && r.populationIdentityPreserved===true && r.externalLlmCalls===0 && r.realFilesystemWrites===0 && r.networkCalls===0 && r.processExecutions===0 && r.peakCognitiveEligibilityAtMost30===true && r.allPheromoneTypesHaveDecisionSite===true && r.allExpectationsMet===true)"
```

## 11. Colony Genesis G4–G5 (`src/colony/`, Build Law §14)

These checks prove reserve activation adds no new authority, and that
recruitment/quorum stay bounded, chamber-local, and free of any global tally
or declared winner. Sections 1–10 above still apply unchanged to this code.

**The reserve early-return is gone, with no replacement controller** —
expect no output for each:
```
grep -n "if (ant.currentBehaviorState === \"reserve\")" src/colony/colonyTickRunner.ts
grep -rniE "class ReserveActivator|function activateReserve\(" src/colony --include="*.ts"
```

**Candidate ids are a pure function of (colonySeed, chamberId) only** —
expect exactly `1` (proves the ONLY parameters are colonySeed and chamberId,
so no population/roster/ant input can reach candidate generation, i.e. no
global candidate board is even expressible):
```
grep -c "export function candidateIdsForChamber(colonySeed: number, chamberId: ChamberId)" src/colony/recruitmentQuorumSystem.ts
```

**No global quorum winner and no global support count anywhere in
`src/colony/`** — expect no output for each:
```
grep -rnE "quorumWinner\s*=|recruitmentWinner\s*=|declareWinner\(" src/colony --include="*.ts"
grep -rnE "\.filter\([^)]*commitmentState[^)]*===[^)]*[\"']committed[\"'][^)]*\)\.length" src/colony --include="*.ts"
```

**Recruitment and quorum sensing reuse the ant's own bounded encounter, not a
second unbounded contact** — expect `1` (the only place
`firstEncounterOffset` is defined) and `1` (the only other place it is
called, from the G5 module):
```
grep -c "export function firstEncounterOffset" src/colony/encounterNetwork.ts
grep -c "firstEncounterOffset(" src/colony/recruitmentQuorumSystem.ts
```

**Candidate memory is bounded by a fixed code constant** — expect one match:
```
grep -n "MAX_CANDIDATE_MEMORY = " src/colony/recruitmentQuorumSystem.ts
```

**Local quorum support is clamped, never an unbounded accumulator** — expect
at least one match showing the clamp against `quorumThreshold`:
```
grep -n "Math.min(quorumThreshold, acting.localQuorumSupportCount" src/colony/recruitmentQuorumSystem.ts
```

**The demo proves G4/G5 activity at runtime alongside every G0-G3 fact and
every zero-authority counter** — expect `true`:
```
node -e "const r=require('./dist/examples/demoColonyGenesis.js').runDemoColonyGenesis(); console.log(r.reserveActivationCount>0 && r.recruitmentEvents>0 && r.quorumLocalCommitments>0 && r.centralTaskAssignments===0 && r.queenTaskAssignments===0 && r.externalLlmCalls===0 && r.realFilesystemWrites===0 && r.networkCalls===0 && r.processExecutions===0 && r.populationIdentityPreserved===true && r.allExpectationsMet===true)"
```

## 12. Colony Genesis G6–G7 (`src/colony/`, Build Law §15)

These checks prove brood/lifecycle stays bounded and never breaches the
population cap, generation transitions touch only the Queen's own record,
the cognitive budget never exceeds 30 and never calls a real model, and a
retired identity is never removed from the population. Sections 1-11 above
still apply unchanged to this code.

**Live brood and the cognitive budget are both bounded by fixed code
constants** — expect one match each:
```
grep -n "MAX_LIVE_BROOD = " src/colony/broodLifecycleSystem.ts
grep -n "MAX_COGNITIVE_BUDGET = " src/colony/cognitiveBudgetSystem.ts
```

**Population-cap admission never exceeds room** — expect the exact gating
line (bounds admission to `populationCap - currentPersistentCount`, never
more):
```
grep -n "const room = populationCap - currentPersistentCount" src/colony/broodLifecycleSystem.ts
```

**Generation transition touches only the Queen's own record — no
population, roster, or worker parameter** — expect the exact two-parameter
signature:
```
grep -n "export function maybeAdvanceGeneration(" src/colony/queenContinuitySystem.ts
grep -A2 "export function maybeAdvanceGeneration(" src/colony/queenContinuitySystem.ts | grep -c "admittedThisGeneration: number"
```
Expected: the signature line, then `1`.

**No identity is ever removed from the population — only mapped/concatenated,
never filtered out** — expect no output (a `.filter(` on the worker/ant
array itself, as opposed to a brood-record array, would be the one way an
identity could disappear):
```
grep -nE "workersAfterCognition\.filter\(|nextWorkers\.filter\(|recruitmentQuorumResult\.ants\.filter\(" src/colony/colonyTickRunner.ts
```

**A retired ant is a closed record, not a deleted one** — expect the
early-return that stops aging/metabolism without touching array membership:
```
grep -n "if (ant.lifecycleState === \"retired\")" src/colony/workerLifecycleSystem.ts
```

**No real cognitive-worker call anywhere** — `CognitiveWorkerContract` is
declared but never implemented or invoked — expect no output for each (the
leading `.` on the first pattern is deliberate: it matches only an
invocation like `worker.requestCognition(...)`, never the interface's own
method declaration `requestCognition(context: ...): ...`):
```
grep -rn "\.requestCognition(" src/colony --include="*.ts"
grep -rniE "implements CognitiveWorkerContract|new .*CognitiveWorker" src --include="*.ts"
```

**Only `"llm-eligible"` is ever assigned by G7 — `"deterministic-local"` and
`"llm-active"` remain unreached** — expect no output for each:
```
grep -rnE "activationMode:\s*[\"']deterministic-local[\"']|activationMode:\s*[\"']llm-active[\"']" src/colony --include="*.ts"
grep -rnE "as const.*deterministic-local|as const.*llm-active" src/colony/colonyTickRunner.ts
```

**Queen authority-absence fields are untouched by G6/G7** — expect the same
`4` and `1` §9 already established, unchanged:
```
grep -cE "(taskAssignmentAuthority|routingAuthority|quorumSelectionAuthority|populationMemoryAccess): false;" src/colony/queenContinuitySystem.ts
grep -c "queenTaskAssignments: 0;" src/colony/queenContinuitySystem.ts
```
Expected: `4` and `1`.

**The demo proves G6/G7 activity at runtime alongside every G0-G5 fact** —
expect `true`:
```
node -e "const r=require('./dist/examples/demoColonyGenesis.js').runDemoColonyGenesis(); console.log(r.broodRecordsCreated>0 && r.broodLifecycleTransitions>0 && r.nursingStimulusEvents>0 && r.nursingLocalResponses>0 && r.queenDirectNursingAssignments===0 && r.cognitionClaims>0 && r.observedPeakCognitivelyActiveAnts<=30 && r.cognitiveBudgetViolations===0 && r.deterministicFallbackActions>0 && r.centralTaskAssignments===0 && r.queenTaskAssignments===0 && r.externalLlmCalls===0 && r.realFilesystemWrites===0 && r.networkCalls===0 && r.processExecutions===0 && r.populationIdentityPreserved===true && r.allExpectationsMet===true)"
```

**The scale demo proves boundedness, determinism, and the renewal mechanism
at 300/1,000/10,000 identities** — expect `true`:
```
node -e "const r=require('./dist/examples/demoColonyScale.js').runDemoColonyScale(); console.log(r.allExpectationsMet===true && r.scales.every(s=>s.allExpectationsMet && s.boundedMemoryConfirmed && s.noAllToAllInteraction && s.deterministicRerunMatches && s.peakCognitivelyActive<=30 && s.centralTaskAssignments===0 && s.queenTaskAssignments===0 && s.externalLlmCalls===0) && r.renewalProof.renewalMechanismProven===true)"
```

## 13. Real Cognitive Ants V1 (`src/colonyMission/`, `src/cli/`, Build Law §16)

These checks prove the mission layer never touches Colony Genesis itself,
the Claude/Codex adapters have no execution code path at all (not just a
disabled one), the mission workspace can never target Namla source or a
secret-shaped name, and the deterministic demo proves the whole pipeline —
quorum, claims, cognitive budget, artifact review, defect repair — for
real. Sections 1-12 above still apply unchanged.

**`src/colony/` is untouched by this layer** — expect no output (nothing
under `src/colonyMission/` or `src/cli/` is imported back into
`src/colony/`):
```
grep -rln "colonyMission\|from \"../cli/\|from \"\.\./\.\./cli/" src/colony --include="*.ts"
```

**No `child_process` import anywhere in the mission layer** — expect no
output (the CLI adapters construct planned invocations only; there is no
execution code path to disable, not even a guarded one — this deliberately
matches only actual import/require syntax, not the word appearing in the
explanatory comments this file's own modules carry):
```
grep -rnE "require\(.child_process.\)|from \"child_process\"|from 'child_process'|execSync|spawnSync|spawn\(|execFile" src/colonyMission src/cli --include="*.ts"
```

**The CLI adapters always refuse — `submit()` has exactly one return path
and it is a refusal** — expect `1` (the only `return` in the method body):
```
grep -c "return this.refuseWithPlan" src/colonyMission/cliCognitiveWorkerBase.ts
```

**Real verification also always refuses** — expect the literal outcome
`"failed"` in `RealVerificationRunner`, never a pass:
```
grep -A6 "class RealVerificationRunner" src/colonyMission/verificationRunner.ts | grep -c 'outcome: "failed"'
```

**Mission workspace boundary refuses Namla source, secret-shaped names, and
cross-mission paths** — expect all four reason codes present:
```
grep -c '"targets-namla-source"' src/colonyMission/missionWorkspace.ts
grep -c '"outside-mission-root"' src/colonyMission/missionWorkspace.ts
grep -c '"protected-name-segment"' src/colonyMission/missionWorkspace.ts
grep -c '"path-traversal"' src/colonyMission/missionWorkspace.ts
```
Expected: at least `1` for each.

**Cognitive-execution budget for this milestone is hard-capped and
verified in code, not just documented** — expect the demo/CLI constant:
```
grep -n "MAX_CONCURRENT_COGNITIVE_ANTS = 5" src/examples/demoRealCognitiveColony.ts src/cli/colonyMissionCli.ts
```

**No real-provider call anywhere in the automated suite** — expect no
output (the only providers registered by the demo are `DeterministicCognitiveWorker`;
`ClaudeCliAdapter`/`CodexCliAdapter` are never constructed by any demo or
by `demoGoldenOutputs.ts`):
```
grep -n "ClaudeCliAdapter\|CodexCliAdapter" src/examples/demoRealCognitiveColony.ts src/examples/demoGoldenOutputs.ts
```

**The real-provider smoke command is never invoked automatically** — expect
no output (no demo, no golden baseline, no other CLI script calls it):
```
grep -rln "colonyRealSmokeCli" src/examples src/tools --include="*.ts"
```

**The demo proves the full pipeline at runtime** — expect `true`:
```
node -e "const r=require('./dist/examples/demoRealCognitiveColony.js').runDemoRealCognitiveColony(); console.log(r.totalPersistentAnts===300 && r.queenIdentities===1 && r.workerIdentities===299 && r.scoutProposalCount>=3 && r.quorumReached===true && r.rejectedProposalCount>=2 && r.voluntaryTaskClaims>0 && r.acceptedTaskClaims>0 && r.cognitiveClaims>0 && r.peakCognitiveAnts<=5 && r.centralTaskAssignments===0 && r.queenTaskAssignments===0 && r.artifactProposals>0 && r.artifactsReviewed>0 && r.filesApplied>0 && r.verificationRuns>0 && r.injectedDefects===1 && r.verificationFailures>0 && r.repairRounds>0 && r.finalVerificationPassed===true && r.workspaceBoundaryViolations===0 && r.fakeProviderCalls>0 && r.realClaudeCalls===0 && r.realCodexCalls===0 && r.realNetworkCalls===0 && r.dangerousRegressionCount===0 && r.receiptCrashCount===0 && r.allExpectationsMet===true)"
```

## 10. Ant Intelligence Deepening V1 (`src/colony/` intelligence layer)

The intelligence layer (Build Law §17) reuses the same `src/colony/` invariants
already checked in Section 9 (no simulation/planner import, no fs, no
mutation/process/network/timer/Worker API, no `Date.now`/ambient randomness, no
module-level mutable counter) — those greps cover every new module. These add
the intelligence-specific checks.

**No real cognition provider is called** — expect no output (a provider SDK
import or invocation would match; the type-only `CognitiveWorkerContract` seam
does not):
```
grep -rniE "new OpenAI|new Anthropic|\.messages\.create|require\(.*(openai|anthropic).*\)|api\.openai|api\.anthropic|claude\.ai" src/colony --include="*.ts"
```

**The intelligence demo proves the whole layer at runtime** — expect `true`:
```
node -e "const r=require('./dist/examples/demoAntIntelligenceDeepening.js').runDemoAntIntelligenceDeepening(); console.log(r.totalPersistentAnts===300 && r.uniqueAntIds===300 && r.individualCognitiveProfiles===299 && r.distinctProfileDigests>=150 && r.localPlansCreated>0 && r.localPlansRevised>0 && r.selfEvaluations>0 && r.calibrationImproved===true && r.peerReviewsCompleted>0 && r.disagreementsRecorded>0 && r.assumptionsChallenged>0 && r.temporaryTeamsFormed>0 && r.teamsDissolved>0 && r.knowledgeProposals>0 && r.acceptedKnowledge>0 && r.rejectedKnowledge>0 && r.contradictionsDetected>0 && r.knowledgeReused>0 && r.mentorshipEvents>0 && r.youngWorkersImproved>0 && r.crisisScenariosRun>=10 && r.crisesRecovered>0 && r.unreliableClaimsContained>0 && r.specializationDiversityMaintained===true && r.globalPlannerDecisions===0 && r.centralTaskAssignments===0 && r.queenTaskAssignments===0 && r.peakCognitivelyActiveAnts<=30 && r.externalLlmCalls===0 && r.realNetworkCalls===0 && r.realFilesystemWrites===0 && r.processExecutions===0 && r.dangerousRegressionCount===0 && r.receiptCrashCount===0 && r.allExpectationsMet===true && r.mismatchCaseIds.length===0)"
```

**Bounded minds and plans at scale** — expect `true` (300/1,000/10,000):
```
node -e "const {runIntelligenceScale}=require('./dist/colony/antIntelligenceRuntime.js'); const ok=[['300',299,60,20260721],['1000',999,30,20260722],['10000',9999,12,20260723]].every(([l,w,t,s])=>{const r=runIntelligenceScale(l,w,t,s); return r.allMindsWithinBounds && r.maxWorkingMemory<=8 && r.deterministicRerunMatches && r.diversityPreserved && r.centralTaskAssignments===0 && r.queenTaskAssignments===0;}); console.log(ok)"
```

## 11. Real Cognitive Ants R1 (`src/colonyMission/` + `src/cli/`)

R1 reuses the runtime already checked in Section 9-style greps; these add the
provider/execution-boundary checks. The `src/colony/` purity checks in Sections
9 and 10 continue to prove the colony imports no fs, `child_process`, network, or
provider code.

**No `child_process` and no `shell: true` in the cognitive runtime** — expect no
output for each (the real process driver does not exist for demos to reach):
```
grep -rnE "child_process|execSync|spawnSync|spawn\(|shell:\s*true" src/colonyMission src/cli --include="*.ts"
```

**No real network in the cognitive runtime** — expect no output:
```
grep -rnE "fetch\(|https?\.(get|request)|WebSocket|net\.|dgram" src/colonyMission src/cli --include="*.ts"
```

**No real provider SDK is imported** — expect no output:
```
grep -rniE "new OpenAI|new Anthropic|\.messages\.create|require\(.*(openai|anthropic).*\)|api\.openai|api\.anthropic" src/colonyMission src/cli --include="*.ts"
```

**Executable names are hard-coded string literals, never built from mission
text** — expect the two adapters' literal executable names:
```
grep -rnE "executable" src/colonyMission/claudeCliAdapter.ts src/colonyMission/codexCliAdapter.ts | head
```

**The R1 end-to-end demo proves the whole bounded pipeline at runtime** — expect
`true`:
```
node -e "const r=require('./dist/examples/demoRealCognitiveAntsR1.js').runDemoRealCognitiveAntsR1(); console.log(r.totalPersistentAnts===300 && r.queenIdentities===1 && r.workerIdentities===299 && r.scoutProposalCount>=3 && r.quorumReached===true && r.rejectedProposalCount>=2 && r.voluntaryTaskClaims>0 && r.acceptedTaskClaims>0 && r.nonVolunteerAssignments===0 && r.cognitiveClaims>0 && r.cognitionClaimsAccepted>0 && r.peakCognitiveAnts<=5 && r.centralTaskAssignments===0 && r.queenTaskAssignments===0 && r.globalPlannerDecisions===0 && r.artifactProposals>0 && r.artifactsReviewed>0 && r.verificationRuns>0 && r.injectedDefects===1 && r.verificationFailures>0 && r.repairRounds>0 && r.finalVerificationPassed===true && r.workspaceBoundaryViolations===0 && r.deterministicProviderCalls>0 && r.realClaudeCalls===0 && r.realCodexCalls===0 && r.realProviderProcessExecutions===0 && r.realNetworkCalls===0 && r.realFilesystemWrites===0 && r.dangerousRegressionCount===0 && r.receiptCrashCount===0 && r.allExpectationsMet===true && r.mismatchCaseIds.length===0)"
```

**Demo cognition peak ≤ 5 and global colony budget ≤ 30** — the demo caps
concurrent cognitive ants at 5 (`peakCognitiveAnts<=5` above) while
`MAX_COGNITIVE_BUDGET` in `src/colony/cognitiveBudgetSystem.ts` stays 30:
```
grep -c "MAX_COGNITIVE_BUDGET = 30" src/colony/cognitiveBudgetSystem.ts
```
Expected: `1`.

## 12. Real Cognitive Ants R2 — human-only provider execution (`src/cognitive/`)

Build Law §19. These checks prove the first real-execution door stays exactly
one human, one ant, one process wide, with automated real execution at zero.

**child_process IMPORTED only in the real driver** — expect exactly one line:
```
grep -rlnE 'from "child_process"|require\(["'"'"']child_process' src --include="*.ts"
```
Expected: `src/cognitive/nodeProviderProcessDriver.ts`.

**No child_process import in `src/colony/` or in any demo** — expect no output:
```
grep -rnE 'from "child_process"|require\(["'"'"']child_process' src/colony src/examples --include="*.ts"
```

**shell:false, and no exec/execSync/fork/shell string** — expect no output:
```
grep -rnE "shell:\s*true|execSync|\bexec\(|\bfork\(" src/cognitive src/colonyMission src/cli --include="*.ts"
```

**Provider executable map is hard-coded; mission text never selects the
executable** — expect the two literal entries and no dynamic key:
```
grep -nE "claude:|codex:" src/cognitive/nodeProviderProcessDriver.ts
```

**Typed confirmation is mandatory and cannot come from argv/env/piped input** —
expect the TTY + exact-phrase + no-argv + no-pipe gate:
```
grep -nE "isInteractiveTty|stdinWasPiped|argvConfirmationFlagPresent|requiredPhrase" src/cognitive/realProviderExecutionPermit.ts | head
```

**The real driver is never imported by any automated demo** — expect no output:
```
grep -rn "nodeProviderProcessDriver" src/examples --include="*.ts"
```

**The R2 demo proves the whole boundary at runtime (fake driver only)** — expect
`true`:
```
node -e "const r=require('./dist/examples/demoRealProviderActivationR2.js').runDemoRealProviderActivationR2(); console.log(r.totalCases===22 && r.passedCases===22 && r.allExpectationsMet===true && r.forgedPermitsAccepted===0 && r.preAdmissionPermitConsumption===0 && r.replayRefusals===2 && r.simulatedClaudeCalls>0 && r.simulatedCodexCalls>0 && r.realClaudeCalls===0 && r.realCodexCalls===0 && r.realProviderProcessExecutions===0 && r.shellTrueCount===0 && r.arbitraryExecutableCount===0 && r.arbitraryArgumentCount===0 && r.sourceTreeWrites===0 && r.workspaceBoundaryViolations===0 && r.centralTaskAssignments===0 && r.queenTaskAssignments===0 && r.globalPlannerDecisions===0 && r.receiptCrashCount===0 && r.dangerousRegressionCount===0)"
```

**Global cognitive budget remains 30** — expect `1`:
```
grep -c "MAX_COGNITIVE_BUDGET = 30" src/colony/cognitiveBudgetSystem.ts
```

## 13. Tamara–Namla Federation V1 + Ant Academy V1 (`src/federation/`, `src/academy/`)

Build Law §20. Both layers are deterministic and in-memory; neither adds real
execution.

**No fs / child_process / network / timer / clock / ambient randomness** —
expect no output:
```
grep -rnE 'from "fs"|from "child_process"|node:fs|fetch\(|https?\.(get|request)|WebSocket|setTimeout|setInterval|worker_threads|Date\.now|new Date\(|Math\.random' src/federation src/academy --include="*.ts"
```

**No module-level mutable state; no real provider SDK** — expect no output:
```
grep -rnE '^(let|var) |new OpenAI|new Anthropic|\.messages\.create' src/federation src/academy --include="*.ts"
```

**Tamara's worker powers are literal-false; direct-assignment counter is zero** —
expect the forbidden-authority fields and the zero counter:
```
grep -cE "(directAntAssignmentAuthority|quorumSelectionAuthority|privateMindAccess|permitMintingAuthority): false;" src/federation/tamaraObjective.ts
grep -c "tamaraDirectAntAssignments: 0;" src/federation/tamaraObjective.ts
```
Expected: `4` and `1`.

**Global cognitive budget still 30; rotation is tighten-only against it** —
expect `1` (the rotation ceiling is clamped to `MAX_COGNITIVE_BUDGET`, never above):
```
grep -c "Math.min(Math.max(0, Math.floor(maxSlots)), MAX_COGNITIVE_BUDGET)" src/academy/providerPoolRotation.ts
grep -c "MAX_COGNITIVE_BUDGET = 30" src/colony/cognitiveBudgetSystem.ts
```
Expected: `1` and `1`.

**The academy demo proves the whole layer at runtime (deterministic worker only)**
— expect `true`:
```
node -e "const r=require('./dist/examples/demoAntAcademyV1.js').runDemoAntAcademyV1(); console.log(r.totalPersistentAnts===300 && r.academyDomains>=12 && r.examinationPasses>0 && r.examinationFailures>0 && r.promotions>0 && r.rejectedPromotions>0 && r.certifications>0 && r.selfCertifications===0 && r.unsupportedPromotions===0 && r.mentorshipEvents>0 && r.temporaryTeamsFormed>0 && r.reviewsCompleted>0 && r.verificationRuns>0 && r.repairRounds>0 && r.specializationDiversityMaintained===true && r.peakCognitivelyActiveAnts<=30 && r.nonVolunteerAssignments===0 && r.centralTaskAssignments===0 && r.queenTaskAssignments===0 && r.tamaraDirectAntAssignments===0 && r.globalPlannerDecisions===0 && r.realClaudeCalls===0 && r.realCodexCalls===0 && r.realNetworkCalls===0 && r.realFilesystemWrites===0 && r.processExecutions===0 && r.dangerousRegressionCount===0 && r.receiptCrashCount===0 && r.allExpectationsMet===true && r.mismatchCaseIds.length===0)"
```

## 14. Tamara–Namla Real Academy Pilot V2 (`src/cognitive/multiProviderPilotPermit.ts`, `src/academy/realAcademyPilot.ts`)

Build Law §21. A bounded live training pilot of 1-5 voluntary ants; automated
flows make zero real calls.

**Pilot cohort and provider-call ceilings are 5** — expect `1` each:
```
grep -c "MAX_PILOT_COHORT = 5" src/cognitive/multiProviderPilotPermit.ts
grep -c "MAX_PILOT_PROVIDER_CALLS = 5" src/cognitive/multiProviderPilotPermit.ts
grep -c "MAX_PILOT_MEMBER_PERMITS = 5" src/cognitive/realProviderExecutionPermit.ts
```

**The pilot permit is human-only and never delegable; member permits are
per-ant, single-use** — expect the human-confirmation gate and the batch cap:
```
grep -c "HUMAN_CONFIRMATIONS.has" src/cognitive/realProviderExecutionPermit.ts
```
Expected: at least `2` (single mint + batch mint both gate on it).

**The pilot modules import no fs/child_process/network/clock/randomness
directly** — expect no output:
```
grep -rnE 'from "fs"|from "child_process"|fetch\(|https?\.(get|request)|setTimeout|Date\.now|new Date\(|Math\.random' src/academy/realAcademyPilot.ts src/cognitive/multiProviderPilotPermit.ts --include="*.ts"
```

**The real driver is never imported by any demo** — expect no output:
```
grep -rn "nodeProviderProcessDriver" src/examples --include="*.ts"
```

**The academy-pilot workspace cannot escape** — the only writable pilot root is
the allowlisted pattern; expect `1`:
```
grep -c "workspaces\\/academy-pilot" src/cognitive/smokeWorkspace.ts
```

**The V2 demo proves the whole bounded pilot at runtime (fake driver only)** —
expect `true`:
```
node -e "const r=require('./dist/examples/demoRealAcademyPilotV2.js').runDemoRealAcademyPilotV2(); console.log(r.totalPersistentAnts===300 && r.voluntaryTrainingClaims>=8 && r.acceptedCohortSize===5 && r.nonVolunteerAssignments===0 && r.tamaraDirectAntAssignments===0 && r.centralTaskAssignments===0 && r.queenTaskAssignments===0 && r.globalPlannerDecisions===0 && r.simulatedClaudeCalls>0 && r.simulatedCodexCalls>0 && r.realClaudeCalls===0 && r.realCodexCalls===0 && r.providerCallsStarted===5 && r.providerCallsCompleted>0 && r.providerCallsFailed>0 && r.quotaFailures===1 && r.malformedResults===1 && r.evaluationsPassed>0 && r.evaluationsFailed>0 && r.remediationRequests>0 && r.passportEvidenceUpdates>0 && r.certificationsGranted===0 && r.workspaceBoundaryViolations===0 && r.realFilesystemWrites===0 && r.realNetworkCalls===0 && r.realProviderProcessExecutions===0 && r.pilotCompleted===true && r.allExpectationsMet===true && r.mismatchCaseIds.length===0)"
```

**R2 one-ant smoke path intact; global cognitive budget still 30** — the R2
smoke CLI still gates on the exact typed phrase, and the budget constant is
unchanged; expect the R2 CLI path, then `1`:
```
grep -rln "REQUIRED_CONFIRMATION_PHRASE" src/cli/colonyRealSmokeCli.ts
grep -c "MAX_COGNITIVE_BUDGET = 30" src/colony/cognitiveBudgetSystem.ts
```
Expected: `src/cli/colonyRealSmokeCli.ts` and `1`.

## 15. Digital Superorganism Metabolism V1 (`src/digital/`, Build Law §23)

The digital product layer is pure and deterministic: it imports no fs, no
child_process, no network, no timers, and uses no ambient randomness.

**No forbidden imports or ambient nondeterminism in `src/digital/` or the frozen
`src/biology/` reference layer** — expect `CLEAN`:
```
grep -rlnE 'from "(fs|net|http|https|dgram|dns|child_process|worker_threads)"|Date\.now|Math\.random' src/digital src/biology --include="*.ts" || echo CLEAN
```
Expected: `CLEAN` (neither layer touches the filesystem, processes, network,
wall clock, or `Math.random`; all draws go through the seeded `digitalDraw` /
`bioDraw`).

**The digital layer does not import child_process** — the single authorized
importer is unchanged:
```
grep -rlnE 'require\("child_process"\)|from "child_process"' src --include="*.ts"
```
Expected exactly: `src/cognitive/nodeProviderProcessDriver.ts`. No `src/digital/`
file appears (the string only occurs in digital module header comments describing
what they do NOT do).

**Conservation + causality hold at every scale** — the demo re-checks 300 /
1,000 / 10,000 identities:
```
node dist/examples/demoDigitalSuperorganismV1.js
```
Expected: `digitalResourceConservationValid: true`, `unexplainedResourceCreation:
0`, `causalityViolations: 0`, `providerCalls: 0`, `peakCognitiveWorkers` ≤ 30,
`centralTaskAssignments`/`queenTaskAssignments`/`tamaraDirectAntAssignments`/
`globalPlannerDecisions` all 0, `allExpectationsMet: true`, and `mismatchCaseIds`
empty, with every `scaleChecks[*]` showing `conserved: true`, `causalityClean:
true`, `boundedCognitive: true`, `providerCalls: 0`.

**Bounded working hands (mechanical):** the runner caps deep-cognitive
concurrency at `GLOBAL_COGNITIVE_CAP` (30) and real-provider identities at
`REAL_PROVIDER_CAP` (5) which never execute in deterministic runs. The golden
baseline asserts `peakCognitiveWorkers ≤ 30` and `providerCalls === 0`.

## 16. Digital Superorganism Operations V2 (`src/digital/` + `src/cli/digitalRealObjectiveCli.ts`, Build Law §24)

The V2 operations layer is pure and deterministic: it adds no filesystem,
process, or network access, and every real-action counter stays 0.

**No new fs / child_process / network importer** — the counts are unchanged:
```
grep -rln 'from "fs"' src --include="*.ts" | grep -v '^src/tools/' | wc -l   # expect 4
grep -rlnE 'require\("child_process"\)|from "child_process"' src --include="*.ts" | wc -l   # expect 1
grep -rlnE 'from "(fs|net|http|https|dgram|dns|child_process|worker_threads)"|Date\.now|Math\.random' src/digital --include="*.ts" || echo CLEAN
```
Expected: `3`, `1`, and `CLEAN` (no `src/digital/` file touches fs, process,
network, wall clock, or `Math.random`; all draws use the seeded `digitalDraw`).

**The operations demo performs no real action** — run it and confirm the zeros:
```
node dist/examples/demoDigitalSuperorganismOperationsV2.js
```
Expected: `realClaudeCalls: 0`, `realCodexCalls: 0`,
`realProviderProcessExecutions: 0`, `realNetworkCalls: 0`,
`realFilesystemWrites: 0`, `workspaceBoundaryViolations: 0`,
`unexplainedResourceCreation: 0`, `causalityViolations: 0`,
`centralTaskAssignments`/`queenTaskAssignments`/`tamaraDirectAntAssignments`/
`globalPlannerDecisions` all 0, `injectedDefects: 1`, `finalObjectivePassed:
true`, `allExpectationsMet: true`, and every `scaleChecks[*]` conserved at 300 /
1,000 / 10,000.

**The workspace is boundary-enforced (mechanical):** `validateWorkspacePath`
rejects traversal, absolute/drive paths, backslash/junction, and protected names
(.env, keys, tokens, credentials, ssh, certs, .git); the in-memory driver bounds
file count / bytes / total size and reports `realFilesystemWrites === 0`.

**Verification is allowlisted (mechanical):** `isAllowedVerificationCommand`
accepts only the four hard-coded (executable, args) pairs; the automated runtime
uses `FakeVerificationDriver` (no spawn). Real execution is human-authorized only
and not wired.

**The real-objective CLI is inert:** `src/cli/digitalRealObjectiveCli.ts` prints
its contract and refuses; it imports no fs/child_process/network and takes no
action (`enabled: false`).

## 17. Digital Superorganism Live Objective V3 (`src/cognitive/liveObjectivePermit.ts`, `src/digital/live*.ts`, `src/cli/digitalLiveObjectiveCli.ts`, Build Law §25)

The V3 live-objective layer adds no new filesystem, process, or network surface.
The real-fs live workspace is confined to the already-authorized
`smokeWorkspace.ts` (still one of exactly two fs-mutation modules), and the
automated demo makes zero real calls.

**No new fs / child_process importer** — counts unchanged:
```
grep -rln 'from "fs"' src --include="*.ts" | grep -v '^src/tools/' | wc -l   # expect 4
grep -rlnE 'require\("child_process"\)|from "child_process"' src --include="*.ts" | wc -l   # expect 1
grep -rlnE "writeFile|writeFileSync|appendFile|mkdirSync|rmSync|unlinkSync|renameSync|copyFileSync|createWriteStream|truncateSync|chmodSync|openSync|writeSync" src --include="*.ts" | wc -l   # expect 2
```
Expected: `3`, `1`, `2`. The live-objective real-fs surface lives inside the
existing `smokeWorkspace.ts` (human-only, never imported by a demo/test).

**The live demo makes zero real action** — run it and confirm:
```
node dist/examples/demoDigitalLiveObjectiveV3.js
```
Expected: `realClaudeCalls: 0`, `realCodexCalls: 0`,
`realProviderProcessExecutions: 0`, `realNetworkCalls: 0`,
`realFilesystemWrites: 0`, `workspaceBoundaryViolations: 0`, `sourceTreeWrites:
0`, `providerBudgetViolations: 0`, `safetyViolations: 0`,
`acceptedLiveCohortSize: 3`, `providerCallsStarted: 3`, `repairCalls: 1`,
`repairRounds: 1`, `selfReviewsAccepted: 0`, central/queen/tamara/global-planner
all 0, `finalObjectivePassed: true`, `allExpectationsMet: true`, and an empty
`mismatchCaseIds` (24 guard cases, 33 expectations).

**The live permit is non-forgeable (mechanical):** `isValidLivePermit` is WeakSet
identity; a JSON/object-literal permit is never valid; `consumeLivePermit` is
single-use; `recordProviderCall` enforces initial ≤ 3, repair ≤ 2, total ≤ 5.

**The live CLI is TTY-only and stops after minting:**
`src/cli/digitalLiveObjectiveCli.ts` refuses without an interactive TTY, requires
the exact phrase `RUN DIGITAL OBJECTIVE WITH 3 ANTS` (never y/yes/true/flag/pipe),
mints one permit, and stops — no automatic provider call, no background
continuation. It imports no fs/child_process/network.

## 18. Digital Superorganism Live Objective V4 — real driver wiring (Build Law §26)

V4 wires the real live path while keeping every boundary. The real verification
spawn lives inside the ONE `child_process` module; the real writes inside the
authorized `smokeWorkspace`; automated tests use only fakes.

**Boundaries unchanged** — counts hold:
```
grep -rlnE 'require\("child_process"\)|from "child_process"' src --include="*.ts" | wc -l   # expect 1
grep -rln 'from "fs"' src --include="*.ts" | grep -v '^src/tools/' | wc -l   # expect 4
grep -rlnE "writeFile|writeFileSync|appendFile|mkdirSync|rmSync|unlinkSync|renameSync|copyFileSync|createWriteStream|truncateSync|chmodSync|openSync|writeSync" src --include="*.ts" | wc -l   # expect 2
grep -rlnE 'from "(fs|net|http|https|child_process)"' src/cognitive/liveProviderExecution.ts src/cognitive/liveRealDrivers.ts src/cli/digitalLiveObjectiveCli.ts || echo CLEAN
```
Expected: `1`, `3`, `2`, `CLEAN` (the V4 modules delegate real spawn/writes to the
single authorized importers and import neither directly).

**Automated wiring makes zero real action** — run it:
```
node dist/examples/demoDigitalLiveObjectiveV4Wiring.js
```
Expected: `realClaudeCalls: 0`, `realCodexCalls: 0`,
`realProviderProcessExecutions: 0`, `realNetworkCalls: 0`,
`realFilesystemWrites: 0`, `workspaceBoundaryViolations: 0`, `sourceTreeWrites:
0`, `providerBudgetViolations: 0`, `selfReviewsAccepted: 0`,
`providerCallsStarted: 3`, `repairCalls: 1`, `finalObjectivePassed: true`,
`allExpectationsMet: true`, empty `mismatchCaseIds` (15 guard cases). A guard
proves the real Node process driver refuses an automated-test-origin permit
WITHOUT executing.

**Dry-run does nothing real** — no TTY needed, no directory created:
```
node dist/cli/digitalLiveObjectiveCli.js --providers claude,claude,codex --dry-run
```
Expected: `status: "dry-run-complete"` after full validation + cohort selection +
request building; no `workspaces/digital-live-objective/` directory is created, no
provider process runs, and no live permit is consumed. The REAL run (without
`--dry-run`) refuses unless `process.stdin.isTTY` and the exact phrase `RUN
DIGITAL OBJECTIVE WITH 3 ANTS` is typed; each repair call requires the separate
exact phrase `RUN ONE REPAIR ANT`.

## 19. Windows Codex invocation fix (`liveProviderExecution.ts`, `nodeProviderProcessDriver.ts`)

The Windows Codex stdin-timeout fix keeps every boundary: the executable stays
hard-coded, all flags are fixed, `shell:false` is unchanged, and the bounded
prompt is delivered as Codex's single final POSITIONAL argument with EMPTY stdin
(Claude is unchanged — prompt on stdin).

**Codex flags are fixed and the executable is still hard-coded** — expect the
base flags and the hard-coded map:
```
grep -nE 'CODEX_BASE_ARGS|CLAUDE_ARGS' src/cognitive/liveProviderExecution.ts
grep -nE "claude:|codex:" src/cognitive/nodeProviderProcessDriver.ts
```
Expected: `CODEX_BASE_ARGS = ["exec", "--ephemeral", "--json"]`, `CLAUDE_ARGS =
["--print", "--output-format", "json"]`, and the two literal executable entries.
The prompt is appended as the single final positional element (`shell:false`, so
it can never become a flag), and Codex `stdinData` is `""`.

**The real driver is never imported by any automated demo** (restored/strengthened
— the V4 wiring demo now uses a local `isReal` stub, not the real driver) — expect
no output:
```
grep -rn "nodeProviderProcessDriver" src/examples --include="*.ts"
```

**The Codex fix is proven with zero real action** — run it:
```
node dist/examples/demoCodexInvocationFix.js
```
Expected: `allExpectationsMet: true`, `codexGuardsChecked: 14`, and
`realClaudeCalls`/`realCodexCalls`/`realProviderProcessExecutions`/
`realFilesystemWrites`/`realNetworkCalls` all 0. It proves (via a spy process
driver) the Codex invocation shape `exec --ephemeral --json <PROMPT>`, empty
Codex stdin, unchanged Claude invocation, multi-line JSONL parsing, agent_message
(CODEX_OK) extraction, stderr warnings not failing an exit-0 result, and
missing/malformed output failing safely. No Codex or Claude process is executed.

## 20. Live-objective pre-spawn hang fix (readline lifecycle)

The human live CLI never holds `process.stdin` open across provider execution: a
long-lived readline would block the synchronous provider spawn on Windows and
read as an indefinite pre-spawn hang. Each interactive prompt uses `askOnce`,
which opens ONE readline, reads one answer, and CLOSES it immediately.

**The CLI opens no long-lived readline** — expect no `createInterface` in the CLI
(the only one lives in `askOnce`, which self-closes):
```
grep -n "createInterface" src/cli/digitalLiveObjectiveCli.ts || echo "(none — uses askOnce)"
grep -n "createInterface" src/cli/liveObjectiveCliHelpers.ts
```
Expected: `(none — uses askOnce)` for the CLI, and exactly the `readline` import +
one use inside `askOnce` for the helper.

**The pre-spawn sequence is proven with zero real action** — run it:
```
node dist/examples/demoLiveObjectivePreSpawn.js
```
Expected: `allExpectationsMet: true`, `preSpawnStagesReached: 7`,
`fakeProcessRunCount: 3`, and all real-action counters 0. It proves the exact
confirmation is accepted, `askOnce` requests one input and closes the readline, no
second hidden input precedes the first provider call, the preparation reaches
`provider-spawn-starting`/`provider-spawn-completed`, and the fake process
driver's `run()` is actually invoked. The CLI also arms a
`pre-spawn-preparation-timeout` watchdog so a future async stall fails loudly
instead of hanging.

## 21. Namla Digital Civilization OS V1 (`src/civilization/`, Build Law §27)

The civilization layer is pure and deterministic: it adds no filesystem, process,
network, timer, wall clock, or ambient randomness, and every real-action counter
stays 0. It reuses the existing conserving economy and worker persistence.

**No forbidden imports, timers, clock, or ambient randomness in `src/civilization/`**
— expect `CLEAN`, and no module-level mutable state:
```
grep -rlnE 'from "(fs|net|http|https|dgram|dns|child_process|worker_threads)"|Date\.now|new Date\(|Math\.random|setTimeout|setInterval' src/civilization --include="*.ts" || echo CLEAN
grep -rnE "^(let|var) " src/civilization --include="*.ts" || echo "(none)"
```
Expected: `CLEAN` and `(none)` (all draws use the seeded `civDraw`/`digitalDraw`).

**Core importer counts are unchanged** — the civilization layer adds no new
surface:
```
grep -rln 'from "fs"' src --include="*.ts" | grep -v '^src/tools/' | wc -l   # expect 4
grep -rlnE 'require\("child_process"\)|from "child_process"' src --include="*.ts" | wc -l   # expect 1
```
Expected: `3` and `1`.

**The civilization demo proves the whole settlement at runtime with zero real
action** — run it:
```
node dist/examples/demoNamlaCivilizationOSV1.js
```
Expected: `allExpectationsMet: true`, `districtsCreated: 20`,
`tamaraObjectivesReceived: 1`, `quorumReached: true`, `minorityReports >= 1`,
`nonVolunteerAssignments: 0`, `peakCognitiveAnts <= 30`, `mcpToolCalls > 0`,
`mcpToolFailures > 0`, `providerCalls > 0`, `realProviderCalls: 0`,
`failuresDetected >= 2`, `repairsCompleted > 0`, `knowledgeAccepted > 0`,
`knowledgeContradictions > 0`, `finalObjectivePassed: true`,
`digitalResourceConservationValid: true`, `unexplainedResourceCreation: 0`,
`causalityViolations: 0`, central/queen/tamara/global-planner all 0,
`realNetworkCalls`/`realFilesystemWrites`/`processExecutions` all 0, an empty
`mismatchCaseIds`, and every `scaleChecks[*]` conserved + causality-clean +
bounded-cognitive at 300 / 1,000 / 10,000.

## 22. Namla Civilization OS V2 — Live MCP (`src/civilization/civLive*.ts`, `src/cognitive/civilizationLivePermit.ts`, `src/cli/civilizationLiveCli.ts`, Build Law §28)

The V2 live layer wires the settlement to bounded provider + MCP cognition while
keeping every boundary. Real provider execution reuses the V4 path; real MCP file
writes route through `smokeWorkspace` and verification through the one
`child_process` importer; automated tests use only fakes.

**No new fs / child_process importer** — counts unchanged:
```
grep -rln 'from "fs"' src --include="*.ts" | grep -v '^src/tools/' | wc -l   # expect 4
grep -rlnE 'require\("child_process"\)|from "child_process"' src --include="*.ts" | wc -l   # expect 1
grep -rlnE 'from "(fs|net|http|https|dgram|dns|child_process|worker_threads)"|Date\.now|new Date\(|Math\.random|setTimeout|setInterval' src/civilization --include="*.ts" || echo CLEAN
```
Expected: `3`, `1`, `CLEAN` (the V2 civilization modules delegate real spawn/writes
to the already-authorized modules and import neither fs nor child_process; the
`setTimeout` watchdog lives only in the digital live CLI, not the civilization layer).

**The live demo makes zero real action** — run it:
```
node dist/examples/demoNamlaCivilizationLiveV2.js
```
Expected: `allExpectationsMet: true`, `acceptedLiveCohortSize` in 1..5 (3 here),
`voluntaryLiveClaims >= 15`, `councilsActivated >= 5`, `minorityReports >= 1`,
`providerCalls > 0`, `realProviderCalls: 0`, `mcpToolGrants >= 8`,
`mcpToolFailures > 0`, `providerFailures > 0`, `securityFindings > 0`,
`verificationFailures >= 1`, `incidentsCreated > 0`, `repairsCompleted > 0`,
`finalObjectivePassed: true`, `realProviderProcessExecutions: 0`,
`realMcpExecutions: 0`, `realNetworkCalls: 0`, `realFilesystemWrites: 0`,
`conservationValid: true`, `unexplainedResourceCreation: 0`, `safetyViolations: 0`,
central/queen/tamara/global-planner all 0, empty `mismatchCaseIds`.

**The civilization live permit is non-forgeable (mechanical):**
`isValidCivilizationPermit` is WeakSet identity; a JSON/object-literal permit is
never valid; `consumeCivilizationPermit` is single-use; `recordCivilizationCall`
enforces ≤5 initial, ≤3 repair, ≤8 total provider calls plus MCP/verification
budgets.

**Dry-run does nothing real; the CLI is TTY-only for the real path:**
```
node dist/cli/civilizationLiveCli.js --providers codex,codex,claude --cohort 3 --dry-run
```
Expected: `status: "dry-run-complete"` with no `workspaces/namla-civilization/`
directory created, no provider/MCP execution, and no permit consumed. The real run
requires an interactive TTY and the exact dynamic phrase `RUN NAMLA CIVILIZATION
WITH <N> ANTS`; each repair call requires `RUN ONE CIVILIZATION REPAIR ANT`. The V1
civilization demo and the V4 live-objective path remain intact.

**The live execution path is connected and provably fake in tests** — after the
exact phrase the CLI runs the bounded live session (`runCivilizationLiveSession`):
real provider cognition via `RealLiveProviderDriver`→`NodeProviderProcessDriver`,
real MCP via `RealMcpExecutionDriver`, reviewed-file application, allowlisted
verification, and — only after the separate repair phrase — one bounded repair
round; it then reports and stops (no automatic retry, no background continuation).
The real civilization workspace lives only under `workspaces/namla-civilization/
<run-id>/`, gated by the new `ensureCivilizationWorkspace` allowlist in the
already-authorized `smokeWorkspace` module (no new fs importer; the counts above
stay `3`/`1`). Run the regression proof:
```
node dist/examples/demoCivilizationLiveWiring.js
```
Expected: `allExpectationsMet: true`, `expectationsChecked: 34`, empty
`mismatchCaseIds`; `fakeProviderRuns > 0`, `mcpToolCalls > 0`, cohort ⊆ volunteers,
councils activated, no self-review, reviews before application,
`verificationFailures: 1` → `incidentsCreated >= 1` → `repairCalls: 1`
→ `finalObjectivePassed: true`; `orderingEvents` shows all initial `provider-run`s
BEFORE the single `repair-confirm` (no hidden confirmation before initial provider
execution); and every real-action counter (`realProviderProcessExecutions`,
`realProviderCalls`, `realMcpExecutions`, `realFilesystemWrites`, `realNetworkCalls`)
is 0.

**Operational hardening (Build Law §28 pre-flight):** the human CLI runs a
read-only pre-flight before any confirmation. `inspectCivilizationWorkspace`
(no creation/mutation) reports the resolved path, inside-root, existing file/byte
count, new-vs-reused, and `staleOutput`; if the run directory already holds
prior-run output the CLI **refuses** (`stale-workspace-output`) and asks the human
to archive/rename it — **nothing is deleted or overwritten**. `detectProviderAvailability`
runs each provider's own `--version` (bounded, `shell:false`, fixed arg, timeout,
safe env — **unpaid**, no prompt/cognition/cost) inside the one `child_process`
importer; it is non-fatal and never runs in dry-run or automated tests. The whole
run is wrapped so a final report (or a redacted `error` summary carrying the error
NAME only) is ALWAYS produced. Prove cleanup with:
```
node dist/examples/demoCivilizationLiveCleanup.js
```
Expected: `allExpectationsMet: true`, `expectationsChecked: 26`, empty
`mismatchCaseIds` — across clean-success, confirmed-repair, and rejected-repair, the
permit is consumed and NOT reusable, every MCP grant issued was revoked
(`grantsIssued === grantsRevoked`), the readline closes immediately, the watchdog
once cleared never fires, and every `real*` counter is 0. See
[civilization-live-preflight.md](docs/civilization-live-preflight.md) for the full
transition matrix. The added `readdirSync`/`statSync` reuse `smokeWorkspace`'s
existing fs import and `detectProviderAvailability` reuses the one `child_process`
importer, so the `3`/`1` counts are unchanged.

## 23. Tamara–Namla Sovereign Federation V3 (Build Law §29)

Run the proofs:
```
node dist/examples/demoTamaraNamlaFederationV3.js       # 57 checks, Tamara accepts on evidence
node dist/examples/demoCivilizationCapabilityPipeline.js # 30 checks, cohort/contract/gating/repair
```
Expected: `allExpectationsMet: true`, empty `mismatchCaseIds`, every real-action
counter 0, `tamaraFinalDecision: "accepted"` only after green evidence. Mechanical
invariants: capability-complete admission refuses `cohort-capability-gap`;
verification never runs on an empty workspace (`verification-not-vacuous` check);
repair claimants are implementation-capable; role contracts reject malformed/
oversized/traversal/source-tree/command-injection/secret-like provider output;
`future-approved-mcp` capabilities cannot be granted; passports refuse
self-certification; the federation state machine has no silent transitions (every
change receipted). The fs/child_process importer counts stay `3`/`1`;
`src/federation`, `src/civilization`, and the learning loop import no real-action
modules.

## 24. Workspace Security Kernel — the authorized `fs` importers

`src/cognitive/safeWorkspacePath.ts` is the CENTRALIZED path-security kernel.
Every real workspace write in Namla routes through `SafeWorkspacePathResolver` +
`safeWriteWorkspaceFile`; no other module re-implements path validation.

The kernel closes what `path.resolve` cannot: `resolve()` is purely lexical, so a
symlink or Windows junction in any existing parent component could still land a
write outside the authorized root. The kernel `lstat`s every existing component,
refuses symlinks/reparse points (`symlink-parent-escape` / `symlink-target-escape`),
compares `realpath` against the real workspace root, re-validates immediately
before the write (TOCTOU), and never silently overwrites — exclusive `wx`
creation by default, atomic staged-write-then-rename for explicit overwrites.
Byte budgets are real UTF-8 bytes (`Buffer.byteLength`), never character counts.

**The authorized production `fs` importers are now exactly FOUR:**

```
grep -rln 'from "fs"' src --include="*.ts" | grep -v '^src/tools/'
```

Expected, and only these:
- `src/application/projectFileCreator.ts` — authorized project-file surface
- `src/cognitive/smokeWorkspace.ts` — authorized workspace roots (delegates every write to the kernel)
- `src/cognitive/safeWorkspacePath.ts` — the security kernel itself (the 4th, added deliberately)
- `src/inspector/projectInspector.ts` — read-only inspection

`src/tools/workspaceSecurityTests.ts` also imports `fs`, but it is a TEST that
operates exclusively on an OS temp directory, never the repository — hence the
`src/tools/` exclusion above.

**The Twin Bundle Store adds NO fs importer.** Prove it:

```
grep -c 'from "fs"' src/twin/twinBundleStore.ts src/cognitive/twinBundleRealStore.ts
```

Expected: `0` for both. `twinBundleStore.ts` is pure (contract + in-memory fake +
validation); `twinBundleRealStore.ts` performs real persistence only by
delegating to `smokeWorkspace`'s `writeLiveObjectiveFile` / `readLiveObjectiveFile`,
which themselves route through the kernel.

Bundle-store safety is mission- AND colony-scoped: `guardRecordForWrite` refuses a
cross-colony write (`cross-colony-write-refused`), a cross-mission write
(`cross-mission-write-refused`), an unfrozen bundle (`bundle-not-frozen`), and a
bundle whose digest does not recompute (`bundle-fingerprint-mismatch`). Bundles
are write-once (`file-exists-refused-overwrite`) and a missing record returns an
explicit `bundle-not-found` / `attempt-not-found`. Verify:

```
node --test dist/tools/twinBundleStoreTests.js
node --test dist/tools/workspaceSecurityTests.js
```

## 25. Provider Output and Receipt Redaction Kernel (`src/cognitive/safeRedactor.ts`)

`SafeRedactor` is the SINGLE redaction boundary. Every untrusted
provider-derived string must pass through it before it reaches a receipt, stage
log, diagnostic summary, error summary, frozen-bundle metadata, attempt record,
resume record, customer-safe report, persisted manifest, or the terminal. No
caller may implement its own redaction — a second regex set is a second thing to
get wrong, exactly as with `SafeWorkspacePathResolver` (§24).

### The rule: no secret value is ever emitted, anywhere

The original matched secret is never returned, persisted, hashed, fingerprinted,
logged, or included in any output field. Matches are replaced by stable markers
(`[REDACTED:OPENAI_KEY]`, `[REDACTED:GITHUB_TOKEN]`, `[REDACTED:BEARER_TOKEN]`,
`[REDACTED:PRIVATE_KEY]`, `[REDACTED:AWS_KEY]`, `[REDACTED:COOKIE]`,
`[REDACTED:OAUTH_TOKEN]`, `[REDACTED:SECRET_VALUE]`). `RedactionResult` exposes
only `redactedText`, `redactionCount`, `redactionCategories`, `acceptedBytes`,
`rejectedBytes`, `truncated`, `safeFingerprint` — there is no field through
which raw text could escape.

`safeFingerprint` is computed over the REDACTED text ONLY. A digest of the raw
value would be a side channel (a known secret could be confirmed by comparing
digests), so the hash never sees the original.

### Ordering is the invariant, not just the patterns

1. Registered + per-call environment-secret VALUES are scrubbed literally, so an
   exact credential dies even when it matches no structural pattern.
2. Structural rules run most-specific first (PEM block, then `sk-`/`ghp_`/AWS,
   then `Authorization`/OAuth/cookie, then generic `key=value`).
3. The UTF-8 byte bound is applied LAST.

Redaction runs BEFORE truncation. If it ran after, a secret straddling the cut
point could survive as a prefix in the persisted record. Proven by the test
`a secret is redacted even when it straddles the byte limit`.

Already-redacted text is never re-redacted: a later generic rule that matched an
earlier rule's marker would double-count and mangle structured output (JSON must
stay parseable). `detectResidualSecrets` strips markers before scanning for the
same reason — a marker is proof of success, not a leak.

### Proof that raw provider strings cannot reach persistence

Redaction is enforced at the boundary, not at the call site, so forgetting to
redact is not sufficient to leak:

- `civRoleContracts.normalizeCivRoleOutput` redacts `planSummary` and artifact
  `purpose` — the single point where provider output becomes a role output.
- `twinBundleStore.buildPersistedAttempt` redacts `failureReason`,
  `reviewSkippedReason`, and every diagnostic `failureCategory`, and fingerprints
  the REDACTED reason. Resume records derive from that attempt, so
  `resume.json` inherits the guarantee.
- `liveObjectiveCliHelpers.logStage` routes all stage metadata through
  `redactMeta` before `console.log` — terminal output is covered.
- `safeErrorSummary` yields `{ name, safeMessage, safeFingerprint }` only: a
  redacted, bounded message and never a stack trace or raw payload.

The persistence test hands RAW secrets to `buildPersistedAttempt` deliberately,
writes `bundle.json` / `attempt.json` / `resume.json` / `diagnostics.json` to a
REAL temp directory, reads them back off disk, and asserts zero raw secrets and
zero residual matches. Real-action counters stay zero throughout.

Ordinary source code is untouched unless it actually matches a secret pattern —
verified by `clean non-secret text and ordinary source code are unchanged`.

### UTF-8 is measured in bytes, never in UTF-16 units

Byte budgets use `Buffer.byteLength(value, "utf8")` via `utf8Bytes`, and
truncation backs off to a valid UTF-8 boundary, so Arabic, Hebrew, CJK, and
emoji are never split into replacement characters. `acceptedBytes` and
`rejectedBytes` are exact.

### Focused tests

```
npx.cmd tsc --noEmit
node --test dist/tools/safeRedactorTests.js
node --test dist/tools/workspaceSecurityTests.js
node --test dist/tools/twinBundleStoreTests.js
node dist/examples/demoGoldenOutputs.js
```

## 26. Provider Request-Side Secret Containment (`src/cognitive/safeProviderRequest.ts`)

§25 stops secrets on the way IN (provider output → receipts, persistence).
`safeProviderRequest` stops them on the way OUT. Nothing reaches a provider
CLI's argv, stdin, child environment, an API request body, or a request manifest
except through `buildSafeProviderRequest`.

### Outbound fails CLOSED; inbound redacts

This asymmetry is the central rule, not an implementation detail:

- INBOUND, redaction is sufficient. A provider that echoed a secret back has
  already been shown it; scrubbing the receipt is all that remains.
- OUTBOUND, redaction is NOT sufficient. If an assembled prompt contains a live
  credential, the safe act is to NOT SEND IT AT ALL. Redacting and continuing
  would still transmit the surrounding context, and would silently normalize a
  caller bug that is leaking real authentication material into prompt assembly.

High-confidence authentication material therefore BLOCKS the whole request with
`provider-request-secret-blocked`: OpenAI keys, GitHub tokens/PATs, bearer and
Authorization credentials, OAuth access/refresh tokens, AWS keys, session
cookies, passwords, PEM blocks, SSH private material (`OPENSSH PRIVATE KEY`,
`ssh-rsa AAAA…`, PuTTY keys), and registered environment-secret values.

A blocked result carries `spec: null` and `env: null`, so a caller is
STRUCTURALLY unable to hand it to a driver. The decisive test assertion is a
counting fake driver's `runs === 0`: a request inspected and refused *after*
spawning would already have leaked.

Detection reuses the §25 rule set via `detectResidualSecrets`, so there is
exactly one definition of "this is a credential" in the codebase. Registered
environment secrets match no structural pattern, so the kernel exposes
`containsRegisteredEnvironmentSecret` — a PREDICATE, never a getter: the
outbound boundary can fail closed on a literal credential without the registered
values ever being exposed, returned, or digested.

Lower-risk secret-SHAPED text (a long unbroken base64/hex blob, a UUID — usually
a hash, fixture, or embedded asset) is redacted to `[REDACTED:ENTROPY]` /
`[REDACTED:UUID]` and sent, with a safe receipt. Blocking those would reject
ordinary legitimate prompts; the rules are deliberately narrow so real source
code is untouched.

### Argv, executable, and environment are built here — never by a caller

- Fixed executable map (`claude`, `codex`) — never a path, never mission text.
- Fixed flag templates. `liveProviderExecution.ts` no longer defines its own
  copy; a second definition would drift.
- Mission text can only ever become the SINGLE final positional argv entry, and
  `shell: false` means a positional entry can never be reinterpreted as a flag.
  Proven by feeding `--dangerously-skip-permissions … ; rm -rf /` as prompt text
  and asserting `argumentList.length === 4`.
- The child environment is an explicit NAME allowlist minus
  `FORBIDDEN_ENV_NAME_PATTERN` (TOKEN, SECRET, PASSWORD, COOKIE, SESSION,
  PRIVATE_KEY, API_KEY, CREDENTIAL, AUTH, KEY, PRIVATE). `process.env` is read
  by explicit key and NEVER enumerated, so a credential variable cannot be
  forwarded by accident. Environment VALUES are never logged, fingerprinted, or
  placed in a receipt.
- A caller asking to forward a credential-shaped env NAME is refused
  (`forbidden-environment-name`), not silently filtered — a silent drop hides a
  caller bug.

### Byte bounds are real UTF-8 on every outbound surface

The assembled prompt, provider stdin, argv fields, context excerpts, and
manifest fields are all bounded with `truncateUtf8`. This replaced a
`rawPrompt.slice(0, maxStdinBytes)` in `liveProviderExecution.ts`, which counted
UTF-16 units rather than bytes and could split a surrogate pair mid-emoji.

### Receipts carry ten safe fields and nothing else

`requestId`, `providerId`, `role`, `acceptedBytes`, `rejectedBytes`,
`redactionCount`, `redactionCategories`, `blocked`, `safeReasonCode`,
`safeFingerprint` — asserted exactly, by key, against a manifest read back off
disk. Never the original prompt, a raw secret, an environment value,
secret-bearing argv, or a provider credential. A BLOCKED receipt's fingerprint
is the constant `spr-blocked`: digesting a blocked secret would be a side
channel.

### Focused tests

```
npx.cmd tsc --noEmit
node --test dist/tools/providerRequestContainmentTests.js
node --test dist/tools/safeRedactorTests.js
node --test dist/tools/workspaceSecurityTests.js
node --test dist/tools/twinBundleStoreTests.js
node dist/examples/demoGoldenOutputs.js
```

## 27. Filesystem Authority Centralization (P0.1)

`src/cognitive/safeWorkspacePath.ts` is the ONE filesystem security kernel.
Every real workspace read, write, delete, rename, realpath, lstat, and atomic
replacement goes through it. No other module may implement containment.

### The defect this closed

Writes were centralized; READS were not. `readLiveObjectiveFile` in
`smokeWorkspace.ts` carried its own validation: a private regex set, a naive
`target.startsWith(root + sep)` prefix compare, and `statSync` — which FOLLOWS
symlinks. A junction planted inside an authorized workspace therefore returned
the contents of a file outside it. Reproduced before the fix:

```
read result: {"ok":true,"content":"TOP-CONFIDENTIAL-EXTERNAL"}
READ ESCAPE CONFIRMED - external file exfiltrated
```

and after routing the read through the kernel:

```
read result: {"ok":false,"reasonCode":"resolved-outside-workspace"}
```

This is the general lesson: a second implementation of a security check is not
redundancy, it is the weakest link. The duplicate was strictly weaker than the
kernel it duplicated, and it was invisible because the module *did* use the
kernel — for writes only.

### The kernel surface

| Operation | Entry point |
| --- | --- |
| resolve/validate | `SafeWorkspacePathResolver.forRoot` + `resolveForWrite` |
| read | `safeReadWorkspaceFile` |
| write / atomic replace | `safeWriteWorkspaceFile` |
| delete | `safeDeleteWorkspaceFile` |
| rename | `safeRenameWorkspaceFile` |

All five share one validation path, so a single hostile input is refused
identically by each — there is no weaker surface to attack. Proven by
`every mutating and reading kernel entry point revalidates before acting`.

Every operation `lstat`s (never `stat`) each existing component, refuses
symlinks and Windows junctions, compares `realpath` against the real root, and
**re-validates immediately before mutating** (TOCTOU). Rename validates source
and destination INDEPENDENTLY: a valid source never authorizes an arbitrary
destination. Source-tree writes remain forbidden at the workspace-id level.

Reason codes are explicit and unchanged: `path-traversal`, `absolute-path`,
`null-byte`, `illegal-char`, `home-expansion`, `empty-path`, `path-too-long`,
`resolved-outside-workspace`, `symlink-parent-escape`, `symlink-target-escape`,
`file-exists-refused-overwrite`, `content-too-large`, `write-failed`,
plus `not-found` / `file-too-large` / `read-failed` on the read path.

### Authorized `fs` importers — the exact list

Production modules that may import `fs` at all (six, verified with
`grep -rln 'from "fs"' src/ --include=*.ts | grep -v '^src/tools/\|^src/examples/'`):

1. `src/cognitive/safeWorkspacePath.ts` — THE kernel. All containment lives here.
2. `src/cognitive/smokeWorkspace.ts` — human-only workspace surface; routes
   every read and write through the kernel. Retains `existsSync`/`mkdirSync`/
   `readdirSync`/`statSync` only for workspace-root creation and bounded
   directory-metadata walks, never for content access.
3. `src/application/projectFileCreator.ts` — durable write (`openSync`/`writeSync`/
   `fsyncSync`/`closeSync`) behind the write-authority chain.
4. `src/inspector/projectInspector.ts` — read-only repository inspection.
5. `src/cognitive/twinBundleRealStore.ts` — persists via `smokeWorkspace`, not raw fs.
6. `src/cognitive/trustedExecutableRegistry.ts` — §26. Uses `lstat`/`realpath`/
   `readFile` to prove an executable is a real, non-symlinked file. This is
   executable identity, not workspace containment, and it never writes.

Any NEW `fs` importer must be added here with a justification, or routed
through the kernel instead.

### Focused tests

```
npx.cmd tsc --noEmit
node --test dist/tools/workspaceSecurityTests.js
node dist/examples/demoGoldenOutputs.js
```

`workspaceSecurityTests` covers nested junction escape, prefix collision
(`workspace-safe` vs `workspace-safe-evil`), platform case semantics, read /
delete / rename escape, cross-colony operations, unauthorized overwrite, and
TOCTOU revalidation. Every test asserts the external tree is byte-identical
afterwards — a reason code alone cannot prove nothing was touched.

Verified non-vacuous: disabling the kernel's link-chain check fails 7 tests;
reverting the read path to its old lexical form fails 4, including the
read-escape test.

Honest skip: file-symlink escape is skipped on Windows, which refuses file
symlink creation without elevation. Directory junctions ARE creatable here, so
all junction-based escapes are genuinely exercised.

## 28. Fail-Closed Sandbox Policy Boundary (P0.3 / P0.4)

Running provider-generated code, `npm test`, a build, or any package script is
arbitrary code execution: a generated `package.json` can put anything in
`scripts`. An allowlist of npm subcommands does not make the underlying script
safe. A temp directory is not a sandbox. A subprocess timeout is not a sandbox.

`src/cognitive/sandboxPolicy.ts` is a POLICY GATE, not an isolation
implementation. It answers one question — is verified isolation available right
now — and refuses when the answer is no.

### Verified-sandbox requirement

High-risk execution is authorized ONLY when capability is
`available-and-verified`. The four states are deliberately distinct:

| State | Authorizes high-risk? | Meaning |
| --- | --- | --- |
| `available-and-verified` | YES | backend exists AND isolation was verified |
| `available-unverified` | NO — `sandbox-capability-unverified` | a runtime binary was detected, nothing more |
| `unavailable` | NO — `sandbox-runtime-unavailable` | nothing usable |
| `fake-test-backend` | NO — `sandbox-fake-backend-not-permitted` | deterministic test double |

A successful `docker --version` proves a CLI is installed. It proves nothing
about cgroup limits, namespaces, or network policy. Detection therefore returns
at most `available-unverified` and claims NO isolation properties
(`NO_ISOLATION_CLAIMS`, all 19 false).

### Fail closed, and NEVER fall back to the host

When no verified backend exists the gate returns `spec`-less refusal BEFORE any
process is created. There is no host-execution fallback anywhere in
`authorize()`. A silent fallback would be strictly worse than an error: the
caller would believe it was sandboxed and behave accordingly.

`runVerificationCommand` asks the gate first. On this host, with no container
runtime installed, it returns:

```
ran: false, status: "failed", failureCategory: "sandbox-runtime-unavailable"
```

A blocked receipt reports `cpuLimit: 0`, `memoryLimitMb: 0`, `pidLimit: 0`,
`mountPolicy: "none"` — reporting the REQUESTED limits would imply something
enforced them, and nothing ran.

### Fake-backend labelling

`FakeSandboxBackend` reports `backendId: "fake-test-backend"`, `isReal: false`,
and `NO_ISOLATION_CLAIMS`. It is permitted only in automated tests and can
never authorize high-risk execution or be projected as real isolation.

### Default-deny network, forbidden mounts and namespaces

`DEFAULT_SANDBOX_POLICY` denies the network with an empty allowlist. The gate
refuses, even on a VERIFIED backend:

- any `hostMounts` entry — `sandbox-host-mount-refused`
- Docker socket mount — `sandbox-docker-socket-refused`
- credential mount or `inheritEnvironmentSecrets` — `sandbox-credential-mount-refused`
- `privileged` — `sandbox-privileged-refused`
- host PID / host network namespace — `sandbox-host-namespace-refused`
- root or shared user — `sandbox-user-policy-refused`
- `allowed` network, or `denied` carrying an allowlist — `sandbox-network-policy-refused`
- non-disposable filesystem or no cleanup — `sandbox-cleanup-policy-refused`
- any zero/absent limit — `sandbox-limits-missing`
- missing human authorization — `sandbox-human-authorization-missing`

Mounts are described as a CLASS (`bounded-workspace-only`), never as host paths.

### Command-centre projection

`projectSandbox` sets `sandboxExecutionBlocked: true` for every state except
`available-and-verified`, and reports `sandboxLimits: "none-enforced"` and
`sandboxMountPolicy: "none"` when unverified. `describeSandbox` prints
`NOT SANDBOXED (<state>) reason=<code>` — it can never display "sandboxed"
without a verified backend.

### NOT VERIFIED on this host

No container runtime is installed here (`docker` and `podman` both return
ENOENT), so capability is `unavailable`. `ContainerSandboxBackend` is an
INTERFACE ONLY — no container implementation ships. Real cgroup limits,
namespace isolation, disposable filesystems, and default-deny networking are
therefore **unverified**, and this document does not claim otherwise. P0.3/P0.4
remain partially open pending a verified runtime.

### Focused tests

```
npx.cmd tsc --noEmit
node --test dist/tools/sandboxPolicyTests.js
node --test dist/tools/trustedExecutableTests.js
node dist/examples/demoGoldenOutputs.js
```

## 29. Cross-Platform P0 Security CI

Windows can create junctions unprivileged but not file symlinks. Linux and
macOS can create both. A single-platform run therefore cannot prove the
containment kernel, and two real escapes were skipped locally in every previous
milestone.

`.github/workflows/p0-security.yml` runs the whole P0 suite on
`windows-latest`, `ubuntu-latest`, and `macos-latest`.

### A skip is honest only where the platform is genuinely incapable

This is the invariant the matrix exists to enforce. An honest skip is correct
when a platform cannot perform an operation; it becomes a LIE the moment it is
used on a platform that can, because "skipped" then reads as "fine" forever and
the escape is silently untested everywhere.

`p0SecurityRunner` therefore treats a skip of any of these as a FAILURE on
Linux and macOS:

- `rejects a symlinked FILE target pointing outside the workspace`
- `a SYMLINKED executable is refused`
- nested symlink escape (`nested junction`, `nested two directories deep`)
- `delete and rename revalidate`
- `READ ESCAPE`

`ciInvariantTests` asserts the platform capability directly — on POSIX it
requires `symlinkSync(..., "file")` to succeed and `kill(-pgid, 0)` to be
available — so a skip caused by a broken runner fails the job rather than
passing quietly.

The runner also reconciles the number of PARSED skip names against the number
the test runner REPORTED. node's skip marker is U+FE63 (SMALL HYPHEN-MINUS),
not an ASCII hyphen; matching the wrong character yields zero parsed skips and
silently disables the enforcement above. A mismatch is now a violation.

### Gate rules

The job fails when: any suite or demo exits nonzero, any suite reports
`failed > 0`, `allGoldensPassed` is not exactly `true`, a POSIX-capable test is
skipped on POSIX, the skip parse is inconsistent, an unavailable sandbox is
projected as sandboxed, or an unknown network observation is projected as zero.
No failure is downgraded to a warning and no golden baseline is rewritten.

### CI security constraints

No repository secrets, no API keys, no provider authentication, no provider
network calls, no browser automation, no `git push`. `persist-credentials:
false` on checkout. The sandbox-capability job performs DETECTION ONLY: it
resolves docker/podman through `TrustedExecutableRegistry` and reads a version
token — no image pull, no image build, no mission container, no package
install. It asserts `namlaSandboxVerified === false`, so detection can never be
mistaken for verification of Namla's sandbox.

### Artifacts

Safe summaries only: platform, suite name, pass/fail/skip counts, skipped test
names and reasons, docker capability state, golden summary, commit SHA. Never
an environment dump, absolute host path, credential, prompt, provider output,
or workspace content.

### Commands

```
npm run test:p0                      # full gate + safe report
npm run test:p0:windows              # junction + process-tree proof
npm run test:p0:posix                # file-symlink + process-group proof
npm run test:p0:sandbox-capability   # detection only, never verification
```
