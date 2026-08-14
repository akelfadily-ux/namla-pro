/**
 * CommandSafetyPolicy classifies a shell-command-shaped string. It is used
 * by CommandAdapter to justify its Phase 0 refusal, and will remain the
 * gate for command execution in every future phase.
 *
 * Fable S-8: this policy matched a flat list of indicator strings with
 * `lowered.includes(indicator)`. That is wrong in BOTH directions, and both
 * were measured against the previous commit:
 *
 *   ESCAPES - the substring is spacing- and order-sensitive, so trivially
 *   rewriting a command defeated it. `rm  -rf /` (two spaces), `rm -r -f /`
 *   (split flags), `rm -fr /` (swapped flags) and `doas rm -r -f /` all
 *   classified SAFE. This was not limited to the audit's examples: every
 *   multi-token indicator failed the same way, so `npm   install pkg`,
 *   `pip   install pkg`, `git   push origin b` and `del   /s target` were
 *   all safe too. `npx --yes evilpkg` had no rule at all.
 *
 *   FALSE POSITIVES - a short indicator matched inside a longer word, so
 *   `echo information` was FORBIDDEN because "information" contains
 *   "format". So were `formatting documentation`, `dockerized
 *   architecture`, `curling result`, `sudoer documentation`, `wingetlike`
 *   and `transformation`.
 *
 * Matching now goes through the canonical textIndicatorMatcher. That matcher
 * tokenizes into maximal [a-z0-9] runs, which is exactly the normalization
 * this policy needs: `-rf`, `--recursive` and `/s` become the tokens `rf`,
 * `recursive` and `s`, and any run of spaces, tabs or punctuation is a
 * boundary. Whitespace insensitivity therefore comes from the shared
 * tokenizer rather than from a second parser written here.
 *
 * The matcher itself is UNCHANGED. `mode: "command"` is deliberately not
 * used: it is still raw substring matching, so migrating the old strings to
 * it would have preserved the escapes above.
 *
 * Lexical matching alone is not sufficient for OPTION syntax, and pretending
 * otherwise was measurably wrong. The canonical tokenizer discards "-", so a
 * phrase rule for `rm -rf` also matched `rm rf /` — deleting a file named
 * `rf`. Option spellings are therefore compared as whole whitespace-delimited
 * words against exact closed sets, in the two narrow recognizers below. That
 * is a word splitter, not a second lexical matcher and not a shell parser:
 * no quoting, escaping, pipes, redirection, substitution, expansion, aliases
 * or grammar.
 *
 * HONEST LIMITATION: this classifies arbitrary TEXT, not parsed argv. It
 * recognises a fixed set of dangerous command spellings and is not a
 * substitute for the sandbox boundary that actually prevents execution.
 */

import { containsTextIndicator, TextIndicatorRule } from "./textIndicatorMatcher";

/**
 * Single command or tool names, matched as whole lexical tokens.
 *
 * Token mode is what fixes the false positives: "format" matches the token
 * `format` in `format c:` but not the word "information", and "docker" does
 * not match "dockerized". These stay individually forbidden because naming
 * one of them is itself the dangerous request in Phase 0.
 */
const FORBIDDEN_TOOL_RULES: TextIndicatorRule[] = [
  { indicator: "sudo", mode: "token" },
  { indicator: "docker", mode: "token" },
  { indicator: "curl", mode: "token" },
  { indicator: "wget", mode: "token" },
  { indicator: "winget", mode: "token" },
  { indicator: "format", mode: "token" },
];

/**
 * Multi-token command operations, matched as consecutive-token phrases.
 *
 * Phrase mode is correct HERE because every word carries its own meaning —
 * `npm install` is dangerous as two ordinary words, with no option marker to
 * preserve. Whitespace insensitivity comes free from the shared tokenizer,
 * so `npm   install pkg` and `npm\tinstall pkg` match identically.
 *
 * Operations whose danger lives in PUNCTUATION are deliberately not here:
 * `del /s` moved to the exact-option recogniser below once measurement
 * showed phrase mode also matched `del s target`.
 */
const FORBIDDEN_OPERATION_RULES: TextIndicatorRule[] = [
  { indicator: "npm install", mode: "phrase" },
  { indicator: "pip install", mode: "phrase" },
  { indicator: "git push", mode: "phrase" },
];

const FORBIDDEN_COMMAND_RULES: TextIndicatorRule[] = [
  ...FORBIDDEN_TOOL_RULES,
  ...FORBIDDEN_OPERATION_RULES,
];

/**
 * Split on whitespace ONLY, keeping every other character.
 *
 * This is NOT a second lexical matcher and not a shell parser — it is the
 * exact opposite of the canonical tokenizer, and that is the point. The
 * canonical tokenizer deliberately cuts on punctuation, which is right for
 * lexical and phrase matching but erases the leading "-" that distinguishes
 * an OPTION from an OPERAND. Measured on the phrase-only design: `rm rf /`
 * and `rm fr /` — a delete of files literally named `rf` or `fr` — were
 * indistinguishable from `rm -rf /` and classified destructive.
 *
 * So option spellings are compared as whole whitespace-delimited words, with
 * their punctuation intact. There is no quoting, escaping, pipe,
 * redirection, substitution, expansion, alias or grammar handling here, and
 * there never should be: this recognizes an exact closed set of words.
 */
