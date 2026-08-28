/**
 * src/twin/final02/sandboxReceiptVerifier.ts — Cryptographic Sandbox Security Verifier for FINAL-02.
 *
 * Verifies Ed25519 cryptographically signed SandboxSecurityReceipts produced by trusted sandbox backends.
 * Uses crypto.verify(undefined, payloadBuffer, publicKey, signatureBuffer).
 * NO caller booleans, NO trust shortcuts, NO private signing keys in production code.
 */

import { verify } from "node:crypto";
import type { SandboxSecurityReceipt, SecurityGateStatus } from "./contracts";

export interface TrustedSandboxKey {
  readonly backendId: string;
  readonly keyId: string;
  readonly publicKeyPem: string;
}

export interface TrustedSandboxKeyRegistry {
  resolve(backendId: string, keyId: string): TrustedSandboxKey | null;
}

export interface SecurityVerificationResult {
  readonly status: SecurityGateStatus;
  readonly sandboxVerified: boolean;
  readonly networkIsolated: boolean;
  readonly credentialProtected: boolean;
  readonly pathTraversalProtected: boolean;
  readonly dockerSocketProtected: boolean;
  readonly mountPolicyVerified: boolean;
  readonly detail: string;
}

/**
 * Computes the canonical deterministic JSON payload string to sign/verify.
 * Signature covers ALL receipt fields without normalizing booleans before verification.
 */
export function buildCanonicalSecurityPayload(receipt: Omit<SandboxSecurityReceipt, "signature">): string {
  const payload = {
    backendId: receipt.backendId ?? "",
    keyId: receipt.keyId ?? "",
    backendVerificationId: receipt.backendVerificationId ?? "",
    executionId: receipt.executionId ?? "",
    workspaceId: receipt.workspaceId ?? "",
    absoluteWorkspacePath: receipt.absoluteWorkspacePath ?? "",
    mergedTreeDigest: receipt.mergedTreeDigest ?? "",
    realProcessExecution: receipt.realProcessExecution,
    sandboxVerified: receipt.sandboxVerified,
    networkIsolated: receipt.networkIsolated,
    credentialsProtected: receipt.credentialsProtected,
    dockerSocketProtected: receipt.dockerSocketProtected,
    mountPolicyVerified: receipt.mountPolicyVerified,
    sourceMountReadOnly: receipt.sourceMountReadOnly,
    pathTraversalProtected: receipt.pathTraversalProtected,
    symlinkEscapeProtected: receipt.symlinkEscapeProtected,
    resourceLimitsVerified: receipt.resourceLimitsVerified,
    timeoutEnforced: receipt.timeoutEnforced,
    cleanupVerified: receipt.cleanupVerified,
  };

  return JSON.stringify(payload);
}

/**
 * Cryptographically verifies Ed25519 signed SandboxSecurityReceipts.
 * Signature verification happens FIRST against the trusted public key registry.
 */
