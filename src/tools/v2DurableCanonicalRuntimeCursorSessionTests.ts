import assert from "node:assert/strict";
import test from "node:test";

import {
  V2_CANONICAL_RUNTIME_CHECKPOINT_SCHEMA,
  type CanonicalRuntimeCheckpoint,
  type CanonicalRuntimeCheckpointCasResult,
  type CanonicalRuntimeCheckpointCreateResult,
  type CanonicalRuntimeCursorStore,
} from "../v2/persistence/canonicalRuntimeCursorStore";

import {
  DurableCanonicalRuntimeCursorSession,
} from "../v2/persistence/durableCanonicalRuntimeCursorSession";

import {
  InMemoryCanonicalRuntimeCursorStore,
} from "../v2/persistence/inMemoryCanonicalRuntimeCursorStore";

import {
  advanceCanonicalRuntimeCursor,
  createCanonicalRuntimeCursor,
  type CanonicalRuntimeCursor,
} from "../v2/runtime/canonicalRuntimeStepper";

function initialCheckpoint(
  missionId = "mission-session",
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
      `Fixture cursor transition refused: ${result.reasonCode}`,
    );
  }

  return result.cursor;
}

function sameNodeCheckpoint(
  current: CanonicalRuntimeCheckpoint,
  checkpointVersion =
    current.checkpointVersion + 1,
  savedAt =
    current.savedAt + 1,
): CanonicalRuntimeCheckpoint {
  return {
    ...current,
    checkpointVersion,
    savedAt,
  };
}

function adjacentCheckpoint(
  current: CanonicalRuntimeCheckpoint,
  checkpointVersion =
    current.checkpointVersion + 1,
  savedAt =
    current.savedAt + 1,
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
  "10E6 durable cursor session rejects an empty mission id",
  () => {
    assert.throws(
      () =>
        new DurableCanonicalRuntimeCursorSession(
          new InMemoryCanonicalRuntimeCursorStore(),
          "   ",
        ),
      /DURABLE_CANONICAL_RUNTIME_CURSOR_SESSION_MISSION_ID_EMPTY/,
    );
  },
);

test(
  "10E6 durable cursor session creates the initial checkpoint and becomes active",
  async () => {
    const store =
      new InMemoryCanonicalRuntimeCursorStore();

    const session =
      new DurableCanonicalRuntimeCursorSession(
        store,
        "mission-create",
      );

    const checkpoint =
      initialCheckpoint(
        "mission-create",
      );

    const result =
      await session.createInitial(
        checkpoint,
      );

    assert.equal(
      result.ok,
      true,
    );

    if (!result.ok) {
      return;
    }

    assert.equal(
      result.status,
      "CREATED",
    );

    assert.deepEqual(
      result.checkpoint,
      checkpoint,
    );

    assert.equal(
      session.isActive(),
      true,
    );

    assert.equal(
      session.isFailedClosed(),
      false,
    );
  },
);

test(
  "10E6 durable cursor session returns detached snapshots",
  async () => {
    const store =
      new InMemoryCanonicalRuntimeCursorStore();

    const session =
      new DurableCanonicalRuntimeCursorSession(
        store,
        "mission-snapshot",
      );

    const checkpoint =
      initialCheckpoint(
        "mission-snapshot",
      );

    await session.createInitial(
      checkpoint,
    );

    const first =
      session.getSnapshot();

    assert.ok(first);

    (
      first as {
        savedAt: number;
      }
    ).savedAt = 999999;

    (
      first.cursor as {
        missionId: string;
      }
    ).missionId = "tampered";

    const second =
      session.getSnapshot();

    assert.deepEqual(
      second,
      checkpoint,
    );

    assert.notEqual(
      first,
      second,
    );

    assert.notEqual(
      first.cursor,
      second?.cursor,
    );
  },
);

test(
  "10E6 durable cursor session rejects mission identity mismatch and locks permanently",
  async () => {
    const session =
      new DurableCanonicalRuntimeCursorSession(
        new InMemoryCanonicalRuntimeCursorStore(),
        "mission-a",
      );

    const first =
      await session.createInitial(
        initialCheckpoint(
          "mission-b",
        ),
      );

    assert.equal(
      first.ok,
      false,
    );

    if (first.ok) {
      return;
    }

    assert.equal(
      first.reasonCode,
      "mission-id-mismatch",
    );

    assert.equal(
      first.lockedByReasonCode,
      "mission-id-mismatch",
    );

    assert.equal(
      session.isFailedClosed(),
      true,
    );

    const second =
      await session.createInitial(
        initialCheckpoint(
          "mission-a",
        ),
      );

    assert.equal(
      second.ok,
      false,
    );

    if (!second.ok) {
      assert.equal(
        second.reasonCode,
        "session-failed-closed",
      );

      assert.equal(
        second.lockedByReasonCode,
        "mission-id-mismatch",
      );
    }
  },
);

