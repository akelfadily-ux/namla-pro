/**
 * ProviderProcessDriver — the contract for running ONE bounded provider
 * process, and a deterministic FAKE implementation for automated tests
 * (Build Law §19).
 *
 * The contract is deliberately narrow: a fixed executable id (an enum key, not
 * a path), a fixed argument list, bounded stdin, bounded stdout/stderr, a
 * timeout, and a working directory. It never exposes raw environment,
 * credentials, tokens, cookies, a full provider config, an arbitrary command
 * string, or a shell script.
 *
 * `FakeProviderProcessDriver` runs NO real process — it returns a deterministic
 * result for a chosen scenario, so the R2 demo can exercise every lifecycle and
 * failure path (missing executable, spawn failure, timeout, non-zero exit,
 * oversized stdout/stderr, malformed output, success) with zero real execution.
 * The real driver lives in `nodeProviderProcessDriver.ts` and is the only file
 * in the repository that imports `child_process`.
 *
 * No fs, no child_process, no network in THIS file.
 */

export type ProviderExecutableId = "claude" | "codex";

export type TerminationSignalCategory = "none" | "timeout-kill" | "other-signal";

export type ProviderProcessFailureCategory =
  | "none"
  | "executable-missing"
  | "spawn-failed"
  | "timed-out"
  | "non-zero-exit"
  | "quota-exceeded"
  | "output-truncated"
  | "unknown";

export interface ProviderProcessSpec {
  /** Enum key resolved against a hard-coded executable map — never a path. */
  readonly executableId: ProviderExecutableId;
  /**
   * The executable and every FLAG are fixed and never built from mission text.
   * A provider that takes its prompt positionally (e.g. Codex `exec --ephemeral
   * --json <PROMPT>`) may include the bounded prompt as the SINGLE final element;
   * with `shell: false` it is a literal argv entry that can never become a flag.
   */
  readonly argumentList: readonly string[];
  /** Bounded prompt/context delivered on stdin (empty for positional-prompt providers). */
  readonly stdinData: string;
  readonly maxStdinBytes: number;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
  readonly timeoutMs: number;
  /** Absolute path to the dedicated smoke workspace (validated by the caller). */
  readonly workingDirectoryAbsolute: string;
}

export interface ProviderProcessResult {
  /** True once a process actually began (real driver) or a scenario simulated one (fake). */
  readonly ran: boolean;
  readonly exitCode: number | null;
  readonly terminationSignalCategory: TerminationSignalCategory;
  /** Bounded. The parser reads this; it is never trusted as code or paths. */
  readonly stdout: string;
  /** Bounded and INTERNAL — never written to a receipt. */
  readonly stderr: string;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
  readonly failureCategory: ProviderProcessFailureCategory;
}

export interface ProviderProcessDriver {
  readonly isReal: boolean;
  run(spec: ProviderProcessSpec): ProviderProcessResult;
}

export type FakeProcessScenario =
  | "success"
  | "executable-missing"
  | "spawn-failure"
  | "timeout"
  | "non-zero-exit"
  | "quota-exceeded"
  | "weak-success"
  | "oversized-stdout"
  | "oversized-stderr"
  | "malformed-output";

/** A well-formed provider result the parser accepts. */
function successStdout(): string {
  return JSON.stringify({
    summary: "The function looks correct for the described inputs.",
    confidence: 0.7,
    observations: ["Handles the described happy path."],
    edgeCase: "Empty input is not described.",
    testSuggestion: "Add a test for empty input.",
  });
}

/**
 * Deterministic fake driver. Runs no process; returns the result the chosen
 * scenario dictates. Bounds are still enforced so the demo can prove truncation.
 */
export class FakeProviderProcessDriver implements ProviderProcessDriver {
  readonly isReal = false;

  constructor(private readonly scenario: FakeProcessScenario = "success") {}

  run(spec: ProviderProcessSpec): ProviderProcessResult {
    const base = {
      ran: true,
      exitCode: 0 as number | null,
      terminationSignalCategory: "none" as TerminationSignalCategory,
      stdout: "",
      stderr: "",
      stdoutTruncated: false,
      stderrTruncated: false,
      failureCategory: "none" as ProviderProcessFailureCategory,
    };

    switch (this.scenario) {
      case "executable-missing":
        return { ...base, ran: false, exitCode: null, failureCategory: "executable-missing" };
      case "spawn-failure":
        return { ...base, ran: false, exitCode: null, failureCategory: "spawn-failed" };
      case "timeout":
        return { ...base, exitCode: null, terminationSignalCategory: "timeout-kill", failureCategory: "timed-out" };
      case "non-zero-exit":
        return { ...base, exitCode: 2, stderr: "provider reported an error", failureCategory: "non-zero-exit" };
      case "quota-exceeded":
        // A provider CLI reporting an exhausted usage quota: ran, non-zero
        // exit, distinct category so pilots can count quota failures honestly.
        return { ...base, exitCode: 3, stderr: "usage limit reached", failureCategory: "quota-exceeded" };
      case "oversized-stdout": {
        const big = "x".repeat(spec.maxStdoutBytes + 100);
        const truncated = big.slice(0, spec.maxStdoutBytes);
        return { ...base, stdout: truncated, stdoutTruncated: true, failureCategory: "output-truncated" };
      }
      case "oversized-stderr": {
        const big = "e".repeat(spec.maxStderrBytes + 100);
        const truncated = big.slice(0, spec.maxStderrBytes);
        return { ...base, exitCode: 1, stderr: truncated, stderrTruncated: true, failureCategory: "non-zero-exit" };
      }
      case "malformed-output":
        return { ...base, stdout: "not json at all {{{" };
      case "weak-success": {
        // A completed process returning a valid but LOW-CONFIDENCE result:
        // the process succeeds, but an independent evaluator will fail it.
        const weak = JSON.stringify({ summary: "Possibly a defect, unsure.", confidence: 0.25, observations: ["low certainty"] });
        return { ...base, stdout: weak };
      }
      case "success":
      default:
        return { ...base, stdout: successStdout() };
    }
  }
}
