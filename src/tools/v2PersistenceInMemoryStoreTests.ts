import test from "node:test";
import assert from "node:assert/strict";

import {
  MissionCheckpoint,
  V2_MISSION_CHECKPOINT_SCHEMA,
} from "../v2/persistence/missionCheckpointStore";

import {
  InMemoryMissionCheckpointStore,
} from "../v2/persistence/inMemoryMissionCheckpointStore";

function makeCheckpoint(
  stateVersion = 1,
): MissionCheckpoint {
  return {
    schemaVersion:
      V2_MISSION_CHECKPOINT_SCHEMA,

    missionId: "mission-1",

    state: {
      missionId: "mission-1",
      currentState: "INTERPRETING",
      stateVersion,
      currentStage: "EER",
      activeWorkPackages: [],
      executions: [],
      failureCount: 0,
      livelockCounter: 0,
    },

    loopBudget: {
      maxTicks: 100,
      remainingTicks: 100,
      maxFixAttempts: 3,
      remainingFixAttempts: 3,
      maxProviderCalls: 20,
      remainingProviderCalls: 20,
    },

    evidenceRecords: [],
    integratedCandidates: [],
    savedAt: stateVersion,
  };
}

test(
  "in-memory checkpoint store creates and loads a checkpoint",
  async () => {
    const store =
      new InMemoryMissionCheckpointStore();

    const result =
      await store.create(makeCheckpoint());

    assert.equal(result, "CREATED");

    const loaded =
      await store.load("mission-1");

    assert.ok(loaded);
    assert.equal(loaded.state.stateVersion, 1);
  },
);

test(
  "duplicate create is refused without overwriting state",
  async () => {
    const store =
      new InMemoryMissionCheckpointStore();

    await store.create(makeCheckpoint(1));

    const result =
      await store.create(makeCheckpoint(2));

    assert.equal(result, "ALREADY_EXISTS");

    const loaded =
      await store.load("mission-1");

    assert.ok(loaded);
    assert.equal(loaded.state.stateVersion, 1);
  },
);

test(
  "load returns null for an unknown mission",
  async () => {
    const store =
      new InMemoryMissionCheckpointStore();

    assert.equal(
      await store.load("missing"),
      null,
    );
  },
);

test(
  "compareAndSet performs an atomic version advance",
  async () => {
    const store =
      new InMemoryMissionCheckpointStore();

    await store.create(makeCheckpoint(1));

    const result =
      await store.compareAndSet(
        "mission-1",
        1,
        makeCheckpoint(2),
      );

    assert.deepEqual(result, {
      status: "UPDATED",
      stateVersion: 2,
    });

    const loaded =
      await store.load("mission-1");

    assert.ok(loaded);
    assert.equal(loaded.state.stateVersion, 2);
  },
);

test(
  "compareAndSet rejects a stale expected version",
  async () => {
    const store =
      new InMemoryMissionCheckpointStore();

    await store.create(makeCheckpoint(2));

    const result =
      await store.compareAndSet(
        "mission-1",
        1,
        makeCheckpoint(2),
      );

    assert.deepEqual(result, {
      status: "VERSION_CONFLICT",
      currentStateVersion: 2,
    });
  },
);

test(
  "compareAndSet returns NOT_FOUND for unknown mission",
  async () => {
    const store =
      new InMemoryMissionCheckpointStore();

    const result =
      await store.compareAndSet(
        "mission-1",
        1,
        makeCheckpoint(2),
      );

    assert.deepEqual(result, {
      status: "NOT_FOUND",
    });
  },
);

test(
  "compareAndSet refuses mission identity substitution",
  async () => {
    const store =
      new InMemoryMissionCheckpointStore();

    await store.create(makeCheckpoint(1));

    const checkpoint = makeCheckpoint(2);

    await assert.rejects(
      store.compareAndSet(
        "different-mission",
        1,
        checkpoint,
      ),
      /MISSION_ID_MISMATCH/,
    );
  },
);

test(
  "compareAndSet refuses non-monotonic state versions",
  async () => {
    const store =
      new InMemoryMissionCheckpointStore();

    await store.create(makeCheckpoint(1));

    await assert.rejects(
      store.compareAndSet(
        "mission-1",
        1,
        makeCheckpoint(3),
      ),
      /NON_MONOTONIC_STATE_VERSION/,
    );
  },
);

test(
  "store refuses invalid checkpoints",
  async () => {
    const store =
      new InMemoryMissionCheckpointStore();

    const base = makeCheckpoint();

    const invalid: MissionCheckpoint = {
      ...base,
      state: {
        ...base.state,
        missionId: "wrong-mission",
      },
    };

    await assert.rejects(
      store.create(invalid),
      /INVALID_MISSION_CHECKPOINT/,
    );
  },
);

test(
  "loaded checkpoints are defensive copies",
  async () => {
    const store =
      new InMemoryMissionCheckpointStore();

    await store.create(makeCheckpoint(1));

    const first =
      await store.load("mission-1");

    assert.ok(first);

    const mutable =
      first as unknown as {
        state: {
          stateVersion: number;
        };
      };

    mutable.state.stateVersion = 999;

    const second =
      await store.load("mission-1");

    assert.ok(second);
    assert.equal(second.state.stateVersion, 1);
  },
);