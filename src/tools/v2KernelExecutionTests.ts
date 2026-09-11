/**
 * Kernel Command Execution Tests (ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§08, P0.2).
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

test("P0-VERIFY-BOUNDARY: verification has no host fallback when sandbox is absent", () => {
  const ws = tempWorkspace("verify-no-sandbox");

  try {
    const kernel = new TrustedKernel({
      workspaceRoot: ws,
      humanAuthorizationGranted: true,
      verificationHumanAuthorized: true,
    } as any);

    const executeVerificationCommand =
      (kernel as any).executeVerificationCommand;

    assert.equal(
      typeof executeVerificationCommand,
      "function",
      "TrustedKernel must expose a dedicated verification execution boundary"
    );

    const result = executeVerificationCommand.call(
      kernel,
      "typecheck",
      "m-verify-1",
      "PROMAX",
      ws
    );

    assert.equal(
      result.success,
      false,
      "Verification must fail closed when no verified sandbox exists"
    );

    assert.equal(
      result.exitCode,
      null,
      "Sandbox-unavailable verification must never invent an exit code"
    );

    assert.equal(
      result.evidenceRecord,
      undefined,
      "No TRUSTED_KERNEL_COMMAND evidence may be emitted when execution never occurred"
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("P0-VERIFY-AUTH: omitted verification authorization fails closed", () => {
  const ws = tempWorkspace("verify-auth-omitted");

  let authorizeCalls = 0;
  let executeCalls = 0;

  const sandbox = {
    authorize() {
      authorizeCalls += 1;
      throw new Error("sandbox authorize must not be reached without explicit verification authorization");
    },
    execute() {
      executeCalls += 1;
      throw new Error("sandbox execute must not be reached without explicit verification authorization");
    },
  };

  try {
    const kernel = new TrustedKernel({
      workspaceRoot: ws,
      humanAuthorizationGranted: true,
      verificationSandbox: sandbox as any,
      // verificationHumanAuthorized intentionally omitted
    });

    const result = kernel.executeVerificationCommand(
      "typecheck",
      "m-verify-auth",
      "PROMAX",
      ws
    );

    assert.equal(result.success, false);
    assert.equal(result.exitCode, null);
    assert.equal(
      result.reasonCode,
      "VERIFICATION_AUTHORIZATION_REFUSED"
    );
    assert.equal(result.evidenceRecord, undefined);

    assert.equal(
      authorizeCalls,
      0,
      "Sandbox authorization must not be attempted when verification authorization is absent"
    );

    assert.equal(
      executeCalls,
      0,
      "Sandbox execution must not occur when verification authorization is absent"
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
test("P0-VERIFY-PERMIT: sandbox permit identity reaches execution and emits truthful evidence", () => {
  const ws = tempWorkspace("verify-permit");
  const candidateRel = "workspaces/m-verify-permit/leggo-integrated";
  const expectedAbsolute = resolve(ws, candidateRel);

  let authorizeCalls = 0;
  let executeCalls = 0;

  const issuedPermit = Object.freeze({
    opaque: "issued-permit-identity",
  });

  const sandbox = {
    authorize(request: any) {
      authorizeCalls += 1;

      assert.equal(request.objectiveId, "typecheck");
      assert.equal(request.taskId, "typecheck");
      assert.equal(request.workspaceId, expectedAbsolute);
      assert.equal(request.humanAuthorized, true);

      assert.equal(request.executableId, "node");
      assert.deepEqual(
        [...request.fixedArguments],
        [
          "/opt/namla-toolchain/node_modules/typescript/lib/tsc.js",
          "--noEmit",
        ]
      );

      return {
        ok: true,
        permit: issuedPermit,
        receipt: {
          backendId: "verified-test-backend",
          capabilityState: "available-and-verified",
          executionStarted: false,
          executionCompleted: false,
          exitCategory: "not-started",
          timeoutMs: 15000,
          cpuLimit: 1,
          memoryLimitMb: 256,
          pidLimit: 64,
          networkPolicy: "denied",
          mountPolicy: "bounded-workspace-only",
          cleanupComplete: false,
          blocked: false,
          safeReasonCode: "ok",
          safeFingerprint: "sb-auth-test",
        },
      };
    },

    execute(permit: any) {
      executeCalls += 1;

      assert.strictEqual(
        permit,
        issuedPermit,
        "Kernel must execute the exact permit object returned by authorize()"
      );

      return {
        backendId: "verified-test-backend",
        capabilityState: "available-and-verified",
        executionStarted: true,
        executionCompleted: true,
        exitCategory: "completed",
        timeoutMs: 15000,
        cpuLimit: 1,
        memoryLimitMb: 256,
        pidLimit: 64,
        networkPolicy: "denied",
        mountPolicy: "bounded-workspace-only",
        cleanupComplete: true,
        blocked: false,
        safeReasonCode: "ok",
        safeFingerprint: "sb-exec-test",
      };
    },
  };

  try {
    const kernel = new TrustedKernel({
      workspaceRoot: ws,
      humanAuthorizationGranted: true,
      verificationSandbox: sandbox as any,
      verificationHumanAuthorized: true,
    });

    const result = kernel.executeVerificationCommand(
      "typecheck",
      "m-verify-permit",
      "PROMAX",
      candidateRel
    );

    assert.equal(authorizeCalls, 1);
    assert.equal(executeCalls, 1);

    assert.equal(result.success, true);
    assert.equal(
      result.exitCode,
      null,
      "Sandbox receipt has no numeric exit code; Kernel must not invent one"
    );

    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.equal(result.reasonCode, "OK");

    assert.ok(
      result.evidenceRecord,
      "Successful sandbox verification must emit authentic execution evidence"
    );

    assert.equal(
      result.evidenceRecord?.producer,
      "TRUSTED_KERNEL_COMMAND"
    );

    assert.equal(
      result.evidenceRecord?.proofKind,
      "TRACEABILITY"
    );

    assert.equal(
      result.evidenceRecord?.details.executableId,
      "node"
    );

    assert.deepEqual(
      result.evidenceRecord?.details.args,
      [
        "/opt/namla-toolchain/node_modules/typescript/lib/tsc.js",
        "--noEmit",
      ]
    );

    assert.equal(
      result.evidenceRecord?.details.success,
      true
    );

    assert.equal(
      result.evidenceRecord?.details.exitCode,
      null
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
test("P0-VERIFY-PATH: relative candidate workspace resolves to canonical absolute sandbox path", () => {
  const ws = tempWorkspace("verify-path");
  const candidateRel = "workspaces/m-path/leggo-integrated";
  const expectedAbsolute = resolve(ws, candidateRel);

  let authorizeCalls = 0;

  const permit = Object.freeze({ opaque: "path-permit" });

  const sandbox = {
    authorize(request: any) {
      authorizeCalls += 1;

      assert.equal(
        request.workspaceId,
        expectedAbsolute,
        "Sandbox must receive the canonical absolute candidate workspace, never the relative path"
      );

      return {
        ok: true,
        permit,
        receipt: {
          backendId: "verified-test-backend",
          capabilityState: "available-and-verified",
          executionStarted: false,
          executionCompleted: false,
          exitCategory: "not-started",
          timeoutMs: 15000,
          cpuLimit: 1,
          memoryLimitMb: 256,
          pidLimit: 64,
          networkPolicy: "denied",
          mountPolicy: "bounded-workspace-only",
          cleanupComplete: false,
          blocked: false,
          safeReasonCode: "ok",
          safeFingerprint: "sb-path-auth",
        },
      };
    },

    execute(receivedPermit: any) {
      assert.strictEqual(receivedPermit, permit);

      return {
        backendId: "verified-test-backend",
        capabilityState: "available-and-verified",
        executionStarted: true,
        executionCompleted: true,
        exitCategory: "completed",
        timeoutMs: 15000,
        cpuLimit: 1,
        memoryLimitMb: 256,
        pidLimit: 64,
        networkPolicy: "denied",
        mountPolicy: "bounded-workspace-only",
        cleanupComplete: true,
        blocked: false,
        safeReasonCode: "ok",
        safeFingerprint: "sb-path-exec",
      };
    },
  };

  try {
    const kernel = new TrustedKernel({
      workspaceRoot: ws,
      humanAuthorizationGranted: true,
      verificationSandbox: sandbox as any,
      verificationHumanAuthorized: true,
    });

    const result = kernel.executeVerificationCommand(
      "typecheck",
      "m-path",
      "PROMAX",
      candidateRel
    );

    assert.equal(authorizeCalls, 1);
    assert.equal(result.success, true);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
test("P0-VERIFY-LATE-FACTORY: sandbox factory resolves candidate workspace on the same kernel", () => {
  const ws = tempWorkspace("verify-late-factory");
  const candidateRel = "workspaces/m-late-factory/leggo-integrated";
  const expectedAbsolute = resolve(ws, candidateRel);

  let factoryCalls = 0;
  let authorizeCalls = 0;

  const permit = Object.freeze({ opaque: "late-factory-permit" });

  const sandbox = {
    authorize(request: any) {
      authorizeCalls += 1;
      assert.equal(request.workspaceId, expectedAbsolute);

      return {
        ok: true,
        permit,
        receipt: {
          backendId: "verified-test-backend",
          capabilityState: "available-and-verified",
          executionStarted: false,
          executionCompleted: false,
          exitCategory: "not-started",
          timeoutMs: 15000,
          cpuLimit: 1,
          memoryLimitMb: 256,
          pidLimit: 64,
          networkPolicy: "denied",
          mountPolicy: "bounded-workspace-only",
          cleanupComplete: false,
          blocked: false,
          safeReasonCode: "ok",
          safeFingerprint: "sb-late-auth",
        },
      };
    },

    execute(receivedPermit: any) {
      assert.strictEqual(receivedPermit, permit);

      return {
        backendId: "verified-test-backend",
        capabilityState: "available-and-verified",
        executionStarted: true,
        executionCompleted: true,
        exitCategory: "completed",
        timeoutMs: 15000,
        cpuLimit: 1,
        memoryLimitMb: 256,
        pidLimit: 64,
        networkPolicy: "denied",
        mountPolicy: "bounded-workspace-only",
        cleanupComplete: true,
        blocked: false,
        safeReasonCode: "ok",
        safeFingerprint: "sb-late-exec",
      };
    },
  };

  try {
    const kernel = new TrustedKernel({
      workspaceRoot: ws,
      humanAuthorizationGranted: true,
      verificationHumanAuthorized: true,
      verificationSandboxFactory: (workspaceAbsolutePath: string) => {
        factoryCalls += 1;
        assert.equal(
          workspaceAbsolutePath,
          expectedAbsolute,
          "Factory must receive canonical absolute candidate workspace"
        );
        return sandbox;
      },
    } as any);

    const result = kernel.executeVerificationCommand(
      "typecheck",
      "m-late-factory",
      "PROMAX",
      candidateRel
    );

    assert.equal(factoryCalls, 1);
    assert.equal(authorizeCalls, 1);
    assert.equal(result.success, true);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});