export function verifySandboxSecurityReceipts(
  receipts: readonly SandboxSecurityReceipt[],
  expectedWorkspaceId: string,
  expectedAbsolutePath: string,
  expectedMergedTreeDigest: string,
  keyRegistry: TrustedSandboxKeyRegistry
): SecurityVerificationResult {
  if (receipts.length === 0) {
    return {
      status: "SECURITY_UNVERIFIED",
      sandboxVerified: false,
      networkIsolated: false,
      credentialProtected: false,
      pathTraversalProtected: false,
      dockerSocketProtected: false,
      mountPolicyVerified: false,
      detail: "no sandbox security receipts provided",
    };
  }

  for (const r of receipts) {
    // 0. If realProcessExecution is false, this is a simulated/fake driver receipt -> UNVERIFIED
    if (r.realProcessExecution !== true) {
      return {
        status: "SECURITY_UNVERIFIED",
        sandboxVerified: false,
        networkIsolated: r.networkIsolated === true,
        credentialProtected: r.credentialsProtected === true,
        pathTraversalProtected: r.pathTraversalProtected === true,
        dockerSocketProtected: r.dockerSocketProtected === true,
        mountPolicyVerified: r.mountPolicyVerified === true,
        detail: "driver execution was simulated or unverified (realProcessExecution is false)",
      };
    }

    // 1. Resolve key from trusted registry
    if (!r.backendId || !r.keyId) {
      return {
        status: "SECURITY_BLOCKED",
        sandboxVerified: false,
        networkIsolated: false,
        credentialProtected: false,
        pathTraversalProtected: false,
        dockerSocketProtected: false,
        mountPolicyVerified: false,
        detail: "missing backendId or keyId in security receipt",
      };
    }

    const trustedKey = keyRegistry.resolve(r.backendId, r.keyId);
    if (!trustedKey) {
      return {
        status: "SECURITY_BLOCKED",
        sandboxVerified: false,
        networkIsolated: false,
        credentialProtected: false,
        pathTraversalProtected: false,
        dockerSocketProtected: false,
        mountPolicyVerified: false,
        detail: `unknown backendId '${r.backendId}' or keyId '${r.keyId}' in key registry`,
      };
    }

    // 2. Cryptographic Ed25519 signature verification FIRST
    if (!r.signature || r.signature.length === 0) {
      return {
        status: "SECURITY_BLOCKED",
        sandboxVerified: false,
        networkIsolated: false,
        credentialProtected: false,
        pathTraversalProtected: false,
        dockerSocketProtected: false,
        mountPolicyVerified: false,
        detail: "missing cryptographic signature on security receipt",
      };
    }

    try {
      const canonicalPayload = buildCanonicalSecurityPayload(r);
      const signatureBuffer = Buffer.from(r.signature, "hex");
      const valid = verify(undefined, Buffer.from(canonicalPayload, "utf8"), trustedKey.publicKeyPem, signatureBuffer);

      if (!valid) {
        return {
          status: "SECURITY_BLOCKED",
          sandboxVerified: false,
          networkIsolated: false,
          credentialProtected: false,
          pathTraversalProtected: false,
          dockerSocketProtected: false,
          mountPolicyVerified: false,
          detail: "cryptographic signature verification failed on security receipt",
        };
      }
    } catch {
      return {
        status: "SECURITY_BLOCKED",
        sandboxVerified: false,
        networkIsolated: false,
        credentialProtected: false,
        pathTraversalProtected: false,
        dockerSocketProtected: false,
        mountPolicyVerified: false,
        detail: "exception during cryptographic signature verification",
      };
    }

    // 3. Enforce exact binding invariants
    if (!r.workspaceId || r.workspaceId !== expectedWorkspaceId) {
      return {
        status: "SECURITY_BLOCKED",
        sandboxVerified: false,
        networkIsolated: false,
        credentialProtected: false,
        pathTraversalProtected: false,
        dockerSocketProtected: false,
        mountPolicyVerified: false,
        detail: `security receipt workspaceId mismatch: expected '${expectedWorkspaceId}', got '${r.workspaceId}'`,
      };
    }

    if (expectedAbsolutePath && r.absoluteWorkspacePath !== expectedAbsolutePath) {
      return {
        status: "SECURITY_BLOCKED",
        sandboxVerified: false,
        networkIsolated: false,
        credentialProtected: false,
        pathTraversalProtected: false,
        dockerSocketProtected: false,
        mountPolicyVerified: false,
        detail: `security receipt absoluteWorkspacePath mismatch: expected '${expectedAbsolutePath}', got '${r.absoluteWorkspacePath}'`,
      };
    }

    if (!r.mergedTreeDigest || r.mergedTreeDigest !== expectedMergedTreeDigest) {
      return {
        status: "SECURITY_BLOCKED",
        sandboxVerified: false,
        networkIsolated: false,
        credentialProtected: false,
        pathTraversalProtected: false,
        dockerSocketProtected: false,
        mountPolicyVerified: false,
        detail: `security receipt mergedTreeDigest mismatch: expected '${expectedMergedTreeDigest}', got '${r.mergedTreeDigest}'`,
      };
    }

    // 4. Strict boolean evidence evaluation
    if (
      r.realProcessExecution !== true ||
      r.sandboxVerified !== true ||
      r.networkIsolated !== true ||
      r.credentialsProtected !== true ||
      r.dockerSocketProtected !== true ||
      r.mountPolicyVerified !== true ||
      r.sourceMountReadOnly !== true ||
      r.pathTraversalProtected !== true ||
      r.symlinkEscapeProtected !== true ||
      r.resourceLimitsVerified !== true ||
      r.timeoutEnforced !== true ||
      r.cleanupVerified !== true
    ) {
      return {
        status: "SECURITY_UNVERIFIED",
        sandboxVerified: false,
        networkIsolated: r.networkIsolated === true,
        credentialProtected: r.credentialsProtected === true,
        pathTraversalProtected: r.pathTraversalProtected === true,
        dockerSocketProtected: r.dockerSocketProtected === true,
        mountPolicyVerified: r.mountPolicyVerified === true,
        detail: "one or more mandatory sandbox security invariants were false or unverified",
      };
    }
  }

  return {
    status: "SECURITY_VERIFIED",
    sandboxVerified: true,
    networkIsolated: true,
    credentialProtected: true,
    pathTraversalProtected: true,
    dockerSocketProtected: true,
    mountPolicyVerified: true,
    detail: "all mandatory sandbox security invariants cryptographically verified",
  };
}
