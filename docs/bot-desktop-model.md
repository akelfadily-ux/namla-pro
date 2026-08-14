# Bot Desktop Model (Phase 8)

Phase 8 models desktop automation the way every capability in Namla Pro is
born: as data first. A `DesktopActionPlan` is choreography on paper — what
a bot body WOULD click, type, open, focus, or look at — with no ability to
touch an actual desktop, because no OS, input, window, screen, or process
API exists anywhere in this project to touch it with.

Authorized by the Phase 8 amendment in
[NAMLA_BUILD_LAW.md](../NAMLA_BUILD_LAW.md).

## Desktop automation as data only

The five `DesktopActionKind`s (click, type-text, open-app, focus-window,
read-screen-region) describe intent in human language: a target is "the
search box", never a coordinate; typed input is a summary, never a
keystroke stream; there is no field in any type that could hold a window
handle, a screenshot, or an OS object. If the vocabulary cannot express a
real action, a real action cannot leak in through the model.

## Why simulation comes before real automation

Same reasoning as the Phase 7 adapters: the machinery *around* automation —
plan gating, protected-surface refusal, receipts, human approval — must
already work before anything real is attached, because real automation is
the point where a mistake stops being a data bug and starts being an act.
Phase 8 proves the harness on plans that cannot act.

## DesktopActionPlan boundaries

`simulated: true`, `executed: false`, and `requiresHumanApproval: true` are
literal types on every plan, every step, and every narration line — plus a
runtime re-check in `BotBodySimulator.narrate` for plans cast past the type
system (refused with a receipt). A plan also embeds the `SafetyDecision`
that allowed it and the receipt id that recorded it.

## The protected-surface deny list

`DesktopActionPlanner` refuses any plan whose task description, step
target, or input summary mentions: credential prompts, login/sign-in
forms, password fields, one-time codes, terminals and shells, system and
security settings, registry, signed-in browser sessions,
deletion/removal/confirmation dialogs, payment/checkout/banking screens,
wallets, private messages, and inboxes — plus anything carrying the
project's protected indicators. Matching is by substring and deliberately
over-cautious (bare "auth" also catches "author"); a false positive
refuses a harmless rehearsal, a false negative would rehearse targeting a
credential prompt — so over-refusal is the accepted direction. SafetyGuard
runs as a second, independent gate over all plan text.

## Receipt redaction rules

The established standard, unchanged: creation receipts carry plan id, step
count, kinds, and safety level; refusal receipts carry a reason code,
counts, text length, and a SHA-256 fingerprint via the shared
`src/core/redaction.ts` helper. Refusal summaries never name the surface
that was refused ("a step targets a protected surface" — not which one),
because naming it would put words like the deny-list's own vocabulary into
summaries that `ReceiptLog` scans. Raw plan text never enters the log.

## Why no screenshots or OS calls exist

`read-screen-region` is the kind most tempting to "just implement" — and
the most dangerous, since screen content is where credentials live. In
Phase 8 it produces a narration line like everything else. The module
imports `crypto`, the receipt log, and its own types; the
SAFETY_INVARIANTS.md checklist proves the project-wide absence of every
API this phase would need to be dangerous.

## BotBodySimulator vs real automation

The simulator consumes a plan and emits a story: "Step 1: the bot would
open the documentation viewer — simulated only, nothing performed." The
difference from real automation is not a flag or a mode — it is that the
simulator's output is a string and its import list contains nothing that
acts. A future real bot body would be a new module, behind a new law
amendment, behind the same plan gates these phases have been rehearsing.

## What is intentionally not implemented

- **Any real automation** — no input injection, window management,
  screenshots, OCR, browser or app control.
- **Coordinate or accessibility-tree modeling** — targets stay
  human-language until a real phase needs more, so nothing precise enough
  to execute exists.
- **Plan optimization or validation against a real screen** — plans are
  rehearsals, not compiled programs.
- **Persistence** — plans and narrations vanish with the process.
