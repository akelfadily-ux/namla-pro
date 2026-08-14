/**
 * CognitiveExecutionBudget: the one deliberately centralized admission step
 * for cognitive slots, mirroring Colony Genesis G7's
 * `cognitiveBudgetSystem.resolveCognitionClaims` — bounded resource
 * admission, never task assignment. An ant's task is already chosen (it
 * voluntarily claimed work) before this ever runs; this only decides
 * whether that ant may additionally use a cognitive worker right now.
 *
 * Unlike G7 (stateless, re-resolved every tick), a mission runs once, so
 * slots are held for the duration of an ant's cognitive work and explicitly
 * released — "slots release when work ends" is literal here, not implicit
 * in a fresh per-tick recomputation.
 */

export interface CognitiveClaim {
  readonly antId: string;
  readonly claimScore: number;
}

export class CognitiveExecutionBudget {
  private readonly active = new Set<string>();
  private peak = 0;
  private totalAccepted = 0;
  private totalRejected = 0;

  constructor(private readonly maxConcurrent: number) {}

  /**
   * Deterministic ordering: score descending, then antId ascending as a
   * stable tiebreak. Admits at most the currently-free room — never more
   * than `maxConcurrent` active at once, by construction (array slice).
   */
  resolve(claims: readonly CognitiveClaim[]): ReadonlySet<string> {
    const room = Math.max(0, this.maxConcurrent - this.active.size);
    const sorted = [...claims].sort((a, b) => b.claimScore - a.claimScore || a.antId.localeCompare(b.antId));
    const admitted = sorted.slice(0, room);
    const admittedIds = new Set(admitted.map((c) => c.antId));

    for (const id of admittedIds) {
      this.active.add(id);
      this.totalAccepted += 1;
    }
    this.totalRejected += claims.length - admittedIds.size;
    this.peak = Math.max(this.peak, this.active.size);

    return admittedIds;
  }

  release(antId: string): void {
    this.active.delete(antId);
  }

  get activeCount(): number {
    return this.active.size;
  }

  get peakActiveCount(): number {
    return this.peak;
  }

  get maxConcurrentBudget(): number {
    return this.maxConcurrent;
  }

  get acceptedCount(): number {
    return this.totalAccepted;
  }

  get rejectedCount(): number {
    return this.totalRejected;
  }
}
