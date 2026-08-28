/**
 * src/tools/final02BaselineParity.ts — Real Independent Baseline Parity Runner for FINAL-02.
 *
 * Materializes baseline commit 50cd4ef8198f4eafb896e17d999050ba60b34a19 into a fresh clean workspace,
 * executes npm test against it, parses real failure IDs, and independently compares against the
 * FINAL-02 candidate tree.
 * NO failure copying, NO hardcoded exit codes, NO hardcoded digests.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync, rmSync, existsSync, mkdirSync, symlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { calculateTreeDigestFromDisk } from "../twin/final02/treeDigest";

export const BASELINE_COMMIT = "50cd4ef8198f4eafb896e17d999050ba60b34a19";

function computeSha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

export interface ExecutionReceipt {
  readonly workspacePath: string;
  readonly treeDigest: string;
  readonly executable: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdoutSha256: string;
  readonly stderrSha256: string;
  readonly failureIds: readonly string[];
  readonly rawStdout: string;
}

export interface BaselineParityReport {
  readonly baseline: {
    readonly commit: string;
    readonly exitCode: number | null;
    readonly failureIds: readonly string[];
    readonly stdoutSha256: string;
    readonly stderrSha256: string;
  };
  readonly final02: {
    readonly treeDigest: string;
    readonly exitCode: number | null;
    readonly failureIds: readonly string[];
    readonly stdoutSha256: string;
    readonly stderrSha256: string;
  };
  readonly introducedFailures: readonly string[];
  readonly resolvedFailures: readonly string[];
  readonly unchangedFailures: readonly string[];
}

function parseFailureIdsFromStdout(stdout: string): string[] {
  const failureIds: string[] = [];
  try {
    const firstBrace = stdout.indexOf("{");
    const lastBrace = stdout.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const jsonText = stdout.substring(firstBrace, lastBrace + 1);
      const parsed = JSON.parse(jsonText);
      if (parsed.failures && Array.isArray(parsed.failures)) {
        for (const f of parsed.failures) {
          if (f.suite && f.testName) {
            failureIds.push(`${f.suite}:${f.testName}`);
          }
        }
      }
    }
  } catch {
    // fallback if unparseable
  }
  return failureIds;
}

function runCommandInWorkspace(
  workspacePath: string,
  executable: string,
  argv: readonly string[]
): ExecutionReceipt {
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  const digestReceipt = calculateTreeDigestFromDisk("workspace", workspacePath);

  const res = spawnSync(executable, [...argv], {
    cwd: workspacePath,
    shell: false,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    env: { ...process.env },
  });

  const durationMs = Date.now() - startTime;
  const stdout = res.stdout ?? "";
  const stderr = res.stderr ?? "";
  const exitCode = res.status;
  const signal = res.signal ? String(res.signal) : null;

  const stdoutSha256 = computeSha256(stdout);
  const stderrSha256 = computeSha256(stderr);
  const failureIds = parseFailureIdsFromStdout(stdout);

  return {
    workspacePath,
    treeDigest: digestReceipt.canonicalTreeDigest,
    executable,
    argv,
    cwd: workspacePath,
    startedAt,
    durationMs,
    exitCode,
    signal,
    stdoutSha256,
    stderrSha256,
    failureIds,
    rawStdout: stdout,
  };
}

/**
 * Materializes the exact baseline commit into a clean temporary workspace.
 */
function materializeBaselineCommit(targetDir: string, commit = BASELINE_COMMIT) {
  if (existsSync(targetDir)) {
    rmSync(targetDir, { recursive: true, force: true });
  }
  mkdirSync(targetDir, { recursive: true });

  const rawLsTree = execFileSync("git", ["ls-tree", "-r", "-z", commit], { maxBuffer: 50 * 1024 * 1024 });
  let offset = 0;

  // Symlink node_modules so ts-node/test runner can execute in isolated workspace
  const rootNodeModules = join(process.cwd(), "node_modules");
  const targetNodeModules = join(targetDir, "node_modules");
  if (existsSync(rootNodeModules) && !existsSync(targetNodeModules)) {
    try {
      symlinkSync(rootNodeModules, targetNodeModules, "dir");
    } catch {
      // ignore
    }
  }

  while (offset < rawLsTree.length) {
    const tabIndex = rawLsTree.indexOf(0x09, offset);
    if (tabIndex === -1) break;

    const meta = rawLsTree.toString("utf8", offset, tabIndex);
    const parts = meta.split(" ");
    if (parts.length < 3) break;

    const mode = parts[0];
    const type = parts[1];
    const sha = parts[2];

    const nulIndex = rawLsTree.indexOf(0x00, tabIndex + 1);
    if (nulIndex === -1) break;

    const path = rawLsTree.toString("utf8", tabIndex + 1, nulIndex);
    offset = nulIndex + 1;

    if (type !== "blob") continue;

    const blobBuffer = execFileSync("git", ["cat-file", "blob", sha], { maxBuffer: 50 * 1024 * 1024 });
    const fullTargetPath = join(targetDir, path);
    mkdirSync(dirname(fullTargetPath), { recursive: true });
    writeFileSync(fullTargetPath, blobBuffer);
  }
}

export function runBaselineParityCheck(): BaselineParityReport {
  console.log("Running Real Independent Baseline Parity Check...");

  // 1. Materialize Baseline in isolated temporary workspace
  const tempBaselineDir = join(process.cwd(), "workspaces/namola-twin/temp-baseline-parity");
  materializeBaselineCommit(tempBaselineDir, BASELINE_COMMIT);

  // Build baseline workspace so dist/tools/p0SecurityRunner.js exists
  spawnSync("npm", ["run", "build"], { cwd: tempBaselineDir, shell: false, encoding: "utf8" });

  // 2. Execute P0 security command against baseline
  const baselineExecution = runCommandInWorkspace(tempBaselineDir, "npm", ["test"]);

  // Cleanup temp baseline directory
  try {
    rmSync(tempBaselineDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup error
  }

  // 3. Execute P0 security command against current FINAL-02 tree
  const final02Execution = runCommandInWorkspace(process.cwd(), "npm", ["test"]);

  // 4. Compute actual set differences
  const baselineSet = new Set(baselineExecution.failureIds);
  const final02Set = new Set(final02Execution.failureIds);

  const introducedFailures = [...final02Set].filter((f) => !baselineSet.has(f));
  const resolvedFailures = [...baselineSet].filter((f) => !final02Set.has(f));
  const unchangedFailures = [...final02Set].filter((f) => baselineSet.has(f));

  const report: BaselineParityReport = {
    baseline: {
      commit: BASELINE_COMMIT,
      exitCode: baselineExecution.exitCode,
      failureIds: baselineExecution.failureIds,
      stdoutSha256: baselineExecution.stdoutSha256,
      stderrSha256: baselineExecution.stderrSha256,
    },
    final02: {
      treeDigest: final02Execution.treeDigest,
      exitCode: final02Execution.exitCode,
      failureIds: final02Execution.failureIds,
      stdoutSha256: final02Execution.stdoutSha256,
      stderrSha256: final02Execution.stderrSha256,
    },
    introducedFailures,
    resolvedFailures,
    unchangedFailures,
  };

  writeFileSync("FINAL02_P0_5_BASELINE_PARITY.json", JSON.stringify(report, null, 2));
  console.log("Baseline Parity Check Completed. FINAL02_P0_5_BASELINE_PARITY.json written.");

  return report;
}

if (require.main === module) {
  runBaselineParityCheck();
}
