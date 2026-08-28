/**
 * src/twin/final02/productionTrustStore.ts — Pinned Production Trust Root & Backend Signer Adapter.
 *
 * Enforces that production trust roots are pinned in bootstrap configuration
 * and never injectable via untrusted user/mission inputs.
 */

import type { SandboxSecurityReceipt } from "./contracts";
import type { TrustedSandboxKey, TrustedSandboxKeyRegistry } from "./sandboxReceiptVerifier";

export interface SandboxBackendSigner {
  readonly backendId: string;
  readonly keyId: string;
  signReceipt(unsignedReceipt: Omit<SandboxSecurityReceipt, "signature">): SandboxSecurityReceipt | null;
}

export class PinnedSandboxTrustStore implements TrustedSandboxKeyRegistry {
  private readonly keys = new Map<string, TrustedSandboxKey>();

  constructor(initialKeys: readonly TrustedSandboxKey[] = []) {
    for (const k of initialKeys) {
      this.keys.set(`${k.backendId}:${k.keyId}`, k);
    }
  }

  resolve(backendId: string, keyId: string): TrustedSandboxKey | null {
    return this.keys.get(`${backendId}:${keyId}`) ?? null;
  }
}
