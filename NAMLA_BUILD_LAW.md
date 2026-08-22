# NAMLA BUILD LAW

This document is the constitution of Namla Pro. It applies to every human, every
AI coding agent (Claude Code, Codex, Kimi, local agents, or any future agent),
and every ant that operates inside this repository. If any instruction anywhere
conflicts with this file, this file wins.

Namla Pro is currently in **Phase 0**. Phase 0 is a skeleton. It is not a
product, not a deployed system, and not connected to any real tool, shell,
network, or robot. Nothing in this repository is allowed to pretend otherwise.

## 1. Hard boundaries (never break these)

1. **Stay inside `namla-pro`.** No file read, write, or reference may target a
   path outside this project folder.
2. **Never delete files.** No ant, script, or agent may delete or overwrite
   existing project history. Additive and corrective edits only.
3. **Never install packages.** No `npm install`, `pnpm install`, `yarn install`,
   `pip install`, `winget`, `docker`, or any package manager invocation.
4. **Never run real system commands.** `CommandAdapter` in Phase 0 always
   refuses execution. It may only return a `PlannedAction`.
5. **Never start servers.** No dev servers, no daemons, no long-running
   processes.
6. **Never touch secrets.** No `.env` files, tokens, credentials, API keys, or
   private keys may be read, written, created, or logged. `SecretProtectionPolicy`
   and `ColonyMemory` must refuse anything that looks like a secret.
7. **Never push.** No `git push`, no publishing, no deployment of any kind.
8. **Never claim completion.** Documentation and code must not claim Namla Pro
   is production-ready, complete, or safe for real-world execution. It is a
   Phase 0 foundation only.

## 2. Why these laws exist

Namla Pro's long-term goal is to let many AI ants cooperate on real work,
eventually including bot and robot bodies that touch the real world. A system
that can eventually move files, run commands, or control physical devices must
be built on a foundation that defaults to refusal, not a foundation that
defaults to trust. Phase 0 exists to prove the safety skeleton works *before*
any real capability is added. Every phase after this one inherits these laws;
none of them are allowed to loosen the hard boundaries above, only add new
capability behind new explicit guards.

## 3. How agents must behave inside Namla Pro

- Always run planned actions through `SafetyGuard` before treating them as
  approved.
- Always write a `ActionReceipt` for anything attempted, including refusals.
- Always prefer emitting a pheromone or asking a question over guessing intent.
- Never assume a capability exists just because a type or interface exists.
  Types describe shape; Phase 0 implementations are intentionally inert or
  simulated.
- Never widen `CommandAdapter`, `FileAdapter`, `BotBody`, or `RobotBody` to
  perform real execution without an explicit, separate, human-approved phase
  change to this file.

## 4. Amendments

This file may only be amended by an explicit human instruction that names
`NAMLA_BUILD_LAW.md` directly. An AI agent must never self-amend this file to
grant itself more capability.

## 5. Phase 1 amendment — read-only inspection (human-authorized, 2026-07-09)

By explicit human instruction naming this file, the following single
exception to boundary rules is added:

- **Read-only filesystem inspection inside the project root is allowed**,
  and only through `src/inspector/projectInspector.ts`: `readdir` and
  `lstat` for the tree walk, plus `readFile` restricted to small
  (≤ 256 KB by default), allowlisted text files that pass every guard.

Everything else in Section 1 remains fully in force, and the inspector must
uphold it: every path is checked against `FileBoundaryPolicy` before any
filesystem call; symlinks are never followed; `node_modules`, `.git`,
`.claude`, build outputs, and caches are never entered; files with
secret-like names (`.env`, tokens, credentials, keys, ...) are never opened
or sized; content containing a PEM key block is discarded and refused; and
every inspection and every refused read produces a receipt.

Clarification (human-authorized, 2026-07-09): secret-named *source files*
(e.g. `secretProtectionPolicy.ts`) may be listed and sized in snapshots but
are never opened; real secret stores are never listed, sized, or opened.

This amendment grants observation, not action. No write, no command
execution, no network, and no autonomy is authorized by it.

## 6. Phase 3 amendment — code proposals as data (human-authorized, 2026-07-09)

By explicit human instruction naming this file:

- **Code proposals may be created as in-memory data objects** (`CodeProposal`
  in `src/generation/codeProposal.ts`), with `requiresHumanApproval`
  hard-typed to `true` and `applied` hard-typed to `false`. A proposal
  describes a change; it is never the change itself.
- Proposals may only be created through `ProposalFactory`, which must check
  `FileBoundaryPolicy` on the target path, refuse protected-store paths,
  and refuse anything `SafetyGuard` marks RISKY or FORBIDDEN — with a
  receipt for every creation and every refusal.
- **Applying a proposal to disk remains forbidden.** No apply code path may
  exist in Phase 3. Adding one requires a future amendment to this file by
  explicit human instruction, behind its own approval gate.

Everything in Section 1 remains fully in force. This amendment authorizes
describing changes, not making them.

## 7. Phase 5 amendment — git as data (human-authorized, 2026-07-09)

By explicit human instruction naming this file:

- **Git state may be modeled and commit proposals may be created as
  in-memory data** (`src/git/`): `GitRepoState` is asserted, never read from
  a real repository; `GitReadPlan` actions carry `executed: false`; and
  `GitCommitProposal` has `pushIntent`, `applied` hard-typed to `false` and
  `requiresHumanApproval` hard-typed to `true`.
- **Running any git command remains forbidden in Phase 5** — including
  read-only ones (`status`, `log`, `diff`). Executing them requires a future
  explicitly human-authorized phase amendment.
- **Push remains forbidden by law regardless of phase.** This is stronger
  than the phase gating above: no future phase amendment may enable push as
  a side effect. Push becomes possible only through an explicit human
  instruction that names `NAMLA_BUILD_LAW.md` and explicitly authorizes a
  dedicated push policy amendment of its own.

Everything in Section 1 remains fully in force. This amendment authorizes
describing git operations, not performing them.

## 8. Phase 6 amendment — bounded virtual-tick simulation (human-authorized, 2026-07-09)

By explicit human instruction naming this file:

- **Bounded virtual-tick simulation is allowed only inside
  `src/simulation/`.** A simulation step is an in-memory bookkeeping update
  — no command, no write, no network, no git, no test run, no proposal
  application.
- **The simulation may advance only when a human-run script calls a
  step/run function.** No timers, watchers, background workers, or real
  concurrency are permitted; when the call returns, nothing continues.
- **The step budget is hard-coded** (`SIMULATION_MAX_VIRTUAL_STEPS` in
  `src/policies/autonomousLoopPolicy.ts`): not environment-configurable,
  not ant-changeable, not changeable by any runtime input. Callers may
  tighten it, never exceed it. Hitting the cap halts the run with a
  receipt.
- **The default autonomous budget remains zero everywhere outside the
  simulation module.**

Everything in Section 1 remains fully in force. This amendment authorizes
rehearsing colony behavior in virtual time, not acting.

## 9. Phase 7 amendment — simulated agent adapters (human-authorized, 2026-07-10)

By explicit human instruction naming this file:

- **Agent adapters may exist as simulated data contracts only**
  (`src/adapters/`): named tool identities (Claude Code, Codex, Kimi,
  local scripts) with capability profiles and deterministic canned
  responses.
- **Real network calls, process calls, terminal calls, API calls, or
  external AI-agent calls remain forbidden**, and require a future
  explicitly human-authorized phase amendment.
- **Every Phase 7 adapter response must carry `simulated: true`** — it is a
  literal type, so a non-simulated response is unrepresentable.
- **No credentials, tokens, API keys, auth fields, or external endpoints
  may be modeled in Phase 7.** `credentialsMode` is hard-typed to
  "not-modeled"; profile `networkAccess` and `processAccess` are hard-typed
  to false.

Everything in Section 1 remains fully in force. This amendment authorizes
naming future tools and rehearsing their shape, not contacting them.

## 10. Phase 8 amendment — simulated desktop action plans (human-authorized, 2026-07-10)

By explicit human instruction naming this file:

- **Desktop automation may be modeled as simulated planned data only**
  (`src/bots/`): human-language descriptions of what a bot body WOULD do,
  with no coordinates, window handles, screenshot data, or OS handles
  representable in the types.
- **Real input injection, mouse control, keyboard control, window control,
  screen reading, screenshot capture, browser control, terminal control,
  or OS automation remains forbidden**, and requires a future explicitly
  human-authorized phase amendment.
- **Every Phase 8 desktop action plan and step must carry
  `simulated: true` and `executed: false`** — literal types, so a performed
  desktop action is unrepresentable.
- **Protected surfaces may not be targeted even in simulation** —
  credential prompts, login forms, terminals, system/security settings,
  signed-in sessions, deletion/confirmation dialogs, payment and banking
  screens, private messages, and inboxes are refused as data, with
  redacted receipts.

Everything in Section 1 remains fully in force. This amendment authorizes
rehearsing desktop choreography on paper, not touching a desktop.

## 11. Capability C2-A conditional amendment — first future exclusive-create boundary (human-authorized, 2026-07-13)

By explicit human instruction naming this file, the following **conditional**
boundary is defined for a **future** single real local-file creation. This
amendment **defines the future boundary but does not activate it.** C2-A adds
no write primitive; it is documentation and contracts only. Every clause below
constrains a future C2-B/C, and none of them grants a write today.

**Scope of any future admitted create attempt (mechanical):**

- Exactly **one** new file per future admitted attempt.
- Directory allowlist is exactly `docs/generated/`.
- The target must be a **direct child** of `docs/generated/` (no nested path,
  no separator inside the basename).
- The target filename must be **lowercase ASCII** and match a mechanical
  pattern (`^[a-z0-9][a-z0-9._-]{0,95}\.md$`); Windows reserved device
  basenames (`con`, `prn`, `aux`, `nul`, `com1`–`com9`, `lpt1`–`lpt9`) and
  protected/secret-like names are refused.
- Extension is exactly `.md`.
- Hard maximum is exactly **65,536 UTF-8 bytes**.
- The directory **must already exist**; there is **no `mkdir`** and no
  directory-creation authority.
- **No overwrite, no append, no rename, no delete, no automated cleanup, and
  no temporary-file strategy.**

**Exact content (mechanical):**

- **UTF-8 text only.** BOM is prohibited; NUL is prohibited; disallowed C0
  control characters are prohibited; carriage return is prohibited (approved
  text uses exact LF); DEL is prohibited; unpaired UTF-16 surrogate code units
  are prohibited.
- **No newline normalization, no trimming, no formatting, and no encoding
  conversion after approval.**
- The full-operation integrity fingerprint remains bound to proposal id, path,
  exact content bytes, and review metadata. An **exact content-byte
  fingerprint** must be recomputed **before any future write**, binding the
  exact bytes to be written.

