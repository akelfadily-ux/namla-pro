import type { VerificationSafeReason } from "../cognitive/sandboxPolicy";
/**
 * digitalVerification — the strictly allowlisted project-verification boundary
 * (Build Law §24). Only a fixed set of hard-coded (executable, args) pairs may
 * ever be verified; there is no mission-text command, no arbitrary script name,
 * no shell. The automated runtime uses the DETERMINISTIC FAKE driver
 * (`realProviderProcessExecutions` / `realNetworkCalls` stay 0). A real driver
 * that actually spawns these commands is a separate, human-authorized capability
 * (it would live behind the single existing `child_process` importer) and is NOT
 * wired here.
 *
 * No fs, no child_process, no network, no wall clock.
 */

export interface VerificationCommand {
  readonly id: string;
  readonly executable: string;
  readonly args: readonly string[];
}

/** The ONLY commands that may ever run — executable + args are hard-coded. */
export const ALLOWED_VERIFICATION_COMMANDS: readonly VerificationCommand[] = [
  { id: "typecheck", executable: "npx.cmd", args: ["tsc", "--noEmit"] },
  { id: "test", executable: "npm.cmd", args: ["test"] },
  { id: "build", executable: "npm.cmd", args: ["run", "build"] },
  { id: "lint", executable: "npm.cmd", args: ["run", "lint"] },
];

export type VerificationStatus = "passed" | "failed";

/**
 * Every safe reason the REAL verification path can truthfully report.
 *
 * Deliberately a CLOSED union assembled from the sandbox's own vocabularies
 * rather than `string`: these are the only values `runVerificationCommand` can
 * produce, and keeping the set closed is what stops a future caller inventing a
 * reason the sandbox never established. Type-only import, so no runtime edge is
 * added between the digital and cognitive layers.
 */
export type { VerificationSafeReason };

export type FailureCategory =
  | "type-error"
  | "test-failure"
  | "build-failure"
  | "security-failure"
  | "review-rejection"
  | "malformed-provider-output"
  | "invalid-path"
  | "missing-requirement"
  | "duplicate-implementation"
  | "integration-conflict"
  /**
   * S-13. The two categories the REAL verification path may report.
   *
   * Every category above is a claim about the CODE — "the types are wrong",
   * "a test failed". The real driver used to report `type-error` for all of
   * them, including a missing sandbox and a refused authorization, which said
   * something about the code that had never been checked. These two say only
   * what was actually established:
   *
   *   verification-unavailable   nothing ran, so nothing about the code is
   *                              known — no sandbox, refused authorization,
   *                              blocked, or never started.
   *   verification-command-failed the command ran inside the sandbox and did
   *                              not pass, but a sandbox receipt reports an
   *                              exit CATEGORY, never a compiler diagnostic, so
   *                              WHY it failed is not knowable from here.
   *
   * The precise, safe reason travels in `safeReasonCode` alongside.
   */
  | "verification-unavailable"
  | "verification-command-failed";

export interface VerificationOutcome {
  readonly commandId: string;
  readonly status: VerificationStatus;
  readonly failureCategory: FailureCategory | null;
  /**
   * S-13: the PRECISE safe reason. A closed union of codes the sandbox itself
   * defines — never raw stdout, stderr, command text, a path, or a diagnostic
   * message.
   *
   * REQUIRED, and deliberately not optional. This field exists precisely to
   * stop the exact reason being discarded, so a shape that let a producer say
   * nothing at all would reopen the hole from the other side: `undefined` would
   * mean both "this driver has no sandbox reason" and "someone forgot", and the
   * two are indistinguishable at the call site. Every outcome now states its
   * position, and `null` is a statement — "no sandbox reason exists here" —
   * which is what the deterministic fake driver reports, since it models
   * code-level verdicts and never touches a sandbox.
   */
  readonly safeReasonCode: VerificationSafeReason | null;
  readonly outputLineCount: number; // bounded, never raw output
  /** 0 for the fake driver; 1 when the human-only real driver actually spawned. */
  readonly realProcessExecutions: number;
  readonly realNetworkCalls: number;
}

/** Reject anything not on the allowlist — the mechanical command guard. */
export function isAllowedVerificationCommand(executable: string, args: readonly string[]): boolean {
  return ALLOWED_VERIFICATION_COMMANDS.some((c) => c.executable === executable && c.args.length === args.length && c.args.every((a, i) => a === args[i]));
}

export function resolveVerificationCommand(commandId: string): VerificationCommand | null {
  return ALLOWED_VERIFICATION_COMMANDS.find((c) => c.id === commandId) ?? null;
}

export interface VerificationDriver {
  /** Verify one allowlisted command in the given workspace. Never spawns in the fake. */
  readonly kind: string;
  run(commandId: string, workspaceRoot: string, defectPresent: boolean): VerificationOutcome;
}

/**
 * The deterministic fake driver used by every automated demo/test. It performs
 * NO process/network/fs work: it maps "is there an unrepaired defect?" to a
 * pass/fail outcome for the typecheck command, and passes the others. This is
 * how the demo detects an injected defect and later proves the repair.
 */
export class FakeVerificationDriver implements VerificationDriver {
  readonly kind = "fake-deterministic" as const;

  run(commandId: string, workspaceRoot: string, defectPresent: boolean): VerificationOutcome {
    void workspaceRoot;
    const cmd = resolveVerificationCommand(commandId);
    // Every branch states `safeReasonCode: null` explicitly: this driver never
    // consults a sandbox, so it has no sandbox reason to report. That is a
    // position, not an omission.
    if (!cmd) {
      return { commandId, status: "failed", failureCategory: "invalid-path", safeReasonCode: null, outputLineCount: 1, realProcessExecutions: 0, realNetworkCalls: 0 };
    }
    // The typecheck surfaces the injected defect; once repaired it passes.
    if (commandId === "typecheck" && defectPresent) {
      return { commandId, status: "failed", failureCategory: "type-error", safeReasonCode: null, outputLineCount: 3, realProcessExecutions: 0, realNetworkCalls: 0 };
    }
    return { commandId, status: "passed", failureCategory: null, safeReasonCode: null, outputLineCount: 2, realProcessExecutions: 0, realNetworkCalls: 0 };
  }
}
