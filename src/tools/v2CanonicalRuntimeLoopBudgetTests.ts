import assert from "node:assert/strict";
import test from "node:test";
import type { LoopBudget } from "../v2/types/namlaLoopTypes";
import type { RuntimeBudgets } from "../v2/types/stageContext";
import {
  createCanonicalRuntimeLoopBudget as create,
  debitCanonicalRuntimeLoopBudget as debit,
  validateCanonicalRuntimeLoopBudget as validate,
  validateCanonicalRuntimeLoopBudgetTransition as transition,
  type CanonicalRuntimeBudgetCost,
} from "../v2/runtime/canonicalRuntimeLoopBudget";

const limits = (): RuntimeBudgets => ({
  virtualTicks: 10, providerCalls: 4, maxFixAttempts: 2,
});
const budget = (): LoopBudget => ({
  maxTicks: 10, remainingTicks: 10,
  maxProviderCalls: 4, remainingProviderCalls: 4,
  maxFixAttempts: 2, remainingFixAttempts: 2,
});
const cost = (): CanonicalRuntimeBudgetCost => ({
  virtualTicks: 1, providerCalls: 1, fixAttempts: 1,
});
const badNumbers = [undefined, null, "1", true, -1, 0.5, NaN, Infinity,
  Number.MAX_SAFE_INTEGER + 1];
const pairs = [
  ["maxTicks", "remainingTicks"],
  ["maxProviderCalls", "remainingProviderCalls"],
  ["maxFixAttempts", "remainingFixAttempts"],
] as const;

function expectFailure(actual: unknown, reasonCode: string): void {
  assert.deepEqual(actual, { ok: false, reasonCode });
}

test("10E6 loop budget initializes only from explicit limits", () => {
  assert.deepEqual(create(limits()), { ok: true, reasonCode: "ok", budget: budget() });
});

test("10E6 loop budget rejects missing or invalid limits without defaults", () => {
  for (const value of [undefined, null, {}, { virtualTicks: 10 }]) {
    expectFailure(create(value as RuntimeBudgets), "limits-invalid");
  }
  for (const field of Object.keys(limits())) {
    for (const value of badNumbers) {
      expectFailure(create({ ...limits(), [field]: value }), "limits-invalid");
    }
  }
});

test("10E6 loop budget permits explicit zero ceilings without granting execution", () => {
  const result = create({ virtualTicks: 0, providerCalls: 0, maxFixAttempts: 0 });
  assert.ok(result.ok);
  assert.equal(validate(result.budget).ok, true);
  expectFailure(debit(result.budget, cost()), "budget-exhausted");
});

test("10E6 loop budget rejects malformed snapshots and invalid counters", () => {
  for (const value of [null, undefined, [], {}, { ...budget(), extra: 1 }]) {
    expectFailure(validate(value), "budget-invalid");
  }
  for (const field of Object.keys(budget())) {
    for (const value of badNumbers) {
      expectFailure(validate({ ...budget(), [field]: value }), "budget-invalid");
    }
  }
});

test("10E6 loop budget rejects a remaining balance above any ceiling", () => {
  for (const [maximum, remaining] of pairs) {
    expectFailure(validate({ ...budget(), [remaining]: budget()[maximum] + 1 }),
      "budget-invalid");
  }
});

test("10E6 loop budget debits all dimensions without mutating its input", () => {
  const current = budget();
  const before = structuredClone(current);
  const result = debit(current, cost());
  assert.ok(result.ok);
  assert.deepEqual(result.budget, {
    ...current, remainingTicks: 9, remainingProviderCalls: 3, remainingFixAttempts: 1,
  });
  assert.deepEqual(current, before);
  assert.equal(Object.isFrozen(current), false);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.budget), true);
});

test("10E6 loop budget refuses overspend in any dimension without partial debit", () => {
  const current = budget();
  for (const charge of [
    { ...cost(), virtualTicks: 11 },
    { ...cost(), providerCalls: 5 },
    { ...cost(), fixAttempts: 3 },
  ]) {
    expectFailure(debit(current, charge), "budget-exhausted");
    assert.deepEqual(current, budget());
  }
});

