/**
 * Kernel Command Execution Tests (§08, P0.2).
 *
 * Verifies that TrustedKernel executes allowlisted commands safely,
 * captures exit codes, stdout/stderr, blocks forbidden commands, and emits evidence.
 *
 * Run: node dist/tools/v2KernelExecutionTests.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { resolve } from "path";
import { TrustedKernel } from "../v2/kernel/trustedKernel";

function tempWorkspace(tag: string): string {
  return mkdtempSync(resolve(tmpdir(), `namla-v2-kernel-${tag}-`));
}

test("TrustedKernel: Forbidden Command is Refused", () => {
  const ws = tempWorkspace("forbidden");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });
    // npm install is forbidden by CommandSafetyPolicy
    const result = kernel.executeCommand("npm", ["install", "express"], "m-1", "TEST_STAGE");

    assert.equal(result.success, false, "Forbidden command must be refused");
    assert.equal(result.reasonCode, "FORBIDDEN_COMMAND_REFUSED");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("TrustedKernel: Allowlisted Command Execution Captures Output & Emits Evidence", () => {
  const ws = tempWorkspace("exec-ok");
  try {
    const kernel = new TrustedKernel({ workspaceRoot: ws });
    // npm version / --version is safe and allowlisted
    const result = kernel.executeCommand("npm", ["--version"], "m-2", "VERIFY_STAGE");

    assert.equal(result.success, true, `Command should execute cleanly: ${result.reasonCode}`);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /^\d+\.\d+\.\d+/);
    assert.equal(result.evidenceRecord !== undefined, true, "Execution evidence must be produced");
    assert.equal(result.evidenceRecord?.producer, "TRUSTED_KERNEL_COMMAND");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
