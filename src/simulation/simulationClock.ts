/**
 * SimulationClock is virtual time: an integer tick counter that advances
 * only when a human-run script calls step(). There is no timer of any
 * kind, no watcher, no background anything — if nobody calls step(), time
 * in the colony simply stops.
 *
 * Determinism: tick counts and labels are fully deterministic. asDate()
 * maps ticks onto wall-clock Dates for components that need one (pheromone
 * decay), anchored at the clock's construction moment — the anchor must be
 * "now" rather than a fixed past date, because pheromones are stamped with
 * real emission times, and decaying them against a Date in their past would
 * compute negative elapsed time and *grow* their strength. The millisecond
 * jitter this introduces is negligible against multi-minute half-lives and
 * does not affect scheduling, ordering, or outcomes.
 */

const MS_PER_TICK = 60_000; // one virtual minute per tick

export class SimulationClock {
  private tick = 0;
  private epochMs = Date.now();

  get currentTick(): number {
    return this.tick;
  }

  /** Advance virtual time by one tick. Returns the new tick. */
  step(): number {
    this.tick += 1;
    return this.tick;
  }

  reset(): void {
    this.tick = 0;
    this.epochMs = Date.now();
  }

  /** Deterministic label for the current tick, e.g. "tick-0007". */
  label(): string {
    return `tick-${String(this.tick).padStart(4, "0")}`;
  }

  /** The current virtual moment as a Date (anchor + tick minutes). */
  asDate(): Date {
    return new Date(this.epochMs + this.tick * MS_PER_TICK);
  }
}
