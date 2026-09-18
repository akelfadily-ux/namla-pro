import assert from "node:assert/strict";
import test from "node:test";

import {
  V2_CANONICAL_RUNTIME_CHECKPOINT_SCHEMA,
  type CanonicalRuntimeCheckpoint,
} from "../v2/persistence/canonicalRuntimeCursorStore";

import {
  InMemoryCanonicalRuntimeCursorStore,
} from "../v2/persistence/inMemoryCanonicalRuntimeCursorStore";

import {
  advanceCanonicalRuntimeCursor,
  createCanonicalRuntimeCursor,
  type CanonicalRuntimeCursor,
} from "../v2/runtime/canonicalRuntimeStepper";

function initialCheckpoint(
  missionId = "mission-in-memory",
  savedAt = 1000,
): CanonicalRuntimeCheckpoint {
  return {
    schemaVersion:
      V2_CANONICAL_RUNTIME_CHECKPOINT_SCHEMA,
    missionId,
    checkpointVersion: 1,
    cursor:
      createCanonicalRuntimeCursor(
        missionId,
      ),
    savedAt,
  };
}

/**
 * Test-only control-flow transition fixture.
 *
 * This is not evidence that EER actually executed; it exercises only the
 * canonical cursor transition rules already established by 10E5.
 */
function nextCursor(
  cursor: CanonicalRuntimeCursor,
): CanonicalRuntimeCursor {
  const result =
    advanceCanonicalRuntimeCursor(
      cursor,
      {
        expectedStepVersion:
          cursor.stepVersion,
        completion: {
          kind:
            "FACTORY_COMPLETED",
          factoryId:
            "EER",
        },
      },
    );

  if (!result.ok) {
    assert.fail(
      `Fixture cursor advance refused: ${result.reasonCode}`,
    );
  }

  return result.cursor;
}

function sameNodeCheckpoint(
  current: CanonicalRuntimeCheckpoint,
  checkpointVersion:
    number,
  savedAt:
    number,
): CanonicalRuntimeCheckpoint {
  return {
    ...current,
    checkpointVersion,
    savedAt,
  };
}

function adjacentCheckpoint(
  current: CanonicalRuntimeCheckpoint,
  checkpointVersion:
    number,
  savedAt:
    number,
): CanonicalRuntimeCheckpoint {
  return {
    ...current,
    checkpointVersion,
    cursor:
      nextCursor(
        current.cursor,
      ),
    savedAt,
  };
}

test(
  "10E6 in-memory store creates and loads the initial canonical checkpoint",
  async () => {
    const store =
      new InMemoryCanonicalRuntimeCursorStore();

    const checkpoint =
      initialCheckpoint();

    assert.equal(
      await store.create(
        checkpoint,
      ),
      "CREATED",
    );

    assert.deepEqual(
      await store.load(
        checkpoint.missionId,
      ),
      checkpoint,
    );
  },
);

test(
  "10E6 in-memory create is insert-only and duplicate creation never overwrites",
  async () => {
    const store =
      new InMemoryCanonicalRuntimeCursorStore();

    const original =
      initialCheckpoint(
        "mission-duplicate",
        1000,
      );

    assert.equal(
      await store.create(
        original,
      ),
      "CREATED",
    );

    const duplicate = {
      ...original,
      savedAt:
        2000,
    };

    assert.equal(
      await store.create(
        duplicate,
      ),
      "ALREADY_EXISTS",
    );

    assert.deepEqual(
      await store.load(
        original.missionId,
      ),
      original,
    );
  },
);

test(
  "10E6 in-memory store detaches caller input on create",
  async () => {
    const store =
      new InMemoryCanonicalRuntimeCursorStore();

    const input =
      structuredClone(
        initialCheckpoint(
          "mission-create-detach",
        ),
      );

    const expected =
      structuredClone(input);

    const pending =
      store.create(input);

    (
      input as {
        savedAt: number;
      }
    ).savedAt = 999999;

    (
      input.cursor as {
        missionId: string;
      }
    ).missionId = "mutated";

    assert.equal(
      await pending,
      "CREATED",
    );

    assert.deepEqual(
      await store.load(
        expected.missionId,
      ),
      expected,
    );
  },
);

