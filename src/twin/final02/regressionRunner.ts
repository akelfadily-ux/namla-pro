/**
 * src/twin/final02/regressionRunner.ts — Real Subprocess Regression Runner for FINAL-02.
 *
 * Executes actual regression commands against absoluteWorkspacePath using spawnSync with shell: false.
 * Sanitizes environment variables (stripping secrets).
 * Uses pinned local toolchain execution without network downloads.
 * Verifies tree digest before and after execution to guarantee non-mutation.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CommandExecutionReceipt, RegressionReceipt } from "./contracts";
import { calculateTreeDigestFromDisk } from "./treeDigest";

export function computeSha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

const ALLOWLIST_ENV_KEYS = new Set([
  "PATH",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "CI",
  "LANG",
  "LC_ALL",
  "NODE_OPTIONS",
  "SYSTEMROOT",
  "WINDIR",
]);

/**
 * Builds a sanitized environment object stripping all credential patterns.
 */
export function buildSanitizedEnvironment(rawEnv: Record<string, string | undefined> = process.env as any): Record<string, string> {
  const sanitized: Record<string, string> = {};

  for (const [key, val] of Object.entries(rawEnv)) {
    if (!val) continue;
    const keyUpper = key.toUpperCase();

    // Strip forbidden credential patterns
    if (
      keyUpper.startsWith("OPENAI") ||
      keyUpper.startsWith("ANTHROPIC") ||
      keyUpper.startsWith("GITHUB") ||
      keyUpper.startsWith("AWS") ||
      keyUpper.startsWith("AZURE") ||
      keyUpper.includes("TOKEN") ||
      keyUpper.includes("SECRET") ||
      keyUpper.includes("PASSWORD") ||
      keyUpper.includes("KEY") ||
      keyUpper.includes("SSH") ||
      keyUpper.includes("DATABASE_URL")
    ) {
      continue; // Omit secret
    }

    if (ALLOWLIST_ENV_KEYS.has(key)) {
      sanitized[key] = val;
    }
  }

  return sanitized;
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

  // P0-17: Use pinned local toolchain executables
  const localTscPath = resolve(process.cwd(), "node_modules", ".bin", "tsc");
  const tscExecutable = existsSync(localTscPath) ? localTscPath : "npm";
  const tscArgv = existsSync(localTscPath) ? ["--noEmit"] : ["run", "typecheck"];

  const defaultCommands = [
    { commandId: "typecheck", executable: tscExecutable, argv: tscArgv },
    { commandId: "twin-metrics", executable: "npx", argv: ["ts-node", "src/tools/twinRunMetricsTests.ts"] },
  ];

  const commandsToRun = opts.regressionCommands ?? defaultCommands;
  const commandReceipts: CommandExecutionReceipt[] = [];

  let aggregateTotalTests: number | null = null;
  let aggregatePassedTests: number | null = null;
  let aggregateFailedTests: number | null = null;

  const sanitizedEnv = buildSanitizedEnvironment();

  if (mergeVerificationPassed && witnessIntegrityIntact && claudeVerified && codexVerified) {
    for (const cmd of commandsToRun) {
      // P0-19: Pre-execution tree digest verification
      const digestBefore = calculateTreeDigestFromDisk(workspaceId, absoluteWorkspacePath).canonicalTreeDigest;
      if (digestBefore !== mergedTreeDigest) {
        // Pre-execution tree digest mismatch -> BLOCK
        break;
      }

      const startedAt = new Date().toISOString();
      const startTime = Date.now();

      const result = spawnSync(cmd.executable, cmd.argv, {
        cwd: absoluteWorkspacePath,
        shell: false,
        encoding: "utf8",
        timeout: 30000,
        env: sanitizedEnv,
      });

      const durationMs = Date.now() - startTime;

      // P0-19: Post-execution tree digest non-mutation verification
      const digestAfter = calculateTreeDigestFromDisk(workspaceId, absoluteWorkspacePath).canonicalTreeDigest;
      const nonMutated = digestAfter === mergedTreeDigest;

      const stdout = result.stdout ?? "";
      const stderr = result.stderr ?? "";
      const exitCode = result.status;
      const signal = result.signal ? String(result.signal) : null;
      const timedOut = result.error ? (result.error as any).code === "ETIMEDOUT" : false;

      const stdoutSha256 = computeSha256(stdout);
      const stderrSha256 = computeSha256(stderr);
      const passed = exitCode === 0 && !timedOut && signal === null && nonMutated;

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