**Authority (mechanical):**

- A `HumanApprovalGrant` alone is **insufficient**. A **separate
  `WriteAuthorityPermit` is required** in addition to a valid grant.
- Permit possession is **default-off**. No mission, ant, adapter, proposal,
  environment variable, untrusted boolean, or AI-generated object may create
  or enable it. It may be minted **only by a trusted one-shot bootstrap**.
- TypeScript types and module boundaries are **architectural** controls, not
  cryptographic ones against arbitrary trusted local code.

**Grant consumption and replay (mechanical):**

- Grant consumption will occur **only in C2-B/C**, immediately after final
  revalidation and **before** exclusive open, whether the write then succeeds
  or fails. **C2-A does not consume grants.**
- Replay protection remains **process-local** and is **not durable across
  process restart**. No durable replay prevention is claimed.

**Proposal, rollback, and failure (mechanical / honest):**

- The `CodeProposal` remains immutable and `applied` remains `false`.
- Rollback remains **data-only**; there is no delete authority.
- A failed future create may leave a **zero-byte or partial residual
  artifact** in `docs/generated/`; **human cleanup is required**.
- **No complete protection from a malicious concurrent same-user process is
  claimed**, and **complete intermediate symlink/junction race protection is
  not claimed.**

**Future execution path (mechanical):**

- Any future real creation requires an **immediate final C1 inspection** and
  an **exclusive-create** primitive (existence-atomic, not content-atomic).
- The "exactly two fs importers" rule (`ProjectInspector` read-only +
  `ProjectFileCreator` create-only) becomes true **only in C2-B**, when the
  real primitive is installed. **C2-A retains exactly one fs importer
  (`ProjectInspector`) and zero filesystem mutation APIs.**
- **No shell/process/network/Git/package-manager/desktop/OS/autonomous/timer/
  server authority** is added.

**Activation (mechanical):**

- This amendment **does not activate** any real write. **C2-C requires a
  separate explicit human instruction** naming this file and authorizing one
  real integration write.

Everything in Section 1 remains fully in force, and no earlier section is
weakened. This amendment authorizes defining the first-write boundary as
contracts, not performing any write.

## 12. Colony Genesis simulation authorization — G0 (human-authorized, 2026-07-19)

By explicit human instruction naming this file, `src/colony/` is authorized as
an **in-memory deterministic colony simulation runtime**. This authorization is
**separate from and additional to** the Phase 6 authorization of
`src/simulation/` (Section 8); neither module inherits the other's budget,
scope, or permissions, and Colony Genesis is a **second runtime beside** the
mission pipeline, never a replacement for it.

**Population budget for G0 (mechanical):**

- Exactly **300** persistent identities per colony.
- Exactly **1** Queen-system identity.
- Exactly **299** worker-capable identities.

**What G0 may do (mechanical):**

- Instantiate population records and nest topology **in memory only**.
- Run **validation and demo code only**.

**What G0 may not do (mechanical):**

- No real filesystem writes, network calls, process execution, Git actions,
  timers, LLM calls, desktop actions, OS actions, or autonomous loops.
- No use of `AntScheduler`, `DecompositionEngine`, `rolePicker`,
  `TaskDependencyGraph`, `TaskRouter`, `ColonyOrchestrator`, `MissionPlanner`,
  or `ColonySimulation` — these modules may not be imported into `src/colony/`
  in G0 or any later G-phase.
- **No central task assignment of any kind.** No component may assign a task to
  an ant. Work selection is reserved for future per-ant local decision phases.

**Queen-system constraints (mechanical):**

The Queen system represents reproduction, colony identity, genetic continuity,
brood production, generation transition, and population renewal. The Queen
system **may not** assign tasks, select quorum winners, route work, inspect all
ant memories, or act as a central planner. It holds no reference to the worker
population.

**Determinism constraints (mechanical):**

- All colony logic must be **deterministic and seed-based**. Only seeded
  generators are permitted; `Math.random` is prohibited in `src/colony/`.
- **Wall-clock time is prohibited in colony state.** No `Date.now()`, no
  `new Date()`, and no timestamp field may enter any colony record.
- **Module-level mutable counters are prohibited** in `src/colony/`. Identity
  must be derived from explicit inputs, never from ambient process state.

**Scope limit (mechanical):**

- G0 **does not authorize full population tick behavior.** No behavior loop
  beyond identity and topology validation exists or is permitted.
- Future **G1/G2 and later phases require separate explicit human
  authorization** for each of: task-stimulus fields, pheromone fields,
  encounter networks, response-threshold decisions, reserve recovery, quorum
  decisions, and cognitive budget / LLM eligibility.

Everything in Section 1 remains fully in force, and **no earlier section is
weakened**. In particular this amendment grants no filesystem, network,
process, Git, desktop, or autonomous authority, and does not activate C2-C or
any real write. This amendment authorizes modeling a colony's identity and
topology in memory, not acting.

## 13. Colony Genesis G1–G3 authorization — task stimulus, pheromone field,
encounters, response-threshold task choice, movement, and specialization
(human-authorized, 2026-07-19)

By explicit human instruction naming this file, `src/colony/` is additionally
authorized to run a **bounded, in-memory, per-tick behavior loop** on top of
the G0 population and topology (Section 12). This amendment activates exactly
three of the phases G0 reserved — **G1** (task-stimulus field, pheromone
field), **G2** (encounter network, response-threshold task choice, local
movement), and **G3** (specialization through threshold learning and
forgetting) — and no others.

**What this amendment adds (mechanical):**

- A **chamber-local task-stimulus field**: a fixed `(chamber x TaskCategory)`
  scalar grid. An ant may read only its **own current chamber's** row; task
  stimulus never diffuses to neighboring chambers, by construction.
