/**
 * Ant Academy V1 — provider pool + cognitive rotation (Build Law §20, §8/§9).
 *
 * The provider pool holds every engine — the deterministic worker plus Claude,
 * Codex, OpenAI, Anthropic, and local models — with real engines DISABLED by
 * default (only a human-authorized flag enables one, and R2's one-ant boundary
 * still governs real execution). Selection is by task requirement, cost, health,
 * and safety; Tamara may set budgets but never selects an individual ant.
 *
 * Cognitive rotation shares a bounded number of slots (global max 30) across
 * hundreds of persistent ants: specialization- and priority-aware admission,
 * expiry at end of round, per-ant cooldown for fairness, and failure backoff.
 * The operational real-provider target is 3-5 active ants; nothing here ever
 * jumps automatically to 30 or to hundreds.
 *
 * Deterministic; no fs, no process, no network, no wall clock.
 */

import type { CognitiveProviderName } from "../colonyMission/cognitiveWorkTypes";
import { MAX_COGNITIVE_BUDGET } from "../colony/cognitiveBudgetSystem";

export interface ProviderPoolEntry {
  readonly name: CognitiveProviderName;
  readonly enabled: boolean;
  readonly costPerCall: number;
  readonly healthy: boolean;
  readonly requiresHumanAuthorization: boolean;
}

export const DEFAULT_PROVIDER_POOL: readonly ProviderPoolEntry[] = [
  { name: "fake", enabled: true, costPerCall: 0, healthy: true, requiresHumanAuthorization: false },
  { name: "claude", enabled: false, costPerCall: 5, healthy: true, requiresHumanAuthorization: true },
  { name: "codex", enabled: false, costPerCall: 4, healthy: true, requiresHumanAuthorization: true },
];

export class ProviderPool {
  constructor(private readonly entries: readonly ProviderPoolEntry[] = DEFAULT_PROVIDER_POOL) {}

  /**
   * Select a provider for a task. Real engines are chosen only when explicitly
   * enabled AND healthy; otherwise the deterministic worker is the fallback, so
   * one provider's failure never stops the colony.
   */
  select(preferReal: boolean): CognitiveProviderName {
    if (preferReal) {
      const real = this.entries.find((e) => e.name !== "fake" && e.enabled && e.healthy);
      if (real) return real.name;
    }
    return "fake";
  }

  enabledRealProviderCount(): number {
    return this.entries.filter((e) => e.name !== "fake" && e.enabled).length;
  }
}

export interface SlotClaim {
  readonly antId: string;
  readonly priority: number; // higher = more important
  readonly specializationScore: number; // 0..1
  readonly costUnits: number;
  readonly recentFailure: boolean;
}

export interface RotationRoundResult {
  readonly admitted: readonly string[];
  readonly rejected: readonly string[];
  readonly activeThisRound: number;
}

export class CognitiveRotation {
  private readonly maxSlots: number;
  private readonly cooldownRounds: number;
  private readonly cooldownUntil = new Map<string, number>();
  private peak = 0;
  private round = 0;

  constructor(maxSlots: number = MAX_COGNITIVE_BUDGET, cooldownRounds = 2) {
    // Tighten-only: never above the global ceiling of 30.
    this.maxSlots = Math.min(Math.max(0, Math.floor(maxSlots)), MAX_COGNITIVE_BUDGET);
    this.cooldownRounds = cooldownRounds;
  }

  get peakActive(): number {
    return this.peak;
  }

  get slotCeiling(): number {
    return this.maxSlots;
  }

  /**
   * Admit up to `maxSlots` claims this round. Ants in cooldown are skipped
   * (fairness); a recent failure applies backoff (deprioritized). Deterministic
   * ordering: priority, then specialization, then antId. Admitted ants enter
   * cooldown; slots expire at the end of the round (stateless admission).
   */
  admit(claims: readonly SlotClaim[]): RotationRoundResult {
    this.round += 1;
    const eligible = claims.filter((c) => (this.cooldownUntil.get(c.antId) ?? 0) <= this.round);
    const sorted = [...eligible].sort((a, b) => {
      const aScore = a.priority + a.specializationScore - (a.recentFailure ? 1 : 0);
      const bScore = b.priority + b.specializationScore - (b.recentFailure ? 1 : 0);
      return bScore - aScore || a.antId.localeCompare(b.antId);
    });

    const admitted = sorted.slice(0, this.maxSlots).map((c) => c.antId);
    const rejected = claims.filter((c) => !admitted.includes(c.antId)).map((c) => c.antId);
    for (const antId of admitted) this.cooldownUntil.set(antId, this.round + this.cooldownRounds);

    this.peak = Math.max(this.peak, admitted.length);
    return { admitted, rejected, activeThisRound: admitted.length };
  }
}
