/**
 * PlannedCliInvocation: the shape a real CLI-backed cognitive worker
 * (Claude Code CLI, Codex CLI) would execute — fully specified, bounded,
 * and hard-coded, but never run. This is the exact same discipline
 * `src/bodies/commandAdapter.ts` already uses for shell commands:
 * `CommandAdapter` in Phase 0 always refuses execution and returns a
 * `PlannedAction` describing what it refused to do and why. There is no
 * execution code path in this file — Node's process-spawning module is not
 * imported here at all, so there is nothing to accidentally invoke.
 *
 * NAMLA_BUILD_LAW.md Section 1 lists "Never run real system commands" as a
 * hard boundary, and Section 2 is explicit that no phase may loosen a hard
 * boundary, only add capability behind new guards. A Claude/Codex adapter
 * that actually spawned a process would break that boundary regardless of
 * how bounded or human-confirmed it was, so the adapters in this module
 * construct the real, reviewable plan for what a future authorized phase
 * would run, and then refuse — exactly like CommandAdapter.
 */

import { randomUUID } from "crypto";
import { fingerprint } from "../core/redaction";

export type CliPromptDeliveryMode = "stdin" | "prompt-file";

export interface PlannedCliInvocation {
  readonly invocationId: string;
  readonly executableName: string;
  /** Hard-coded shape; no positional argument is ever built from raw mission/task text. */
  readonly argumentTemplate: readonly string[];
  readonly promptDeliveryMode: CliPromptDeliveryMode;
  /** Never the raw prompt — a non-reversible fingerprint only. */
  readonly promptFingerprint: string;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
  readonly timeoutMs: number;
  readonly workingDirectoryRelative: string;
  readonly antId: string;
  readonly taskId: string;
  readonly missionId: string;
  readonly plannedAt: string;
  readonly executed: false;
}

export const CLI_MAX_STDOUT_BYTES = 65536 as const;
export const CLI_MAX_STDERR_BYTES = 16384 as const;
export const CLI_TIMEOUT_MS = 60000 as const;

export function buildPlannedCliInvocation(params: {
  executableName: string;
  argumentTemplate: readonly string[];
  promptDeliveryMode: CliPromptDeliveryMode;
  promptText: string;
  workingDirectoryRelative: string;
  antId: string;
  taskId: string;
  missionId: string;
}): PlannedCliInvocation {
  return {
    invocationId: `planned-cli-${randomUUID()}`,
    executableName: params.executableName,
    argumentTemplate: params.argumentTemplate,
    promptDeliveryMode: params.promptDeliveryMode,
    promptFingerprint: fingerprint(params.promptText),
    maxStdoutBytes: CLI_MAX_STDOUT_BYTES,
    maxStderrBytes: CLI_MAX_STDERR_BYTES,
    timeoutMs: CLI_TIMEOUT_MS,
    workingDirectoryRelative: params.workingDirectoryRelative,
    antId: params.antId,
    taskId: params.taskId,
    missionId: params.missionId,
    plannedAt: new Date().toISOString(),
    executed: false,
  };
}
