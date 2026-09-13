import test from "node:test";
import assert from "node:assert/strict";

import {
  NAMLA_OPERATION_IDENTITY_DOMAIN,
  NAMLA_OPERATION_IDENTITY_VERSION,
  canonicalizeOperationValue,
  fingerprintOperationIdentity,
} from "../v2/kernel/operationIdentity";

function fingerprint(
  value: unknown,
  overrides: Partial<{
    missionId: string;
    authorityScope: string;
    operationType: string;
  }> = {},
): string {
  return fingerprintOperationIdentity({
    missionId: overrides.missionId ?? "mission-001",
    authorityScope: overrides.authorityScope ?? "PRO/COLONY_A/task-7",
    operationType: overrides.operationType ?? "tool.filesystem.write",
    value,
  });
}

test("R1A deterministic across object key order", () => {
  const left = { z: 3, a: 1, nested: { y: 2, x: 1 } };
  const right = { nested: { x: 1, y: 2 }, a: 1, z: 3 };

  assert.equal(
    canonicalizeOperationValue(left),
    canonicalizeOperationValue(right),
  );
  assert.equal(fingerprint(left), fingerprint(right));
});

test("R1A preserves array order", () => {
  assert.notEqual(fingerprint(["a", "b"]), fingerprint(["b", "a"]));
});

test("R1A preserves primitive type identity", () => {
  assert.notEqual(fingerprint(1), fingerprint("1"));
  assert.notEqual(fingerprint(1n), fingerprint("1"));
  assert.notEqual(fingerprint(true), fingerprint("true"));
  assert.notEqual(fingerprint(null), fingerprint("null"));
});

test("R1A distinguishes negative zero from zero", () => {
  assert.notEqual(fingerprint(-0), fingerprint(0));
});

test("R1A Date identity is deterministic and type-preserving", () => {
  const iso = "2026-09-12T12:34:56.789Z";
  assert.equal(fingerprint(new Date(iso)), fingerprint(new Date(iso)));
  assert.notEqual(fingerprint(new Date(iso)), fingerprint(iso));
});

test("R1A byte identity is deterministic and type-preserving", () => {
  const bytes = new Uint8Array([0, 1, 2, 255]);
  assert.equal(
    fingerprint(bytes),
    fingerprint(new Uint8Array([0, 1, 2, 255])),
  );
  assert.notEqual(fingerprint(bytes), fingerprint([0, 1, 2, 255]));
});

test("R1A binds mission identity", () => {
  assert.notEqual(
    fingerprint({ x: 1 }, { missionId: "mission-a" }),
    fingerprint({ x: 1 }, { missionId: "mission-b" }),
  );
});

test("R1A binds authority scope", () => {
  assert.notEqual(
    fingerprint({ x: 1 }, { authorityScope: "PRO/COLONY_A/task-1" }),
    fingerprint({ x: 1 }, { authorityScope: "PRO/COLONY_B/task-1" }),
  );
});

test("R1A binds operation type", () => {
  assert.notEqual(
    fingerprint({ path: "a.txt" }, { operationType: "filesystem.read" }),
    fingerprint({ path: "a.txt" }, { operationType: "filesystem.write" }),
  );
});

test("R1A emits lowercase SHA-256", () => {
  assert.match(fingerprint({ stable: true }), /^[0-9a-f]{64}$/);
});

test("R1A fixes domain and schema version", () => {
  assert.equal(
    NAMLA_OPERATION_IDENTITY_DOMAIN,
    "NAMLA_V2_OPERATION_IDENTITY",
  );
  assert.equal(NAMLA_OPERATION_IDENTITY_VERSION, 1);
});

test("R1A rejects non-finite numbers fail closed", () => {
  assert.throws(() => fingerprint(Number.NaN));
  assert.throws(() => fingerprint(Number.POSITIVE_INFINITY));
  assert.throws(() => fingerprint(Number.NEGATIVE_INFINITY));
});

test("R1A rejects unsupported primitives fail closed", () => {
  assert.throws(() => fingerprint(undefined));
  assert.throws(() => fingerprint(Symbol("x")));
  assert.throws(() => fingerprint(() => 1));
});

test("R1A rejects object cycles fail closed", () => {
  const value: Record<string, unknown> = {};
  value.self = value;
  assert.throws(() => fingerprint(value), /Cyclic NAMLA operation input/);
});

test("R1A rejects array cycles fail closed", () => {
  const value: unknown[] = [];
  value.push(value);
  assert.throws(() => fingerprint(value), /Cyclic NAMLA operation input/);
});

test("R1A allows repeated shared references that are not cyclic", () => {
  const shared = { answer: 42 };
  assert.doesNotThrow(() => fingerprint({ left: shared, right: shared }));
});

test("R1A rejects accessors without invoking getters", () => {
  let getterCalls = 0;
  const value: Record<string, unknown> = {};

  Object.defineProperty(value, "secret", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "never";
    },
  });

  assert.throws(() => fingerprint(value), /Accessor property/);
  assert.equal(getterCalls, 0);
});

test("R1A rejects symbol-keyed state instead of dropping it", () => {
  const symbol = Symbol("hidden");
  const value: Record<PropertyKey, unknown> = { visible: 1 };
  value[symbol] = 2;

  assert.throws(() => fingerprint(value), /Symbol-keyed properties/);
});

test("R1A rejects non-plain object prototypes fail closed", () => {
  class CustomInput {
    value = 1;
  }

  assert.throws(() => fingerprint(new CustomInput()));
  assert.throws(() => fingerprint(new Map([["a", 1]])));
  assert.throws(() => fingerprint(new Set([1, 2])));
});

test("R1A rejects invalid Date values fail closed", () => {
  assert.throws(() => fingerprint(new Date(Number.NaN)), /Invalid Date/);
});

test("R1A enforces canonical depth bounds", () => {
  let value: unknown = "leaf";
  for (let index = 0; index < 70; index += 1) value = [value];

  assert.throws(() => fingerprint(value), /maximum canonical depth/);
});

test("R1A validates identity fields fail closed", () => {
  assert.throws(() =>
    fingerprintOperationIdentity({
      missionId: " ",
      authorityScope: "scope",
      operationType: "type",
      value: {},
    }),
  );

  assert.throws(() =>
    fingerprintOperationIdentity({
      missionId: "m",
      authorityScope: "scope",
      operationType: "x".repeat(513),
      value: {},
    }),
  );

  assert.throws(() =>
    fingerprintOperationIdentity({
      missionId: "m",
      authorityScope: "scope\u0000escape",
      operationType: "type",
      value: {},
    }),
  );
});