test(
  "10E6 in-memory load returns detached snapshots",
  async () => {
    const store =
      new InMemoryCanonicalRuntimeCursorStore();

    const checkpoint =
      initialCheckpoint(
        "mission-load-detach",
      );

    await store.create(
      checkpoint,
    );

    const first =
      await store.load(
        checkpoint.missionId,
      );

    assert.ok(first);

    (
      first as {
        savedAt: number;
      }
    ).savedAt = 777777;

    (
      first.cursor as {
        missionId: string;
      }
    ).missionId = "tampered";

    const second =
      await store.load(
        checkpoint.missionId,
      );

    assert.deepEqual(
      second,
      checkpoint,
    );

    assert.notEqual(
      second,
      first,
    );

    assert.notEqual(
      second?.cursor,
      first.cursor,
    );
  },
);

test(
  "10E6 in-memory load returns null for an unknown mission",
  async () => {
    const store =
      new InMemoryCanonicalRuntimeCursorStore();

    assert.equal(
      await store.load(
        "mission-absent",
      ),
      null,
    );
  },
);

test(
  "10E6 in-memory load rejects an empty mission id",
  async () => {
    const store =
      new InMemoryCanonicalRuntimeCursorStore();

    await assert.rejects(
      store.load("   "),
      /CANONICAL_RUNTIME_MISSION_ID_EMPTY/,
    );
  },
);

test(
  "10E6 in-memory create requires checkpointVersion one",
  async () => {
    const store =
      new InMemoryCanonicalRuntimeCursorStore();

    await assert.rejects(
      store.create({
        ...initialCheckpoint(
          "mission-initial-version",
        ),
        checkpointVersion:
          2,
      }),
      /CANONICAL_RUNTIME_INITIAL_CHECKPOINT_VERSION_MUST_BE_1/,
    );
  },
);

test(
  "10E6 in-memory create requires the canonical initial EER cursor",
  async () => {
    const store =
      new InMemoryCanonicalRuntimeCursorStore();

    const initial =
      initialCheckpoint(
        "mission-initial-cursor",
      );

    const advanced =
      nextCursor(
        initial.cursor,
      );

    await assert.rejects(
      store.create({
        ...initial,
        checkpointVersion:
          advanced.stepVersion,
        cursor:
          advanced,
      }),
      /CANONICAL_RUNTIME_INITIAL_CHECKPOINT_VERSION_MUST_BE_1|CANONICAL_RUNTIME_INITIAL_CURSOR_INVALID/,
    );
  },
);

test(
  "10E6 in-memory CAS permits a durable same-node checkpoint without claiming progress",
  async () => {
    const store =
      new InMemoryCanonicalRuntimeCursorStore();

    const initial =
      initialCheckpoint(
        "mission-same-node",
        1000,
      );

    await store.create(
      initial,
    );

    const next =
      sameNodeCheckpoint(
        initial,
        2,
        1001,
      );

    assert.deepEqual(
      await store.compareAndSet(
        initial.missionId,
        1,
        next,
      ),
      {
        status:
          "UPDATED",
        checkpointVersion:
          2,
      },
    );

    const persisted =
      await store.load(
        initial.missionId,
      );

    assert.deepEqual(
      persisted,
      next,
    );

    assert.equal(
      persisted?.cursor.nodeId,
      "EER",
    );

    assert.equal(
      persisted?.cursor.stepVersion,
      1,
    );
  },
);

test(
  "10E6 in-memory CAS permits exactly one adjacent canonical cursor transition",
  async () => {
    const store =
      new InMemoryCanonicalRuntimeCursorStore();

    const initial =
      initialCheckpoint(
        "mission-adjacent",
        1000,
      );

    await store.create(
      initial,
    );

    const next =
      adjacentCheckpoint(
        initial,
        2,
        1001,
      );

    assert.deepEqual(
      await store.compareAndSet(
        initial.missionId,
        1,
        next,
      ),
      {
        status:
          "UPDATED",
        checkpointVersion:
          2,
      },
    );

    assert.equal(
      next.cursor.nodeId,
      "LOOP_AFTER_EER",
    );

    assert.deepEqual(
      await store.load(
        initial.missionId,
      ),
      next,
    );
  },
);