function splitCommandWords(command: string): string[] {
  const words: string[] = [];
  let current = "";
  for (const ch of command.toLowerCase()) {
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f" || ch === "\v") {
      if (current.length > 0) {
        words.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) words.push(current);
  return words;
}

/**
 * Exact rm option spellings. Closed sets, compared by equality — never by
 * letter content.
 *
 * `-fir` and `-frd` are NOT recursive-force even though their letters
 * include r and f, and `rf` / `fr` without a leading "-" are operands, not
 * flags. Every one of those is pinned by a negative test. Combined clusters
 * are exactly `-rf` and `-fr`; a longer cluster such as `-rvf` is outside the
 * recognized set and is an honest limitation rather than a letter heuristic,
 * because any rule broad enough to admit `-rvf` also admits `-fir`.
 */
const RM_RECURSIVE_FLAGS: ReadonlySet<string> = new Set(["-r", "--recursive"]);
const RM_FORCE_FLAGS: ReadonlySet<string> = new Set(["-f", "--force"]);
const RM_RECURSIVE_FORCE_FLAGS: ReadonlySet<string> = new Set(["-rf", "-fr"]);

/**
 * True when the text contains an `rm` invocation carrying BOTH recursive and
 * force, in any order and any accepted spelling.
 *
 * `rm` must be a whole command word, so `firm -rf /`, `harm -rf /` and
 * `rmtool -rf /` are not matched. It need not be the first word, so a
 * privilege wrapper like `doas` or `sudo` in front is covered without this
 * policy knowing what those programs are.
 */
function isRecursiveForceRemove(command: string): boolean {
  const words = splitCommandWords(command);

  for (let start = 0; start < words.length; start += 1) {
    if (words[start] !== "rm") continue;

    let recursive = false;
    let force = false;
    for (let i = start + 1; i < words.length; i += 1) {
      const word = words[i];
      if (RM_RECURSIVE_FORCE_FLAGS.has(word)) {
        recursive = true;
        force = true;
      } else if (RM_RECURSIVE_FLAGS.has(word)) {
        recursive = true;
      } else if (RM_FORCE_FLAGS.has(word)) {
        force = true;
      }
      if (recursive && force) return true;
    }
  }

  return false;
}

/**
 * True when `commandWord` appears as a whole word and is followed by any
 * option from `options`, compared by exact equality.
 *
 * The single-flag counterpart of the rm recogniser, for the operations whose
 * danger is carried by one switch. Requiring the command word to be a whole
 * word is what keeps prose out; requiring the option to match exactly is what
 * keeps the option marker meaningful.
 */
function commandCarriesOption(command: string, commandWord: string, options: ReadonlySet<string>): boolean {
  const words = splitCommandWords(command);

  for (let start = 0; start < words.length; start += 1) {
    if (words[start] !== commandWord) continue;
    for (let i = start + 1; i < words.length; i += 1) {
      if (options.has(words[i])) return true;
    }
  }

  return false;
}

/**
 * Exact npx opt-in flags — the spellings that suppress the confirmation
 * prompt, so the package is fetched and run without a decision point.
 *
 * Exact, not lexical: `npx yes evilpkg` and `npx y evilpkg` are NOT these
 * flags, and a phrase rule for "npx --yes" would have accepted both because
 * the tokenizer drops the dashes. `npx` must also be a whole word, so
 * "document the npx command" stays allowed. No package name is validated.
 */
const NPX_ASSUME_YES_FLAGS: ReadonlySet<string> = new Set(["--yes", "-y"]);

/**
 * Exact `del` recursive switch.
 *
 * Moved out of phrase matching for the same measured reason as rm: the
 * canonical tokenizer turns `/s` into the token `s`, so a phrase rule for
 * "del /s" also matched `del s target` — deleting a file named `s`. The
 * switch marker is the whole difference between the two, so it is compared
 * literally.
 */
const DEL_RECURSIVE_FLAGS: ReadonlySet<string> = new Set(["/s"]);

export function isForbiddenCommand(command: string): boolean {
  return (
    containsTextIndicator(command, FORBIDDEN_COMMAND_RULES) ||
    isRecursiveForceRemove(command) ||
    commandCarriesOption(command, "npx", NPX_ASSUME_YES_FLAGS) ||
    commandCarriesOption(command, "del", DEL_RECURSIVE_FLAGS)
  );
}

export function describeCommandRisk(command: string): string {
  if (isForbiddenCommand(command)) {
    return `Command matches a forbidden indicator and cannot be executed in Namla Pro Phase 0: "${command}"`;
  }
  return `Command is not on the forbidden list, but Phase 0 never executes any command regardless: "${command}"`;
}
