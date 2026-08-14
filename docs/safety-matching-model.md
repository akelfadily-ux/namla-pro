# Safety Matching Model (AH2 Step 4E)

How Namla Pro decides that text matches a dangerous or protected
indicator. The canonical low-level matcher is
[`src/policies/textIndicatorMatcher.ts`](../src/policies/textIndicatorMatcher.ts);
its canonical consumers are `SafetyGuard` and `SecretProtectionPolicy`
(and, through the latter, `ReceiptLog` summaries, `ColonyMemory`,
`PheromoneSafetyPolicy`, and `MemoryAnt`).

## Rule modes

- **exact** — whole text equals the indicator. (Reserved; no canonical
  rule currently needs it.)
- **token** — the indicator appears as a whole lexical token (maximal
  `[a-z0-9]` run after lowercasing). Used for short words where substring
  matching caused false positives. Token rules carry explicit inflected
  `variants` ("remove" also matches removes/removed/removing/removal), so
  narrowing the mechanics does not narrow real coverage.
- **phrase** — the indicator's words appear as consecutive tokens. Because
  tokenization treats hyphens, underscores, colons, and slashes as
  boundaries, "private key" also matches "private-key" and "private_key",
  and "authorization: bearer" matches with or without the colon.
- **command** — raw case-insensitive substring of a command spelling that
  carries its own punctuation ("rm -rf", "del /s"). The punctuation makes
  these precise; tokenizing them would *lose* precision.
- **path-fragment** — substring with lexical edges where the fragment's
  own edge is alphanumeric: ".env" matches ".env", ".env.local",
  "config/.env" — not ".environment".
- **substring** — raw breadth on purpose; canonical use: the PEM marker
  "-----begin", where any occurrence means key material.

## Why embedded-word false positives are reduced

The four canonical offenders — "information"/format, "reinforcement"/force,
"executed"/exec, "author"/auth — were substring hits on short fragments.
Token mode requires the fragment to *be* a token, so those words pass while
"exec:", "EXEC", "auth-request", "force --flag", and "format /target"
still match. The regression matrix in
[`demoSafetyMatcher.ts`](../src/examples/demoSafetyMatcher.ts) pins all of
this behavior.

## Why dangerous patterns remain blocked

Three mechanisms: explicit inflection variants on every narrowed token rule
(destructive verbs, install/push families, execution wording — with one
deliberate, documented exception: the past participle "executed" is
descriptive and is not a variant of "exec", while "execute", "executes",
"executing", and "execution" are); phrase/command/path modes that keep
multi-word and punctuation-bearing indicators at their original or better
precision; and a captured pre-change baseline plus the matrix demo, where
any expected-refused case that becomes allowed counts as a
`dangerousRegression` and is release-blocking.

## Intentionally broad substring rules that remain

Domain deny lists keep their own semantics on purpose — their failure
direction is refusal, which is safe:

- `fileClassifier` (inspector) — filenames are camelCase/concatenated
  ("secretProtectionPolicy.ts" has no token boundary at "secret"), so
  substring is the *correct* semantics there.
- `commandSafetyPolicy` — matches command strings, where fragments are
  precise enough.
- `GitReadPlanner`'s disallowed-git-words — documented false positives
  ("confirm" contains "rm") accepted; candidates are commands, not prose.
- `DesktopActionPlanner`'s protected surfaces — deliberately over-cautious
  ("auth" also catching "author" in a surface description refuses a
  harmless rehearsal, never permits a dangerous one).
- The PEM marker in the canonical policy itself.

## Safe failure direction

Every narrowing was chosen so that what stops matching is prose containing
an indicator *inside another word*; everything that carried intent —
imperatives, inflections, commands, paths, phrases — still matches.
Where genuine ambiguity existed, the rule stayed broad. Over-refusal
remains the accepted cost; under-refusal is the release-blocking defect.

## Limitations

Policy matching is lexical, not semantic — it is a tripwire, not a
security sandbox. Paraphrased danger ("make the directory empty") passes
the guard and always has; the real guarantees remain capability absence
(no execution/network/write APIs exist — see
[SAFETY_INVARIANTS.md](../SAFETY_INVARIANTS.md)), literal-typed
unappliable proposals, and human approval boundaries. The matcher reduces
noise; it does not carry the safety of the system.
