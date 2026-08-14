/**
 * DigitalResourceEconomy — the event-sourced conservation ledger (Build Law §23,
 * the digital analogue of the biology `ColonyResourceEconomy`). This is the
 * load-bearing module: every unit of every digital resource enters ONLY through
 * `collect` (scouted from the environment) or `createVia` (produced by an
 * AUTHORIZED transformation), and leaves ONLY through `consume`, `expire`, or
 * `quarantine`. Each of those updates both the running quantity and a matching
 * accumulator, so for every resource:
 *
 *     quantity == initial + collected + created - consumed - expired - quarantined
 *
 * holds BY CONSTRUCTION. Therefore nothing appears from nowhere
 * (`unexplainedResourceCreation` is 0) and nothing vanishes silently.
 *
 * `toolAccess` is special: it is a bounded, revocable CAPACITY. Grants move
 * capacity from `available` to `held` and releases move it back, so
 * `available + held == initial` always — a permit is reserved, never minted.
 *
 * Budgets (compute / token / money / context) are never created — only consumed
 * — which is why there is no infinite work.
 *
 * No fs, no child_process, no network, no wall clock, no module-level mutable state.
 */

import { roundTo } from "../colony/colonyTypes";
import { DIGITAL_RESOURCES } from "./digitalTypes";
import type { DigitalResource } from "./digitalTypes";

export const DIGITAL_CONSERVATION_TOLERANCE = 1e-6;

interface ResourceLedger {
  quantity: number;
  initial: number;
  collected: number;
  created: number;
  consumed: number;
  expired: number;
  quarantined: number;
}

export interface ResourceConservationCheck {
  readonly resource: DigitalResource;
  readonly quantity: number;
  readonly reconstructed: number;
  readonly closed: boolean;
}

export interface TransformationReceipt {
  readonly transformationId: string;
  readonly kind: string;
  readonly tick: number;
  readonly workerId: string;
  readonly inputs: ReadonlyArray<{ resource: DigitalResource; amount: number }>;
  readonly outputs: ReadonlyArray<{ resource: DigitalResource; amount: number }>;
  readonly authorized: boolean;
}

export class DigitalResourceEconomy {
  private readonly ledgers: Record<DigitalResource, ResourceLedger>;
  // toolAccess capacity sub-ledger (reserve/release, never mint).
  private toolAvailable: number;
  private toolHeld = 0;
  private toolGrantEvents = 0;
  private toolReleaseEvents = 0;
  private toolDenials = 0;
  private readonly transformations: TransformationReceipt[] = [];
  private nextTransformSeq = 0;

  constructor(initial: Partial<Record<DigitalResource, number>>) {
    this.ledgers = {} as Record<DigitalResource, ResourceLedger>;
    for (const r of DIGITAL_RESOURCES) {
      const init = Math.max(0, initial[r] ?? 0);
      this.ledgers[r] = { quantity: init, initial: init, collected: 0, created: 0, consumed: 0, expired: 0, quarantined: 0 };
    }
    this.toolAvailable = this.ledgers.toolAccess.initial;
  }

  balanceOf(resource: DigitalResource): number {
    return roundTo(this.ledgers[resource].quantity, 6);
  }

  /** Scout the environment for raw signal (analogous to foraging). */
  collect(resource: DigitalResource, amount: number): number {
    if (amount <= 0) return 0;
    const l = this.ledgers[resource];
    l.quantity += amount;
    l.collected += amount;
    return roundTo(amount, 6);
  }

  /** Create a resource ONLY as the output of an authorized transformation. */
  createVia(resource: DigitalResource, amount: number): number {
    if (amount <= 0) return 0;
    const l = this.ledgers[resource];
    l.quantity += amount;
    l.created += amount;
    return roundTo(amount, 6);
  }

  /** Consume a resource (context/compute/budget/inputs). Clamped to balance. */
  consume(resource: DigitalResource, amount: number): number {
    if (amount <= 0) return 0;
    const l = this.ledgers[resource];
    const taken = Math.min(amount, l.quantity);
    l.quantity -= taken;
    l.consumed += taken;
    return roundTo(taken, 6);
  }

  /** Degrade/expire a resource (freshness loss, obsolescence). Clamped. */
  expire(resource: DigitalResource, amount: number): number {
    if (amount <= 0) return 0;
    const l = this.ledgers[resource];
    const taken = Math.min(amount, l.quantity);
    l.quantity -= taken;
    l.expired += taken;
    return roundTo(taken, 6);
  }