test(
  "10E6 durable cursor session refuses duplicate durable creation",
  async () => {
    const store =
      new InMemoryCanonicalRuntimeCursorStore();

    const checkpoint =
      initialCheckpoint(
        "mission-duplicate",
      );

    const first =
      new DurableCanonicalRuntimeCursorSession(
        store,
        checkpoint.missionId,
      );

    assert.equal(
      (
        await first.createInitial(
          checkpoint,
        )
      ).ok,
      true,
    );

    const duplicate =
      new DurableCanonicalRuntimeCursorSession(
        store,
        checkpoint.missionId,
      );

    const result =
      await duplicate.createInitial(
        checkpoint,
      );

    assert.equal(
      result.ok,
      false,
    );

    if (!result.ok) {
      assert.equal(
        result.reasonCode,
        "checkpoint-already-exists",
      );

      assert.equal(
        result.lockedByReasonCode,
        "checkpoint-already-exists",
      );
    }

    assert.equal(
      duplicate.isFailedClosed(),
      true,
    );
  },
);

test(
  "10E6 durable cursor session explicitly resumes persisted state after restart",
  async () => {
    const store =
      new InMemoryCanonicalRuntimeCursorStore();

    const checkpoint =
      initialCheckpoint(
        "mission-resume",
      );

    const writer =
      new DurableCanonicalRuntimeCursorSession(
        store,
        checkpoint.missionId,
      );

    await writer.createInitial(
      checkpoint,
    );

    const restarted =
      new DurableCanonicalRuntimeCursorSession(
        store,
        checkpoint.missionId,
      );

    const result =
      await restarted.resume();

    assert.equal(
      result.ok,
      true,
    );

    if (!result.ok) {
      return;
    }

    assert.equal(
      result.status,
      "RESUMED",
    );

    assert.deepEqual(
      result.checkpoint,
      checkpoint,
    );

    assert.equal(
      restarted.isActive(),
      true,
    );
  },
);

test(
  "10E6 durable cursor session never converts a missing resume into a new mission",
  async () => {
    const session =
      new DurableCanonicalRuntimeCursorSession(
        new InMemoryCanonicalRuntimeCursorStore(),
        "mission-missing",
      );

    const result =
      await session.resume();

    assert.equal(
      result.ok,
      false,
    );

    if (!result.ok) {
      assert.equal(
        result.reasonCode,
        "checkpoint-not-found",
      );

      assert.equal(
        result.lockedByReasonCode,
        "checkpoint-not-found",
      );
    }

    assert.equal(
      session.getSnapshot(),
      null,
    );

    assert.equal(
      session.isFailedClosed(),
      true,
    );
  },
);

test(
  "10E6 durable cursor session cannot advance before create or resume",
  async () => {
    const session =
      new DurableCanonicalRuntimeCursorSession(
        new InMemoryCanonicalRuntimeCursorStore(),
        "mission-not-active",
      );

    const result =
      await session.advance(
        sameNodeCheckpoint(
          initialCheckpoint(
            "mission-not-active",
          ),
        ),
      );

    assert.equal(
      result.ok,
      false,
    );

    if (!result.ok) {
      assert.equal(
        result.reasonCode,
        "session-not-active",
      );

      assert.equal(
        result.lockedByReasonCode,
        "session-not-active",
      );
    }

    assert.equal(
      session.isFailedClosed(),
      true,
    );
  },
);

test(
  "10E6 durable cursor session persists a same-node checkpoint through CAS",
  async () => {
    const store =
      new InMemoryCanonicalRuntimeCursorStore();

    const checkpoint =
      initialCheckpoint(
        "mission-same-node",
      );

    const session =
      new DurableCanonicalRuntimeCursorSession(
        store,
        checkpoint.missionId,
      );

    await session.createInitial(
      checkpoint,
    );

    const next =
      sameNodeCheckpoint(
        checkpoint,
      );

    const result =
      await session.advance(
        next,
      );

    assert.equal(
      result.ok,
      true,
    );

    if (!result.ok) {
      return;
    }

    assert.equal(
      result.status,
      "UPDATED",
    );

    assert.deepEqual(
      result.checkpoint,
      next,
    );

    assert.equal(
      result.checkpoint.cursor.nodeId,
      "EER",
    );

    assert.equal(
      result.checkpoint.cursor.stepVersion,
      1,
    );
  },
);

