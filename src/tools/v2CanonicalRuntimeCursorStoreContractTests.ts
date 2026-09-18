import assert from "node:assert/strict";
import test from "node:test";

import {
  V2_CANONICAL_RUNTIME_CHECKPOINT_SCHEMA,
  validateCanonicalRuntimeCheckpoint,
  type CanonicalRuntimeCheckpoint,
  type CanonicalRuntimeCheckpointValidationReason,
} from "../v2/persistence/canonicalRuntimeCursorStore";

import {
  advanceCanonicalRuntimeCursor,
  createCanonicalRuntimeCursor,
  type CanonicalRuntimeCursorValidationReason,
} from "../v2/runtime/canonicalRuntimeStepper";

function checkpoint(): CanonicalRuntimeCheckpoint {
  return {
    schemaVersion: V2_CANONICAL_RUNTIME_CHECKPOINT_SCHEMA,
    missionId: "mission-10e6-contract",
    checkpointVersion: 1,
    cursor: createCanonicalRuntimeCursor("mission-10e6-contract"),
    savedAt: 1700000000000,
  };
}

/** Pure control-flow fixture, not a receipt from actual factory execution. */
function nextNodeCheckpoint(): CanonicalRuntimeCheckpoint {
  const initial = checkpoint();
  const result = advanceCanonicalRuntimeCursor(initial.cursor, {
    expectedStepVersion: initial.cursor.stepVersion,
    completion: { kind: "FACTORY_COMPLETED", factoryId: "EER" },
  });

  if (!result.ok) {
    assert.fail(`Fixture transition refused: ${result.reasonCode}`);
  }

  return { ...initial, checkpointVersion: 2, cursor: result.cursor };
}

function expectInvalid(
  value: unknown,
  reasonCode: CanonicalRuntimeCheckpointValidationReason,
  cursorReasonCode?: CanonicalRuntimeCursorValidationReason,
): void {
  const result = validateCanonicalRuntimeCheckpoint(value);
  assert.deepEqual(result, {
    ok: false,
    reasonCode,
    ...(cursorReasonCode === undefined ? {} : { cursorReasonCode }),
  });
  assert.equal(Object.isFrozen(result), true);
}

const INVALID_POSITIVE_INTEGERS: readonly unknown[] = [
  undefined, null, false, true, "1", {}, [],
  0, -1, 1.5, Number.NaN, Infinity, -Infinity,
  Number.MAX_SAFE_INTEGER + 1,
];

test("10E6 contract accepts the initial EER checkpoint", () => {
  const value = Object.freeze(checkpoint());
  const result = validateCanonicalRuntimeCheckpoint(value);
  assert.equal(value.cursor.nodeId, "EER");
  assert.deepEqual(result, { ok: true, reasonCode: "ok" });
  assert.equal(Object.isFrozen(result), true);
});

test("10E6 contract accepts a cursor advanced through the 10E5 stepper", () => {
  const value = nextNodeCheckpoint();
  assert.equal(value.cursor.nodeId, "LOOP_AFTER_EER");
  assert.equal(value.cursor.stepVersion, 2);
  assert.deepEqual(validateCanonicalRuntimeCheckpoint(value), {
    ok: true, reasonCode: "ok",
  });
});

test("10E6 contract permits checkpointVersion greater than cursor.stepVersion", () => {
  for (const value of [checkpoint(), nextNodeCheckpoint()]) {
    const laterRevision = { ...value, checkpointVersion: 7 };
    assert.equal(laterRevision.cursor, value.cursor);
    assert.deepEqual(validateCanonicalRuntimeCheckpoint(laterRevision), {
      ok: true, reasonCode: "ok",
    });
  }
});

test("10E6 checkpoint revision cannot precede cursor stepVersion", () => {
  expectInvalid(
    { ...nextNodeCheckpoint(), checkpointVersion: 1 },
    "checkpoint-version-before-cursor",
  );
});

test("10E6 contract rejects non-object and incomplete envelopes", () => {
  for (const value of [null, undefined, false, 1, "{}", [], {}, new Date(0)]) {
    expectInvalid(value, "checkpoint-shape-invalid");
  }
});

test("10E6 contract requires every checkpoint field", () => {
  const value = checkpoint();
  for (const field of Object.keys(value)) {
    const missing = Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== field),
    );
    expectInvalid(missing, "checkpoint-shape-invalid");
  }
});

test("10E6 contract rejects extra, symbol and non-enumerable envelope fields", () => {
  expectInvalid({ ...checkpoint(), extra: true }, "checkpoint-shape-invalid");
  expectInvalid(
    { ...checkpoint(), [Symbol("extra")]: true },
    "checkpoint-shape-invalid",
  );
  const hidden = checkpoint();
  Object.defineProperty(hidden, "savedAt", { enumerable: false });
  expectInvalid(hidden, "checkpoint-shape-invalid");
});

test("10E6 contract rejects legacy and unknown schema versions", () => {
  for (const schemaVersion of [
    "namla-v2-mission-checkpoint-v1", "unknown", "", null, 1,
  ]) {
    expectInvalid(
      { ...checkpoint(), schemaVersion },
      "checkpoint-schema-invalid",
    );
  }
});

test("10E6 contract rejects invalid mission identifiers", () => {
  for (const missionId of [undefined, null, "", " \t\n", 1, false, {}, []]) {
    expectInvalid(
      { ...checkpoint(), missionId },
      "checkpoint-mission-id-invalid",
    );
  }
});

