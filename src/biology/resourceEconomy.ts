/**
 * ColonyResourceEconomy — the strict double-entry conservation ledger
 * (Build Law §22, §3). This is the load-bearing module: every unit of every
 * resource lives in exactly one POOL, and the ONLY way to move a unit is
 * `transfer(category, from, to, amount)`, which subtracts from `from` and adds
 * the SAME clamped amount to `to`. Therefore the sum across all pools for each
 * category is invariant by construction — nothing appears from nowhere and
 * nothing vanishes silently.
 *
 * Energy is tracked separately but with the same discipline: energy is
 * PRODUCED only by metabolizing food (a conserving move of food into the
 * `consumed` pool, coupled to an energy credit), and SPENT only into the
 * `energySpent` accumulator. `initialEnergy + energyProduced == liveEnergy +
 * energySpent` closes by construction.
 *
 * `validate()` recomputes the closed sums and confirms they match the initial
 * totals within a fixed tolerance — the conservation invariant the demo and
 * goldens assert.
 *
 * No fs, no child_process, no network, no wall clock, no module-level mutable state.
 */

import type { ResourceCategory, ResourcePool } from "./biologicalTypes";
import { RESOURCE_CATEGORIES, RESOURCE_POOLS } from "./biologicalTypes";
import { roundTo } from "../colony/colonyTypes";

/** Balances may drift by at most this (float rounding) and still be "conserved". */
export const CONSERVATION_TOLERANCE = 1e-6;

export interface ResourceBalanceCheck {
  readonly category: ResourceCategory;
  readonly initialTotal: number;
  readonly currentTotal: number;
  readonly closed: boolean;
}

export interface EnergyBalanceCheck {
  readonly initialEnergy: number;
  readonly energyProduced: number;
  readonly liveEnergy: number;
  readonly energySpent: number;
  readonly closed: boolean;
}

export class ColonyResourceEconomy {
  /** pools[category][pool] = quantity. The single source of aggregate truth. */
  private readonly pools: Record<ResourceCategory, Record<ResourcePool, number>>;
  private readonly initialTotals: Record<ResourceCategory, number>;

  // Energy accounting.
  private readonly initialEnergyValue: number;
  private energyProducedTotal = 0;
  private energySpentTotal = 0;
  private liveEnergyValue: number;

  // Per-op instrumentation (all event-sourced, never guessed).
  private transferCount = 0;

  constructor(initialLive: Partial<Record<ResourceCategory, Partial<Record<ResourcePool, number>>>>, initialEnergy: number) {
    this.pools = {} as Record<ResourceCategory, Record<ResourcePool, number>>;
    this.initialTotals = {} as Record<ResourceCategory, number>;
    for (const category of RESOURCE_CATEGORIES) {
      const row = {} as Record<ResourcePool, number>;
      for (const pool of RESOURCE_POOLS) row[pool] = initialLive[category]?.[pool] ?? 0;
      this.pools[category] = row;
      this.initialTotals[category] = RESOURCE_POOLS.reduce((s, p) => s + row[p], 0);
    }
    this.initialEnergyValue = initialEnergy;
    this.liveEnergyValue = initialEnergy;
  }

  balanceOf(category: ResourceCategory, pool: ResourcePool): number {
    return this.pools[category][pool];
  }

  get transfers(): number {
    return this.transferCount;
  }

  /**
   * Move up to `amount` of `category` from `from` to `to`. Clamped to the
   * `from` balance (a donor can never move more than it holds), and to
   * non-negative. Returns the ACTUAL amount moved — the caller must mirror this
   * exact amount into any detailed per-entity state.
   */
  transfer(category: ResourceCategory, from: ResourcePool, to: ResourcePool, amount: number): number {
    if (amount <= 0 || from === to) return 0;
    const available = this.pools[category][from];
    const moved = Math.min(amount, available);
    if (moved <= 0) return 0;
    this.pools[category][from] = available - moved;
    this.pools[category][to] += moved;
    this.transferCount += 1;
    return moved;
  }

  /**
   * Metabolize food into energy: moves `foodAmount` of `category` from `from`
   * into `consumed`, and credits `foodAmount * efficiency` energy. Returns the
   * energy produced. This is the ONLY way live energy rises.
   */
  metabolize(category: ResourceCategory, from: ResourcePool, foodAmount: number, efficiency: number): number {
    const moved = this.transfer(category, from, "consumed", foodAmount);
    const energy = moved * efficiency;
    this.liveEnergyValue += energy;
    this.energyProducedTotal += energy;
    return energy;
  }

  /** Spend energy (movement/work/basal). Clamped to the live pool. Returns spent. */
  spendEnergy(amount: number): number {
    if (amount <= 0) return 0;
    const spent = Math.min(amount, this.liveEnergyValue);
    this.liveEnergyValue -= spent;
    this.energySpentTotal += spent;
    return spent;
  }

  /** Credit energy already accounted elsewhere (e.g. an ant's body energy leaving the live pool). */
  get liveEnergy(): number {
    return this.liveEnergyValue;
  }

  totalOf(category: ResourceCategory): number {
    return RESOURCE_POOLS.reduce((s, p) => s + this.pools[category][p], 0);
  }

  /** Every category's pool-sum still equals its initial total (within tolerance). */
  validateResources(): { readonly checks: readonly ResourceBalanceCheck[]; readonly allClosed: boolean } {
    const checks = RESOURCE_CATEGORIES.map((category) => {
      const currentTotal = this.totalOf(category);
      const closed = Math.abs(currentTotal - this.initialTotals[category]) <= CONSERVATION_TOLERANCE;
      return { category, initialTotal: roundTo(this.initialTotals[category], 6), currentTotal: roundTo(currentTotal, 6), closed };
    });
    return { checks, allClosed: checks.every((c) => c.closed) };
  }

  validateEnergy(): EnergyBalanceCheck {
    const closed = Math.abs(this.initialEnergyValue + this.energyProducedTotal - (this.liveEnergyValue + this.energySpentTotal)) <= CONSERVATION_TOLERANCE;
    return {
      initialEnergy: roundTo(this.initialEnergyValue, 6),
      energyProduced: roundTo(this.energyProducedTotal, 6),
      liveEnergy: roundTo(this.liveEnergyValue, 6),
      energySpent: roundTo(this.energySpentTotal, 6),
      closed,
    };
  }

  get metabolismConsumed(): number {
    return roundTo(RESOURCE_CATEGORIES.reduce((s, c) => s + this.pools[c].consumed, 0), 6);
  }

  get energyProduced(): number {
    return roundTo(this.energyProducedTotal, 6);
  }
  get energySpent(): number {
    return roundTo(this.energySpentTotal, 6);
  }
}
