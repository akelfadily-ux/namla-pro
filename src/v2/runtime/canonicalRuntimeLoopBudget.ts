import type { LoopBudget } from "../types/namlaLoopTypes";
import type { RuntimeBudgets } from "../types/stageContext";

export interface CanonicalRuntimeBudgetCost {
  readonly virtualTicks: number;
  readonly providerCalls: number;
  readonly fixAttempts: number;
}

export type CanonicalRuntimeBudgetReason =
  | "limits-invalid"
  | "budget-invalid"
  | "cost-invalid"
  | "budget-exhausted"
  | "current-budget-invalid"
  | "next-budget-invalid"
  | "budget-max-mutated"
  | "budget-replenishment";

export type CanonicalRuntimeBudgetValidation =
  | { readonly ok: true; readonly reasonCode: "ok" }
  | { readonly ok: false; readonly reasonCode: CanonicalRuntimeBudgetReason };

export type CanonicalRuntimeBudgetResult =
  | {
      readonly ok: true;
      readonly reasonCode: "ok";
      readonly budget: LoopBudget;
    }
  | { readonly ok: false; readonly reasonCode: CanonicalRuntimeBudgetReason };

const BUDGET_FIELDS = [
  "maxTicks", "remainingTicks", "maxFixAttempts", "remainingFixAttempts",
  "maxProviderCalls", "remainingProviderCalls",
] as const;

const LIMIT_FIELDS = ["virtualTicks", "providerCalls", "maxFixAttempts"] as const;
const COST_FIELDS = ["virtualTicks", "providerCalls", "fixAttempts"] as const;

/** Capture primitive data properties without invoking accessors or coercion. */
function readCounters<K extends string>(
  value: unknown,
  fields: readonly K[],
): Readonly<Record<K, number>> | null {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    if (Reflect.ownKeys(value).length !== fields.length) return null;

    const captured = {} as Record<K, number>;
    for (const field of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(value, field);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return null;
      }
      const counter: unknown = descriptor.value;
      if (
        typeof counter !== "number" ||
        !Number.isSafeInteger(counter) || counter < 0
      ) {
        return null;
      }
      captured[field] = counter;
    }
    return Object.freeze(captured);
  } catch {
    return null;
  }
}

function readBudget(value: unknown): LoopBudget | null {
  const budget = readCounters(value, BUDGET_FIELDS);
  if (
    !budget ||
    budget.remainingTicks > budget.maxTicks ||
    budget.remainingFixAttempts > budget.maxFixAttempts ||
    budget.remainingProviderCalls > budget.maxProviderCalls
  ) {
    return null;
  }
  return budget;
}

function refused(reasonCode: CanonicalRuntimeBudgetReason) {
  return Object.freeze({ ok: false as const, reasonCode });
}

function accepted(budget: LoopBudget): CanonicalRuntimeBudgetResult {
  return Object.freeze({
    ok: true as const,
    reasonCode: "ok" as const,
    budget: Object.freeze({ ...budget }),
  });
}

export function validateCanonicalRuntimeLoopBudget(
  value: unknown,
): CanonicalRuntimeBudgetValidation {
  return readBudget(value)
    ? Object.freeze({ ok: true as const, reasonCode: "ok" as const })
    : refused("budget-invalid");
}

/** New missions only. Resume must load the persisted budget, not call this. */
export function createCanonicalRuntimeLoopBudget(
  limits: RuntimeBudgets,
): CanonicalRuntimeBudgetResult {
  const values = readCounters(limits, LIMIT_FIELDS);
  if (!values) return refused("limits-invalid");
  return accepted({
    maxTicks: values.virtualTicks,
    remainingTicks: values.virtualTicks,
    maxFixAttempts: values.maxFixAttempts,
    remainingFixAttempts: values.maxFixAttempts,
    maxProviderCalls: values.providerCalls,
    remainingProviderCalls: values.providerCalls,
  });
}

/**
 * Pure accounting only: no storage, execution permission or inferred costs.
 * The caller must persist the proposed debit atomically with its attempt state
 * before execution. A successful return is NOT a durable reservation.
 * Failure returns no replacement budget; no dimension is partially debited.
 */
export function debitCanonicalRuntimeLoopBudget(
  current: LoopBudget,
  cost: CanonicalRuntimeBudgetCost,
): CanonicalRuntimeBudgetResult {
  const budget = readBudget(current);
  if (!budget) return refused("budget-invalid");
  const charge = readCounters(cost, COST_FIELDS);
  if (!charge) return refused("cost-invalid");
  if (
    charge.virtualTicks > budget.remainingTicks ||
    charge.providerCalls > budget.remainingProviderCalls ||
    charge.fixAttempts > budget.remainingFixAttempts
  ) {
    return refused("budget-exhausted");
  }
  return accepted({
    ...budget,
    remainingTicks: budget.remainingTicks - charge.virtualTicks,
    remainingProviderCalls: budget.remainingProviderCalls - charge.providerCalls,
    remainingFixAttempts: budget.remainingFixAttempts - charge.fixAttempts,
  });
}

/** Checks continuity only; this does not prove that execution costs were charged. */
export function validateCanonicalRuntimeLoopBudgetTransition(
  current: unknown,
  next: unknown,
): CanonicalRuntimeBudgetValidation {
  const before = readBudget(current);
  if (!before) return refused("current-budget-invalid");
  const after = readBudget(next);
  if (!after) return refused("next-budget-invalid");
  if (
    after.maxTicks !== before.maxTicks ||
    after.maxProviderCalls !== before.maxProviderCalls ||
    after.maxFixAttempts !== before.maxFixAttempts
  ) {
    return refused("budget-max-mutated");
  }
  if (
    after.remainingTicks > before.remainingTicks ||
    after.remainingProviderCalls > before.remainingProviderCalls ||
    after.remainingFixAttempts > before.remainingFixAttempts
  ) {
    return refused("budget-replenishment");
  }
  return Object.freeze({ ok: true as const, reasonCode: "ok" as const });
}
