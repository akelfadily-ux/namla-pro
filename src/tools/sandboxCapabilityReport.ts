/**
 * sandboxCapabilityReport — safe, read-only container-runtime capability probe.
 *
 * Detection ONLY: it resolves docker/podman through the trusted executable
 * registry and reads a version token. It pulls no image, builds no image,
 * starts no container, installs nothing, and reaches no network.
 *
 * It reports whether a runner COULD host the next real sandbox milestone. It
 * never claims Namla's sandbox is verified — that requires a real
 * ContainerSandboxBackend whose isolation is actually exercised, which does not
 * exist yet.
 */

import { detectContainerRuntime } from "../cognitive/sandboxPolicy";

const cap = detectContainerRuntime({ probe: true });

const report = {
  platform: process.platform,
  commitSha: (process.env.GITHUB_SHA ?? "local").slice(0, 40),
  backendId: cap.backendId,
  capabilityState: cap.capabilityState,
  available: cap.available,
  // A detected CLI proves a binary exists. It proves nothing about cgroups,
  // namespaces, or network policy, so this is ALWAYS false here.
  namlaSandboxVerified: false,
  canHostNextSandboxMilestone: cap.available,
  detectionMethod: cap.detectionMethod,
  detectionDetail: cap.detectionDetail,
  safeReasonCode: cap.safeReasonCode,
};

console.log(JSON.stringify(report, null, 2));
// Detection never fails the build: an absent runtime is a fact to report, not
// an error. The fail-closed gate is what protects execution.
process.exit(0);