test(
  "10E6 in-memory CAS rejects stale writers without overwriting current state",
  async () => {
    const store =
      new InMemoryCanonicalRuntimeCursorStore();

    const initial =
      initialCheckpoint(
        "mission-stale-writer",
        1000,
      );

    await store.create(
      initial,
    );

    const winner =
      sameNodeCheckpoint(
        initial,
        2,
        1001,
      );

    assert.equal(
      (
        await store.compareAndSet(
          initial.missionId,
          1,
          winner,
        )
      ).status,
      "UPDATED",
    );

    const stale =
      adjacentCheckpoint(
        initial,
        2,
        2000,
      );

    assert.deepEqual(
      await store.compareAndSet(
        initial.missionId,
        1,
        stale,
      ),
      {
        status:
          "VERSION_CONFLICT",
        currentCheckpointVersion:
          2,
      },
    );

    assert.deepEqual(
      await store.load(
        initial.missionId,
      ),
      winner,
    );
  },
);

test(
  "10E6 in-memory CAS returns NOT_FOUND without creating a mission",
  async () => {
    const store =
      new InMemoryCanonicalRuntimeCursorStore();

    const checkpoint =
      sameNodeCheckpoint(
        initialCheckpoint(
          "mission-not-found",
        ),
        2,
        1001,
      );

    assert.deepEqual(
      await store.compareAndSet(
        checkpoint.missionId,
        1,
        checkpoint,
      ),
      {
        status:
          "NOT_FOUND",
      },
    );

    assert.equal(
      await store.load(
        checkpoint.missionId,
      ),
      null,
    );
  },
);

test(
  "10E6 in-memory CAS requires exact checkpointVersion plus one",
  async () => {
    const store =
      new InMemoryCanonicalRuntimeCursorStore();

    const initial =
      initialCheckpoint(
        "mission-checkpoint-version",
      );

    await store.create(
      initial,
    );

    await assert.rejects(
      store.compareAndSet(
        initial.missionId,
        1,
        {
          ...initial,
          checkpointVersion:
            3,
          savedAt:
            1001,
        },
      ),
      /NON_MONOTONIC_CANONICAL_RUNTIME_CHECKPOINT_VERSION/,
    );

    assert.deepEqual(
      await store.load(
        initial.missionId,
      ),
      initial,
    );
  },
);

test(
  "10E6 in-memory CAS rejects savedAt regression",
  async () => {
    const store =
      new InMemoryCanonicalRuntimeCursorStore();

    const initial =
      initialCheckpoint(
        "mission-saved-at",
        1000,
      );

    await store.create(
      initial,
    );

    await assert.rejects(
      store.compareAndSet(
        initial.missionId,
        1,
        sameNodeCheckpoint(
          initial,
          2,
          999,
        ),
      ),
      /CANONICAL_RUNTIME_CHECKPOINT_SAVED_AT_REGRESSION/,
    );

    assert.deepEqual(
      await store.load(
        initial.missionId,
      ),
      initial,
    );
  },
);

test(
  "10E6 in-memory CAS rejects mission identity mutation",
  async () => {
    const store =
      new InMemoryCanonicalRuntimeCursorStore();

    const initial =
      initialCheckpoint(
        "mission-identity-a",
      );

    await store.create(
      initial,
    );

    const other =
      initialCheckpoint(
        "mission-identity-b",
      );

    await assert.rejects(
      store.compareAndSet(
        initial.missionId,
        1,
        {
          ...other,
          checkpointVersion:
            2,
        },
      ),
      /CANONICAL_RUNTIME_CHECKPOINT_MISSION_ID_MISMATCH/,
    );
  },
);

test(
  "10E6 in-memory CAS rejects invalid expected versions before mutation",
  async () => {
    const store =
      new InMemoryCanonicalRuntimeCursorStore();

    const initial =
      initialCheckpoint(
        "mission-invalid-expected-version",
      );

    await store.create(
      initial,
    );

    for (
      const expectedVersion
      of [
        0,
        -1,
        1.5,
        Number.NaN,
        Infinity,
        Number.MAX_SAFE_INTEGER + 1,
      ]
    ) {
      await assert.rejects(
        store.compareAndSet(
          initial.missionId,
          expectedVersion,
          sameNodeCheckpoint(
            initial,
            2,
            1001,
          ),
        ),
        /INVALID_EXPECTED_CANONICAL_RUNTIME_CHECKPOINT_VERSION/,
      );
    }

    assert.deepEqual(
      await store.load(
        initial.missionId,
      ),
      initial,
    );
  },
);