test(
  "10E6 durable cursor session persists one adjacent canonical transition",
  async () => {
    const store =
      new InMemoryCanonicalRuntimeCursorStore();

    const checkpoint =
      initialCheckpoint(
        "mission-adjacent",
      );

    const session =
      new DurableCanonicalRuntimeCursorSession(
        store,
        checkpoint.missionId,
      );

    await session.createInitial(
      checkpoint,
    );

    const next =
      adjacentCheckpoint(
        checkpoint,
      );

    const result =
      await session.advance(
        next,
      );

    assert.equal(
      result.ok,
      true,
    );

    if (!result.ok) {
      return;
    }

    assert.equal(
      result.checkpoint.cursor.nodeId,
      "LOOP_AFTER_EER",
    );

    assert.equal(
      result.checkpoint.cursor.stepVersion,
      2,
    );
  },
);

test(
  "10E6 durable cursor session rejects non-next checkpoint revisions",
  async () => {
    const store =
      new InMemoryCanonicalRuntimeCursorStore();

    const checkpoint =
      initialCheckpoint(
        "mission-version",
      );

    const session =
      new DurableCanonicalRuntimeCursorSession(
        store,
        checkpoint.missionId,
      );

    await session.createInitial(
      checkpoint,
    );

    const result =
      await session.advance({
        ...checkpoint,
        checkpointVersion:
          3,
        savedAt:
          checkpoint.savedAt + 1,
      });

    assert.equal(
      result.ok,
      false,
    );

    if (!result.ok) {
      assert.equal(
        result.reasonCode,
        "checkpoint-version-not-next",
      );
    }

    assert.deepEqual(
      await store.load(
        checkpoint.missionId,
      ),
      checkpoint,
    );
  },
);

test(
  "10E6 durable cursor session rejects savedAt regression before CAS",
  async () => {
    const store =
      new InMemoryCanonicalRuntimeCursorStore();

    const checkpoint =
      initialCheckpoint(
        "mission-time",
        1000,
      );

    const session =
      new DurableCanonicalRuntimeCursorSession(
        store,
        checkpoint.missionId,
      );

    await session.createInitial(
      checkpoint,
    );

    const result =
      await session.advance(
        sameNodeCheckpoint(
          checkpoint,
          2,
          999,
        ),
      );

    assert.equal(
      result.ok,
      false,
    );

    if (!result.ok) {
      assert.equal(
        result.reasonCode,
        "checkpoint-saved-at-regression",
      );
    }

    assert.deepEqual(
      await store.load(
        checkpoint.missionId,
      ),
      checkpoint,
    );
  },
);

