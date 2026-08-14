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
  | "integration-conflict";

export interface VerificationOutcome {
  readonly commandId: string;
  readonly status: VerificationStatus;
  readonly failureCategory: FailureCategory | null;
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
    if (!cmd) {
      return { commandId, status: "failed", failureCategory: "invalid-path", outputLineCount: 1, realProcessExecutions: 0, realNetworkCalls: 0 };
    }
    // The typecheck surfaces the injected defect; once repaired it passes.
    if (commandId === "typecheck" && defectPresent) {
      return { commandId, status: "failed", failureCategory: "type-error", outputLineCount: 3, realProcessExecutions: 0, realNetworkCalls: 0 };
    }
    return { commandId, status: "passed", failureCategory: null, outputLineCount: 2, realProcessExecutions: 0, realNetworkCalls: 0 };
  }
}