test(
  "10E6 in-memory CAS rejects a canonical cursor skip",
  async () => {
    const store =
      new InMemoryCanonicalRuntimeCursorStore();

    const initial =
      initialCheckpoint(
        "mission-cursor-skip",
        1000,
      );

    await store.create(
      initial,
    );

    const first =
      nextCursor(
        initial.cursor,
      );

    const passVerdict = {
      status:
        "PASS" as const,
      nextAction:
        "NEXT" as const,
      reasonCodes:
        ["ALL_GATE_CRITERIA_SATISFIED"],
      staleEvidenceRefs:
        [],
      missingEvidence:
        [],
      failedCriteria:
        [],
    };

    const secondResult =
      advanceCanonicalRuntimeCursor(
        first,
        {
          expectedStepVersion:
            first.stepVersion,
          completion: {
            kind:
              "GATE_VERDICT",
            gateInstanceId:
              "LOOP_AFTER_EER",
            verdict:
              passVerdict,
          },
        },
      );

    if (!secondResult.ok) {
      assert.fail(
        `Fixture second cursor advance refused: ${secondResult.reasonCode}`,
      );
    }

    const skipped: CanonicalRuntimeCheckpoint = {
      ...initial,
      checkpointVersion:
        3,
      cursor:
        secondResult.cursor,
      savedAt:
        1002,
    };

    await assert.rejects(
      store.compareAndSet(
        initial.missionId,
        1,
        skipped,
      ),
      /NON_MONOTONIC_CANONICAL_RUNTIME_CHECKPOINT_VERSION|CANONICAL_RUNTIME_CURSOR_TRANSITION_NOT_ADJACENT/,
    );

    assert.deepEqual(
      await store.load(
        initial.missionId,
      ),
      initial,
    );
  },
);

test(
  "10E6 in-memory CAS rejects canonical cursor regression",
  async () => {
    const store =
      new InMemoryCanonicalRuntimeCursorStore();

    const initial =
      initialCheckpoint(
        "mission-cursor-regression",
        1000,
      );

    await store.create(
      initial,
    );

    const advanced =
      adjacentCheckpoint(
        initial,
        2,
        1001,
      );

    assert.equal(
      (
        await store.compareAndSet(
          initial.missionId,
          1,
          advanced,
        )
      ).status,
      "UPDATED",
    );

    const regressed: CanonicalRuntimeCheckpoint = {
      ...advanced,
      checkpointVersion:
        3,
      cursor:
        initial.cursor,
      savedAt:
        1002,
    };

    await assert.rejects(
      store.compareAndSet(
        initial.missionId,
        2,
        regressed,
      ),
      /CANONICAL_RUNTIME_CURSOR_TRANSITION_NOT_ADJACENT/,
    );

    assert.deepEqual(
      await store.load(
        initial.missionId,
      ),
      advanced,
    );
  },
);

test(
  "10E6 in-memory CAS detaches accepted checkpoint input",
  async () => {
    const store =
      new InMemoryCanonicalRuntimeCursorStore();

    const initial =
      initialCheckpoint(
        "mission-cas-detach",
        1000,
      );

    await store.create(
      initial,
    );

    const next =
      structuredClone(
        sameNodeCheckpoint(
          initial,
          2,
          1001,
        ),
      );

    const expected =
      structuredClone(next);

    const pending =
      store.compareAndSet(
        initial.missionId,
        1,
        next,
      );

    (
      next as {
        savedAt: number;
      }
    ).savedAt = 888888;

    (
      next.cursor as {
        missionId: string;
      }
    ).missionId = "mutated-after-call";

    assert.deepEqual(
      await pending,
      {
        status:
          "UPDATED",
        checkpointVersion:
          2,
      },
    );

    assert.deepEqual(
      await store.load(
        initial.missionId,
      ),
      expected,
    );
  },
);

test(
  "10E6 in-memory stores isolate independent missions",
  async () => {
    const store =
      new InMemoryCanonicalRuntimeCursorStore();

    const a =
      initialCheckpoint(
        "mission-a",
        1000,
      );

    const b =
      initialCheckpoint(
        "mission-b",
        2000,
      );

    assert.equal(
      await store.create(a),
      "CREATED",
    );

    assert.equal(
      await store.create(b),
      "CREATED",
    );

    const a2 =
      sameNodeCheckpoint(
        a,
        2,
        1001,
      );

    assert.equal(
      (
        await store.compareAndSet(
          a.missionId,
          1,
          a2,
        )
      ).status,
      "UPDATED",
    );

    assert.deepEqual(
      await store.load(
        a.missionId,
      ),
      a2,
    );

    assert.deepEqual(
      await store.load(
        b.missionId,
      ),
      b,
    );
  },
);
