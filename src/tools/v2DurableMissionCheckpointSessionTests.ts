import test from "node:test";
import assert from "node:assert/strict";

import {
  DurableMissionCheckpointSession,
} from "../v2/persistence/durableMissionCheckpointSession";
import {
  MissionCheckpoint,
  MissionCheckpointCasResult,
  MissionCheckpointCreateResult,
  MissionCheckpointStore,
  V2_MISSION_CHECKPOINT_SCHEMA,
} from "../v2/persistence/missionCheckpointStore";
import {
  InMemoryMissionCheckpointStore,
} from "../v2/persistence/inMemoryMissionCheckpointStore";
import {
  MissionStage,
  MissionState,
} from "../v2/types/missionState";

function makeCheckpoint(
  missionId: string,
  stateVersion: number,
  currentState: MissionState = "INTERPRETING",
  currentStage: MissionStage = "EER",
  savedAt = 1000 + stateVersion,
): MissionCheckpoint {
  return {
    schemaVersion:
      V2_MISSION_CHECKPOINT_SCHEMA,
    missionId,
    state: {
      missionId,
      currentState,
      stateVersion,
      currentStage,
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
    savedAt,
  };
}

test(
  "10E1 durable session creates v1 and advances monotonically",
  async () => {
    const store =
      new InMemoryMissionCheckpointStore();

    const session =
      new DurableMissionCheckpointSession(
        store,
        "mission-10e1",
      );

    const created =
      await session.createInitial(
        makeCheckpoint(
          "mission-10e1",
          1,
        ),
      );

    assert.equal(created.ok, true);
    assert.equal(created.status, "CREATED");
    assert.equal(session.isActive(), true);
    assert.equal(
      session.getSnapshot()?.state.stateVersion,
      1,
    );

    const advanced =
      await session.advance(
        makeCheckpoint(
          "mission-10e1",
          2,
          "PLANNING",
          "PLAN",
        ),
      );

    assert.equal(advanced.ok, true);
    assert.equal(advanced.status, "UPDATED");

    const persisted =
      await store.load("mission-10e1");

    assert.ok(persisted);
    assert.equal(
      persisted.state.stateVersion,
      2,
    );
    assert.equal(
      persisted.state.currentStage,
      "PLAN",
    );
  },
);

test(
  "10E1 snapshot is detached from internal session authority",
  async () => {
    const store =
      new InMemoryMissionCheckpointStore();

    const session =
      new DurableMissionCheckpointSession(
        store,
        "mission-clone",
      );

    await session.createInitial(
      makeCheckpoint("mission-clone", 1),
    );

    const snapshot =
      session.getSnapshot();

    assert.ok(snapshot);

    (snapshot as any).state.stateVersion = 999;

    assert.equal(
      session.getSnapshot()?.state.stateVersion,
      1,
    );
  },
);

test(
  "10E1 resume loads and validates existing durable state",
  async () => {
    const store =
      new InMemoryMissionCheckpointStore();

    const writer =
      new DurableMissionCheckpointSession(
        store,
        "mission-resume",
      );

    await writer.createInitial(
      makeCheckpoint(
        "mission-resume",
        1,
      ),
    );

    await writer.advance(
      makeCheckpoint(
        "mission-resume",
        2,
        "PLANNING",
        "PLAN",
      ),
    );

    const resumed =
      new DurableMissionCheckpointSession(
        store,
        "mission-resume",
      );

    const result =
      await resumed.resume();

    assert.equal(result.ok, true);
    assert.equal(result.status, "RESUMED");
    assert.equal(
      resumed.getSnapshot()?.state.stateVersion,
      2,
    );
    assert.equal(
      resumed.getSnapshot()?.state.currentStage,
      "PLAN",
    );
  },
);

test(
  "10E1 initial creation refuses non-v1 state and locks stale writer",
  async () => {
    const store =
      new InMemoryMissionCheckpointStore();

    const session =
      new DurableMissionCheckpointSession(
        store,
        "mission-initial-version",
      );

    const refused =
      await session.createInitial(
        makeCheckpoint(
          "mission-initial-version",
          2,
        ),
      );

    assert.equal(refused.ok, false);

    if (refused.ok) {
      assert.fail(
        "non-v1 initial checkpoint must fail",
      );
    }

    assert.equal(
      refused.reasonCode,
      "initial-state-version-must-be-1",
    );

    const retry =
      await session.createInitial(
        makeCheckpoint(
          "mission-initial-version",
          1,
        ),
      );

    assert.equal(retry.ok, false);

    if (retry.ok) {
      assert.fail(
        "failed-closed session must reject retry",
      );
    }

    assert.equal(
      retry.reasonCode,
      "session-failed-closed",
    );
    assert.equal(
      retry.lockedByReasonCode,
      "initial-state-version-must-be-1",
    );
  },
);

test(
  "10E1 advance refuses skipped stateVersion and permanently fail-closes session",
  async () => {
    const store =
      new InMemoryMissionCheckpointStore();

    const session =
      new DurableMissionCheckpointSession(
        store,
        "mission-skip-version",
      );

    await session.createInitial(
      makeCheckpoint(
        "mission-skip-version",
        1,
      ),
    );

    const skipped =
      await session.advance(
        makeCheckpoint(
          "mission-skip-version",
          3,
          "PLANNING",
          "PLAN",
        ),
      );

    assert.equal(skipped.ok, false);

    if (skipped.ok) {
      assert.fail(
        "version skip must fail",
      );
    }

    assert.equal(
      skipped.reasonCode,
      "checkpoint-version-not-next",
    );

    const laterRetry =
      await session.advance(
        makeCheckpoint(
          "mission-skip-version",
          2,
          "PLANNING",
          "PLAN",
        ),
      );

    assert.equal(laterRetry.ok, false);

    if (laterRetry.ok) {
      assert.fail(
        "failed-closed writer must remain locked",
      );
    }

    assert.equal(
      laterRetry.reasonCode,
      "session-failed-closed",
    );
  },
);

test(
  "10E1 concurrent stale writer loses CAS and cannot continue",
  async () => {
    const store =
      new InMemoryMissionCheckpointStore();

    const seed =
      new DurableMissionCheckpointSession(
        store,
        "mission-cas",
      );

    const seedResult =
      await seed.createInitial(
        makeCheckpoint(
          "mission-cas",
          1,
        ),
      );

    assert.equal(seedResult.ok, true);

    const writerA =
      new DurableMissionCheckpointSession(
        store,
        "mission-cas",
      );

    const writerB =
      new DurableMissionCheckpointSession(
        store,
        "mission-cas",
      );

    assert.equal(
      (await writerA.resume()).ok,
      true,
    );

    assert.equal(
      (await writerB.resume()).ok,
      true,
    );

    const winner =
      await writerA.advance(
        makeCheckpoint(
          "mission-cas",
          2,
          "PLANNING",
          "PLAN",
        ),
      );

    assert.equal(winner.ok, true);

    const loser =
      await writerB.advance(
        makeCheckpoint(
          "mission-cas",
          2,
          "PLANNING",
          "PLAN",
        ),
      );

    assert.equal(loser.ok, false);

    if (loser.ok) {
      assert.fail(
        "stale CAS writer must fail",
      );
    }

    assert.equal(
      loser.reasonCode,
      "checkpoint-version-conflict",
    );
    assert.equal(
      loser.currentStateVersion,
      2,
    );
    assert.equal(
      writerB.isFailedClosed(),
      true,
    );

    const illegalContinue =
      await writerB.advance(
        makeCheckpoint(
          "mission-cas",
          3,
          "CONTRACT_FREEZE",
          "PROTOCOL",
        ),
      );

    assert.equal(
      illegalContinue.ok,
      false,
    );

    if (illegalContinue.ok) {
      assert.fail(
        "CAS loser must not continue",
      );
    }

    assert.equal(
      illegalContinue.reasonCode,
      "session-failed-closed",
    );
    assert.equal(
      illegalContinue.lockedByReasonCode,
      "checkpoint-version-conflict",
    );

    const persisted =
      await store.load("mission-cas");

    assert.ok(persisted);

    assert.equal(
      persisted.state.stateVersion,
      2,
    );
  },
);

test(
  "10E1 resume refuses missing durable mission instead of silently recreating",
  async () => {
    const store =
      new InMemoryMissionCheckpointStore();

    const session =
      new DurableMissionCheckpointSession(
        store,
        "missing-mission",
      );

    const result =
      await session.resume();

    assert.equal(result.ok, false);

    if (result.ok) {
      assert.fail(
        "missing durable mission must fail",
      );
    }

    assert.equal(
      result.reasonCode,
      "checkpoint-not-found",
    );
    assert.equal(
      session.isFailedClosed(),
      true,
    );
  },
);

test(
  "10E1 resume fail-closes malformed persisted checkpoint",
  async () => {
    const malformed =
      makeCheckpoint(
        "mission-malformed",
        1,
      );

    const malformedStore:
      MissionCheckpointStore = {
        async create():
          Promise<MissionCheckpointCreateResult> {
          return "CREATED";
        },

        async load():
          Promise<MissionCheckpoint | null> {
          return {
            ...malformed,
            state: {
              ...malformed.state,
              missionId:
                "different-mission",
            },
          };
        },

        async compareAndSet():
          Promise<MissionCheckpointCasResult> {
          return {
            status: "UPDATED",
            stateVersion: 2,
          };
        },
      };

    const session =
      new DurableMissionCheckpointSession(
        malformedStore,
        "mission-malformed",
      );

    const result =
      await session.resume();

    assert.equal(result.ok, false);

    if (result.ok) {
      assert.fail(
        "malformed persisted checkpoint must fail",
      );
    }

    assert.equal(
      result.reasonCode,
      "invalid-checkpoint:state-mission-id-mismatch",
    );
  },
);

test(
  "10E1 duplicate initial creator is refused rather than treated as resume",
  async () => {
    const store =
      new InMemoryMissionCheckpointStore();

    const first =
      new DurableMissionCheckpointSession(
        store,
        "mission-duplicate",
      );

    assert.equal(
      (
        await first.createInitial(
          makeCheckpoint(
            "mission-duplicate",
            1,
          ),
        )
      ).ok,
      true,
    );

    const duplicate =
      new DurableMissionCheckpointSession(
        store,
        "mission-duplicate",
      );

    const result =
      await duplicate.createInitial(
        makeCheckpoint(
          "mission-duplicate",
          1,
        ),
      );

    assert.equal(result.ok, false);

    if (result.ok) {
      assert.fail(
        "duplicate creator must fail",
      );
    }

    assert.equal(
      result.reasonCode,
      "checkpoint-already-exists",
    );
  },
);

test(
  "10E1 savedAt regression is rejected before persistence",
  async () => {
    const store =
      new InMemoryMissionCheckpointStore();

    const session =
      new DurableMissionCheckpointSession(
        store,
        "mission-time-regression",
      );

    await session.createInitial(
      makeCheckpoint(
        "mission-time-regression",
        1,
        "INTERPRETING",
        "EER",
        5000,
      ),
    );

    const result =
      await session.advance(
        makeCheckpoint(
          "mission-time-regression",
          2,
          "PLANNING",
          "PLAN",
          4999,
        ),
      );

    assert.equal(result.ok, false);

    if (result.ok) {
      assert.fail(
        "savedAt regression must fail",
      );
    }

    assert.equal(
      result.reasonCode,
      "checkpoint-saved-at-regression",
    );

    const persisted =
      await store.load(
        "mission-time-regression",
      );

    assert.ok(persisted);
    assert.equal(
      persisted.state.stateVersion,
      1,
    );
  },
);

test(
  "10E1 storage exception fail-closes session without leaking backend details",
  async () => {
    const throwingStore:
      MissionCheckpointStore = {
        async create():
          Promise<MissionCheckpointCreateResult> {
          throw new Error(
            "SECRET_DATABASE_BACKEND_DETAIL",
          );
        },

        async load():
          Promise<MissionCheckpoint | null> {
          throw new Error(
            "SECRET_DATABASE_BACKEND_DETAIL",
          );
        },

        async compareAndSet():
          Promise<MissionCheckpointCasResult> {
          throw new Error(
            "SECRET_DATABASE_BACKEND_DETAIL",
          );
        },
      };

    const session =
      new DurableMissionCheckpointSession(
        throwingStore,
        "mission-storage-failure",
      );

    const result =
      await session.createInitial(
        makeCheckpoint(
          "mission-storage-failure",
          1,
        ),
      );

    assert.equal(result.ok, false);

    if (result.ok) {
      assert.fail(
        "storage failure must fail",
      );
    }

    assert.equal(
      result.reasonCode,
      "storage-operation-failed",
    );

    assert.equal(
      JSON.stringify(result).includes(
        "SECRET_DATABASE_BACKEND_DETAIL",
      ),
      false,
    );
  },
);