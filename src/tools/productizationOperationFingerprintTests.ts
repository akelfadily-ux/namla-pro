import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { ConfigurationError } from "../domain/errors";
import {
  canonicalize, fingerprintOperation,
  PRODUCTIZATION_OPERATION_FINGERPRINT_DOMAIN as DOMAIN,
  PRODUCTIZATION_OPERATION_FINGERPRINT_VERSION as VERSION,
  type OperationFingerprintInput,
} from "../application/operation-fingerprint";
import {
  canonicalizeOperationValue, fingerprintOperationIdentity,
} from "../v2/kernel/operationIdentity";

function input(value: unknown, extra: Partial<OperationFingerprintInput> = {}): OperationFingerprintInput {
  return { runId: "run-1", taskId: "task-1", toolName: "echo", value, ...extra };
}
function fp(value: unknown, extra: Partial<OperationFingerprintInput> = {}): string {
  return fingerprintOperation(input(value, extra));
}
function refused(work: () => unknown): void {
  assert.throws(work, (error: unknown) => error instanceof ConfigurationError &&
    error.message === "Invalid Productization operation input" &&
    error.code === "CONFIGURATION_ERROR" && error.retryable === false);
}
function malformed(value: unknown): void {
  refused(() => canonicalize(value));
  refused(() => fp(value));
}

test("C4 fingerprint delegates to the pinned V2 codec with an explicit Productization namespace", () => {
  assert.equal(VERSION, 2);
  assert.equal(DOMAIN, "NAMLA_PRODUCTIZATION_TOOL_INPUT");
  assert.equal(fp({ x: 1 }), fingerprintOperationIdentity({
    missionId: "run-1", authorityScope: "task-1", operationType: "productization.tool-input.v2",
    value: [DOMAIN, VERSION, "echo", { x: 1 }],
  }));
  assert.equal(fp({ x: 1 }), "61b5c121fe96409ebe898da4f14f29323fa0ab5ff21b9b3574091ac562a626bc");
});

test("C4 retained canonical V2 fingerprint golden vector does not change", () => {
  assert.equal(fingerprintOperationIdentity({
    missionId: "mission-001", authorityScope: "PRO/COLONY_A/task-7",
    operationType: "tool.filesystem.write", value: { stable: true },
  }), "3208cd8bfaa1c1ede2ee1e32f619270ac257c878f86209a43cf00924a3b3f7f7");
});

test("C4 canonicalize uses V2 tagged values rather than the donor v1 object encoding", () => {
  for (const value of [null, true, "hello", 2, -0, 8n, [1, 2], { b: 2, a: 1 },
    new Date("2026-09-12T12:00:00.000Z"), new Uint8Array([1, 2])]) {
    assert.equal(JSON.stringify(canonicalize(value)), canonicalizeOperationValue(value));
  }
  assert.deepEqual(canonicalize({ a: 1 }), ["object", [["a", ["number", "1"]]]]);
});

test("C4 new hashes are not donor v1 hashes and no fallback comparison is performed", () => {
  // Independent preimage for this one donor-v1 plain-object example, NOT a legacy implementation.
  const legacyPreimage = '{"input":{"x":1},"runId":"run-1","taskId":"task-1","toolName":"echo","version":1}';
  const oldHash = createHash("sha256").update(legacyPreimage).digest("hex");
  assert.notEqual(fp({ x: 1 }), oldHash);
  assert.match(fp({ x: 1 }), /^[0-9a-f]{64}$/);
});

test("C4 nested object insertion order does not change input identity", () => {
  assert.equal(fp({ z: 3, a: { y: 2, x: 1 } }), fp({ a: { x: 1, y: 2 }, z: 3 }));
});

test("C4 array order length and nesting remain significant", () => {
  assert.notEqual(fp([1, 2]), fp([2, 1]));
  assert.notEqual(fp([]), fp([null]));
  assert.notEqual(fp([1, [2]]), fp([[1], 2]));
});

test("C4 primitive types and negative zero cannot collapse through JSON coercion", () => {
  const values = [null, "null", true, "true", 1, "1", 1n, 0, -0, false];
  assert.equal(new Set(values.map(v => fp(v))).size, values.length);
});

test("C4 bigint cannot alias an ordinary object bearing donor type tags", () => {
  assert.notEqual(fp(1n), fp({ $type: "bigint", value: "1" }));
  assert.notEqual(fp(-2n), fp({ $type: "bigint", value: "-2" }));
});