test(
  "10E6 durable cursor session rejects non-adjacent cursor persistence",
  async () => {
    const store =
      new InMemoryCanonicalRuntimeCursorStore();

    const initial =
      initialCheckpoint(
        "mission-skip",
      );

    const session =
      new DurableCanonicalRuntimeCursorSession(
        store,
        initial.missionId,
      );

    await session.createInitial(
      initial,
    );

    /*
     * First persist a legitimate same-node revision.
     *
     * checkpointVersion=2 / cursor.stepVersion=1 is valid and gives us
     * enough durable revision space to construct a structurally valid
     * checkpointVersion=3 carrying a cursor at stepVersion=3.
     */
    const sameNode =
      sameNodeCheckpoint(
        initial,
        2,
        1001,
      );

    const sameNodeResult =
      await session.advance(
        sameNode,
      );

    assert.equal(
      sameNodeResult.ok,
      true,
    );

    const first =
      nextCursor(
        initial.cursor,
      );

    const gateResult =
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
            verdict: {
              status:
                "PASS",
              nextAction:
                "NEXT",
              reasonCodes:
                ["ALL_GATE_CRITERIA_SATISFIED"],
              staleEvidenceRefs:
                [],
              missingEvidence:
                [],
              failedCriteria:
                [],
            },
          },
        },
      );

    if (!gateResult.ok) {
      assert.fail(
        `Fixture gate transition refused: ${gateResult.reasonCode}`,
      );
    }

    /*
     * This checkpoint is structurally valid:
     *
     * checkpointVersion=3
     * cursor.stepVersion=3
     *
     * but it illegally skips the persisted cursor from EER directly to PLAN.
     */
    const skipped: CanonicalRuntimeCheckpoint = {
      ...sameNode,
      checkpointVersion:
        3,
      cursor:
        gateResult.cursor,
      savedAt:
        1002,
    };

    const result =
      await session.advance(
        skipped,
      );

    assert.equal(
      result.ok,
      false,
    );

    if (!result.ok) {
      assert.equal(
        result.reasonCode,
        "cursor-transition-not-allowed",
      );

      assert.equal(
        result.lockedByReasonCode,
        "cursor-transition-not-allowed",
      );
    }

    assert.deepEqual(
      await store.load(
        initial.missionId,
      ),
      sameNode,
    );
  },
);
test(
  "10E6 two resumed writers produce one winner and one permanent stale-writer refusal",
  async () => {
    const store =
      new InMemoryCanonicalRuntimeCursorStore();

    const initial =
      initialCheckpoint(
        "mission-concurrency",
      );

    const creator =
      new DurableCanonicalRuntimeCursorSession(
        store,
        initial.missionId,
      );

    await creator.createInitial(
      initial,
    );

    const writerA =
      new DurableCanonicalRuntimeCursorSession(
        store,
        initial.missionId,
      );

    const writerB =
      new DurableCanonicalRuntimeCursorSession(
        store,
        initial.missionId,
      );

    assert.equal(
      (
        await writerA.resume()
      ).ok,
      true,
    );

    assert.equal(
      (
        await writerB.resume()
      ).ok,
      true,
    );

    const winner =
      sameNodeCheckpoint(
        initial,
        2,
        1001,
      );

    const loserAttempt =
      adjacentCheckpoint(
        initial,
        2,
        1002,
      );

    const winnerResult =
      await writerA.advance(
        winner,
      );

    assert.equal(
      winnerResult.ok,
      true,
    );

    const loserResult =
      await writerB.advance(
        loserAttempt,
      );

    assert.equal(
      loserResult.ok,
      false,
    );

    if (!loserResult.ok) {
      assert.equal(
        loserResult.reasonCode,
        "checkpoint-version-conflict",
      );

      assert.equal(
        loserResult.currentCheckpointVersion,
        2,
      );

      assert.equal(
        loserResult.lockedByReasonCode,
        "checkpoint-version-conflict",
      );
    }

    assert.equal(
      writerB.isFailedClosed(),
      true,
    );

    const retryOnSameSession =
      await writerB.resume();

    assert.equal(
      retryOnSameSession.ok,
      false,
    );

    if (!retryOnSameSession.ok) {
      assert.equal(
        retryOnSameSession.reasonCode,
        "session-failed-closed",
      );
    }

    assert.deepEqual(
      await store.load(
        initial.missionId,
      ),
      winner,
    );
  },
);

test(
  "10E6 stale-writer recovery requires a fresh session and explicit resume",
  async () => {
    const store =
      new InMemoryCanonicalRuntimeCursorStore();

    const initial =
      initialCheckpoint(
        "mission-restart-after-conflict",
      );

    const creator =
      new DurableCanonicalRuntimeCursorSession(
        store,
        initial.missionId,
      );

    await creator.createInitial(
      initial,
    );

    const stale =
      new DurableCanonicalRuntimeCursorSession(
        store,
        initial.missionId,
      );

    const winner =
      new DurableCanonicalRuntimeCursorSession(
        store,
        initial.missionId,
      );

    await stale.resume();
    await winner.resume();

    const persisted =
      sameNodeCheckpoint(
        initial,
        2,
        1001,
      );

    await winner.advance(
      persisted,
    );

    const conflict =
      await stale.advance(
        adjacentCheckpoint(
          initial,
          2,
          1002,
        ),
      );

    assert.equal(
      conflict.ok,
      false,
    );

    const restarted =
      new DurableCanonicalRuntimeCursorSession(
        store,
        initial.missionId,
      );

    const resumed =
      await restarted.resume();

    assert.equal(
      resumed.ok,
      true,
    );

    if (!resumed.ok) {
      return;
    }

    assert.deepEqual(
      resumed.checkpoint,
      persisted,
    );

    assert.equal(
      restarted.isActive(),
      true,
    );
  },
);

