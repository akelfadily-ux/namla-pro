/**
 * Capability C2-A — append-only, process-local consumed-approval registry.
 *
 * Tracks which single-use grants have been consumed, so a future C2-B/C
 * write attempt can enforce single-use and refuse replay within one process.
 *
 * CRITICAL C2-A RULE: nothing in C2-A calls `consume`. Consumption begins
 * only when C2-B introduces an admitted REAL write attempt (consumed at the
 * start of that attempt, after final revalidation and before exclusive
 * open). In C2-A this class only reads (`isConsumed`, `snapshot`,
 * `asConsumedApprovalState`); the C2-A admission and the non-mutating
 * ProjectFileCreator never mutate it.
 *
 * HONEST LIMITATION: this is process-local only. `durableAcrossRestart` is
 * `false` — after a process restart the set is empty, so durable
 * cross-restart replay prevention is NOT provided (that would require a
 * persistence layer, itself a separate write capability under its own
 * amendment).
 *
 * Pure/in-memory: no fs, no process/env, no network, no timers, no
 * persistence.
 */

import type { ConsumedApprovalState } from "./createCapabilityTypes";

export interface ConsumedRegistrySnapshot {
  readonly consumedGrantIds: readonly string[];
  readonly processLocal: true;
  readonly durableAcrossRestart: false;
}

export interface ConsumeOutcome {
  consumed: boolean;
  reasonCode: "grant-consumed" | "grant-already-consumed";
}

export class ConsumedApprovalRegistry {
  private readonly consumedGrantIds = new Set<string>();

  readonly processLocal = true as const;
  readonly durableAcrossRestart = false as const;

  isConsumed(grantId: string): boolean {
    return this.consumedGrantIds.has(grantId);
  }

  snapshot(): ConsumedRegistrySnapshot {
    return {
      consumedGrantIds: [...this.consumedGrantIds],
      processLocal: true,
      durableAcrossRestart: false,
    };
  }

  /** Adapter to the C0 verifier's expected shape (read-only projection). */
  asConsumedApprovalState(): ConsumedApprovalState {
    return { consumedGrantIds: [...this.consumedGrantIds] };
  }

  /**
   * Append-only consumption, refusing duplicates. Reserved for C2-B: no
   * C2-A code path calls this. Left here so the single-use semantics are
   * defined once, ahead of the real write attempt.
   */
  consume(grantId: string): ConsumeOutcome {
    if (this.consumedGrantIds.has(grantId)) {
      return { consumed: false, reasonCode: "grant-already-consumed" };
    }
    this.consumedGrantIds.add(grantId);
    return { consumed: true, reasonCode: "grant-consumed" };
  }
}