test("C4 Date identities retain time and cannot alias empty objects or strings", () => {
  const date = new Date("2026-09-12T12:00:00.000Z");
  assert.equal(fp(date), fp(new Date(date.getTime())));
  assert.notEqual(fp(date), fp({}));
  assert.notEqual(fp(date), fp(date.toISOString()));
  assert.notEqual(fp(date), fp(new Date(date.getTime() + 1)));
});

test("C4 raw bytes retain byte identity and distinguish arrays from typed bytes", () => {
  assert.equal(fp(new Uint8Array([0, 255])), fp(Buffer.from([0, 255])));
  assert.notEqual(fp(new Uint8Array([0, 255])), fp([0, 255]));
  assert.notEqual(fp(new Uint8Array([0, 255])), fp(new Uint8Array([255, 0])));
  assert.equal(fp(new Uint8Array([9, 0, 255, 9]).subarray(1, 3)), fp(Buffer.from([0, 255])));
});

test("C4 each complete run task and tool identifier participates in fingerprinting", () => {
  const baseline = fp("x");
  for (const key of ["runId", "taskId", "toolName"] as const) {
    assert.notEqual(baseline, fp("x", { [key]: input(null)[key] + "-other" }));
  }
  assert.notEqual(fp(1, { taskId: "abcdefgh-first" }), fp(1, { taskId: "abcdefgh-second" }));
});

test("C4 identity tuples cannot alias through delimiter concatenation", () => {
  assert.notEqual(fp("x", { runId: "a:b", taskId: "c" }), fp("x", { runId: "a", taskId: "b:c" }));
  assert.notEqual(fp("x", { taskId: "a:b", toolName: "c" }), fp("x", { taskId: "a", toolName: "b:c" }));
});

test("C4 Unicode significant spaces and Unicode normalization forms are retained", () => {
  assert.equal(fp({ "עברית": "مرحبا 😀" }), fp({ "עברית": "مرحبا 😀" }));
  assert.notEqual(fp("é"), fp("e\u0301"));
  assert.notEqual(fp("x", { runId: "run" }), fp("x", { runId: " run " }));
});

test("C4 invalid identity parts are rejected without string coercion", () => {
  for (const key of ["runId", "taskId", "toolName"]) {
    for (const value of [null, undefined, "", " ", "bad\n", "bad\u0000", "bad\u007f", "x".repeat(513), 1, {}]) {
      refused(() => fingerprintOperation({ ...input(1), [key]: value } as OperationFingerprintInput));
    }
  }
  assert.match(fp(1, { runId: "x".repeat(512) }), /^[0-9a-f]{64}$/);
});

test("C4 input envelopes require all and only the four declared fields", () => {
  for (const value of [undefined, null, [], {}, { ...input(1), extra: true }, new Date()]) {
    refused(() => fingerprintOperation(value as OperationFingerprintInput));
  }
  for (const key of Object.keys(input(1))) {
    const value: Record<string, unknown> = { ...input(1) }; delete value[key];
    refused(() => fingerprintOperation(value as unknown as OperationFingerprintInput));
  }
});

test("C4 envelope accessors are rejected without invocation", () => {
  let reads = 0;
  for (const key of Object.keys(input(1))) {
    const value = { ...input(1) };
    Object.defineProperty(value, key, { enumerable: true, get() { reads++; return "bad"; } });
    refused(() => fingerprintOperation(value));
  }
  assert.equal(reads, 0);
});

test("C4 envelopes reject inherited hidden and symbol fields", () => {
  refused(() => fingerprintOperation(Object.create(input(1))));
  const hidden = { ...input(1) }; Object.defineProperty(hidden, "value", { enumerable: false, value: 1 });
  refused(() => fingerprintOperation(hidden));
  const symbol = { ...input(1), [Symbol("metadata")]: true };
  refused(() => fingerprintOperation(symbol));
});

test("C4 nested object getters are not executed during validation or hashing", () => {
  let reads = 0;
  const value = { safe: 1 };
  Object.defineProperty(value, "danger", { enumerable: true, get() { reads++; throw new Error("private"); } });
  malformed({ nested: value });
  assert.equal(reads, 0);
});

test("C4 nested hidden and symbol keys are rejected rather than silently omitted", () => {
  const hidden = {}; Object.defineProperty(hidden, "x", { value: 1 });
  for (const value of [hidden, { [Symbol("x")]: 1 }]) malformed(value);
});

