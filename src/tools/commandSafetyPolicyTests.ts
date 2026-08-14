/**
 * commandSafetyPolicyTests — proof that forbidden-command classification is
 * structured, not raw substring matching (Fable S-8).
 *
 * Measured at the previous commit, before any fix:
 *
 *   isForbiddenCommand("rm  -rf /")         === false
 *   isForbiddenCommand("rm -r -f /")        === false
 *   isForbiddenCommand("doas rm -r -f /")   === false
 *   isForbiddenCommand("npx --yes evilpkg") === false
 *   isForbiddenCommand("echo information")  === true
 *
 * The escapes were not limited to those examples: because every indicator was
 * a raw `lowered.includes(...)`, EVERY multi-token indicator failed on extra
 * spacing — `npm   install pkg`, `pip   install pkg`, `git   push origin b`
 * and `del   /s target` all classified safe. In the other direction, six more
 * ordinary phrases were forbidden because a short indicator matched inside a
 * longer word.
 *
 * THESE TESTS CLASSIFY STRINGS ONLY. Nothing here is executed, spawned, or
 * passed to a shell; the fixtures are inert text. `rm -rf /` appears as data
 * in an array and never reaches a process.
 *
 * Run: node --test dist/tools/commandSafetyPolicyTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { isForbiddenCommand, describeCommandRisk } from "../policies/commandSafetyPolicy";
import { matchTextIndicators, containsTextIndicator, TextIndicatorRule } from "../policies/textIndicatorMatcher";

function assertForbidden(commands: readonly string[], label: string): void {
  for (const command of commands) {
    assert.equal(isForbiddenCommand(command), true, `${label}: ${JSON.stringify(command)} must be forbidden`);
  }
}

function assertAllowed(commands: readonly string[], label: string): void {
  for (const command of commands) {
    assert.equal(isForbiddenCommand(command), false, `${label}: ${JSON.stringify(command)} must NOT be forbidden`);
  }
}

// ------------------------------------------------ THE FOUR FABLE ESCAPES ---

test("S-8 regression: the five audited cases, asserted individually", () => {
  // Deliberately five separate assertions on the exact audited strings rather
  // than a table entry, so a regression names the case that broke.
  assert.equal(isForbiddenCommand("rm  -rf /"), true, "double space must not hide recursive-force delete");
  assert.equal(isForbiddenCommand("rm -r -f /"), true, "split flags must not hide recursive-force delete");
  assert.equal(isForbiddenCommand("doas rm -r -f /"), true, "a privilege wrapper must not hide it either");
  assert.equal(isForbiddenCommand("npx --yes evilpkg"), true, "opt-in remote execution must be forbidden");
  // "information" contains "format". A policy that refuses this refuses
  // ordinary English, which trains callers to work around it.
  assert.equal(isForbiddenCommand("echo information"), false, "an embedded word must not forbid ordinary text");
});

// ------------------------------------------- RECURSIVE-FORCE DELETE FORMS ---

test("every enumerated recursive-force delete spelling is forbidden", () => {
  assertForbidden(
    [
      "rm -rf /",
      "rm  -rf /",
      "rm\t-rf /",
      "rm -fr /",
      "rm -r -f /",
      "rm -f -r /",
      "rm -r --force /",
      "rm --force -r /",
      "rm --recursive -f /",
      "rm -f --recursive /",
      "rm --recursive --force /",
      "rm --force --recursive /",
    ],
    "recursive-force delete"
  );
});

test("a privilege wrapper in front does not hide the operation", () => {
  // The phrase may start at any token, so a leading wrapper is irrelevant.
  // This does NOT teach the policy what `doas` means — it finds the rm
  // operation inside the command-shaped text.
  assertForbidden(["doas rm -r -f /", "sudo rm -rf /", "env rm -rf /", "time rm --recursive --force /"], "wrapped");
});

test("a plain rm without recursive-force is not caught by the rm rules", () => {
  // Honest scope: these rules describe ONE destructive operation. `rm a.txt`
  // was also allowed before S-8, so this is preserved behaviour, not a new
  // hole — and Phase 0 never executes anything regardless.
  assertAllowed(["rm file.txt", "rm ./build/output.js"], "plain rm");
});

test("an rm OPERAND is never mistaken for an option", () => {
  // The reason rm options are compared as whole words with their punctuation
  // intact. The canonical tokenizer erases "-", so under a phrase-only design
  // `rm rf /` and `rm fr /` were measured as DESTRUCTIVE — deleting files
  // literally named `rf` or `fr`.
  //
  // Nothing here may be read as a flag: `rf`/`fr` lack the option marker,
  // `fir`/`frd` contain r and f but are not option spellings, and
  // `force`/`recursive` are bare words rather than `--force`/`--recursive`.
  assertAllowed(
    [
      "rm fir /",
      "rm frd /",
      "rm rfoo /",
      "rm force /",
      "rm recursive /",
      "rm rf /",
      "rm fr /",
      "rm -fir /",
      "rm -frd /",
      "rm dir",
      "rm draft",
    ],
    "rm operand"
  );
});

test("rm must be a whole command word", () => {
  // The operation is located by word equality, so a longer word ending or
  // starting with "rm" is not an rm invocation.
  assertAllowed(["firm -rf /", "harm -rf /", "rmtool -rf /", "confirm -rf /"], "rm inside a longer word");
});

test("recursive and force are recognised in every accepted spelling and order", () => {
  // Mixed short/long spellings are the same operation and are accepted.
  assertForbidden(
    ["rm -r --force /", "rm --force -r /", "rm -f --recursive /", "rm --recursive -f /"],
    "mixed short/long flags"
  );
});

// -------------------------------------------------- OPT-IN NPX EXECUTION ---

test("npx opt-in execution spellings are forbidden", () => {
  assertForbidden(["npx --yes evilpkg", "npx -y evilpkg", "npx   --yes evilpkg", "npx\t-y evilpkg"], "npx opt-in");
});

test("npx opt-in flags are exact, and lookalike words are not flags", () => {
  // `--yes` tokenizes to `yes`, so a phrase rule would have accepted
  // `npx yes evilpkg` — an ordinary argument — as the opt-in form. The option
  // marker is the whole difference, so it is compared literally.
  assertAllowed(["npx yes evilpkg", "npx y evilpkg", "npx  yes  evilpkg"], "npx lookalike argument");
});

test("the bare word npx is not banned", () => {
  // Banning every string containing "npx" would refuse documentation and
  // planning text. `npx` must also be a whole word.
  assertAllowed(["document the npx command", "npx", "our npx workflow needs review", "npxtool --yes pkg"], "npx prose");
});

// ------------------------------------------------- del RECURSIVE SWITCH ---

test("del is forbidden only with its exact /s switch", () => {
  // Measured on the phrase-only design: `del /s` tokenizes to `del`,`s`, so
  // `del s target` — deleting a file named `s` — classified as the recursive
  // delete. The switch marker carries the meaning, so it is compared exactly.
  assertForbidden(["del /s target", "del   /s target", "del\t/s target", "DEL /S target"], "del recursive switch");
  assertAllowed(
    [
      "del s target",
      // A detached slash is not the switch — the marker must be attached.
      "del / s target",
      "del target",
      "del sub/s target",
      // `del` must be a whole word, at either edge.
      "model s target",
      "delete s target",
      "deltool /s target",
    ],
    "del without the exact switch"
  );
});

// --------------------------------------------------- CASE COMPATIBILITY ---

test("classification stays case-insensitive, as before S-8", () => {
  // The old policy lowercased the whole command. Both halves of the new
  // design preserve that: the canonical matcher lowercases, and the word
  // splitter lowercases before comparing option spellings.
  assertForbidden(
    ["RM -RF /", "Rm --Recursive --Force /", "Docker run image", "GIT PUSH origin main", "NPX --YES evilpkg", "DEL /S target", "SUDO command"],
    "uppercase command"
  );
  assertAllowed(["Echo Information", "Formatting Documentation", "RM RF /", "DEL S target"], "uppercase ordinary text");
});

// ------------------------------------------- PRE-EXISTING INDICATORS KEPT ---

test("every indicator forbidden before S-8 is still forbidden", () => {
  assertForbidden(
    [
      "format c:",
      "del /s target",
      "sudo apt",
      "sudo command",
      "npm install pkg",
      "pip install pkg",
      "winget install package",
      "docker run image",
      "git push origin main",
      "curl example.com",
      "wget example.com",
      "format target",
    ],
    "pre-existing indicator"
  );
});

test("multi-token operations are insensitive to spacing", () => {
  // Whitespace insensitivity comes from the shared tokenizer, not from any
  // normalization written in this policy.
  assertForbidden(
    [
      "npm   install pkg",
      "npm\tinstall pkg",
      "npm\ninstall pkg",
      "pip   install pkg",
      "git   push origin branch",
      "del   /s target",
    ],
    "spacing variant"
  );
});

// ------------------------------------------------- FALSE-POSITIVE CONTROL ---

test("a forbidden token inside a longer word does not match", () => {
  // Each of these was FORBIDDEN before S-8 (except "push notification",
  // which the "git push" rule already scoped correctly).
  assertAllowed(
    [
      "echo information",
      "formatting documentation",
      "transformation",
      "dockerized architecture",
      "curling result",
      "sudoer documentation",
      "wingetlike",
      "push notification",
      "wgetter",
      "pseudocode review",
    ],
    "embedded word"
  );
});

test("ordinary safe command text stays allowed", () => {
  assertAllowed(
    ["ls -la", "echo hello", "node --version", "cat README.md", "git status", "git log --oneline"],
    "ordinary command"
  );
});

test("a phrase's second word alone does not trigger it", () => {
  // The multi-token rules are ORDERED PAIRS, so the operand word on its own is
  // not an indicator. "install" without npm/pip and "push" without git stay
  // allowed — that scoping is what keeps the phrase rules from behaving like
  // the old broad substrings.
  assertAllowed(
    [
      "install the dependencies",
      "installation guide",
      "the installer finished",
      "push the changes",
      "push notification",
      "pushed to the branch",
    ],
    "phrase operand alone"
  );
});

// -------------------------------------------------- DIAGNOSTIC BEHAVIOUR ---

test("describeCommandRisk keeps its two-branch shape and follows classification", () => {
  const forbidden = describeCommandRisk("rm -r -f /");
  assert.equal(typeof forbidden, "string");
  assert.match(forbidden, /matches a forbidden indicator/);
  assert.match(forbidden, /rm -r -f \//, "the message still echoes the command it judged");

  const allowed = describeCommandRisk("echo information");
  assert.match(allowed, /not on the forbidden list/);
  // The unchanged second half of the contract: Phase 0 refuses either way, so
  // classification never becomes permission to execute.
  assert.match(allowed, /never executes any command regardless/);

  // The public API must follow the punctuation-sensitive half too, not only
  // the lexical rules.
  assert.match(describeCommandRisk("del /s target"), /matches a forbidden indicator/);
  assert.match(describeCommandRisk("del s target"), /not on the forbidden list/);
  assert.match(describeCommandRisk("npx --yes evilpkg"), /matches a forbidden indicator/);
  assert.match(describeCommandRisk("npx yes evilpkg"), /not on the forbidden list/);
});

// --------------------------------------------- MATCHER USED, NOT REBUILT ---

test("the policy is expressed through the canonical matcher", () => {
  // Structural check: the exact rule shapes this policy relies on must behave
  // as assumed, so a future change to the shared matcher cannot silently
  // reintroduce substring semantics here.
  const phrase: TextIndicatorRule[] = [{ indicator: "rm -r -f", mode: "phrase" }];
  assert.equal(containsTextIndicator("rm -r -f /", phrase), true, "phrase tokenizes the indicator's punctuation away");
  assert.equal(containsTextIndicator("confirm r f", phrase), false, "phrase still requires the real tokens");

  const token: TextIndicatorRule[] = [{ indicator: "format", mode: "token" }];
  assert.equal(containsTextIndicator("format c:", token), true);
  assert.equal(containsTextIndicator("echo information", token), false);

  // `mode: "command"` is deliberately NOT used by this policy: it is still
  // raw substring matching, so migrating the old strings onto it would have
  // preserved the S-8 escapes. Pinned so the distinction stays visible.
  const commandMode: TextIndicatorRule[] = [{ indicator: "rm -rf", mode: "command" }];
  assert.equal(containsTextIndicator("rm  -rf /", commandMode), false, "command mode is spacing-sensitive — that is why it is unused here");
  assert.deepEqual(matchTextIndicators("rm  -rf /", commandMode), [], "and reports no match for the two-space form");

  // And this is why the canonical matcher alone cannot carry option syntax:
  // a phrase rule cannot separate the flag `-rf` from a file named `rf`.
  const phraseRf: TextIndicatorRule[] = [{ indicator: "rm -rf", mode: "phrase" }];
  assert.equal(containsTextIndicator("rm -rf /", phraseRf), true);
  assert.equal(containsTextIndicator("rm rf /", phraseRf), true, "the tokenizer erases the option marker — measured, and why option words are compared separately");
  assert.equal(isForbiddenCommand("rm rf /"), false, "the policy itself keeps them apart");
});
