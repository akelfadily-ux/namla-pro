import test from "node:test";
import assert from "node:assert/strict";

import {
  MissionCheckpoint,
  V2_MISSION_CHECKPOINT_SCHEMA,
} from "../v2/persistence/missionCheckpointStore";

import {
  PostgresCheckpointClient,
  PostgresCheckpointDatabase,
  PostgresCheckpointQueryResult,
  PostgresMissionCheckpointStore,
} from "../v2/persistence/postgresMissionCheckpointStore";

import {
  V2_POSTGRES_MISSION_CHECKPOINT_SCHEMA_SQL,
} from "../v2/persistence/postgresMissionCheckpointSchema";

interface ScriptStep {
  readonly sqlContains: string;
  readonly rows: readonly unknown[];
}

interface QueryCall {
  readonly sql: string;
  readonly params:
    readonly unknown[] | undefined;
}

class ScriptedDatabase
  implements PostgresCheckpointDatabase
{
  public readonly calls: QueryCall[] = [];
  public transactionCount = 0;
  private stepIndex = 0;

  public constructor(
    private readonly steps:
      readonly ScriptStep[],
  ) {}

  public async query<T = unknown>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<PostgresCheckpointQueryResult<T>> {
    const step =
      this.steps[this.stepIndex];

    assert.ok(
      step,
      `Unexpected SQL call: ${sql}`,
    );

    assert.ok(
      sql.includes(step.sqlContains),
      `Expected SQL containing ${step.sqlContains}`,
    );

    this.stepIndex += 1;

    this.calls.push({
      sql,
      params,
    });

    return {
      rows:
        step.rows as readonly T[],
      rowCount: step.rows.length,
    };
  }

  public async transaction<T>(
    work: (
      client: PostgresCheckpointClient,
    ) => Promise<T>,
  ): Promise<T> {
    this.transactionCount += 1;
    return work(this);
  }

  public assertComplete(): void {
    assert.equal(
      this.stepIndex,
      this.steps.length,
      "Not all scripted SQL steps were consumed",
    );
  }
}

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

function storedRow(
  checkpoint: MissionCheckpoint,
): Record<string, unknown> {
  return {
    mission_id: checkpoint.missionId,
    schema_version:
      checkpoint.schemaVersion,
    state_version:
      String(checkpoint.state.stateVersion),
    checkpoint,
    saved_at:
      String(checkpoint.savedAt),
  };
}

test(
  "V2 PostgreSQL schema is checkpoint-native and guarded",
  () => {
    assert.match(
      V2_POSTGRES_MISSION_CHECKPOINT_SCHEMA_SQL,
      /namla_v2_mission_checkpoints/,
    );

    assert.match(
      V2_POSTGRES_MISSION_CHECKPOINT_SCHEMA_SQL,
      /PRIMARY KEY/,
    );

    assert.match(
      V2_POSTGRES_MISSION_CHECKPOINT_SCHEMA_SQL,
      /JSONB NOT NULL/,
    );

    assert.match(
      V2_POSTGRES_MISSION_CHECKPOINT_SCHEMA_SQL,
      new RegExp(
        V2_MISSION_CHECKPOINT_SCHEMA,
      ),
    );

    assert.doesNotMatch(
      V2_POSTGRES_MISSION_CHECKPOINT_SCHEMA_SQL,
      /\bruns\b|\btasks\b|\bant_executions\b/,
    );
  },
);

test(
  "Postgres store create inserts one V2 checkpoint",
  async () => {
    const db =
      new ScriptedDatabase([
        {
          sqlContains:
            "INSERT INTO namla_v2_mission_checkpoints",
          rows: [
            {
              mission_id: "mission-1",
            },
          ],
        },
      ]);

    const store =
      new PostgresMissionCheckpointStore(db);

    const result =
      await store.create(makeCheckpoint());

    assert.equal(result, "CREATED");

    const encoded =
      db.calls[0].params?.[3];

    assert.equal(
      typeof encoded,
      "string",
    );

    assert.equal(
      JSON.parse(encoded as string).missionId,
      "mission-1",
    );

    db.assertComplete();
  },
);

