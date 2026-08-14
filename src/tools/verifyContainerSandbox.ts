/**
 * verifyContainerSandbox — CI entry point that attempts REAL isolation
 * verification and writes a safe capability receipt.
 *
 * It starts one disposable container under production flags, reads the probe's
 * findings, and reports the resulting capability state. It never prints
 * container stdout: raw output could carry host information, so only the
 * classified verdict and boolean claims are emitted.
 *
 * Exit code is 0 when verification SUCCEEDS and 1 when it does not, so the CI
 * job fails loudly rather than recording an unverified sandbox as fine.
 *
 * Usage: node dist/tools/verifyContainerSandbox.js [--out <file>]
 */

import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { resolve } from "path";
import { DockerContainerSandboxBackend, approvedImageReference, imageIsPinned } from "../cognitive/containerSandboxBackend";
import { describeStartupFailure, type SafeStartupDiagnostics } from "../cognitive/containerStartupDiagnostics";

function main(): void {
  const outIndex = process.argv.indexOf("--out");
  const outPath = outIndex >= 0 ? process.argv[outIndex + 1] : "";

  // A scratch workspace that is the container's ONLY writable mount.
  const probeWorkspace = mkdtempSync(resolve(tmpdir(), "namla-sandbox-verify-"));
  let report;
  let startup: SafeStartupDiagnostics | null = null;
  try {
    // The authorized mount roots are nominated HERE, by the trusted entry point
    // that created the scratch workspace — never by a permit or policy (§31).
    const backend = new DockerContainerSandboxBackend({
      probeWorkspaceHostPath: probeWorkspace,
      probeScriptHostDir: resolve(process.cwd(), "dist", "tools"),
      authorizedMountRoots: [probeWorkspace],
      trustedBuildRoot: process.cwd(),
    });
    report = backend.verifyIsolation();
    startup = backend.startupDiagnostics;
  } finally {
    rmSync(probeWorkspace, { recursive: true, force: true });
  }

  // SAFE receipt only: verdict, claims, reason code. Never container stdout,
  // never a host path, never an environment value.
  const receipt = {
    backendId: report.backendId,
    capabilityState: report.capabilityState,
    available: report.available,
    verified: report.verified,
    detectionMethod: report.detectionMethod,
    detectionDetail: report.detectionDetail,
    imageReference: approvedImageReference(),
    imagePinned: imageIsPinned(),
    claims: report.claims,
    safeReasonCode: report.safeReasonCode,
    // Startup diagnostics: the SIX safe fields only. Never raw stdout/stderr,
    // a host path, a username, an environment value, a Docker id, or a
    // container name. Present only when the container failed to start.
    startupDiagnostics: startup
      ? {
          runtimeExitCode: startup.runtimeExitCode,
          runtimeSignal: startup.runtimeSignal,
          stdoutPresent: startup.stdoutPresent,
          stderrCategory: startup.stderrCategory,
          safeFailureFingerprint: startup.safeFailureFingerprint,
          safeReasonCode: startup.safeReasonCode,
        }
      : null,
    platform: process.platform,
    commitSha: (process.env.GITHUB_SHA ?? "local").slice(0, 40),
  };

  const json = JSON.stringify(receipt, null, 2);
  if (outPath) writeFileSync(resolve(outPath), json, "utf8");
  console.log(json);

  if (report.capabilityState === "available-and-verified" && report.verified) {
    console.error("\nCONTAINER SANDBOX VERIFIED: every isolation property was proven inside a real container.");
    process.exit(0);
  }
  console.error(`\nCONTAINER SANDBOX NOT VERIFIED: ${report.safeReasonCode}`);
  console.error("High-risk execution remains fail-closed. This is a failure, not a warning.");
  process.exit(1);
}

main();