test("C4 special object keys including __proto__ survive without prototype assignment", () => {
  const value: unknown = JSON.parse('{"__proto__":{"x":1},"constructor":"c","prototype":2}');
  assert.notEqual(fp(value), fp({ constructor: "c", prototype: 2 }));
  assert.equal(JSON.stringify(canonicalize(value)), canonicalizeOperationValue(value));
  assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, "x"), false);
});

test("C4 plain null-prototype objects and envelopes are accepted", () => {
  const value = Object.assign(Object.create(null), { x: 1 });
  assert.equal(fp(value), fp({ x: 1 }));
  assert.equal(fingerprintOperation(Object.assign(Object.create(null), input(value))), fp({ x: 1 }));
});

test("C4 custom instances Maps Sets boxed values and unsupported views are refused", () => {
  class Model { x = 1; }
  for (const value of [new Model(), new Map(), new Set(), /x/, new Number(1), new String("x"),
    new ArrayBuffer(1), new Uint16Array([1]), new DataView(new ArrayBuffer(1)), Object.create({ x: 1 })]) malformed(value);
});

test("C4 sparse arrays extra fields symbols and nonenumerable indexes are refused", () => {
  const extra = [1]; Object.defineProperty(extra, "extra", { value: true });
  const symbol = [1]; Object.defineProperty(symbol, Symbol("extra"), { value: true });
  const hidden = [1]; Object.defineProperty(hidden, "0", { value: 1, enumerable: false });
  for (const value of [new Array(1), [1, , 3], extra, symbol, hidden]) malformed(value);
});

test("C4 array index getters and subclass hooks are rejected without invocation", () => {
  let reads = 0;
  const value = [1]; Object.defineProperty(value, "0", { enumerable: true, get() { reads++; return 1; } });
  class OtherArray extends Array<number> { map(): never { reads++; throw new Error("private"); } }
  malformed(value); malformed(new OtherArray(1));
  assert.equal(reads, 0);
});

test("C4 cycles in objects arrays and mixed graphs fail with a bounded input error", () => {
  const object: Record<string, unknown> = {}; object.self = object;
  const array: unknown[] = []; array.push(array);
  const mixed: unknown[] = []; mixed.push({ parent: mixed });
  for (const value of [object, array, mixed]) malformed(value);
});

test("C4 repeated acyclic references remain legal and equivalent to copied data", () => {
  const shared = { x: [1, 2] };
  assert.equal(fp([shared, shared]), fp([{ x: [1, 2] }, { x: [1, 2] }]));
});

test("C4 transparent hostile and revoked proxies are refused without reflection traps", () => {
  let traps = 0;
  const hostile = new Proxy({}, {
    getPrototypeOf() { traps++; throw new Error("private"); },
    ownKeys() { traps++; throw new Error("private"); },
    get() { traps++; throw new Error("private"); },
  });
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  for (const value of [new Proxy({}, {}), hostile, revoked.proxy]) malformed(value);
  refused(() => fingerprintOperation(new Proxy(input(1), {})));
  assert.equal(traps, 0);
});

test("C4 serialization and coercion hooks on inputs are never invoked", () => {
  let calls = 0;
  const value = { toJSON() { calls++; return 1; }, valueOf() { calls++; return 1; } };
  malformed(value);
  assert.equal(calls, 0);
});

test("C4 invalid decorated and subclassed Date instances are refused", () => {
  let calls = 0;
  const decorated = new Date(); decorated.toISOString = () => { calls++; return "private"; };
  class OtherDate extends Date { getTime(): number { calls++; return 0; } }
  for (const value of [new Date(NaN), decorated, new OtherDate(), Object.create(Date.prototype)]) malformed(value);
  assert.equal(calls, 0);
});

test("C4 decorated typed arrays shared storage detached views and byte subclasses are refused", () => {
  const decorated = new Uint8Array([1]); Object.defineProperty(decorated, "note", { value: "x" });
  const shared = new Uint8Array(new SharedArrayBuffer(4));
  const buffer = new ArrayBuffer(2), detached = new Uint8Array(buffer);
  structuredClone(buffer, { transfer: [buffer] });
  class OtherBytes extends Uint8Array {}
  for (const value of [decorated, shared, detached, new OtherBytes([1])]) malformed(value);
});

