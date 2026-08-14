/**
 * CognitiveWorkerRegistry: a lookup of CognitiveWorkerContract implementations
 * by provider name. Injection only — the registry builds nothing; providers
 * are constructed by the caller (CLI/demo composition root) and registered
 * here. Mirrors src/adapters/adapterRegistry.ts.
 */

import type { CognitiveProviderName, CognitiveWorkerContract, CognitiveWorkerProfile } from "./cognitiveWorkTypes";

export class CognitiveWorkerRegistry {
  private readonly workers = new Map<CognitiveProviderName, CognitiveWorkerContract>();

  register(worker: CognitiveWorkerContract): void {
    this.workers.set(worker.profile.providerName, worker);
  }

  list(): CognitiveWorkerProfile[] {
    return [...this.workers.values()].map((worker) => worker.profile);
  }

  get(providerName: CognitiveProviderName): CognitiveWorkerContract | undefined {
    return this.workers.get(providerName);
  }
}
