/** C2 component tests. No provider, database, scheduler or execution authority is used. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import { BudgetController } from "../application/budget-controller";
import type { Supervisor, SupervisorDecision } from "../application/supervisor";
import { BudgetExceededError, ConfigurationError } from "../domain/errors";
import type { BudgetLimits, BudgetUsage } from "../domain/types";

const controller = new BudgetController();
const NOW = 1_800_000_000_000;
function usage(patch: Partial<BudgetUsage> = {}): BudgetUsage {
  return { costUsd: 1, inputTokens: 3, outputTokens: 2, modelCalls: 1,
    toolCalls: 1, startedAt: new Date(NOW - 1_000), ...patch };
}
function withClock(work: () => void, now = NOW): void {
  // All tests in this file are synchronous and sequential. Restore even on failure.
  const original = Date.now;
  try { Date.now = () => now; work(); } finally { Date.now = original; }
}
function check(limits: BudgetLimits, observed: BudgetUsage = usage()): void {
  withClock(() => controller.assertWithinLimits(limits, observed));
}
function rejectsConfig(work: () => unknown): void {
  assert.throws(work, (error: unknown) => error instanceof ConfigurationError &&
    error.code === "CONFIGURATION_ERROR" && error.retryable === false);
}
function rejectsLimit(work: () => unknown): void {
  assert.throws(work, (error: unknown) => error instanceof BudgetExceededError &&
    error.code === "BUDGET_EXCEEDED" && error.retryable === false);
}
const invalidCounters: unknown[] = [-1, 0.5, NaN, Infinity, -Infinity,
  Number.MAX_SAFE_INTEGER + 1, "1", null, true, 1n];
const limitNames = ["maxCostUsd", "maxTokens", "maxModelCalls", "maxToolCalls", "maxRuntimeMs",
  "maxIterations", "maxAgents", "maxConcurrency", "maxDepth"] as const;

// Preserve the donor's observed-usage semantics, including rejection at equality.
test("C2 preserves the donor below-cost-limit case", () => {
  assert.doesNotThrow(() => check({ maxCostUsd: 10 }, usage({ costUsd: 5 })));
});
test("C2 rejects cost at and above its configured limit", () => {
  for (const costUsd of [10, 11]) rejectsLimit(() => check({ maxCostUsd: 10 }, usage({ costUsd })));
});
test("C2 sums input and output tokens and rejects a reached token limit", () => {
  check({ maxTokens: 6 });
  rejectsLimit(() => check({ maxTokens: 5 }));
  rejectsLimit(() => check({ maxTokens: 4 }));
});
test("C2 rejects model-call counts at and above the limit", () => {
  check({ maxModelCalls: 2 });
  for (const modelCalls of [1, 2]) rejectsLimit(() => check({ maxModelCalls: 1 }, usage({ modelCalls })));
});
test("C2 rejects tool-call counts at and above the limit", () => {
  check({ maxToolCalls: 2 });
  for (const toolCalls of [1, 2]) rejectsLimit(() => check({ maxToolCalls: 1 }, usage({ toolCalls })));
});
test("C2 enforces observed elapsed runtime at the exact boundary", () => {
  check({ maxRuntimeMs: 1_001 });
  rejectsLimit(() => check({ maxRuntimeMs: 1_000 }));
  rejectsLimit(() => check({ maxRuntimeMs: 999 }));
});
test("C2 zero configured usage limits do not permit another operation", () => {
  const zero = usage({ costUsd: 0, inputTokens: 0, outputTokens: 0, modelCalls: 0, toolCalls: 0,
    startedAt: new Date(NOW) });
  for (const field of ["maxCostUsd", "maxTokens", "maxModelCalls", "maxToolCalls", "maxRuntimeMs"]) {
    rejectsLimit(() => check({ [field]: 0 }, zero));
  }
});
test("C2 omitted and explicit undefined optional limits retain donor semantics", () => {
  const limits: BudgetLimits = { maxCostUsd: undefined, maxModelCalls: undefined };
  assert.equal(controller.validateLimits(limits), undefined);
  assert.equal(check(limits), undefined);
  assert.deepEqual(limits, { maxCostUsd: undefined, maxModelCalls: undefined });
  check({});
});
test("C2 validates every declared limit and retains the donor upper bounds", () => {
  controller.validateLimits({ maxCostUsd: 1_000_000, maxTokens: 1_000_000_000,
    maxConcurrency: 1_000, maxAgents: 1_000, maxDepth: 100,
    maxModelCalls: Number.MAX_SAFE_INTEGER, maxToolCalls: Number.MAX_SAFE_INTEGER,
    maxRuntimeMs: Number.MAX_SAFE_INTEGER, maxIterations: Number.MAX_SAFE_INTEGER });
  controller.validateLimits({ maxConcurrency: 1, maxAgents: 1, maxDepth: 0, maxIterations: 0 });
});
test("C2 rejects malformed formerly unchecked call runtime and iteration limits", () => {
  for (const field of ["maxModelCalls", "maxToolCalls", "maxRuntimeMs", "maxIterations"]) {
    for (const value of invalidCounters) {
      rejectsConfig(() => controller.validateLimits({ [field]: value } as BudgetLimits));
      rejectsConfig(() => check({ [field]: value } as BudgetLimits));
    }
  }
});
test("C2 rejects invalid costs and preserves valid fractional cost limits", () => {
  controller.validateLimits({ maxCostUsd: 0.25 });
  for (const value of [-1, NaN, Infinity, -Infinity, "1", null, true, 1_000_000.01]) {
    rejectsConfig(() => controller.validateLimits({ maxCostUsd: value } as BudgetLimits));
  }
});
test("C2 validates original token concurrency agent and depth ranges", () => {
  for (const field of ["maxTokens", "maxConcurrency", "maxAgents", "maxDepth"]) {
    for (const value of invalidCounters) rejectsConfig(() => controller.validateLimits({ [field]: value } as BudgetLimits));
  }
  for (const limits of [{maxTokens:1_000_000_001}, {maxConcurrency:0}, {maxConcurrency:1001},
    {maxAgents:0}, {maxAgents:1001}, {maxDepth:101}]) rejectsConfig(() => controller.validateLimits(limits));
});
test("C2 rejects malformed and unknown limit record shapes", () => {
  for (const value of [null, undefined, [], 1, "limits", new Date(), {maxToken:1}, {extra:undefined},
    Object.assign(Object.create({}), {maxTokens:10})]) {
    rejectsConfig(() => controller.validateLimits(value as BudgetLimits));
  }
});
test("C2 requires every observed usage field even without optional limits", () => {
  for (const field of Object.keys(usage())) {
    const observed = { ...usage() } as Record<string, unknown>;
    delete observed[field];
    rejectsConfig(() => check({}, observed as unknown as BudgetUsage));
  }
  for (const value of [null, undefined, [], 1, {...usage(), extra:1}]) {
    rejectsConfig(() => withClock(() => controller.assertWithinLimits({}, value as BudgetUsage)));
  }
});
test("C2 refuses invalid observed counters and never coerces them", () => {
  for (const field of ["inputTokens", "outputTokens", "modelCalls", "toolCalls"]) {
    for (const value of [...invalidCounters, undefined]) {
      rejectsConfig(() => check({}, { ...usage(), [field]: value } as BudgetUsage));
    }
  }
});
test("C2 refuses invalid observed cost while accepting nonnegative fractions", () => {
  check({maxCostUsd:1}, usage({costUsd:0.125}));
  for (const value of [-1, NaN, Infinity, -Infinity, undefined, null, "1", false]) {
    rejectsConfig(() => check({}, {...usage(), costUsd:value} as BudgetUsage));
  }
});
test("C2 refuses unsafe combined token arithmetic", () => {
  rejectsConfig(() => check({}, usage({inputTokens:Number.MAX_SAFE_INTEGER, outputTokens:1})));
  check({}, usage({inputTokens:Number.MAX_SAFE_INTEGER, outputTokens:0}));
});
test("C2 rejects invalid missing negative and non-Date start times", () => {
  for (const startedAt of [undefined, null, "2026-01-01", NOW, new Date(NaN), new Date(-1), {}]) {
    rejectsConfig(() => check({}, {...usage(), startedAt} as BudgetUsage));
  }
});
test("C2 rejects start times in the future instead of extending run time", () => {
  rejectsConfig(() => check({maxRuntimeMs:1}, usage({startedAt:new Date(NOW+1)})));
  rejectsConfig(() => check({}, usage({startedAt:new Date(NOW+1)})));
});
test("C2 Date overrides are rejected without invoking supplied methods", () => {
  let called = 0;
  const start = new Date(NOW);
  Object.defineProperty(start, "getTime", {value:() => {called++; return 0;}, enumerable:true});
  rejectsConfig(() => check({}, usage({startedAt:start})));
  assert.equal(called, 0);
  class CustomDate extends Date {}
  rejectsConfig(() => check({}, usage({startedAt:new CustomDate(NOW)})));
});
test("C2 limit accessors are rejected without executing getters", () => {
  let reads = 0;
  for (const field of limitNames) {
    const limits = Object.defineProperty({}, field, {enumerable:true, get() {reads++; return 1;}});
    rejectsConfig(() => controller.validateLimits(limits));
  }
  assert.equal(reads, 0);
});
test("C2 usage accessors are rejected without executing getters", () => {
  let reads = 0;
  for (const field of Object.keys(usage())) {
    const observed = { ...usage() };
    Object.defineProperty(observed, field, {enumerable:true, get() {reads++; return 1;}});
    rejectsConfig(() => check({}, observed));
  }
  assert.equal(reads, 0);
});
test("C2 rejects symbol hidden and inherited budget fields", () => {
  rejectsConfig(() => controller.validateLimits({[Symbol("x")]:1} as BudgetLimits));
  rejectsConfig(() => controller.validateLimits(Object.defineProperty({},"maxCostUsd",{value:1})));
  rejectsConfig(() => check({}, Object.assign(Object.create({startedAt:new Date(NOW)}), usage())));
  const observed = {...usage()};
  Object.defineProperty(observed,"costUsd",{enumerable:false});
  rejectsConfig(() => check({}, observed));
});
test("C2 accepts plain null-prototype records without inserting defaults", () => {
  const limits = Object.assign(Object.create(null), {maxCostUsd:10});
  const observed = Object.assign(Object.create(null), usage());
  check(limits, observed);
  assert.equal(Object.getPrototypeOf(limits), null);
  assert.deepEqual(Object.keys(limits), ["maxCostUsd"]);
});
test("C2 reflection failures are classified as invalid input", () => {
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  rejectsConfig(() => controller.validateLimits(revoked.proxy));
  rejectsConfig(() => check({}, revoked.proxy as BudgetUsage));
});
test("C2 checks neither mutate nor freeze caller-owned snapshots", () => {
  const limits = {maxCostUsd:10}; const observed = usage();
  const before = structuredClone({limits, observed});
  check(limits, observed);
  rejectsLimit(() => check({maxCostUsd:1}, observed));
  assert.deepEqual({limits, observed}, before);
  assert.equal(Object.isFrozen(limits), false);
  assert.equal(Object.isFrozen(observed), false);
  assert.equal(Object.isFrozen(observed.startedAt), false);
});
test("C2 supervisor contract remains a review interface not a canonical receipt", () => {
  // Compile-time witness only. No supervisor implementation or permission is supplied.
  const review: SupervisorDecision = {approved:false, reason:"needs evidence", risks:[], requiredFixes:["verify"]};
  const method: keyof Supervisor = "review";
  assert.equal(method, "review");
  assert.equal(review.approved, false);
  assert.equal(Object.prototype.hasOwnProperty.call(review,"leaseToken"), false);
});
test("C2 application components retain only the reviewed domain dependencies", () => {
  const allowed = new Set(["../domain/errors", "../domain/types"]);
  for (const name of ["budget-controller", "supervisor"]) {
    const source = ts.createSourceFile(name, readFileSync(resolve(process.cwd(),"src/application",name+".ts"),"utf8"),
      ts.ScriptTarget.Latest, true);
    const seen: string[] = [];
    const walk = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier) {
          assert.ok(ts.isStringLiteral(node.moduleSpecifier));
          assert.ok(allowed.has(node.moduleSpecifier.text)); seen.push(node.moduleSpecifier.text);
        }
      }
      if (ts.isCallExpression(node)) {
        assert.notEqual(node.expression.kind, ts.SyntaxKind.ImportKeyword);
        if (ts.isIdentifier(node.expression)) assert.notEqual(node.expression.text,"require");
      }
      ts.forEachChild(node,walk);
    };
    walk(source); assert.ok(seen.length > 0);
  }
});
test("C2 scheduler dimensions are configuration-only at this component boundary", () => {
  // BudgetUsage has no depth/agents/concurrency/iteration observations. This must
  // not be described as proof that a scheduler has enforced any of those limits.
  assert.equal(check({maxIterations:0,maxDepth:0,maxAgents:1,maxConcurrency:1}), undefined);
  assert.deepEqual(Object.keys(controller), []);
});
test("C2 invalid clock observations are refused without exposing input values", () => {
  for (const clock of [NaN, Infinity, -1, 0.5]) {
    rejectsConfig(() => withClock(() => controller.assertWithinLimits({},usage()), clock));
  }
  try { check({}, {...usage(), costUsd:"do-not-echo-input"} as unknown as BudgetUsage); }
  catch (error) { assert.ok(error instanceof ConfigurationError); assert.ok(!error.message.includes("do-not-echo-input")); }
});
