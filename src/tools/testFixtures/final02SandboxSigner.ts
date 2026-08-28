/**
 * src/tools/testFixtures/final02SandboxSigner.ts — TEST-ONLY Ed25519 Security Receipt Signer.
 *
 * MUST NOT be imported by any module under src/twin/final02/**.
 * Exposes test keypair generation and signing functions exclusively for unit tests.
 */

import { generateKeyPairSync, sign } from "node:crypto";
import type { SandboxSecurityReceipt } from "../../twin/final02/contracts";
import { buildCanonicalSecurityPayload } from "../../twin/final02/sandboxReceiptVerifier";

const TEST_KEYPAIR = generateKeyPairSync("ed25519", {
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

export const TEST_SANDBOX_PUBLIC_KEY_PEM = TEST_KEYPAIR.publicKey;
export const TEST_SANDBOX_PRIVATE_KEY_PEM = TEST_KEYPAIR.privateKey;
export const TEST_SANDBOX_KEY_ID = "test-ed25519-key-01";

/**
 * Signs a SandboxSecurityReceipt for test fixtures using the test private key.
 */
export function signTestSandboxSecurityReceipt(
  unsignedReceipt: Omit<SandboxSecurityReceipt, "signature">,
  privateKeyPem: string = TEST_SANDBOX_PRIVATE_KEY_PEM
): SandboxSecurityReceipt {
  const canonicalPayload = buildCanonicalSecurityPayload(unsignedReceipt);
  const signatureBuffer = sign(undefined, Buffer.from(canonicalPayload, "utf8"), privateKeyPem);
  const signature = signatureBuffer.toString("hex");

  return Object.freeze({
    ...unsignedReceipt,
    signature,
  });
}