  /** Quarantine a resource (poisoned/unsafe). Clamped. Immune-system sink. */
  quarantine(resource: DigitalResource, amount: number): number {
    if (amount <= 0) return 0;
    const l = this.ledgers[resource];
    const taken = Math.min(amount, l.quantity);
    l.quantity -= taken;
    l.quarantined += taken;
    return roundTo(taken, 6);
  }

  /**
   * Record + execute a metabolism transformation: consume the inputs, create the
   * outputs, and log a receipt. The caller passes `authorized=false` only to
   * PROVE a guard rejects it — an unauthorized transform creates nothing.
   */
  transform(kind: string, tick: number, workerId: string, inputs: ReadonlyArray<{ resource: DigitalResource; amount: number }>, outputs: ReadonlyArray<{ resource: DigitalResource; amount: number }>, authorized: boolean): TransformationReceipt {
    const applied: Array<{ resource: DigitalResource; amount: number }> = [];
    const produced: Array<{ resource: DigitalResource; amount: number }> = [];
    if (authorized) {
      for (const i of inputs) {
        const taken = this.consume(i.resource, i.amount);
        if (taken > 0) applied.push({ resource: i.resource, amount: taken });
      }
      for (const o of outputs) {
        const made = this.createVia(o.resource, o.amount);
        if (made > 0) produced.push({ resource: o.resource, amount: made });
      }
    }
    const receipt: TransformationReceipt = {
      transformationId: `xf-${this.nextTransformSeq++}`,
      kind,
      tick,
      workerId,
      inputs: applied,
      outputs: produced,
      authorized,
    };
    if (this.transformations.length < 5000) this.transformations.push(receipt);
    return receipt;
  }

  // --- toolAccess capacity (oxygen): reserve/release, never mint -----------

  get toolAccessAvailable(): number {
    return this.toolAvailable;
  }
  get toolAccessHeld(): number {
    return this.toolHeld;
  }
  get toolAccessGrants(): number {
    return this.toolGrantEvents;
  }
  get toolAccessReleases(): number {
    return this.toolReleaseEvents;
  }
  get toolAccessDenials(): number {
    return this.toolDenials;
  }

  /** Reserve one tool permit if capacity remains. Bounded, attributable. */
  grantToolAccess(): boolean {
    if (this.toolAvailable < 1) {
      this.toolDenials += 1;
      return false;
    }
    this.toolAvailable -= 1;
    this.toolHeld += 1;
    this.toolGrantEvents += 1;
    return true;
  }

  /** Release a previously granted permit back into capacity (revocable). */
  releaseToolAccess(): void {
    if (this.toolHeld < 1) return;
    this.toolHeld -= 1;
    this.toolAvailable += 1;
    this.toolReleaseEvents += 1;
  }

  get transformationCount(): number {
    return this.transformations.length;
  }
  get transformationLog(): readonly TransformationReceipt[] {
    return this.transformations;
  }

  // --- conservation validation --------------------------------------------

  validate(): { readonly checks: readonly ResourceConservationCheck[]; readonly allClosed: boolean; readonly unexplainedResourceCreation: number; readonly toolAccessClosed: boolean } {
    const checks = DIGITAL_RESOURCES.map((resource) => {
      const l = this.ledgers[resource];
      const reconstructed = l.initial + l.collected + l.created - l.consumed - l.expired - l.quarantined;
      const closed = Math.abs(l.quantity - reconstructed) <= DIGITAL_CONSERVATION_TOLERANCE;
      return { resource, quantity: roundTo(l.quantity, 6), reconstructed: roundTo(reconstructed, 6), closed };
    });
    const toolAccessClosed = Math.abs(this.toolAvailable + this.toolHeld - this.ledgers.toolAccess.initial) <= DIGITAL_CONSERVATION_TOLERANCE;
    const unexplainedResourceCreation = checks.filter((c) => !c.closed).length + (toolAccessClosed ? 0 : 1);
    return { checks, allClosed: checks.every((c) => c.closed) && toolAccessClosed, unexplainedResourceCreation, toolAccessClosed };
  }

  totals(resource: DigitalResource): ResourceLedger {
    return { ...this.ledgers[resource] };
  }
}