- A **pheromone field**: a fixed `(chamber x ColonyPheromoneType)` scalar grid
  supporting deposit, reinforcement (a deposit onto an already-nonzero cell),
  read, and multiplicative decay. Every one of the 10 `ColonyPheromoneType`
  values must be deposited by some code path and read by at least one decision
  site; a type satisfying neither must be removed from the enum, not kept for
  flavour (the biological-model doc's existing hard rule).
- A **bounded chamber-local encounter network**: for ants sharing a chamber in
  a given tick, each ant may record at most a small fixed number of encounters
  (per-ant, per-tick) into its existing bounded `recentEncounterMemory` ring
  buffer (capacity 20, unchanged). No encounter is population-wide, and no
  encounter records another ant's identity, genome, or history — only
  `{tick, otherWorkState, otherCarriedSuccess}`, exactly as G0 already typed.
- **Response-threshold task selection**: each non-reserve ant computes its own
  engagement probability per `TaskCategory` from ONLY its own local stimulus
  read, local pheromone read, its own recent-encounter rate, and its own
  heritable threshold/genome profile — then chooses its own next `WorkState`.
  No component chooses on an ant's behalf.
- **Local movement**: an ant may move to at most one chamber per tick, and
  only to a chamber directly adjacent to its current one in the existing
  G0 `NestGraph`. Teleportation and population-wide placement remain forbidden.
- **Specialization (G3)**: an ant's own `responseThresholds` may change only
  through its own attempted-task outcome (success lowers the attempted
  category's threshold; failure raises it) and through disuse ("forgetting")
  drifting an unattempted category's threshold back toward that ant's
  unbiased genome baseline. No threshold is ever set by anything other than
  the ant's own history.

**What remains excluded (still requires its own future amendment):**

- **G4 (reserve activation and recovery)** is not authorized. Ants whose
  `activationMode` is `"reserve"` at genesis take no part in task selection,
  movement, or learning in this pass; they remain ordinary un-activated ants,
  exactly as Section 12 left them.
- **G5 (recruitment network / quorum)** is not authorized. The existing
  `"recruitment"` pheromone type is activated only as an ordinary decaying
  environmental signal read by local task choice — never as the directed,
  tandem-run recruitment channel or a quorum tally described in
  `docs/ant-colony-biological-model.md`. No component counts support for a
  candidate or declares a winner.
- **G6 (brood lifecycle / queen reproduction)** is not authorized. The Queen
  continuity record is carried through every tick unchanged; nothing in this
  amendment reads or writes it, and it is never passed to a decision function.
- **G7 (cognitive budget / LLM eligibility)** is not authorized. No code path
  introduced by this amendment sets any ant's `activationMode` to
  `"deterministic-local"`, `"llm-eligible"`, or `"llm-active"` — those remain
  exactly as inert as Section 12 left them, so the count of cognitively active
  ants stays mechanically `0` for the whole run, trivially satisfying "at most
  30" without implementing eligibility scoring at all.
- Energy, health, age, and lifecycle-state dynamics remain unauthorized and
  untouched by this amendment; only response thresholds, current behavior
  state, chamber location, encounter memory, local observation fields, and
  success/failure history evolve.

**Determinism and boundaries (mechanical, unchanged from Section 12):**

- The tick loop is bounded by a hard-coded, code-constant tick cap in
  `src/colony/colonyTickRunner.ts` (tighten-only, not environment-configurable,
  not ant-changeable). It runs only when a human-run script calls it; nothing
  continues after the call returns.
- All new randomness draws from `createSeededRandom`, keyed by
  `(colonySeed, antIndex, tick, purpose-salt)`. `Math.random`, `Date.now`,
  `new Date`, and module-level mutable counters remain prohibited in
  `src/colony/`, exactly as Section 12 already requires.
- No new filesystem, network, process, Git, desktop, timer, or autonomous
  authority is added. `centralTaskAssignments` and `queenTaskAssignments`
  remain literal-zero across every tick of this phase.
- This amendment does not touch `src/simulation/` or its Phase 6 budget
  (Section 8); the two runtimes remain separate, as Section 12 established.

Everything in Section 1 and Section 12 remains fully in force, and no earlier
section is weakened. This amendment authorizes a colony reading its own local
environment and choosing its own behavior deterministically, not any form of
central assignment, reserve activation, recruitment/quorum, reproduction, or
cognitive-budget authority.

## 14. Colony Genesis G4–G5 — reserve activation, recruitment, and local
quorum (human-authorized — 2026-07-20)

**Status: authorized, with required precision edits applied.** The human
reviewer approved this section on the condition that the candidate-origin
rule below be made concrete (not deferred to the implementing commit) and
that the G4/G5 mechanism bullets be restated as hard constraints rather than
proposals. Both are done below. Code may now be written against this
section, strictly within its bounds — G6, G7, LLM/cognitive eligibility, and
brood/queen reproduction remain unauthorized (see "What remains excluded").

**Why this is a separate section from Section 13:** the original working
session's instructions asked for reserve activation, competing proposals,
local recruitment, and decentralized quorum in the same pass as G1-G3. That
was declined — Section 13 explicitly excluded G4/G5 and this file's own
convention is that each phase gets its own explicit amendment. This section
is that amendment.

### G4 — reserve activation (mechanism, hard constraints)

**No new mechanism is added.** G0 already made every reserve ant an ordinary
ant with every `responseThresholds` entry multiplied by `1.45`
(`src/colony/antAgent.ts`, the `reserveMultiplier` constant) — reserve was
designed from the start to be "a threshold, not a class"
(`docs/colony-genesis-g0.md`). G4 is the **removal of one exclusion**, not
the addition of a system. The implementation must:

- Remove **only** the reserve early-return / skip at
  `src/colony/colonyTickRunner.ts:172`
  (`if (ant.currentBehaviorState === "reserve") { ... }`). Every worker,
  reserve or not, runs through the same `localTaskChoice` /
  `responseThresholdSystem` / `antMovement` functions already authorized by
  Section 13 — the same local G1-G3 machinery, unmodified in kind. A reserve
  ant's elevated thresholds mean it engages later than an equivalent
  non-reserve ant under the same local stimulus, never earlier and never via
  a different code path.
- Introduce **no special reserve controller, scheduler, or activation
  function** of any kind. There is no `ReserveActivator`, no
  `activateReserve()`, and no function that decides for a reserve ant —
  removing the skip is the entire mechanism.
- Make **no queen or central assignment** of any kind. Reserve activation is
  a per-ant consequence of the ant's own elevated threshold crossing its own
  local stimulus read; the Queen record and `centralTaskAssignments` /
  `queenTaskAssignments` are untouched by this section.
- `"reserve"` becomes an ordinary member of `WorkState` that an ant's own
  task-switch logic can leave, exactly as it already leaves `"resting"`. No
  function may set `currentBehaviorState` back to `"reserve"` once left —
  reserve is an initial condition, not a state an ant is returned to by any
  external actor.
- `ColonyRunReport` gains exactly one purely **observational** metric,
  `reserveActivationCount`: the number of ants that started in reserve
  (identified by `activationMode === "reserve"`, which G1-G3 never mutates)
  whose `currentBehaviorState` differs from `"reserve"` at the end of the
  run. It is computed by inspecting final state only, same as
  `peakCognitiveEligibility` already does; it decides nothing and gates
  nothing.

**Label (Honesty checklist, `docs/ant-colony-biological-model.md`):** real
mechanism (inactive-worker activation, Temnothorax/Myrmica/honeybee
literature), already implemented as a threshold multiplier in G0; G4 only
lets the existing multiplier's consequence run.

### G5 — recruitment and local quorum (mechanism, hard constraints)

**Hard constraint carried over verbatim from the biological-model doc's
"Design commitment":** quorum **observes and records, never tallies and
decides**. No function anywhere may count support across the population and
declare a winner. No global quorum winner and no global support count may
exist in any form — not a module-level variable, not a return value of a
population-wide reduction, not a field on `ColonyRunReport` that ranks
candidates. Every commitment transition belongs to exactly one ant, decided
by no central decision function, computed from only that ant's own bounded
state.

- **Candidate origin (required, defined now — not deferred):** candidate IDs
  must be **deterministic, seeded, chamber-local, and derived only from
  existing local colony state** — specifically, only `colonySeed` (already
  threaded through every tick) and the chamber's own `chamberId` (static,
  from the G0 `NestGraph`). No global candidate board — the function that
  produces candidate ids must be a pure function of `(colonySeed, chamberId)`
  with no population, roster, or cross-chamber input, so there is never a
  stored structure enumerating "every candidate in the colony." No central
  winner and no population-wide tally may be derived from it. No filesystem,
  network, provider, LLM, process, or any external source may contribute to
  a candidate id or its perceived quality — every input is either the
  colony's own seed or an ant's own already-local, already-authorized reads
  (its own seeded stream, its own chamber's pheromone/stimulus rows).
  **Label:** digital adaptation — Temnothorax candidates are physical nest
  sites; this colony has no equivalent, so candidate origin is invented, not
  observed, and must stay documented as such.
- **Recruitment channel** (directed, transient, one tick, encounter-local —
  distinct from the pheromone field and from the ordinary encounter
  channel): during the same bounded chamber-local encounter that
  `encounterNetwork.ts` already establishes for that ant this tick
  (never a new, separately unbounded contact), if the acting ant's own
  `commitmentState === "recruiting"` and the encountered nestmate's own
  `commitmentState === "uncommitted"`, the acting ant may pass its own
  single top-`privateQuality` candidate id to that nestmate, that tick only.
  This changes **only the recruited ant's own** `commitmentState`
  (`"uncommitted" → "assessing"` or directly to `"recruiting"` if its own
  freshly formed private assessment already clears the recruiting-quality
  bar) and appends one entry to **the recruited ant's own**, already-bounded
  `privateCandidateAssessments`. Nothing is written to any shared or
  population-scope structure; the recruiting ant's own state is unchanged by
  the act of recruiting.
- **Bounded candidate memory:** `privateCandidateAssessments` gets a fixed
  cap of 8 (mirroring the existing `recentEncounterMemory` capacity of 20 at
  a smaller scale appropriate to "candidates" rather than "encounters").
  Oldest entries drop first. "Minority proposals keep their final support
  counts permanently" (the biological doc) is satisfied because no support
  count is ever computed or stored outside each ant's own bounded list in
  the first place; there is no global tally to erase.
- **Local quorum sensing, advancing only the sensing ant's own state:** each
  tick, an ant with `commitmentState` in `("assessing", "recruiting")` may
  sense support **only from its own bounded chamber-local encounter this
  tick** (the same single bounded contact the recruitment channel above
  uses, never a population-wide scan and never more than the encounter bound
  Section 13 already established). When that one bounded observation reports
  a nestmate whose own top candidate matches the sensing ant's own top
  candidate and whose own `commitmentState` is `("recruiting", "committed")`,
  the sensing ant increments a small counter on **its own record only**,
  clamped so it can never exceed `genome.quorumThreshold` — the counter is
  therefore bounded by construction, never an unbounded accumulator. When
  the count reaches `genome.quorumThreshold`, only **that ant's own**
  `commitmentState` advances one rung (`"assessing" → "recruiting"` or
  `"recruiting" → "committed"`), and the counter resets. No other ant's
  state is read in bulk and no ant ever learns the colony-wide count for any
  candidate. Reaching `"committed"` is terminal for this section — reversal
  is left to a future phase, not implemented here.
- The `"recruitment"` pheromone type's existing Section 13 behavior (an
  ordinary decaying environmental signal read by local task choice) is
  unchanged by this section and is not merged with the directed channel
  above.

**Label:** real mechanism (Temnothorax house-hunting, Franks/Pratt), with one
explicitly flagged digital adaptation (candidate origin, defined above).

### What remains excluded

- **Do not implement G6** (brood lifecycle / queen reproduction). The Queen
  continuity record is carried through every tick unchanged; nothing in this
  section reads or writes it.
- **Do not implement G7** (cognitive budget / LLM eligibility). No code path
  introduced by this section sets any ant's `activationMode` to
  `"deterministic-local"`, `"llm-eligible"`, or `"llm-active"`.
- **Do not implement LLM or external-cognition calls of any kind.**
  `externalLlmCalls` remains literal-zero.
- **Do not implement brood or queen reproduction dynamics.**
- **Do not implement scale demos beyond exercising already-authorized
  mechanics.** Nothing in this section is population-size-dependent (every
  rule is chamber-local or per-ant), so a 1,000- or 10,000-ant demo may run
  the exact mechanics this section defines without needing its own further
  amendment — but such a demo may not add any new mechanism to reach those
  scales; if it needs one, that mechanism needs its own amendment first.
- `centralTaskAssignments` and `queenTaskAssignments` remain literal-zero. No
  filesystem, network, process, Git, timer, or autonomous authority is
  authorized.

### Determinism and boundaries (unchanged in kind from Section 13)

- All new randomness (candidate-origin seeding, any tie-breaking) draws from
  `createSeededRandom` keyed by `(colonySeed, antIndex, tick, purpose-salt)`.
- The tick cap, no-module-mutable-state, and no-central-import rules from
  Section 13 apply unchanged.

This section is now in force. Implementation must stay strictly inside the
mechanisms named above; anything not named here (G6, G7, LLM calls, brood,
reproduction, or any new mechanism to reach population scale) still requires
its own separate amendment.

## 15. Colony Genesis G6–G7 — Queen continuity/brood/lifecycle/generations
and the cognitive budget (human-authorized, 2026-07-20)

By explicit human instruction naming this file and specifying the exact
mechanics below, `src/colony/` is additionally authorized to run brood
lifecycle, worker aging, generation transitions, and a bounded cognitive
budget on top of G0-G5. This amendment activates the two phases G0 and
Section 13/14 reserved — **G6** (brood/lifecycle/generations) and **G7**
(cognitive budget) — and no others.

### G6 — brood, lifecycle, generations (mechanical)

- **Brood are not AntAgents.** They are a separately bounded record type
  (`BroodRecord`, `src/colony/broodLifecycleSystem.ts`), capped at
  `MAX_LIVE_BROOD = 10` live records regardless of population size — never
  an unbounded list. A brood record only becomes a real persistent identity
  through `admitMaturedBroodIfRoom`, strictly gated by the colony's
  population cap. In every fixed-population demo (`demoColonyGenesis.ts`,
  `demoColonyScale.ts`'s three scale runs) the cap is already saturated at
  genesis, so admission structurally cannot fire — matured brood stay
  queued at the `"young-worker"` stage rather than creating unlimited
  agents, exactly as the bounded population policy below requires.
  `demoColonyScale.ts`'s dedicated small-colony run (20 workers, cap 40)
  proves the admission mechanism itself is real, not dead code.
- **Genome inheritance and controlled variation.** A brood record's genome
  profile is derived the same way a genesis worker's is (colony genome plus
  a deterministic seeded index, `deriveAntGenomeProfile`), then a small,
  bounded, seeded perturbation (`MUTATION_MAGNITUDE = 0.12`) is applied per
  threshold-bias category. **Label: digital adaptation** — no single named
  biological source; real ant colonies do not tune per-trait mutation
  magnitudes. This stands in for genetic recombination across a generation.
- **Brood-created local nursing demand, never a Queen assignment.** Live
  brood raise their own chamber's `"nursing"` cell in the existing G1
  `TaskStimulusField` (`applyBroodNursingDemand`, using the new
  `raiseTaskStimulus` — the inverse of the already-authorized
  `relieveTaskStimulus`). Nursing ants respond through the SAME
  already-authorized G1-G3 response-threshold system
  (`localTaskChoice.chooseWorkState`) — no new decision path exists for
  nursing. The Queen never calls or selects a nurse;
  `queenDirectNursingAssignments` is literal-zero. Nursed brood mature
  faster than unnursed brood, so nursing accelerates development rather
  than gating it — a real behavioral link, not a decorative one.
- **Generation transitions.** `queenContinuitySystem.maybeAdvanceGeneration`
  reads and writes only the Queen's own record — no population, no roster,
  no worker reference — preserving `queenHoldsNoAuthority`'s guarantee. It
  advances `generation`/`lineageDepth` only once cumulative admitted brood
  in the current generation reaches `queen.broodCapacityPerGeneration`.
  Continuity bookkeeping, never a decision about any ant's task.
- **Worker aging, energy, health, recovery, withdrawal.** Activates the
  `age` / `energy` / `health` / `lifecycleState` / `recoveryTicksRemaining`
  fields G0 declared and Section 12 left "unauthorized and untouched"
  (`src/colony/workerLifecycleSystem.ts`). Energy drains on work
  (`genome.workEnergyCost`) and recovers on rest (`genome.restEnergyGain`);
  sustained low energy drifts health down, sustained high energy drifts it
  back up. `adult → senescent → retired` transitions are health-driven
  (selective, non-uniform — only an ant's own workload/luck genuinely
  drains it) more than age-driven (age thresholds sit near the tick hard
  cap deliberately, so age alone does not uniformly retire the whole colony
  inside one ordinary run). **A retired ant keeps its persistent identity
  forever** — `lifecycleState` changes, nothing is removed from `workers[]`,
  satisfying "no identity may silently disappear" by construction, not by
  promise. A retired (or mid-recovery senescent) ant makes no decision that
  tick: no task choice, no learning, no cognition claim, no movement — it
  still exists, is still counted, and can still be met by others.

### G7 — cognitive budget and agent activation (mechanical)

- **Every ant's task is already fully decided before this runs.** G7
  (`src/colony/cognitiveBudgetSystem.ts`) runs strictly after
  `localTaskChoice.chooseWorkState` has already picked that tick's
  `WorkState` — it never influences WHAT an ant does, only whether that
  ant may additionally be labeled cognitively eligible for the tick.
- **The claim is computed from only the ant's own local state:** its own
  threshold for the category it just attempted (task difficulty), how
  close the top two categories scored in its own `chooseWorkState` call
  (choice ambiguity), its own failure history (recent failures), how
  specialized it already is, its own reliability, and its own energy/health.
  No population scan.
- **`resolveCognitionClaims` is the one deliberately centralized step** —
  pre-authorized by `docs/ant-colony-biological-model.md` section 8's
  existing "digital adaptation... centralized admission control... denies
  capability rather than directing behavior" language. It ranks that tick's
  submitted claims (deterministic: score, then antId) and admits at most
  `MAX_COGNITIVE_BUDGET = 30` — structurally, by array slice, never more. It
  never assigns a task, never picks a worker for a role, never reads or
  writes Queen state.
- **Only `"llm-eligible"` is ever set**, and only for admitted ants, only for
  the tick they are admitted. `"deterministic-local"` and `"llm-active"`
  remain inert, unreached code paths in this pass — a deliberate,
  conservative scope choice: activating `"deterministic-local"` for every
  actively-working ant would trivially exceed the 30-slot budget, since
  G1-G4 already lets up to the whole population work simultaneously. A
  future phase may activate a second tier under its own amendment.
- **Claims are recomputed fresh every tick (stateless).** A rejected ant is
  never excluded from future ticks (no starvation — every tick re-evaluates
  current conditions), nothing is queued across ticks (no unbounded waiting
  queue), and every admission "expires" at the end of the tick it was
  granted — the simplest faithful reading of "slots release when work ends,
  energy falls, or the claim expires." A rejected ant's already-chosen
  deterministic work proceeds completely unaffected
  (`deterministicFallbackActions`, one per rejected claim).
- **Future-facing, not provider-active.** `CognitiveWorkerContract` (a
  type-only interface naming `claude | codex | openai | anthropic |
  local-model`) exists so a later, separately authorized phase can attach a
  real implementation without redesigning this module. No implementation of
  it exists anywhere in Namla Pro; nothing constructs one; nothing calls
  `requestCognition`. `externalLlmCalls` stays literal-zero.

### Bounded population policy (mechanical)

- The default Colony Genesis demo remains exactly 300 persistent identities.
  Brood may be simulated (created, matured, made to raise nursing demand)
  without ever exceeding the configured population cap; when the cap is
  already reached, matured brood remain queued at `"young-worker"` rather
  than creating unlimited agents. No unbounded population growth is
  possible: `admitMaturedBroodIfRoom` computes `room = populationCap -
  currentPersistentCount` and admits at most `room` records, never more.

### What remains excluded

- **Do not implement real external-model calls.** `CognitiveWorkerContract`
  is a type only; `externalLlmCalls` remains literal-zero.
- **Do not implement a second cognitive-activation tier
  (`"deterministic-local"` / `"llm-active"`)** without its own amendment
  re-justifying how it stays inside the 30-slot budget.
- **Do not let generation transitions, brood admission, or worker
  retirement touch the Queen's absence-of-authority fields** —
  `taskAssignmentAuthority`, `routingAuthority`, `quorumSelectionAuthority`,
  `populationMemoryAccess` stay literal `false`; `queenTaskAssignments`
  stays literal `0`.
- `centralTaskAssignments` and `queenTaskAssignments` remain literal-zero.
  No filesystem, network, process, Git, timer, or autonomous authority is
  authorized by this section.

### Determinism and boundaries (unchanged in kind from Sections 13-14)

- All new randomness (brood spawn/chamber/caste/quality/mutation draws,
  cognition-claim tiebreak jitter) draws from `createSeededRandom` keyed by
  `(colonySeed, index, tick, purpose-salt)`.
- The tick cap, no-module-mutable-state, and no-central-import rules from
  Section 13 apply unchanged.
- This section does not touch `src/simulation/` or its Phase 6 budget
  (Section 8); the two runtimes remain separate.

Everything in Sections 1, 12, 13, and 14 remains fully in force, and no
earlier section is weakened. This section authorizes a colony that ages,
reproduces through its own environment-mediated brood, and rations its own
scarce deeper-cognition resource without ever assigning a task, selecting a
worker, or calling a real model.

## 16. Real Cognitive Ants V1 — bounded mission layer, no real execution
(human-authorized, 2026-07-22)

By explicit human instruction naming this file, `src/colonyMission/` and
`src/cli/` are authorized to run a bounded mission layer on top of Colony
Genesis: a provider-neutral cognitive-worker contract, a deterministic fake
provider, a mission workspace under `workspaces/<mission-id>/`, a
software-work market, scout-proposal quorum, and a bounded artifact/review/
verification/repair loop. None of this is Colony Genesis (`src/colony/`
itself is untouched by this section) — it is a layer that gives the
existing 300-identity colony real missions while staying inside every
existing capability boundary.

**What this section does NOT and cannot authorize.** Section 1 lists "Never
run real system commands" as a hard boundary, and Section 2 is explicit:
*"none of them are allowed to loosen the hard boundaries above, only add new
capability behind new explicit guards."* A Claude Code CLI or Codex CLI
adapter that actually spawned a process would break that boundary
regardless of how bounded, disabled-by-default, or human-confirmed its
design was. This is not a capability this section can grant by being named,
and no future amendment can grant it either — Section 4 requires an
amendment to be a human instruction naming this file, but Section 2 already
forecloses any amendment from loosening a hard boundary at all. Lifting it
would require rewriting Section 1/2 themselves, which is a foundational
decision beyond what "add capability behind a new guard" means, and this
section does not attempt it.

Accordingly:

- `src/colonyMission/claudeCliAdapter.ts` and `codexCliAdapter.ts`
  (`cliCognitiveWorkerBase.ts`) construct a fully-specified
  `PlannedCliInvocation` — hard-coded executable name, hard-coded argument
  template, bounded prompt-file delivery, bounded output/timeout — and then
  **always refuse**, exactly like `src/bodies/commandAdapter.ts` already
  does for shell commands. There is no `child_process` import anywhere in
  `src/colonyMission/`.
- The tester ant's verification step is the same real system command
  execution in miniature (`npx tsc --noEmit`, `npm test`, `npm run build`).
  `verificationRunner.ts`'s `RealVerificationRunner` exists for the same
  reason the CLI adapters do — a real, reviewable, hard-coded allowlist —
  and also always refuses. Every verification result produced anywhere in
  this codebase is `FakeVerificationRunner`'s deterministic, content-based
  simulation.
- `npm run colony:real-smoke` requires explicit provider selection and
  typed human confirmation before it will even construct a request, and the
  request it constructs is refused at the adapter for the same reason.
  Confirmation gates *starting* the smoke check; it does not and cannot
  reach past the hard boundary.

**What is genuinely real in this section:** the mission workspace boundary
checks, the work-market claim/contention resolution, the scout-proposal
local quorum, the cognitive-budget admission (bounded at 5 for this
milestone, well under the global 30 from Section 15), the artifact review
checks, and the deterministic defect-injection/detection/repair cycle all
run for real, against real (if fake-provider-sourced) content, with real
counts — none of that is simulated in the sense the CLI adapters are.
`docs/real-provider-adapters.md` documents this distinction in full.

### Bounded population and budget (mechanical)

- The default mission colony remains 300 persistent identities (1
  queen-system + 299 worker-capable), reusing `createColonyGenesis`
  unmodified.
- The cognitive-execution budget for this milestone is capped at 5
  concurrent cognitive ants (`MAX_CONCURRENT_COGNITIVE_ANTS` in the CLI and
  demo), structurally separate from and well under Section 15's global
  30-slot `MAX_COGNITIVE_BUDGET`.
- `centralTaskAssignments` and `queenTaskAssignments` are literal-zero
  types on `MissionRunReport`, the same discipline `colonyGenesis.ts` and
  `colonyRunReport.ts` already use.

### What remains excluded

- Real Claude/Codex process execution — see above; not amendable within
  Phase 0's Section 1/2, only by a foundational rewrite of this file that
  this section does not attempt.
- Real filesystem writes to `workspaces/<mission-id>/` — `MissionWorkspace`
  is built against a pluggable `WorkspaceDriver`; only `FakeWorkspaceDriver`
  (in-memory) is used anywhere in this codebase's demo/test/CLI paths. A
  real driver is a separate, future, separately-authorized capability, the
  same staged pattern the C0-C2-B stack already established for
  `docs/generated/`.
- Any second cognitive-activation tier or any change to Colony Genesis's
  own G1-G7 mechanics — `src/colony/` is not modified by this section.

Everything in Sections 1-15 remains fully in force, and no earlier section
is weakened. This section authorizes a colony that takes real, bounded,
auditable missions and would be ready to call a real cognitive worker the
moment a human amends the parts of this constitution that are actually
amendable — never the hard boundaries themselves.

## 17. Ant Intelligence Deepening V1 — bounded cognition, no real provider (human-authorized, 2026-07-24)

By explicit human instruction naming this file, `src/colony/` is authorized to
gain a **second deterministic intelligence layer** on top of the committed
G1-G7 colony: a bounded per-ant `AntMind`, individual cognitive profiles, local
planning, self-evaluation and confidence calibration, peer review and local
challenge, temporary teams, a bounded in-memory colony knowledge store,
mentorship of young workers, and a deterministic crisis suite. This makes each
of the 300+ persistent identities a richer autonomous digital worker **before**
any real model is attached.

**This section adds no real cognition provider.** No real Claude, Codex,
OpenAI, Anthropic, or local model is called; there is no network call, no
`child_process`, no `fetch`, and no provider SDK import anywhere in
`src/colony/`. `externalLlmCalls` remains literal zero. The intelligence here is
entirely deterministic, seed-driven arithmetic over each ant's own bounded local
state. Attaching a real provider remains a separate, future, explicitly
human-authorized step, and — per Sections 1 and 2 — cannot loosen any hard
boundary when it comes.

**Decentralization is preserved (mechanical):**

- `centralTaskAssignments`, `queenTaskAssignments`, and `globalPlannerDecisions`
  are all literal zero. No component assigns a task to an ant; no object
  receives all ants' private minds; every mission operates on a bounded local
  window of the population, never an all-to-all scan.
- The Queen gains no new authority: she does not plan, review, form teams,
  select knowledge, choose mentors, or control cognitive slots.
- The cognitive budget ceiling stays at `MAX_COGNITIVE_BUDGET = 30`; the
  observed peak never exceeds it.

**Boundedness is preserved (mechanical):**

- Every mind surface (working memory, episodic summaries, strategy patterns,
  unresolved questions), every plan (substeps, assumptions, risks, revisions),
  the review pool, teams, and knowledge retrieval each have a hard cap, checked
  at runtime. Old episodic detail is compacted into summaries, never retained
  unbounded. No ant holds the colony roster, the whole knowledge store, or
  another ant's full mind.
- The layer stays O(N), never O(N^2); it is verified at 300, 1,000, and 10,000
  identities with bounded memory and preserved profile diversity.

**Determinism is preserved (mechanical):**

- All logic is seed-based; no `Date.now`, no `new Date`, no `Math.random`, no
  module-level mutable counter appears in `src/colony/`. An independent second
  run produces an identical deterministic digest.

Everything in Section 1 remains fully in force, and no earlier section is
weakened. This section authorizes making the colony's ants think harder in
memory, not act in the world.

## 18. Real Cognitive Ants R1 — provider-ready, provider-inactive (human-authorized, 2026-07-25)

By explicit human instruction naming this file, the Real Cognitive Ants runtime
already authorized in Section 16 (`src/colonyMission/`, `src/cli/`) is reaffirmed
as the R1 provider-neutral bounded cognitive runtime, and R1 adds a deterministic
end-to-end mission demo (`src/examples/demoRealCognitiveAntsR1.ts`) plus its
documentation and invariants. R1 introduces **no new capability**: it reuses the
existing bounded runtime rather than duplicating it, exactly as instructed.

**Architectural boundary (mechanical).** `src/colony/` stays pure and
deterministic — no filesystem mutation, no `child_process`, no network, no
provider-specific code, no credential access. All external-cognition and
mission-execution code lives under the separate `src/colonyMission/` boundary.
The colony decides locally (which demand exists, which ants volunteer, which
request cognitive slots, which proposal gets local support, which repair demand
is raised); a provider only supplies bounded cognition to an **already-selected**
ant. A provider may never select an ant, assign a task, control the Queen,
inspect all minds, run an autonomous loop, or gain unrestricted filesystem or
shell authority.

**Provider inactivity (mechanical).** As under Section 16, the Claude Code and
Codex adapters construct a fully-specified `PlannedCliInvocation`
(hard-coded executable name, hard-coded argument template, no `shell: true`, no
mission text reaching an executable or its arguments, bounded stdin/stdout/
stderr/timeout, one-shot) and then **always refuse**. There is no
`child_process` import anywhere in `src/colonyMission/`, so there is no real
process driver for automated demos to reach. Every automated test uses only the
`DeterministicCognitiveWorker` and the in-memory `FakeWorkspaceDriver`:
`realClaudeCalls`, `realCodexCalls`, `realProviderProcessExecutions`,
`realNetworkCalls`, and `realFilesystemWrites` are all literal zero.

**Decentralization (mechanical).** `centralTaskAssignments`,
`queenTaskAssignments`, `globalPlannerDecisions`, and `nonVolunteerAssignments`
are all zero. Accepted claims are always a subset of voluntary claims (acceptance
can never exceed volunteering), the demo's proof that no non-volunteer is ever
selected. The R1 demo's cognitive budget is capped at 5 concurrent ants, well
under the global colony ceiling of 30, which is unchanged.

**Real activation stays human-only and future.** `npm run colony:real-smoke --
--provider <claude|codex>` requires explicit provider selection and typed human
confirmation and still refuses at the adapter (Section 16). A first real smoke
call would activate exactly one ant and make exactly one request; a maximum
first multi-ant provider phase would be five ants; the global budget stays 30;
the Queen never activates a provider; and providers do cognition only, receiving
no unrestricted execution authority. None of this is executed in R1.

Everything in Section 1 remains fully in force, and no earlier section is
weakened. Persistent ants are not simultaneous model calls; R1 keeps every real
provider execution count at zero.

## 19. Real Cognitive Ants R2 — human-only bounded provider execution (human-authorized foundational exception, 2026-07-26)

By explicit human instruction naming this file, a **narrowly scoped foundational
exception** to the Section 1 boundary "Never run real system commands" is added.
This is the first amendment that touches a hard boundary; it does so only
because a human explicitly authorized it here, and it opens the smallest
possible door: **one human, one provider, one ant, one bounded request, one
process, one response, then stop.**

**What this exception permits — and nothing more:**

- Exactly **one** explicitly human-selected provider (`claude` or `codex`).
- Exactly **one** cognitive ant, already selected through a voluntary claim and
  bounded cognitive-budget admission.
- Exactly **one** bounded provider request and **one** bounded result.
- Exactly **one** human-invoked CLI command (`npm run colony:real-smoke --
  --provider <claude|codex>`), requiring an interactive terminal and the human
  typing the exact phrase `RUN ONE CLAUDE ANT` / `RUN ONE CODEX ANT`.
- A dedicated smoke workspace under `workspaces/provider-smoke/<provider>/<mission>/`.
- Immediate process termination afterward.

**What remains forbidden (unchanged hard boundaries):**

- No automatic or background execution; no loop; no automatic retry; no second
  request with the same permit (the permit is single-use).
- **No provider execution from any automated test, demo, or build** — those use
  only the `DeterministicCognitiveWorker` and the `FakeProviderProcessDriver`.
- No arbitrary executable (a hard-coded provider map only), no arbitrary shell
  (`shell: false`, no `exec`/`execSync`/`fork`), and **no mission text is ever
  converted into an executable name or a CLI argument** — the prompt is bounded
  stdin data, the argument list is a fixed literal.
- No activation by the Queen, an ant, a mission, adapter output, an environment
  variable, a boolean, or any AI-generated object. Activation requires a
  non-serializable `RealProviderExecutionPermit` minted only after a human types
  the exact phrase at a TTY; a forged/JSON/object-literal permit is rejected by
  WeakSet identity.
- No Git push, no remote mutation, no unrestricted process execution.
- **No source-tree writes.** The only real filesystem writes are confined to the
  dedicated smoke workspace, in exactly one module (`src/cognitive/smokeWorkspace.ts`),
  which can only create `workspaces/provider-smoke/...` and refuses traversal,
  absolute paths, source paths, and protected names. No `.env`, secret, token,
  key, cookie, or private-file access.
- No central task assignment, no Queen command authority. `centralTaskAssignments`,
  `queenTaskAssignments`, and `globalPlannerDecisions` remain zero.

**Confinement (mechanical):**

- `child_process` is imported in **exactly one** module,
  `src/cognitive/nodeProviderProcessDriver.ts`; it is never imported by any demo.
- Real filesystem mutation is confined to two modules only:
  `src/application/projectFileCreator.ts` (C2-B exclusive create) and
  `src/cognitive/smokeWorkspace.ts` (human-only smoke workspace). `src/colony/`
  imports no `fs`, `child_process`, network, or provider code.
- The real Node driver never enumerates or logs `process.env`; it forwards only
  a small NAME allowlist and drops any name matching
  KEY/TOKEN/SECRET/PASSWORD/CREDENTIAL/COOKIE/PRIVATE. Provider authentication
  stays entirely external to the repository (the provider CLI's own local
  session); no credential value is read deliberately, persisted, or logged.
- Raw stdout/stderr never reach a receipt; receipts carry categories, counts,
  fingerprints, and the safe parsed summary only. stdout/stderr are bounded and
  truncation is flagged; a timeout kills the child.
- **Provider output is DATA, never authority** — it enters the existing
  review-gated workflow and is never applied or executed automatically.

**Honest limitations:** the permit is an ARCHITECTURAL boundary, not
cryptographic protection against arbitrary trusted local code in the same
process. Replay prevention is process-local single-use only; it is not durable
across a process restart.

Everything in Section 1 remains in force **except** this single, explicitly
human-authorized, narrowly-scoped provider-execution door. No broader execution
capability is granted, and a future multi-ant real-provider phase (3-5 ants,
global budget still 30) requires its own separate explicit human authorization.

## 20. Tamara–Namla Federation V1 + Ant Academy V1 (human-authorized, 2026-07-28)

By explicit human instruction naming this file, two deterministic, in-memory
layers are authorized: the **Tamara–Namla Federation** (`src/federation/`) and
the **Ant Academy** (`src/academy/`). Both are pure/deterministic — no fs,
`child_process`, network, timer, wall clock, or module-level mutable state — and
neither adds any real-provider execution. **R2's one-ant human-only provider
boundary is unchanged**; automated academy and federation flows use the
deterministic worker only.

**Tamara is the sovereign strategic layer, not a worker (mechanical):**

- Tamara may publish objectives, set budgets, define safety constraints,
  approve dangerous boundaries, inspect SAFE summaries, accept/reject final
  results, pause missions, and reduce provider budgets (reduce-only).
- Tamara may NOT assign a task to a specific ant, choose a quorum winner, read
  private `AntMind` state, bypass the work market/review/safety, mint provider
  permits, or create unlimited provider calls. Each forbidden power is a
  literal `false`/`0` on `TamaraAuthorityRecord`, re-checked by
  `tamaraHoldsNoWorkerAuthority`. An objective becomes local DEMAND that ants
  answer through the existing voluntary market; `tamaraDirectAntAssignments`,
  `centralTaskAssignments`, `queenTaskAssignments`, and `nonVolunteerAssignments`
  are all zero.

**Ant Academy (mechanical):**

- Skill advancement requires EVIDENCE: a promotion needs a passing exam plus an
  independent review on record (`tryPromote` never advances without both, so
  `unsupportedPromotions` is zero), and an ant can never self-certify (the
  evaluator is always a different ant, so `selfCertifications` is zero).
- All records are bounded and compacted (skill passports, training history,
  mentorship, teams, knowledge). The academy is O(N), verified at 300 / 1,000 /
  10,000 identities with bounded records and preserved diversity.
- The global cognitive budget stays 30; cognitive rotation shares a bounded
  number of slots with fairness/cooldown/backoff, and the operational
  real-provider target is 3-5 active ants — no automatic jump to 30 or hundreds.
- Only DEFENSIVE security scenarios are generated (unsafe-input detection,
  access-control review, secret-leak detection, dependency-risk analysis); no
  offensive exploitation or unauthorized-access content exists.

**What this section does NOT authorize:** no new real-provider execution, no
automatic provider invocation, no hundreds of real processes, no unrestricted
filesystem/process/shell/network, no Git push or remote mutation, no Queen
control, no central per-ant assignment, no global planner, and no unbounded
loops or training history. A future phase that trains 3-5 ants with real
provider cognition requires its own separate explicit human authorization and
still runs under R2's permit + rotation bounds.

Everything in Section 1 remains in force; no earlier section is weakened. This
section authorizes a large deterministic ant nation that trains, specializes,
certifies, and executes technology work under bounded strategic leadership — in
memory, not in the world.

## 21. Tamara–Namla Real Academy Pilot V2 — bounded multi-ant real training (human-authorized, 2026-07-30)

By explicit human instruction naming this file, a **bounded live academy pilot**
is authorized: a human may run one training pilot of **1-5 voluntary ants** with
**at most 5 total real provider invocations**, one bounded call per ant. This
extends R2's one-ant door to a strictly bounded cohort; it does **not** widen any
other boundary, and R2's one-ant smoke path stays intact.

**What one pilot permits — and nothing more (mechanical):**

- Minimum 1, maximum 5 real provider-backed ants (`MAX_PILOT_COHORT = 5`).
- Maximum 5 total real provider calls (`MAX_PILOT_PROVIDER_CALLS = 5`); each ant
  makes **at most one** call; no ant makes a second call in the same pilot.
- One explicitly selected training cohort (the accepted subset of VOLUNTARY
  claims), one selected academy domain + difficulty, one human-invoked CLI
  command, one dedicated `workspaces/academy-pilot/<pilot-id>/` workspace.
- No background execution, no automatic continuation, no provider-triggered new
  provider calls, no automatic real-provider retry — unused calls stay unused.
- No source-tree modification, no unrestricted shell, no arbitrary command, no
  Git push or remote mutation.

**Human authorization specifies** provider pool, cohort size, academy domain,
difficulty, mission budget, max provider calls, max input/output bytes, timeout,
workspace, and an **exact typed confirmation** — the dynamic phrase
`RUN TAMARA NAMLA PILOT WITH N ANTS` at an interactive TTY (never argv, env, or
piped stdin).

**Tamara sets the strategic goal and budget; she may NOT** select the exact ant
identities, bypass voluntary claims, bypass cognitive rotation, bypass
evaluation or review, bypass SkillPassport evidence requirements, or mint permits
automatically. `tamaraDirectAntAssignments`, `centralTaskAssignments`,
`queenTaskAssignments`, and `globalPlannerDecisions` remain zero.

**Permits (mechanical):** a `MultiProviderPilotPermit` (non-serializable WeakSet
identity, frozen, single-use, human-only) plus one single-use R2-style member
permit per accepted ant, minted in one bounded batch from ONE typed
confirmation. The real Node driver runs a member permit only when its origin is
`human-cli`; automated tests use `automated-test`-origin permits + the fake
driver, so `realClaudeCalls`, `realCodexCalls`, and
`realProviderProcessExecutions` stay zero in every demo.

**Evidence, not authority (mechanical):** every real provider result is DATA,
evaluated by a DIFFERENT ant, and updates only bounded SkillPassport evidence
through the existing evidence-gated rules. **One provider response cannot promote
or certify an ant, and one pilot grants ZERO certifications**
(`certificationsGranted` is literal 0). No provider output executes a command.

**Filesystem scope (mechanical):** real writes are limited to
`workspaces/academy-pilot/<pilot-id>/` (manifest, bounded prompt files, safe
result files, evaluation summaries, receipts, bounded evidence export), enforced
by `smokeWorkspace.ts` — the second and only other authorized fs-mutation module
besides `projectFileCreator.ts`. No Namla source write, no `.env`/secret/SSH/
browser-data access, no provider-created executables, no shell scripts.
`child_process` stays imported in exactly one module
(`nodeProviderProcessDriver.ts`), and the global cognitive budget stays 30.

**What this section does NOT authorize:** more than 5 real provider-backed ants,
any automatic scaling toward 30 or hundreds, real execution from automated tests,
or any relaxation of R2. Expanding to 3-5 real ants operationally is exactly what
this section bounds; going beyond 5 requires its own separate explicit human
authorization.

Everything in Section 1 remains in force; no earlier section is weakened. This
section authorizes a small, human-triggered, evidence-gated live training pilot —
bounded to five ants and five calls, then stop.

## 22. Ant Superorganism Biology V1 — frozen research reference layer (human-authorized, 2026-07-31)

`src/biology/` contains a mechanistic biological colony simulator (bodies,
energy, nutrition, brood, ecology, disease, sanitation, a conserving
double-entry resource economy, and decentralized task allocation). It is
**preserved as a research reference layer only** and is **frozen**: it is not the
product model and must not be extended (no further literal food/water/pathogen
metabolism). Its conservation engine (`resourceEconomy.ts`) and event-sourced
design directly informed the digital economy in Section 23. Nothing here writes
files, spawns processes, touches the network, reads the clock, or uses ambient
randomness; all draws are seeded and deterministic.

## 23. Digital Superorganism Metabolism V1 — the product model (human-authorized, 2026-07-31)

Namla Pro's product is a **digital superorganism** that performs high-tech work
by translating colony biology into a **causal digital economy**. This section
authorizes `src/digital/` and `src/examples/demoDigitalSuperorganismV1.ts`.

**Mapping (mechanical):** food→information, carbohydrate→fast context, protein→
durable skills/components, water→memory/bandwidth, oxygen→tools/APIs/permissions/
compute, energy→token/compute/time/money budget, working hands→executing
AntAgents + cognitive workers, trophallaxis→bounded local knowledge transfer,
metabolism→raw information becoming plans/code/tests/reviews/artifacts, CO₂/
waste→errors/failures/debt/dead knowledge, disease→poisoned data/vulns/injection,
immunity→review/testing/security/evidence/sandboxing, brood/maturation→evidence-
based promotion, death/retirement→disabled agents. The **Queen never assigns
tasks**.

**Conservation (mechanical):** the 15-resource ledger
(`digitalResourceEconomy.ts`) holds, for every resource,
`quantity == initial + collected + created − consumed − expired − quarantined`
by construction, and tool-access capacity closes (`available + held == initial`).
`unexplainedResourceCreation` is 0. Budgets are consumed-only (no infinite work).

**Causality (mechanical):** the report validates — no verified knowledge without
a raw-information input + verification, no artifact without knowledge + compute +
tokens + context + tool access, no repaired failure without a failure, no
promotion without evidence, no provider call, and no action by a retired worker.
`causalityViolations` is 0. A counter-only demo cannot satisfy these.

**Decentralization (mechanical):** task choice is a voluntary claim (stable
affinity × current demand); `centralTaskAssignments`, `queenTaskAssignments`,
`tamaraDirectAntAssignments`, and `globalPlannerDecisions` are literally 0.
Tamara only publishes the objective + budget.

**Bounded hands (mechanical):** 300 / 1,000 / 10,000 persistent identities, but
deep-cognitive concurrency ≤ 30 and real-provider workers ≤ 5 with **0** real
calls in deterministic runs (`providerCalls === 0`). Determinism is by seed.

**What this section does NOT authorize:** running Claude/Codex from Namla, any
increase in provider concurrency, any real fs/network/process access from the
digital layer (it imports none), UI work, or unfreezing the Section 22 biology
layer. Everything in Sections 1–22 remains in force; no earlier baseline is
weakened, and the golden harness grows from 31 to 32 demos with all checks green.

## 24. Digital Superorganism Operations V2 — real high-tech mission workflow (human-authorized, 2026-08-01)

This section authorizes `src/digital/digitalObjective.ts`,
`digitalWorkspace.ts`, `digitalVerification.ts`, `digitalOperationsRunner.ts`,
`digitalOperationsReport.ts`, `src/examples/demoDigitalSuperorganismOperationsV2.ts`,
and the inert `src/cli/digitalRealObjectiveCli.ts`. It builds a complete real
software mission workflow on top of the §23 digital economy.

**Objective flow (mechanical):** Tamara publishes ONE `DigitalTechnologyObjective`
and constrains it (budgets, caps, acceptance criteria). She may not name ants,
assign tasks, select the quorum winner, bypass claims/reviews/tests/budgets, mint
permits, or bypass human confirmation — the reused Tamara authority record types
those powers as literal `false`/`0`, so `tamaraDirectAntAssignments`,
`centralTaskAssignments`, `queenTaskAssignments`, and `globalPlannerDecisions`
stay 0.

**Demand metabolism (mechanical):** the objective becomes bounded demands, each
with a cause (objective requirement, identified risk, failed verification, review
finding, missing artifact, or unmet acceptance criterion). No unexplained work
demand. The full causal chain objective→demand→voluntary claim→accepted
worker→context/tool/compute→artifact/evidence/failure→review→verification→repair
is event-sourced.

**Workspace (mechanical):** the in-memory `InMemoryWorkspaceDriver` is rooted at
`workspaces/digital-operations/<objective-id>/`, rejects traversal / absolute /
backslash / protected names (.env, keys, tokens, credentials, ssh, certs, .git),
bounds file count / bytes / total size, attributes every op to
objectiveId+taskId+antId+receipt with before/after fingerprints, and performs
**0 real filesystem writes** (`realFilesystemWrites === 0`). It NEVER writes the
Namla source tree and adds no new fs importer. A real-disk driver is a separate
human-only capability that would delegate to the single authorized smoke-workspace
fs surface; it is **not** wired here.

**Verification (mechanical):** only the hard-coded allowlisted commands
(`npx.cmd tsc --noEmit`, `npm.cmd test`, `npm.cmd run build`, `npm.cmd run lint`)
may ever run; there is no mission-text command, no arbitrary script, no shell.
Automated demos use the deterministic FAKE verification driver
(`realProviderProcessExecutions`/`realNetworkCalls === 0`). Real project-command
execution requires **separate explicit human authorization** and is not enabled.

**Provider boundary (mechanical, unchanged in kind):** deterministic providers
only in automated runs (`realClaudeCalls`/`realCodexCalls === 0`); the operational
cognitive target is 1-5 (`peakCognitiveWorkers <= 5`); provider output is DATA
reviewed by a different ant; providers write no files and run no commands.

**Conservation + causality (mechanical):** the 15-resource ledger closes exactly
(`unexplainedResourceCreation === 0`) and the report's causal invariants hold
(`causalityViolations === 0`): no task without demand, no accepted worker without
voluntary claim, no artifact without consumed resources, no applied artifact
without review, no successful objective without test evidence, no repair without a
recorded failure, no knowledge without source, no evidence beyond the work, no
real provider call, no self-review.

**What this section does NOT authorize:** running Claude/Codex from Namla, real
disk workspaces or real verification execution in automated tests, provider
concurrency beyond the existing human-only 1-5 target, source-tree mutation, any
push or remote, or unfreezing the §22 biology layer. Everything in Sections 1-23
remains in force; the golden harness grows from 32 to 33 demos with all checks
green, and no earlier baseline is weakened. The R2 one-ant smoke, the academy
pilot boundaries, the global cognitive budget 30, and the human-only real-provider
target 1-5 are all preserved.

## 25. Digital Superorganism Live Objective V3 — human-authorized three-ant live objective (human-authorized, 2026-08-02)

This section narrowly authorizes the FIRST genuinely live, human-controlled
three-ant software objective. It authorizes `src/cognitive/liveObjectivePermit.ts`,
the `src/cognitive/smokeWorkspace.ts` live-objective root extension,
`src/digital/liveCohort.ts`, `liveProviderNormalization.ts`,
`liveObjectiveRunner.ts`, `liveObjectiveReport.ts`,
`src/cli/digitalLiveObjectiveCli.ts`, and
`src/examples/demoDigitalLiveObjectiveV3.ts`.

**Authorized (human-only) scope:** exactly ONE human-invoked live objective;
cohort size exactly 3; at most 3 real provider calls in planning/build; at most 2
additional human-approved repair calls; total at most 5 real provider calls; one
isolated objective workspace at `workspaces/digital-live-objective/<objective-id>/`;
no background continuation; no automatic retry; no provider-triggered provider
call; no source-tree modification; no Git push; no remote mutation; no
unrestricted shell; no arbitrary executable; no arbitrary command from mission
text. The human explicitly selects the provider pool, cohort size, objective,
workspace, provider-call cap, byte limits, timeout, and allowed verification
commands.

**Cohort (mechanical):** Tamara may publish the objective + budgets but may NOT
select ant identities. Ants enter only by voluntary claim + SkillPassport
eligibility + reliability threshold + cognitive-budget admission + live-permit
scope validation. `voluntaryLiveClaims >= 8`, `acceptedLiveCohortSize = 3`,
`nonVolunteerAssignments = 0`, and central/queen/tamara/global-planner
assignments stay 0.

**Permit (mechanical):** `LiveObjectivePermit` validity is WeakSet identity on a
frozen object bound to objective/pilot/workspace/exactly-3-ants/provider-per-ant/
call-caps/byte-caps/timeout/verification-commands/workspace-caps. It cannot be
built from JSON, an object literal, Tamara, the Queen, an ant, mission data,
provider output, an argv flag, or an env var; it is minted only by the human CLI
after an exact typed confirmation (`RUN DIGITAL OBJECTIVE WITH 3 ANTS`), is
single-use process-locally, cannot be delegated, and claims no durable replay
guarantee. Per-permit call budgets enforce initial ≤ 3, repair ≤ 2, total ≤ 5.

**Providers are data, not authority (mechanical):** each real cognitive ant makes
at most one initial call; output is normalized + size/path/secret-checked; a
provider never writes files, runs commands, chooses another ant, calls another
provider, alters Namla source, or bypasses review. Independent review (never
self; two reviewers for high-risk) precedes any application. Real verification is
allowlisted (hard-coded executable+args, `shell:false`, cwd = objective
workspace, no install, no Git, bounded output, timeout) and each repair provider
call requires a SEPARATE typed human confirmation.

**Automated verification makes zero real calls (mechanical):** the demo uses the
fake provider/verification drivers and the in-memory workspace, so `realClaudeCalls`,
`realCodexCalls`, `realProviderProcessExecutions`, `realNetworkCalls`,
`realFilesystemWrites`, `workspaceBoundaryViolations`, `sourceTreeWrites`, and
`providerBudgetViolations` are all 0, and `safetyViolations` is 0. The
`digital:live-objective` CLI stops after minting the permit (no automatic
provider call, no background continuation); real provider execution routing
through the single authorized process driver remains a separate blocker.

**What this section does NOT authorize:** more than three real ants; more than
five real provider calls; automatic scale-up toward 5, 30, or hundreds; real
execution from automated tests; a fourth fs importer or a second `child_process`
importer; source-tree writes; any push or remote. Everything in Sections 1-24
remains in force: the R2 one-ant smoke, the academy pilot boundaries, Digital
Operations V2, and the global cognitive budget 30 are all intact, and the golden
harness grows from 33 to 34 demos with all checks green.

## 26. Digital Superorganism Live Objective V4 — real driver wiring (human-authorized, 2026-08-03)

This section authorizes wiring the actual live path so a human can run one
command and three admitted voluntary ants can make one real provider call each,
return bounded structured proposals, pass independent review, write approved
files into one isolated workspace, run allowlisted verification, and perform at
most two separately-confirmed repair calls, then stop. It authorizes the
`nodeProviderProcessDriver.ts` verification-command extension,
`src/cognitive/liveProviderExecution.ts`, `src/cognitive/liveRealDrivers.ts`, the
completed `src/cli/digitalLiveObjectiveCli.ts`, and
`src/examples/demoDigitalLiveObjectiveV4Wiring.ts`.

**Authorized live path (human-only):** exactly one live objective per CLI run;
exactly three admitted voluntary ants; at most three initial real provider calls;
at most two separately-confirmed repair calls; at most five real provider calls
total; one isolated workspace; one bounded verification phase; no background
continuation; no automatic retries; no source-tree writes; no Git commands; no
push; no remote mutation; no arbitrary executable; no shell command generated from
mission text. The live CLI is human-only and TTY-only (the real run refuses
without an interactive terminal; `--dry-run` previews without a TTY and takes no
real action).

**Provider execution (mechanical):** `RealLiveProviderDriver` implements the
runner's provider contract by, per ant, validating the human-approved provider
assignment, validating the scoped single-use `RealProviderExecutionPermit`,
building a bounded `ProviderProcessSpec` (fixed executable id, fixed argument
template, bounded stdin prompt, timeout, workspace cwd), CONSUMING the permit
immediately before spawn, running exactly one process via the injected
`ProviderProcessDriver`, and normalizing stdout to DATA. Real counters increment
ONLY when the injected driver `isReal`; an automated-test-origin permit can never
drive the real Node driver (`non-human-permit`). No provider triggers another
provider; there is no retry.

**Verification (mechanical):** the one `child_process` module gains
`runVerificationCommand` — a fixed verification executable map (npx.cmd tsc
--noEmit, npm.cmd test/build/lint), `shell:false`, cwd exactly the objective
workspace, timeout, bounded output, no npm install, no Git, no argument from
provider/mission text, no retry. `RealBackedVerificationDriver` refuses any
command not in the human-approved allowlist. The CLI displays the exact commands
before running them. `child_process` remains imported in exactly one module.

**Workspace (mechanical):** `RealLiveWorkspaceDriver` applies only reviewed files
through the already-authorized `smokeWorkspace` boundary
(`writeLiveObjectiveFile`), rooted only at
`workspaces/digital-live-objective/<objective-id>/`, recording real writes and
before/after fingerprints. `fs` mutation stays confined to the same two modules.
Provider output never writes files directly.

**Repair (mechanical):** on verification failure the CLI requires the separate
exact phrase `RUN ONE REPAIR ANT` before EACH repair provider call, mints one
fresh single-use member permit per approved repair, and re-verifies — at most two
repair rounds / two repair calls / five total calls, no automatic retry.

**Automated tests make zero real calls (mechanical):**
`demoDigitalLiveObjectiveV4Wiring` drives the SAME real wiring through the FAKE
process driver, in-memory workspace, and fake verification, so `realClaudeCalls`,
`realCodexCalls`, `realProviderProcessExecutions`, `realNetworkCalls`, and
`realFilesystemWrites` are all 0, with 15 guard cases (including the real Node
driver refusing an automated-test permit without executing) and 14 expectations.

**What this section does NOT authorize:** more than three real ants; more than
five real provider calls; automatic scale-up; real execution from automated tests;
a second `child_process` importer or a fourth `fs` importer; source-tree writes;
any push or remote. Everything in Sections 1-25 remains in force; the golden
harness grows from 34 to 35 demos with all checks green, and no earlier baseline
is weakened.

## 27. Namla Digital Civilization OS V1 — living settlement (human-authorized, 2026-08-04)

This section authorizes `src/civilization/` and
`src/examples/demoNamlaCivilizationOSV1.ts`: a persistent digital ant settlement
that reuses (never duplicates) the proven `DigitalResourceEconomy`,
`createDigitalWorker` persistence, the Tamara federation authority record, the
academy, and the provider boundaries. Tamara is the sovereign strategic
intelligence; Namla is the decentralized workforce; Claude/Codex/local-models/
MCP-tools are TEMPORARY bounded cognitive/execution resources used by individual
ants.

**Settlement (mechanical):** twenty districts (`settlementDistricts.ts`), each
with real local state, published demand, consumed resources, produced artifacts/
failures, and bounded local messages. Districts, the labor market, councils,
knowledge, academy, and waste/repair are all real event-sourced state, not labels.

**Decentralization (mechanical, forever):** work is a VOLUNTARY market —
districts emit demand, ants observe it, ants submit claims, and a bounded
resolver accepts only among volunteers, forming temporary teams that dissolve.
`nonVolunteerAssignments`, `centralTaskAssignments`, `queenTaskAssignments`,
`tamaraDirectAntAssignments`, and `globalPlannerDecisions` are literally 0.
Councils (`councilsGovernance.ts`) reach LOCAL quorum on evidence with minority
reports and conflict-of-interest exclusion; neither Queen nor Tamara chooses a
council outcome.

**MCP nervous system (mechanical):** `mcpNervousSystem.ts` is a bounded, receipted
capability fabric — a hard-coded tool registry, task/ant/time-scoped revocable
grants (powerful tools require human approval), session receipts, tool + provider
health, cost/rate budgets, failure isolation, result validation, and deterministic
provider routing. No ant receives all tools; no raw mission text becomes a
command; `realProviderCalls`/`realNetworkCalls`/`processExecutions` stay 0.

**Conservation + causality (mechanical):** the 15-resource ledger closes
(`unexplainedResourceCreation === 0`) and the report's causal invariants hold
(`causalityViolations === 0`): accepted claims ⊆ voluntary, teams dissolve,
cognition ≤ 30, every MCP call is receipted, repairs come from failures,
knowledge accepted ⊆ verified, and all central/real counters are 0. Holds at
300 / 1,000 / 10,000 identities.

**What this section does NOT authorize:** running Claude/Codex from Namla (real
providers stay a separate human-gated pilot), any new fs/child_process/network
importer (the layer imports none), source-tree writes, provider concurrency beyond
the existing human-only 1-5 target, or any weakening of Sections 1-26. The golden
harness grows from 37 to 38 demos with all checks green; no earlier baseline is
weakened; the global cognitive budget stays 30.

## 28. Namla Civilization OS V2 — Live MCP Settlement (human-authorized, 2026-08-05)

This section authorizes connecting the Civilization OS V1 runtime to bounded real
provider cognition and bounded real MCP tool execution. It authorizes
`src/cognitive/civilizationLivePermit.ts`, `src/civilization/civLiveCohort.ts`,
`civLiveMcp.ts`, `civilizationLiveRunner.ts`, `civilizationLiveReport.ts`, the
`McpExecutionDriver` seam added to `mcpNervousSystem.ts`, the human CLI
`src/cli/civilizationLiveCli.ts`, and
`src/examples/demoNamlaCivilizationLiveV2.ts`.

**Authorized (human-only) scope:** exactly ONE civilization objective per CLI run;
a persistent settlement of 300 identities; 1-5 real provider-backed ants; ≤5
initial real provider calls; ≤3 separately-confirmed repair/provider calls; ≤8
real provider calls total; global cognitive budget stays 30; one isolated
civilization workspace at `workspaces/namla-civilization/<run-id>/`; bounded real
MCP tool calls; bounded allowlisted verification; no background continuation; no
automatic provider retry; no provider-triggered provider call; no provider/MCP
escalation; no source-tree writes; no Git push; no remote mutation; no
unrestricted shell. The human authorization specifies the Tamara objective,
provider pool, cohort cap, provider-call cap, MCP tool groups, workspace,
byte/file/context/timeout limits, verification commands, token/compute/monetary
budget, and the exact typed confirmation phrase. Tamara chooses strategy and
budgets but may NOT select individual ants.

**Permit (mechanical):** `CivilizationLivePermit` is a frozen, WeakSet-validated
object bound to the run/objective/workspace, allowed providers + MCP tools, cohort
(1-5), provider/repair-call caps (≤5 initial + ≤3 repair = ≤8), aggregate MCP +
verification budgets, byte/timeout/workspace caps, and token/compute/monetary
budgets. It cannot be forged by JSON/literal/Tamara/Queen/ant/council/mission/
provider-output/MCP-result/argv/env; it is minted only by the TTY human CLI after
the exact phrase, is single-use process-locally, claims no durable replay, and
cannot be delegated.

**Voluntary cohort (mechanical):** ≥15 qualified ants voluntarily claim; a
cognitive-rotation resolver admits 1-5 among the volunteers. Tamara/Queen/councils
do not name ants (a council may approve a CAPABILITY category, never an ant).
`nonVolunteerAssignments`/`centralTaskAssignments`/`queenTaskAssignments`/
`tamaraDirectAntAssignments`/`globalPlannerDecisions` stay 0.

**Provider + MCP (mechanical):** provider cognition reuses the V4
`RealLiveProviderDriver` (over a fake process driver in tests → `realProviderCalls`/
`realProviderProcessExecutions` = 0). MCP execution goes through an injected
`McpExecutionDriver`: the fake driver (tests → `realMcpExecutions` = 0) or the real
driver, which routes FILE tools through the authorized `smokeWorkspace` boundary
and VERIFICATION through the single `child_process` importer (`runVerificationCommand`)
— hard-coded executable + args, shell:false, cwd = the civilization workspace, no
install, no Git, bounded output, timeout. No provider receives a generic run-tool
capability; no provider directly writes files, runs commands, calls another
provider, selects ants, or bypasses councils/reviews/tests/workspace boundaries.
Every MCP grant is tool/task/ant/district/workspace-scoped, tick- and
call-count-bounded, revocable, receipted, costed, and human/council-approved when
powerful. Repair calls require the separate phrase `RUN ONE CIVILIZATION REPAIR ANT`.

**Automated tests make zero real action (mechanical):** the demos use fake
provider/MCP/verification drivers and an in-memory workspace, so `realProviderCalls`,
`realProviderProcessExecutions`, `realMcpExecutions`, `realNetworkCalls`, and
`realFilesystemWrites` are all 0, with conservation closing and `safetyViolations`
= 0.

**Live execution path (mechanical):** after the exact phrase the CLI closes the
confirmation readline, mints one `CivilizationLivePermit` + one scoped provider
permit per accepted ant, creates the real workspace under
`workspaces/namla-civilization/<run-id>/`, and runs the bounded live session via
`runCivilizationLiveSession` — one real provider call per initial ant through
`RealLiveProviderDriver`→`NodeProviderProcessDriver`, bounded real MCP through
`RealMcpExecutionDriver`, reviewed-file application, allowlisted verification, and
(only after a SEPARATE fresh `RUN ONE CIVILIZATION REPAIR ANT` phrase) one bounded
repair round. The pipeline is factored into a setup phase and a finalize phase so
the repair confirmation is gathered between them; the same phases back the
synchronous demo path. The session then reports and stops: no automatic retry, no
background continuation. `src/examples/demoCivilizationLiveWiring.ts` proves the
exact confirmation reaches this orchestration with fake drivers (fake provider +
fake MCP runs > 0, reviews before application, one verification failure → incident
→ one confirmed repair → final pass, every `real*` counter 0, and no repair
confirmation requested before the initial provider calls).

**What this section does NOT authorize:** more than 5 real ants; more than 8 real
provider calls; automatic scale-up; real execution from automated tests; a new
fs/child_process importer (the V2 modules import neither directly); source-tree
writes; any push or remote; or any weakening of Sections 1-27. The V4 live-objective
path and the R2 one-ant smoke remain intact; the golden harness grows from 38 to
39 demos with all checks green; the global cognitive budget stays 30.

## 29. Tamara–Namla Sovereign Federation Runtime V3 (2026-08-05)

Authorizes `src/federation/tamaraNamlaFederationV3.ts` + `tamaraCommandCenterV3.ts`,
`src/civilization/capabilityFabric.ts` + `civRoleContracts.ts`,
`src/academy/civilizationLearningLoop.ts`, and the V3 regressions.

**Sovereignty (mechanical):** Tamara publishes national objectives with policy/
budget/acceptance envelopes and accepts or rejects FINAL EVIDENCE only. Her
worker powers stay unrepresentable (V1 authority record, re-checked at runtime).
The Queen keeps continuity only. Worker selection remains voluntary claims +
capability-complete admission (`cohort-capability-gap` refusal when architecture/
implementation/independent-review coverage is impossible); councils decide policy
and artifact approval, never ants.

**Pipeline repair (mechanical, from the first real run's evidence):** role-
specific provider contracts with 14 explicit normalization failure categories;
artifact-GATED verification (an empty workspace raises `no-build-artifacts` +
repair demand instead of a vacuous check, and can never pass); repair claimants
must be implementation/debugging-capable; mode-aware safety checks (a
human-confirmed run is judged by permit caps, not mislabeled as violations) with
visible violation codes/stages/categories.

**Capability fabric (mechanical):** every computer-work capability maps to a
fixed bounded tool with risk/verification/budget/revocation metadata; grants are
scoped, receipted, revocable; `future-approved-mcp` capabilities refuse to grant;
no unrestricted shell capability exists; provider routing is evidence-scored and
provider output is never authority. Mastery requires missions + independent
tests/reviews + exam + evaluator + freshness; passports block self-certification.

**Federation flow:** every state change flows through the 19-state receipted
machine (no silent transition). Automated proof: `demoTamaraNamlaFederationV3`
(57 checks, golden-registered) with every real-action counter 0.

## 30. NAMLA PRO V2 architecture documentation publication (human-authorized, 2026-08-22)

By explicit human authorization naming `NAMLA_BUILD_LAW.md`, the approved NAMLA
PRO V2 architecture baseline (FINAL R2) may be published through a dedicated
documentation branch. This is a DOCUMENTATION operation only: it adopts a TARGET
architecture and changes no runtime behaviour.

Authorized by this amendment:

- this Build Law amendment
- `README.md` architecture update
- the approved V2 architecture documents under `docs/` (00–29)
- documentation-only Git inspection
- a dedicated documentation branch (`docs/namla-v2-architecture-baseline`)
- documentation commits on that branch
- push of that dedicated branch
- an architecture pull request to `main`

NOT authorized by this amendment:

- `src/**` modification
- production-code deletion
- runtime or security authority changes
- dependency or package changes (`package.json`, `package-lock.json`)
- CI/workflow changes (`.github/**`)
- secrets access
- deployment or release
- force push or history rewrite
- direct modification of `main`
- any unrelated future push authority

**The V2 architecture is a TARGET, not an implementation claim.** Nothing in the
published documents asserts that V2 runtime exists. The current runtime families
(`src/simulation/`, `src/colony/`, `src/colonyMission/`, `src/digital/`,
`src/civilization/`, `src/twin/`, `src/academy/`, and related paths) remain the
CURRENT implementation and are untouched by this operation. They are subjects of
a future census, not of deletion.

Migration is rescue-first: no production tree may be removed on the strength of
this baseline. The first implementation-preparation milestone after this baseline
is accepted is the **Repository Rescue Census**, which classifies components
(KEEP / EXTRACT / REWRITE / ARCHIVE / REMOVE) using dependency, entry-point,
security-boundary, test-ownership, unique-capability and replacement-proof
analysis. No production deletion occurs during that census either.

This exception applies only to this architecture-adoption operation and expires
with it.
