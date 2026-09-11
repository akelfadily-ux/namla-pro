import type { VerificationSandboxExecutor } from "../cognitive/verificationSandbox";

export function createV2TestVerificationSandboxFactory(): (
  workspaceAbsolutePath: string
) => VerificationSandboxExecutor {
  return (_workspaceAbsolutePath: string): VerificationSandboxExecutor => {
    const issuedPermits = new WeakSet<object>();

    return {
      authorize(_request: any) {
        const permit = Object.freeze({
          opaque: "v2-test-verification-permit",
        });

        issuedPermits.add(permit);

        return {
          ok: true,
          permit: permit as any,
          receipt: {
            backendId: "v2-test-verified-backend",
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
            safeFingerprint: "v2-test-auth",
          },
        } as any;
      },

      execute(permit: any) {
        if (
          typeof permit !== "object" ||
          permit === null ||
          !issuedPermits.has(permit)
        ) {
          throw new Error("V2_TEST_SANDBOX_UNISSUED_PERMIT");
        }

        return {
          backendId: "v2-test-verified-backend",
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
          safeFingerprint: "v2-test-exec",
        } as any;
      },
    };
  };
}