test("10E6 contract rejects checkpoint/cursor mission mismatch", () => {
  expectInvalid(
    { ...checkpoint(), cursor: createCanonicalRuntimeCursor("other-mission") },
    "checkpoint-cursor-mission-id-mismatch",
  );
});

test("10E6 contract rejects invalid checkpoint revisions without coercion", () => {
  for (const checkpointVersion of INVALID_POSITIVE_INTEGERS) {
    expectInvalid(
      { ...checkpoint(), checkpointVersion },
      "checkpoint-version-invalid",
    );
  }
});

test("10E6 contract rejects invalid savedAt values without coercion", () => {
  for (const savedAt of INVALID_POSITIVE_INTEGERS) {
    expectInvalid(
      { ...checkpoint(), savedAt },
      "checkpoint-saved-at-invalid",
    );
  }
});

test("10E6 contract requires the exact cursor field set", () => {
  const value = checkpoint();
  for (const cursor of [
    undefined, null, [], {}, "cursor", { ...value.cursor, extra: 1 },
  ]) {
    expectInvalid({ ...value, cursor }, "checkpoint-cursor-invalid");
  }
  for (const field of Object.keys(value.cursor)) {
    const cursor = Object.fromEntries(
      Object.entries(value.cursor).filter(([key]) => key !== field),
    );
    expectInvalid({ ...value, cursor }, "checkpoint-cursor-invalid");
  }
});

test("10E6 contract retains the precise 10E5 cursor validation reason", () => {
  const value = checkpoint();
  const cases: readonly [object, CanonicalRuntimeCursorValidationReason][] = [
    [{ schemaVersion: "unknown" }, "cursor-schema-invalid"],
    [{ missionId: "" }, "cursor-mission-id-invalid"],
    [{ nodeIndex: -1 }, "cursor-node-index-invalid"],
    [{ nodeIndex: Number.MAX_SAFE_INTEGER }, "cursor-node-out-of-range"],
    [{ nodeId: "PLAN" }, "cursor-node-id-mismatch"],
    [{ nodeKind: "GATE" }, "cursor-node-kind-mismatch"],
    [{ stepVersion: 0 }, "cursor-step-version-invalid"],
    [{ stepVersion: 2 }, "cursor-step-version-mismatch"],
    [{ contractPhase: "unknown" }, "cursor-contract-phase-invalid"],
    [{ contractPhase: "CONTRACT_BOUND" }, "cursor-contract-phase-mismatch"],
  ];
  for (const [change, reason] of cases) {
    expectInvalid(
      { ...value, cursor: { ...value.cursor, ...change } },
      "checkpoint-cursor-invalid",
      reason,
    );
  }
});

test("10E6 contract rejects accessors without invoking their getters", () => {
  for (const level of ["checkpoint", "cursor"] as const) {
    const fields = Object.keys(
      level === "checkpoint" ? checkpoint() : checkpoint().cursor,
    );

    for (const field of fields) {
      const value = { ...checkpoint(), cursor: { ...checkpoint().cursor } };
      const target = level === "checkpoint" ? value : value.cursor;
      let reads = 0;

      Object.defineProperty(target, field, {
        enumerable: true,
        configurable: true,
        get() {
          reads += 1;
          throw new Error("GETTER_MUST_NOT_RUN");
        },
      });

      expectInvalid(
        value,
        level === "checkpoint"
          ? "checkpoint-shape-invalid"
          : "checkpoint-cursor-invalid",
      );
      assert.equal(reads, 0);
    }
  }
});

test("10E6 contract accepts exact data records with null prototypes", () => {
  const initial = checkpoint();
  const value: unknown = Object.assign(Object.create(null), initial, {
    cursor: Object.assign(Object.create(null), initial.cursor),
  });
  assert.deepEqual(validateCanonicalRuntimeCheckpoint(value), {
    ok: true, reasonCode: "ok",
  });
});

test("10E6 contract rejects custom prototypes at both levels", () => {
  const initial = checkpoint();
  expectInvalid(
    Object.assign(Object.create({ inherited: true }), initial),
    "checkpoint-shape-invalid",
  );
  expectInvalid(
    {
      ...initial,
      cursor: Object.assign(Object.create({ inherited: true }), initial.cursor),
    },
    "checkpoint-cursor-invalid",
  );
});

test("10E6 contract converts reflection exceptions into validation failure", () => {
  const throwing = new Proxy({}, {
    ownKeys() {
      throw new Error("REFLECTION_FAILURE");
    },
  });

  expectInvalid(throwing, "checkpoint-validation-failed");
  expectInvalid(
    { ...checkpoint(), cursor: throwing },
    "checkpoint-validation-failed",
  );

  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  expectInvalid(revoked.proxy, "checkpoint-validation-failed");
});

test("10E6 validation does not mutate or freeze caller-owned data", () => {
  const value = { ...checkpoint(), cursor: { ...checkpoint().cursor } };
  const before = JSON.stringify(value);
  assert.equal(validateCanonicalRuntimeCheckpoint(value).ok, true);
  assert.equal(JSON.stringify(value), before);
  assert.equal(Object.isFrozen(value), false);
  assert.equal(Object.isFrozen(value.cursor), false);
});

test("10E6 contract accepts a JSON-round-tripped envelope", () => {
  const original = nextNodeCheckpoint();
  const decoded: unknown = JSON.parse(JSON.stringify(original));
  assert.notEqual(decoded, original);
  assert.deepEqual(decoded, original);
  assert.deepEqual(validateCanonicalRuntimeCheckpoint(decoded), {
    ok: true, reasonCode: "ok",
  });
});