test("C4 unsupported primitives and nonfinite numbers are refused at every nesting level", () => {
  for (const value of [undefined, () => 1, Symbol("x"), NaN, Infinity, -Infinity]) {
    malformed(value); malformed({ value }); malformed([value]);
  }
});

test("C4 canonicalize preserves caller active-set membership on success and failure", () => {
  const sentinel = {}, value = { x: 1 }, seen = new WeakSet<object>([sentinel]);
  canonicalize(value, seen);
  assert.equal(seen.has(sentinel), true); assert.equal(seen.has(value), false);
  const bad = { x: undefined }; refused(() => canonicalize(bad, seen));
  assert.equal(seen.has(sentinel), true); assert.equal(seen.has(bad), false);
  seen.add(value); refused(() => canonicalize(value, seen)); assert.equal(seen.has(value), true);
});

test("C4 malformed active sets are refused without executing custom methods", () => {
  let calls = 0;
  const decorated = new WeakSet<object>(); decorated.has = () => { calls++; return false; };
  for (const value of [null, {}, new Set(), new Proxy(new WeakSet(), {}), decorated]) {
    refused(() => canonicalize({}, value as WeakSet<object>));
  }
  assert.equal(calls, 0);
});

test("C4 depth and node count have explicit admission limits", () => {
  let value: unknown = 1;
  for (let i = 0; i < 48; i++) value = [value];
  assert.match(fp(value), /^[0-9a-f]{64}$/);
  malformed([value]);
  assert.match(fp(Array(9_999).fill(null)), /^[0-9a-f]{64}$/);
  malformed(Array(10_000).fill(null));
});

test("C4 aggregate text keys and bigint digits are bounded", () => {
  assert.match(fp("x".repeat(1_048_576)), /^[0-9a-f]{64}$/);
  malformed("x".repeat(1_048_577));
  malformed({ ["x".repeat(1_048_577)]: 1 });
  malformed(["x".repeat(524_289), "y".repeat(524_289)]);
  assert.match(fp(10n ** 1_000n), /^[0-9a-f]{64}$/);
});

test("C4 byte quota is cumulative and bounded before copying oversized buffers", () => {
  assert.match(fp(new Uint8Array(65_536)), /^[0-9a-f]{64}$/);
  malformed(new Uint8Array(65_537));
  malformed([new Uint8Array(32_769), new Uint8Array(32_768)]);
});

test("C4 calls do not mutate freeze or retain the caller input", () => {
  const bytes = new Uint8Array([1]), date = new Date(0), value = { bytes, date, nested: [1] };
  const before = structuredClone(value), first = fp(value), canonical = canonicalize(value);
  assert.deepEqual(value, before); assert.equal(Object.isFrozen(value), false);
  bytes[0] = 2; date.setTime(1); value.nested.push(2);
  assert.notEqual(fp(value), first);
  assert.equal(JSON.stringify(canonical), canonicalizeOperationValue(before));
});

test("C4 refusals never expose identities input values or reflection exception messages", () => {
  const secret = "PRIVATE_VALUE_NOT_FOR_LOGS";
  for (const value of [input(1, { runId: secret + "\n" }), { ...input(1), [secret]: true }]) {
    assert.throws(() => fingerprintOperation(value), (error: unknown) => {
      assert.ok(error instanceof ConfigurationError);
      assert.equal(error.message.includes(secret), false);
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});

test("C4 equal fingerprints supply neither an operation claim nor a replay result", () => {
  const a = fp({ work: "same" }), b = fp({ work: "same" });
  assert.equal(a, b); assert.equal(typeof a, "string");
  assert.equal(a.length, 64);
  assert.equal(Object.prototype.hasOwnProperty.call(a, "claimToken"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(a, "result"), false);
});

test("C4 source delegates codec and hashing and imports no database or execution component", () => {
  const file = "src/application/operation-fingerprint.ts";
  const content = readFileSync(resolve(process.cwd(), file), "utf8");
  const ast = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
  const imports: string[] = [], calls = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) calls.add(node.expression.text);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.deepEqual(imports.sort(), ["../domain/errors", "../v2/kernel/operationIdentity", "node:util"].sort());
  assert.ok(calls.has("canonicalizeOperationValue")); assert.ok(calls.has("fingerprintOperationIdentity"));
  assert.equal(calls.has("createHash"), false); assert.equal(calls.has("require"), false);
});