test("10E6 loop budget rejects invalid or incomplete costs", () => {
  expectFailure(debit(budget(), {} as CanonicalRuntimeBudgetCost), "cost-invalid");
  for (const field of Object.keys(cost())) {
    for (const value of badNumbers) {
      expectFailure(debit(budget(), { ...cost(), [field]: value }), "cost-invalid");
    }
  }
});

test("10E6 loop budget supports a zero-cost accounting snapshot without replenishment", () => {
  const current = budget();
  const result = debit(current, { virtualTicks: 0, providerCalls: 0, fixAttempts: 0 });
  assert.ok(result.ok);
  assert.deepEqual(result.budget, current);
  assert.notEqual(result.budget, current);
});

test("10E6 loop budget transition rejects changes to any ceiling", () => {
  for (const [maximum] of pairs) {
    expectFailure(transition(budget(), { ...budget(), [maximum]: budget()[maximum] + 1 }),
      "budget-max-mutated");
  }
});

test("10E6 loop budget transition rejects replenishment below the original ceilings", () => {
  const charged = debit(budget(), cost());
  assert.ok(charged.ok);
  for (const [, remaining] of pairs) {
    expectFailure(transition(charged.budget, {
      ...charged.budget, [remaining]: charged.budget[remaining] + 1,
    }), "budget-replenishment");
  }
});

test("10E6 loop budget transition permits unchanged or decreasing balances", () => {
  assert.deepEqual(transition(budget(), budget()), { ok: true, reasonCode: "ok" });
  const charged = debit(budget(), cost());
  assert.ok(charged.ok);
  assert.deepEqual(transition(budget(), charged.budget), { ok: true, reasonCode: "ok" });
});

test("10E6 loop budget results do not retain caller-owned limits or budget objects", () => {
  const input = { ...limits() };
  const created = create(input);
  assert.ok(created.ok);
  input.virtualTicks = 999;
  assert.deepEqual(created.budget, budget());
  const current = { ...budget() };
  const charged = debit(current, cost());
  assert.ok(charged.ok);
  current.remainingTicks = 0;
  assert.equal(charged.budget.remainingTicks, 9);
});

test("10E6 loop budget rejects accessor fields without invoking their getters", () => {
  let reads = 0;
  const value = { ...budget() };
  Object.defineProperty(value, "remainingTicks", {
    enumerable: true, get() { reads += 1; return 10; },
  });
  expectFailure(validate(value), "budget-invalid");
  assert.equal(reads, 0);
});

test("10E6 loop budget accepts plain null-prototype data and refuses reflection errors", () => {
  assert.equal(validate(Object.assign(Object.create(null), budget())).ok, true);
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  expectFailure(validate(revoked.proxy), "budget-invalid");
});

test("10E6 loop budget transition distinguishes invalid current and next snapshots", () => {
  expectFailure(transition(null, budget()), "current-budget-invalid");
  expectFailure(transition(budget(), null), "next-budget-invalid");
});

test("10E6 loop budget debit refuses an invalid current snapshot", () => {
  expectFailure(debit({ ...budget(), remainingTicks: 11 }, cost()), "budget-invalid");
});

test("10E6 loop budget JSON round-trip preserves consumed balances", () => {
  const charged = debit(budget(), cost());
  assert.ok(charged.ok);
  const restored: LoopBudget = JSON.parse(JSON.stringify(charged.budget));
  assert.equal(validate(restored).ok, true);
  const next = debit(restored, cost());
  assert.ok(next.ok);
  assert.equal(next.budget.remainingTicks, 8);
  assert.equal(next.budget.remainingProviderCalls, 2);
  assert.equal(next.budget.remainingFixAttempts, 0);
  expectFailure(debit(next.budget, cost()), "budget-exhausted");
});