test(
  "10E6 durable cursor session maps store disappearance to permanent refusal",
  async () => {
    const initial =
      initialCheckpoint(
        "mission-disappeared",
      );

    const store:
      CanonicalRuntimeCursorStore = {
        create:
          async (): Promise<CanonicalRuntimeCheckpointCreateResult> =>
            "CREATED",

        load:
          async () =>
            structuredClone(
              initial,
            ),

        compareAndSet:
          async (): Promise<CanonicalRuntimeCheckpointCasResult> => ({
            status:
              "NOT_FOUND",
          }),
      };

    const session =
      new DurableCanonicalRuntimeCursorSession(
        store,
        initial.missionId,
      );

    await session.createInitial(
      initial,
    );

    const result =
      await session.advance(
        sameNodeCheckpoint(
          initial,
        ),
      );

    assert.equal(
      result.ok,
      false,
    );

    if (!result.ok) {
      assert.equal(
        result.reasonCode,
        "checkpoint-disappeared",
      );

      assert.equal(
        result.lockedByReasonCode,
        "checkpoint-disappeared",
      );
    }
  },
);

test(
  "10E6 durable cursor session fails closed on mismatched store update receipt",
  async () => {
    const initial =
      initialCheckpoint(
        "mission-receipt-mismatch",
      );

    const store:
      CanonicalRuntimeCursorStore = {
        create:
          async () =>
            "CREATED",

        load:
          async () =>
            structuredClone(
              initial,
            ),

        compareAndSet:
          async () => ({
            status:
              "UPDATED",
            checkpointVersion:
              999,
          }),
      };

    const session =
      new DurableCanonicalRuntimeCursorSession(
        store,
        initial.missionId,
      );

    await session.createInitial(
      initial,
    );

    const result =
      await session.advance(
        sameNodeCheckpoint(
          initial,
        ),
      );

    assert.equal(
      result.ok,
      false,
    );

    if (!result.ok) {
      assert.equal(
        result.reasonCode,
        "store-checkpoint-version-mismatch",
      );

      assert.equal(
        result.currentCheckpointVersion,
        999,
      );
    }
  },
);

test(
  "10E6 durable cursor session fails closed on storage exceptions",
  async () => {
    const initial =
      initialCheckpoint(
        "mission-storage-error",
      );

    const store:
      CanonicalRuntimeCursorStore = {
        create:
          async () =>
            "CREATED",

        load:
          async () =>
            structuredClone(
              initial,
            ),

        compareAndSet:
          async () => {
            throw new Error(
              "STORAGE_OFFLINE",
            );
          },
      };

    const session =
      new DurableCanonicalRuntimeCursorSession(
        store,
        initial.missionId,
      );

    await session.createInitial(
      initial,
    );

    const result =
      await session.advance(
        sameNodeCheckpoint(
          initial,
        ),
      );

    assert.equal(
      result.ok,
      false,
    );

    if (!result.ok) {
      assert.equal(
        result.reasonCode,
        "storage-operation-failed",
      );

      assert.equal(
        result.lockedByReasonCode,
        "storage-operation-failed",
      );
    }

    assert.equal(
      session.isFailedClosed(),
      true,
    );
  },
);

test(
  "10E6 resume refuses corrupted persisted cursor state",
  async () => {
    const valid =
      initialCheckpoint(
        "mission-corrupt",
      );

    const corrupted = {
      ...valid,
      cursor: {
        ...valid.cursor,
        nodeId:
          "PLAN",
      },
    } as unknown as CanonicalRuntimeCheckpoint;

    const store:
      CanonicalRuntimeCursorStore = {
        create:
          async () =>
            "CREATED",

        load:
          async () =>
            corrupted,

        compareAndSet:
          async () => ({
            status:
              "NOT_FOUND",
          }),
      };

    const session =
      new DurableCanonicalRuntimeCursorSession(
        store,
        valid.missionId,
      );

    const result =
      await session.resume();

    assert.equal(
      result.ok,
      false,
    );

    if (!result.ok) {
      assert.equal(
        result.reasonCode,
        "invalid-checkpoint:checkpoint-cursor-invalid",
      );

      assert.equal(
        result.lockedByReasonCode,
        "invalid-checkpoint:checkpoint-cursor-invalid",
      );
    }

    assert.equal(
      session.getSnapshot(),
      null,
    );
  },
);

test(
  "10E6 active durable cursor session cannot silently resume over its own state",
  async () => {
    const store =
      new InMemoryCanonicalRuntimeCursorStore();

    const initial =
      initialCheckpoint(
        "mission-double-resume",
      );

    const session =
      new DurableCanonicalRuntimeCursorSession(
        store,
        initial.missionId,
      );

    await session.createInitial(
      initial,
    );

    const result =
      await session.resume();

    assert.equal(
      result.ok,
      false,
    );

    if (!result.ok) {
      assert.equal(
        result.reasonCode,
        "session-already-active",
      );

      assert.equal(
        result.lockedByReasonCode,
        "session-already-active",
      );
    }

    assert.equal(
      session.isFailedClosed(),
      true,
    );
  },
);
