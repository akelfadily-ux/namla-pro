/**
 * C2 adaptation of Productization 44977cf, budget-controller.ts.
 * Validates an observed usage snapshot only. This is NOT a reservation, debit,
 * lease, replay decision, or permission to execute. Canonical V2 remains authoritative.
 */
import { BudgetExceededError, ConfigurationError } from "../domain/errors";
import type { BudgetLimits, BudgetUsage } from "../domain/types";

const LIMIT_FIELDS = [
  "maxCostUsd", "maxTokens", "maxModelCalls", "maxToolCalls", "maxRuntimeMs",
  "maxIterations", "maxAgents", "maxConcurrency", "maxDepth",
] as const;
const USAGE_FIELDS = [
  "costUsd", "inputTokens", "outputTokens", "modelCalls", "toolCalls", "startedAt",
] as const;

function invalid(label: string): never {
  // Labels are internal constants, never input values or provider output.
  throw new ConfigurationError(`Invalid budget ${label}`);
}

/** Snapshot exact plain data fields; ordinary accessor properties are rejected. */
function dataFields(
  input: unknown,
  allowed: readonly string[],
  required: boolean,
  label: string,
): Record<string, unknown> {
  try {
    if (input === null || typeof input !== "object" || Array.isArray(input)) invalid(label);
    const proto: unknown = Object.getPrototypeOf(input);
    if (proto !== null && proto !== Object.prototype) invalid(label);
    const keys = Reflect.ownKeys(input);
    if (keys.length > allowed.length || (required && keys.length !== allowed.length)) invalid(label);
    const captured: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      if (typeof key !== "string" || !allowed.includes(key)) invalid(label);
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) invalid(label);
      captured[key] = descriptor.value;
    }
    return captured;
  } catch {
    return invalid(label);
  }
}

function nonnegativeFinite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) invalid(label);
  return value;
}

function counter(value: unknown, label: string): number {
  const result = nonnegativeFinite(value, label);
  if (!Number.isSafeInteger(result)) invalid(label);
  return result;
}

function limitsSnapshot(input: BudgetLimits): Readonly<BudgetLimits> {
  const values = dataFields(input, LIMIT_FIELDS, false, "limits shape");
  for (const name of LIMIT_FIELDS) {
    const value = values[name];
    // Preserve donor semantics: omitted/undefined optional limits are not configured.
    // They do not become zero, a default allowance, or an execution permit.
    if (value === undefined) continue;
    const number = name === "maxCostUsd" ? nonnegativeFinite(value, name) : counter(value, name);
    if (name === "maxCostUsd" && number > 1_000_000) invalid(name);
    if (name === "maxTokens" && number > 1_000_000_000) invalid(name);
    if ((name === "maxAgents" || name === "maxConcurrency") && (number < 1 || number > 1_000)) invalid(name);
    if (name === "maxDepth" && number > 100) invalid(name);
  }
  return Object.freeze(values) as Readonly<BudgetLimits>;
}

function startedAtMillis(value: unknown): number {
  try {
    if (value === null || typeof value !== "object" ||
        Object.getPrototypeOf(value) !== Date.prototype || Reflect.ownKeys(value).length !== 0) {
      invalid("startedAt");
    }
    const millis = Date.prototype.getTime.call(value);
    return counter(millis, "startedAt");
  } catch {
    return invalid("startedAt");
  }
}

export class BudgetController {
  validateLimits(limits: BudgetLimits): void {
    limitsSnapshot(limits);
  }

  /**
   * Refuse malformed observations and reached/exceeded configured thresholds.
   * All usage fields are required, including when the corresponding limit is absent.
   * maxIterations/maxAgents/maxConcurrency/maxDepth are validated here but cannot
   * be enforced from BudgetUsage, which carries no observations for those dimensions.
   * A successful return is void and does not reserve capacity for a proposed action.
   */
  assertWithinLimits(limits: BudgetLimits, usage: BudgetUsage): void {
    const bounds = limitsSnapshot(limits);
    const values = dataFields(usage, USAGE_FIELDS, true, "usage shape");
    const costUsd = nonnegativeFinite(values.costUsd, "costUsd");
    const inputTokens = counter(values.inputTokens, "inputTokens");
    const outputTokens = counter(values.outputTokens, "outputTokens");
    const modelCalls = counter(values.modelCalls, "modelCalls");
    const toolCalls = counter(values.toolCalls, "toolCalls");
    const totalTokens = counter(inputTokens + outputTokens, "totalTokens");
    const startedAt = startedAtMillis(values.startedAt);
    const now = counter(Date.now(), "clock");
    if (startedAt > now) invalid("startedAt in future");

    if (bounds.maxCostUsd !== undefined && costUsd >= bounds.maxCostUsd) {
      throw new BudgetExceededError("Run cost limit reached or exceeded");
    }
    if (bounds.maxTokens !== undefined && totalTokens >= bounds.maxTokens) {
      throw new BudgetExceededError("Token limit reached or exceeded");
    }
    if (bounds.maxModelCalls !== undefined && modelCalls >= bounds.maxModelCalls) {
      throw new BudgetExceededError("Maximum model calls reached or exceeded");
    }
    if (bounds.maxToolCalls !== undefined && toolCalls >= bounds.maxToolCalls) {
      throw new BudgetExceededError("Maximum tool calls reached or exceeded");
    }
    if (bounds.maxRuntimeMs !== undefined && now - startedAt >= bounds.maxRuntimeMs) {
      throw new BudgetExceededError("Maximum run duration reached or exceeded");
    }
  }
}
