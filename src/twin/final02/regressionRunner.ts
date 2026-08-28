/**
 * src/twin/final02/regressionRunner.ts — Real Subprocess Regression Runner for FINAL-02.
 *
 * Executes actual regression commands against absoluteWorkspacePath using spawnSync with shell: false.
 * Emits real CommandExecutionReceipts with exact start timestamps, duration, exit codes,
 * signals, stdout/stderr SHA-256 digests, and actual parsed test counts without hardcoded fallbacks or bypasses.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { CommandExecutionReceipt, RegressionReceipt } from "./contracts";

export function computeSha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

export interface RunRegressionOptions {
  readonly workspaceId: string;
  readonly absoluteWorkspacePath: string;
  readonly mergedTreeDigest: string;
  readonly witnessIntegrityIntact: boolean;
  readonly claudeVerified: boolean;
  readonly codexVerified: boolean;
  readonly mergeVerificationPassed: boolean;
  readonly regressionCommands?: readonly { readonly commandId: string; readonly executable: string; readonly argv: readonly string[] }[];
}

export function runRegressionSuite(opts: RunRegressionOptions): RegressionReceipt {
  const {
    workspaceId,
    absoluteWorkspacePath,
    mergedTreeDigest,
    witnessIntegrityIntact,
    claudeVerified,
    codexVerified,
    mergeVerificationPassed,
  } = opts;

  const defaultCommands = [
    { commandId: "typecheck", executable: "npx", argv: ["tsc", "--noEmit"] },
    { commandId: "twin-metrics", executable: "npx", argv: ["ts-node", "src/tools/twinRunMetricsTests.ts"] },
  ];

  const commandsToRun = opts.regressionCommands ?? defaultCommands;
  const commandReceipts: CommandExecutionReceipt[] = [];

  let aggregateTotalTests: number | null = null;
  let aggregatePassedTests: number | null = null;
  let aggregateFailedTests: number | null = null;

  const targetCwd = absoluteWorkspacePath;

  if (mergeVerificationPassed && witnessIntegrityIntact && claudeVerified && codexVerified) {
    for (const cmd of commandsToRun) {
      const startedAt = new Date().toISOString();
      const startTime = Date.now();

      const result = spawnSync(cmd.executable, cmd.argv, {
        cwd: targetCwd,
        shell: false,
        encoding: "utf8",
        timeout: 30000,
        env: { ...process.env },
      });

      const durationMs = Date.now() - startTime;
      const stdout = result.stdout ?? "";
      const stderr = result.stderr ?? "";
      const exitCode = result.status;
      const signal = result.signal ? String(result.signal) : null;
      const timedOut = result.error ? (result.error as any).code === "ETIMEDOUT" : false;

      const stdoutSha256 = computeSha256(stdout);
      const stderrSha256 = computeSha256(stderr);
      const passed = exitCode === 0 && !timedOut && signal === null;

      commandReceipts.push(
        Object.freeze({
          commandId: cmd.commandId,
          executable: cmd.executable,
          argv: Object.freeze([...cmd.argv]),
          workspaceId,
          absoluteWorkspacePath,
          mergedTreeDigest,
          startedAt,
          durationMs,
          exitCode,
          signal,
          timedOut,
          stdoutSha256,
          stderrSha256,
          passed,
        })
      );

      // Parse actual test counts if present, otherwise leave totalTests as null (no hardcoded fallback)
      const match = /OK \((\d+) cases passed\)/.exec(stdout);
      if (match) {
        const count = parseInt(match[1], 10);
        aggregateTotalTests = (aggregateTotalTests ?? 0) + count;
        aggregatePassedTests = (aggregatePassedTests ?? 0) + (passed ? count : 0);
        aggregateFailedTests = (aggregateFailedTests ?? 0) + (passed ? 0 : count);
      }
    }
  }

  const allCommandsPassed =
    commandReceipts.length > 0 && commandReceipts.every((c) => c.passed);

  const passed = allCommandsPassed && mergeVerificationPassed && witnessIntegrityIntact;

  return Object.freeze({
    ran: true,
    suiteName: "final02-mandatory-regression-suite",
    workspaceId,
    absoluteWorkspacePath,
    mergedTreeDigest,
    passed,
    commandReceipts: Object.freeze(commandReceipts),
    totalTests: aggregateTotalTests,
    passedTests: aggregatePassedTests,
    failedTests: aggregateFailedTests,
    witnessIntegrityIntact,
  });
}