test(
  "Postgres store duplicate create does not overwrite",
  async () => {
    const db =
      new ScriptedDatabase([
        {
          sqlContains:
            "INSERT INTO namla_v2_mission_checkpoints",
          rows: [],
        },
      ]);

    const store =
      new PostgresMissionCheckpointStore(db);

    assert.equal(
      await store.create(makeCheckpoint()),
      "ALREADY_EXISTS",
    );

    db.assertComplete();
  },
);

test(
  "Postgres store loads and validates a checkpoint",
  async () => {
    const checkpoint = makeCheckpoint();

    const db =
      new ScriptedDatabase([
        {
          sqlContains:
            "FROM namla_v2_mission_checkpoints",
          rows: [
            storedRow(checkpoint),
          ],
        },
      ]);

    const store =
      new PostgresMissionCheckpointStore(db);

    const loaded =
      await store.load("mission-1");

    assert.deepEqual(
      loaded,
      checkpoint,
    );

    db.assertComplete();
  },
);

test(
  "Postgres store refuses corrupted row version metadata",
  async () => {
    const checkpoint = makeCheckpoint();

    const row = {
      ...storedRow(checkpoint),
      state_version: "2",
    };

    const db =
      new ScriptedDatabase([
        {
          sqlContains:
            "FROM namla_v2_mission_checkpoints",
          rows: [row],
        },
      ]);

    const store =
      new PostgresMissionCheckpointStore(db);

    await assert.rejects(
      store.load("mission-1"),
      /POSTGRES_ROW_STATE_VERSION_MISMATCH/,
    );

    db.assertComplete();
  },
);

test(
  "Postgres CAS locks then atomically advances version",
  async () => {
    const db =
      new ScriptedDatabase([
        {
          sqlContains: "FOR UPDATE",
          rows: [
            {
              state_version: "1",
            },
          ],
        },
        {
          sqlContains:
            "UPDATE namla_v2_mission_checkpoints",
          rows: [
            {
              state_version: "2",
            },
          ],
        },
      ]);

    const store =
      new PostgresMissionCheckpointStore(db);

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

    assert.equal(
      db.transactionCount,
      1,
    );

    db.assertComplete();
  },
);

test(
  "Postgres CAS returns VERSION_CONFLICT under row lock",
  async () => {
    const db =
      new ScriptedDatabase([
        {
          sqlContains: "FOR UPDATE",
          rows: [
            {
              state_version: "3",
            },
          ],
        },
      ]);

    const store =
      new PostgresMissionCheckpointStore(db);

    const result =
      await store.compareAndSet(
        "mission-1",
        1,
        makeCheckpoint(2),
      );

    assert.deepEqual(result, {
      status: "VERSION_CONFLICT",
      currentStateVersion: 3,
    });

    assert.equal(
      db.calls.length,
      1,
    );

    db.assertComplete();
  },
);

test(
  "Postgres CAS returns NOT_FOUND without issuing an update",
  async () => {
    const db =
      new ScriptedDatabase([
        {
          sqlContains: "FOR UPDATE",
          rows: [],
        },
      ]);

    const store =
      new PostgresMissionCheckpointStore(db);

    const result =
      await store.compareAndSet(
        "mission-1",
        1,
        makeCheckpoint(2),
      );

    assert.deepEqual(result, {
      status: "NOT_FOUND",
    });

    assert.equal(
      db.calls.length,
      1,
    );

    db.assertComplete();
  },
);

test(
  "Postgres CAS refuses non-monotonic writes before SQL",
  async () => {
    const db =
      new ScriptedDatabase([]);

    const store =
      new PostgresMissionCheckpointStore(db);

    await assert.rejects(
      store.compareAndSet(
        "mission-1",
        1,
        makeCheckpoint(3),
      ),
      /NON_MONOTONIC_STATE_VERSION/,
    );

    assert.equal(
      db.transactionCount,
      0,
    );

    db.assertComplete();
  },
);

test(
  "Postgres load rejects unknown missions without mutation",
  async () => {
    const db =
      new ScriptedDatabase([
        {
          sqlContains:
            "FROM namla_v2_mission_checkpoints",
          rows: [],
        },
      ]);

    const store =
      new PostgresMissionCheckpointStore(db);

    assert.equal(
      await store.load("mission-1"),
      null,
    );

    db.assertComplete();
  },
);