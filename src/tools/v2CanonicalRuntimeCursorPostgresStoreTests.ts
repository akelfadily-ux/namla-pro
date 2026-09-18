import assert from "node:assert/strict";
import test from "node:test";

import {
  V2_CANONICAL_RUNTIME_CHECKPOINT_SCHEMA,
  type CanonicalRuntimeCheckpoint,
} from "../v2/persistence/canonicalRuntimeCursorStore";

import {
  V2_POSTGRES_CANONICAL_RUNTIME_CHECKPOINT_SCHEMA_SQL,
  V2_POSTGRES_CANONICAL_RUNTIME_CHECKPOINT_TABLE,
} from "../v2/persistence/postgresCanonicalRuntimeCursorSchema";

import {
  PostgresCanonicalRuntimeCursorStore,
} from "../v2/persistence/postgresCanonicalRuntimeCursorStore";

import {
  type PostgresCheckpointClient,
  type PostgresCheckpointDatabase,
  type PostgresCheckpointQueryResult,
} from "../v2/persistence/postgresMissionCheckpointStore";

import {
  advanceCanonicalRuntimeCursor,
  createCanonicalRuntimeCursor,
  V2_CANONICAL_RUNTIME_CURSOR_SCHEMA,
  type CanonicalRuntimeCursor,
} from "../v2/runtime/canonicalRuntimeStepper";

interface ScriptStep {
  readonly sqlContains:
    string;

  readonly rows:
    readonly unknown[];
}

interface QueryCall {
  readonly sql:
    string;

  readonly params:
    readonly unknown[] | undefined;
}

class ScriptedDatabase
  implements PostgresCheckpointDatabase
{
  public readonly calls:
    QueryCall[] = [];

  public transactionCount =
    0;

  private stepIndex =
    0;

  public constructor(
    private readonly steps:
      readonly ScriptStep[],
  ) {}

  public async query<T = unknown>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<PostgresCheckpointQueryResult<T>> {
    const step =
      this.steps[
        this.stepIndex
      ];

    assert.ok(
      step,
      `Unexpected SQL call: ${sql}`,
    );

    assert.ok(
      sql.includes(
        step.sqlContains,
      ),
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
      rowCount:
        step.rows.length,
    };
  }

  public async transaction<T>(
    work: (
      client:
        PostgresCheckpointClient,
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

function initialCheckpoint(
  missionId =
    "mission-postgres",
  savedAt =
    1000,
): CanonicalRuntimeCheckpoint {
  return {
    schemaVersion:
      V2_CANONICAL_RUNTIME_CHECKPOINT_SCHEMA,

    missionId,

    checkpointVersion:
      1,

    cursor:
      createCanonicalRuntimeCursor(
        missionId,
      ),

    savedAt,
  };
}

function nextCursor(
  cursor:
    CanonicalRuntimeCursor,
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
  current:
    CanonicalRuntimeCheckpoint,
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
  current:
    CanonicalRuntimeCheckpoint,
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

function storedRow(
  checkpoint:
    CanonicalRuntimeCheckpoint,
): Record<string, unknown> {
  return {
    mission_id:
      checkpoint.missionId,

    schema_version:
      checkpoint.schemaVersion,

    checkpoint_version:
      String(
        checkpoint.checkpointVersion,
      ),

    cursor_step_version:
      String(
        checkpoint.cursor.stepVersion,
      ),

    checkpoint,

    saved_at:
      String(
        checkpoint.savedAt,
      ),
  };
}

test(
  "10E6 PostgreSQL canonical runtime schema is dedicated and fail-closed",
  () => {
    assert.equal(
      V2_POSTGRES_CANONICAL_RUNTIME_CHECKPOINT_TABLE,
      "namla_v2_canonical_runtime_checkpoints",
    );

    assert.match(
      V2_POSTGRES_CANONICAL_RUNTIME_CHECKPOINT_SCHEMA_SQL,
      /CREATE TABLE namla_v2_canonical_runtime_checkpoints/,
    );

    assert.doesNotMatch(
      V2_POSTGRES_CANONICAL_RUNTIME_CHECKPOINT_SCHEMA_SQL,
      /CREATE TABLE IF NOT EXISTS namla_v2_canonical_runtime_checkpoints/,
    );

    assert.match(
      V2_POSTGRES_CANONICAL_RUNTIME_CHECKPOINT_SCHEMA_SQL,
      new RegExp(
        V2_CANONICAL_RUNTIME_CHECKPOINT_SCHEMA,
      ),
    );

    assert.match(
      V2_POSTGRES_CANONICAL_RUNTIME_CHECKPOINT_SCHEMA_SQL,
      new RegExp(
        V2_CANONICAL_RUNTIME_CURSOR_SCHEMA,
      ),
    );
  },
);

test(
  "10E6 PostgreSQL schema binds physical versions and identities to JSONB",
  () => {
    const sql =
      V2_POSTGRES_CANONICAL_RUNTIME_CHECKPOINT_SCHEMA_SQL;

    assert.match(
      sql,
      /checkpoint_version BIGINT NOT NULL/,
    );

    assert.match(
      sql,
      /cursor_step_version BIGINT NOT NULL/,
    );

    assert.match(
      sql,
      /checkpoint_version >=\s*cursor_step_version/,
    );

    assert.match(
      sql,
      /checkpoint #>> '\{cursor,missionId\}' =\s*mission_id/,
    );

    assert.match(
      sql,
      /\(checkpoint ->> 'checkpointVersion'\)::BIGINT =\s*checkpoint_version/,
    );

    assert.match(
      sql,
      /\(checkpoint #>> '\{cursor,stepVersion\}'\)::BIGINT =\s*cursor_step_version/,
    );

    assert.match(
      sql,
      /\(checkpoint ->> 'savedAt'\)::BIGINT =\s*saved_at/,
    );
  },
);

test(
  "10E6 PostgreSQL create inserts exactly one initial checkpoint",
  async () => {
    const checkpoint =
      initialCheckpoint();

    const db =
      new ScriptedDatabase([
        {
          sqlContains:
            "INSERT INTO namla_v2_canonical_runtime_checkpoints",

          rows: [
            {
              mission_id:
                checkpoint.missionId,
            },
          ],
        },
      ]);

    const store =
      new PostgresCanonicalRuntimeCursorStore(
        db,
      );

    assert.equal(
      await store.create(
        checkpoint,
      ),
      "CREATED",
    );

    assert.deepEqual(
      db.calls[0].params?.slice(
        0,
        4,
      ),
      [
        checkpoint.missionId,
        checkpoint.schemaVersion,
        checkpoint.checkpointVersion,
        checkpoint.cursor.stepVersion,
      ],
    );

    const encoded =
      db.calls[0].params?.[4];

    assert.equal(
      typeof encoded,
      "string",
    );

    assert.deepEqual(
      JSON.parse(
        encoded as string,
      ),
      checkpoint,
    );

    assert.equal(
      db.calls[0].params?.[5],
      checkpoint.savedAt,
    );

    db.assertComplete();
  },
);

test(
  "10E6 PostgreSQL duplicate create never overwrites",
  async () => {
    const db =
      new ScriptedDatabase([
        {
          sqlContains:
            "INSERT INTO namla_v2_canonical_runtime_checkpoints",

          rows:
            [],
        },
      ]);

    const store =
      new PostgresCanonicalRuntimeCursorStore(
        db,
      );

    assert.equal(
      await store.create(
        initialCheckpoint(
          "mission-duplicate",
        ),
      ),
      "ALREADY_EXISTS",
    );

    assert.match(
      db.calls[0].sql,
      /ON CONFLICT \(mission_id\) DO NOTHING/,
    );

    db.assertComplete();
  },
);

test(
  "10E6 PostgreSQL create requires canonical initial revision and cursor",
  async () => {
    const db =
      new ScriptedDatabase([]);

    const store =
      new PostgresCanonicalRuntimeCursorStore(
        db,
      );

    const initial =
      initialCheckpoint(
        "mission-invalid-initial",
      );

    await assert.rejects(
      store.create({
        ...initial,
        checkpointVersion:
          2,
      }),
      /CANONICAL_RUNTIME_INITIAL_CHECKPOINT_VERSION_MUST_BE_1/,
    );

    assert.equal(
      db.calls.length,
      0,
    );

    assert.equal(
      db.transactionCount,
      0,
    );

    db.assertComplete();
  },
);

test(
  "10E6 PostgreSQL load validates and detaches a checkpoint",
  async () => {
    const checkpoint =
      initialCheckpoint(
        "mission-load",
      );

    const db =
      new ScriptedDatabase([
        {
          sqlContains:
            "FROM namla_v2_canonical_runtime_checkpoints",

          rows: [
            storedRow(
              checkpoint,
            ),
          ],
        },
      ]);

    const store =
      new PostgresCanonicalRuntimeCursorStore(
        db,
      );

    const loaded =
      await store.load(
        checkpoint.missionId,
      );

    assert.deepEqual(
      loaded,
      checkpoint,
    );

    assert.notEqual(
      loaded,
      checkpoint,
    );

    assert.notEqual(
      loaded?.cursor,
      checkpoint.cursor,
    );

    db.assertComplete();
  },
);

test(
  "10E6 PostgreSQL load returns null only for an absent mission",
  async () => {
    const db =
      new ScriptedDatabase([
        {
          sqlContains:
            "FROM namla_v2_canonical_runtime_checkpoints",

          rows:
            [],
        },
      ]);

    const store =
      new PostgresCanonicalRuntimeCursorStore(
        db,
      );

    assert.equal(
      await store.load(
        "mission-absent",
      ),
      null,
    );

    db.assertComplete();
  },
);

test(
  "10E6 PostgreSQL load rejects row checkpoint-version corruption",
  async () => {
    const checkpoint =
      initialCheckpoint(
        "mission-corrupt-version",
      );

    const row = {
      ...storedRow(
        checkpoint,
      ),

      checkpoint_version:
        "2",
    };

    const db =
      new ScriptedDatabase([
        {
          sqlContains:
            "FROM namla_v2_canonical_runtime_checkpoints",

          rows: [
            row,
          ],
        },
      ]);

    const store =
      new PostgresCanonicalRuntimeCursorStore(
        db,
      );

    await assert.rejects(
      store.load(
        checkpoint.missionId,
      ),
      /POSTGRES_CANONICAL_RUNTIME_ROW_CHECKPOINT_VERSION_MISMATCH/,
    );

    db.assertComplete();
  },
);

test(
  "10E6 PostgreSQL load rejects row cursor-step corruption",
  async () => {
    const checkpoint =
      initialCheckpoint(
        "mission-corrupt-step",
      );

    const row = {
      ...storedRow(
        checkpoint,
      ),

      cursor_step_version:
        "2",
    };

    const db =
      new ScriptedDatabase([
        {
          sqlContains:
            "FROM namla_v2_canonical_runtime_checkpoints",

          rows: [
            row,
          ],
        },
      ]);

    const store =
      new PostgresCanonicalRuntimeCursorStore(
        db,
      );

    await assert.rejects(
      store.load(
        checkpoint.missionId,
      ),
      /POSTGRES_CANONICAL_RUNTIME_ROW_CURSOR_STEP_VERSION_MISMATCH/,
    );

    db.assertComplete();
  },
);

test(
  "10E6 PostgreSQL load rejects corrupted JSON checkpoint data",
  async () => {
    const checkpoint =
      initialCheckpoint(
        "mission-corrupt-json",
      );

    const row = {
      ...storedRow(
        checkpoint,
      ),

      checkpoint:
        "{not-json",
    };

    const db =
      new ScriptedDatabase([
        {
          sqlContains:
            "FROM namla_v2_canonical_runtime_checkpoints",

          rows: [
            row,
          ],
        },
      ]);

    const store =
      new PostgresCanonicalRuntimeCursorStore(
        db,
      );

    await assert.rejects(
      store.load(
        checkpoint.missionId,
      ),
      /POSTGRES_CANONICAL_RUNTIME_CORRUPT_CHECKPOINT_JSON/,
    );

    db.assertComplete();
  },
);

test(
  "10E6 PostgreSQL CAS locks and atomically persists a same-node checkpoint",
  async () => {
    const current =
      initialCheckpoint(
        "mission-cas-same-node",
        1000,
      );

    const next =
      sameNodeCheckpoint(
        current,
        2,
        1001,
      );

    const db =
      new ScriptedDatabase([
        {
          sqlContains:
            "FOR UPDATE",

          rows: [
            storedRow(
              current,
            ),
          ],
        },

        {
          sqlContains:
            "UPDATE namla_v2_canonical_runtime_checkpoints",

          rows: [
            {
              checkpoint_version:
                "2",

              cursor_step_version:
                "1",
            },
          ],
        },
      ]);

    const store =
      new PostgresCanonicalRuntimeCursorStore(
        db,
      );

    assert.deepEqual(
      await store.compareAndSet(
        current.missionId,
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
      db.transactionCount,
      1,
    );

    assert.match(
      db.calls[0].sql,
      /FOR UPDATE/,
    );

    db.assertComplete();
  },
);

test(
  "10E6 PostgreSQL CAS atomically persists one adjacent canonical transition",
  async () => {
    const current =
      initialCheckpoint(
        "mission-cas-adjacent",
        1000,
      );

    const next =
      adjacentCheckpoint(
        current,
        2,
        1001,
      );

    const db =
      new ScriptedDatabase([
        {
          sqlContains:
            "FOR UPDATE",

          rows: [
            storedRow(
              current,
            ),
          ],
        },

        {
          sqlContains:
            "UPDATE namla_v2_canonical_runtime_checkpoints",

          rows: [
            {
              checkpoint_version:
                "2",

              cursor_step_version:
                "2",
            },
          ],
        },
      ]);

    const store =
      new PostgresCanonicalRuntimeCursorStore(
        db,
      );

    const result =
      await store.compareAndSet(
        current.missionId,
        1,
        next,
      );

    assert.deepEqual(
      result,
      {
        status:
          "UPDATED",

        checkpointVersion:
          2,
      },
    );

    const params =
      db.calls[1].params;

    assert.equal(
      params?.[3],
      2,
    );

    assert.equal(
      params?.[4],
      2,
    );

    assert.equal(
      params?.[6],
      1001,
    );

    db.assertComplete();
  },
);

test(
  "10E6 PostgreSQL CAS returns VERSION_CONFLICT under row lock without UPDATE",
  async () => {
    const current =
      sameNodeCheckpoint(
        initialCheckpoint(
          "mission-conflict",
        ),
        2,
        1001,
      );

    const staleCandidate =
      adjacentCheckpoint(
        initialCheckpoint(
          "mission-conflict",
        ),
        2,
        1002,
      );

    const db =
      new ScriptedDatabase([
        {
          sqlContains:
            "FOR UPDATE",

          rows: [
            storedRow(
              current,
            ),
          ],
        },
      ]);

    const store =
      new PostgresCanonicalRuntimeCursorStore(
        db,
      );

    assert.deepEqual(
      await store.compareAndSet(
        current.missionId,
        1,
        staleCandidate,
      ),
      {
        status:
          "VERSION_CONFLICT",

        currentCheckpointVersion:
          2,
      },
    );

    assert.equal(
      db.calls.length,
      1,
    );

    db.assertComplete();
  },
);

test(
  "10E6 PostgreSQL CAS returns NOT_FOUND under lock without UPDATE",
  async () => {
    const current =
      initialCheckpoint(
        "mission-not-found",
      );

    const next =
      sameNodeCheckpoint(
        current,
      );

    const db =
      new ScriptedDatabase([
        {
          sqlContains:
            "FOR UPDATE",

          rows:
            [],
        },
      ]);

    const store =
      new PostgresCanonicalRuntimeCursorStore(
        db,
      );

    assert.deepEqual(
      await store.compareAndSet(
        current.missionId,
        1,
        next,
      ),
      {
        status:
          "NOT_FOUND",
      },
    );

    assert.equal(
      db.calls.length,
      1,
    );

    db.assertComplete();
  },
);

test(
  "10E6 PostgreSQL CAS rejects non-monotonic checkpoint revisions before transaction",
  async () => {
    const current =
      initialCheckpoint(
        "mission-non-monotonic",
      );

    const db =
      new ScriptedDatabase([]);

    const store =
      new PostgresCanonicalRuntimeCursorStore(
        db,
      );

    await assert.rejects(
      store.compareAndSet(
        current.missionId,
        1,
        {
          ...current,
          checkpointVersion:
            3,
          savedAt:
            1001,
        },
      ),
      /NON_MONOTONIC_CANONICAL_RUNTIME_CHECKPOINT_VERSION/,
    );

    assert.equal(
      db.transactionCount,
      0,
    );

    db.assertComplete();
  },
);

test(
  "10E6 PostgreSQL CAS rejects invalid expected revision before transaction",
  async () => {
    const current =
      initialCheckpoint(
        "mission-invalid-expected",
      );

    const next =
      sameNodeCheckpoint(
        current,
      );

    const db =
      new ScriptedDatabase([]);

    const store =
      new PostgresCanonicalRuntimeCursorStore(
        db,
      );

    await assert.rejects(
      store.compareAndSet(
        current.missionId,
        0,
        next,
      ),
      /INVALID_EXPECTED_CANONICAL_RUNTIME_CHECKPOINT_VERSION/,
    );

    assert.equal(
      db.transactionCount,
      0,
    );

    db.assertComplete();
  },
);

test(
  "10E6 PostgreSQL CAS rejects mission identity mutation before transaction",
  async () => {
    const current =
      initialCheckpoint(
        "mission-a",
      );

    const other =
      sameNodeCheckpoint(
        initialCheckpoint(
          "mission-b",
        ),
      );

    const db =
      new ScriptedDatabase([]);

    const store =
      new PostgresCanonicalRuntimeCursorStore(
        db,
      );

    await assert.rejects(
      store.compareAndSet(
        current.missionId,
        1,
        other,
      ),
      /CANONICAL_RUNTIME_CHECKPOINT_MISSION_ID_MISMATCH/,
    );

    assert.equal(
      db.transactionCount,
      0,
    );

    db.assertComplete();
  },
);

test(
  "10E6 PostgreSQL CAS rejects savedAt regression against locked durable state",
  async () => {
    const current =
      initialCheckpoint(
        "mission-time-regression",
        1000,
      );

    const next =
      sameNodeCheckpoint(
        current,
        2,
        999,
      );

    const db =
      new ScriptedDatabase([
        {
          sqlContains:
            "FOR UPDATE",

          rows: [
            storedRow(
              current,
            ),
          ],
        },
      ]);

    const store =
      new PostgresCanonicalRuntimeCursorStore(
        db,
      );

    await assert.rejects(
      store.compareAndSet(
        current.missionId,
        1,
        next,
      ),
      /CANONICAL_RUNTIME_CHECKPOINT_SAVED_AT_REGRESSION/,
    );

    assert.equal(
      db.calls.length,
      1,
    );

    db.assertComplete();
  },
);

test(
  "10E6 PostgreSQL CAS rejects canonical cursor skip against locked durable state",
  async () => {
    const initial =
      initialCheckpoint(
        "mission-cursor-skip",
        1000,
      );

    const current =
      sameNodeCheckpoint(
        initial,
        2,
        1001,
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

    const skipped:
      CanonicalRuntimeCheckpoint = {
        ...current,

        checkpointVersion:
          3,

        cursor:
          gateResult.cursor,

        savedAt:
          1002,
      };

    const db =
      new ScriptedDatabase([
        {
          sqlContains:
            "FOR UPDATE",

          rows: [
            storedRow(
              current,
            ),
          ],
        },
      ]);

    const store =
      new PostgresCanonicalRuntimeCursorStore(
        db,
      );

    await assert.rejects(
      store.compareAndSet(
        current.missionId,
        2,
        skipped,
      ),
      /CANONICAL_RUNTIME_CURSOR_TRANSITION_NOT_ADJACENT/,
    );

    assert.equal(
      db.calls.length,
      1,
    );

    db.assertComplete();
  },
);

test(
  "10E6 PostgreSQL CAS rejects mismatched written checkpoint revision",
  async () => {
    const current =
      initialCheckpoint(
        "mission-write-version-mismatch",
      );

    const next =
      sameNodeCheckpoint(
        current,
      );

    const db =
      new ScriptedDatabase([
        {
          sqlContains:
            "FOR UPDATE",

          rows: [
            storedRow(
              current,
            ),
          ],
        },

        {
          sqlContains:
            "UPDATE namla_v2_canonical_runtime_checkpoints",

          rows: [
            {
              checkpoint_version:
                "999",

              cursor_step_version:
                "1",
            },
          ],
        },
      ]);

    const store =
      new PostgresCanonicalRuntimeCursorStore(
        db,
      );

    await assert.rejects(
      store.compareAndSet(
        current.missionId,
        1,
        next,
      ),
      /POSTGRES_CANONICAL_RUNTIME_CAS_CHECKPOINT_VERSION_MISMATCH/,
    );

    db.assertComplete();
  },
);

test(
  "10E6 PostgreSQL CAS rejects mismatched written cursor step revision",
  async () => {
    const current =
      initialCheckpoint(
        "mission-write-step-mismatch",
      );

    const next =
      sameNodeCheckpoint(
        current,
      );

    const db =
      new ScriptedDatabase([
        {
          sqlContains:
            "FOR UPDATE",

          rows: [
            storedRow(
              current,
            ),
          ],
        },

        {
          sqlContains:
            "UPDATE namla_v2_canonical_runtime_checkpoints",

          rows: [
            {
              checkpoint_version:
                "2",

              cursor_step_version:
                "999",
            },
          ],
        },
      ]);

    const store =
      new PostgresCanonicalRuntimeCursorStore(
        db,
      );

    await assert.rejects(
      store.compareAndSet(
        current.missionId,
        1,
        next,
      ),
      /POSTGRES_CANONICAL_RUNTIME_CAS_CURSOR_STEP_VERSION_MISMATCH/,
    );

    db.assertComplete();
  },
);

test(
  "10E6 PostgreSQL CAS requires exactly one update receipt",
  async () => {
    const current =
      initialCheckpoint(
        "mission-write-lost",
      );

    const next =
      sameNodeCheckpoint(
        current,
      );

    const db =
      new ScriptedDatabase([
        {
          sqlContains:
            "FOR UPDATE",

          rows: [
            storedRow(
              current,
            ),
          ],
        },

        {
          sqlContains:
            "UPDATE namla_v2_canonical_runtime_checkpoints",

          rows:
            [],
        },
      ]);

    const store =
      new PostgresCanonicalRuntimeCursorStore(
        db,
      );

    await assert.rejects(
      store.compareAndSet(
        current.missionId,
        1,
        next,
      ),
      /POSTGRES_CANONICAL_RUNTIME_CAS_WRITE_LOST/,
    );

    db.assertComplete();
  },
);

test(
  "10E6 PostgreSQL create snapshots caller state before asynchronous persistence",
  async () => {
    const input =
      structuredClone(
        initialCheckpoint(
          "mission-create-detach",
        ),
      );

    const expected =
      structuredClone(
        input,
      );

    const db =
      new ScriptedDatabase([
        {
          sqlContains:
            "INSERT INTO namla_v2_canonical_runtime_checkpoints",

          rows: [
            {
              mission_id:
                input.missionId,
            },
          ],
        },
      ]);

    const store =
      new PostgresCanonicalRuntimeCursorStore(
        db,
      );

    const pending =
      store.create(
        input,
      );

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

    const encoded =
      db.calls[0].params?.[4];

    assert.deepEqual(
      JSON.parse(
        encoded as string,
      ),
      expected,
    );

    db.assertComplete();
  },
);


/**
 * Static DDL regression checks only.
 *
 * These tests do not connect to PostgreSQL or prove database enforcement.
 * They pin the required-field/type guard and its explicit IS TRUE wrapper.
 */
function requiredJsonGuardConditionFor10E6(): string {
  const sql = V2_POSTGRES_CANONICAL_RUNTIME_CHECKPOINT_SCHEMA_SQL
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const marker =
    "CONSTRAINT canonical_runtime_checkpoint_json_required_types";

  const parts = sql.split(marker);

  assert.equal(
    parts.length,
    2,
    "The named required-field/type constraint must appear exactly once",
  );

  /*
   * The current schema places this constraint last.
   * Match the entire remaining SQL, including the closing table delimiter,
   * so IS TRUE must wrap the complete conjunction, not just one clause.
   */
  const match =
    /^CHECK\s*\(\s*\(([\s\S]*?)\)\s+IS\s+TRUE\s*\)\s*\);\s*$/
      .exec(parts[1].trim());

  assert.ok(
    match,
    "The complete required-field/type condition must be wrapped in IS TRUE",
  );

  return match[1];
}

test(
  "10E6 SQL definition wraps the complete required JSON guard in IS TRUE",
  () => {
    const condition = requiredJsonGuardConditionFor10E6();

    assert.ok(
      condition.trim().length > 0,
      "The required-field/type guard must not be empty",
    );
  },
);

test(
  "10E6 SQL definition retains every required checkpoint and cursor JSON type",
  () => {
    const expectedClauses = [
      "jsonb_typeof(checkpoint) = 'object'",
      "jsonb_typeof(checkpoint -> 'schemaVersion') = 'string'",
      "jsonb_typeof(checkpoint -> 'missionId') = 'string'",
      "jsonb_typeof(checkpoint -> 'checkpointVersion') = 'number'",
      "jsonb_typeof(checkpoint -> 'savedAt') = 'number'",
      "jsonb_typeof(checkpoint -> 'cursor') = 'object'",
      "jsonb_typeof(checkpoint #> '{cursor,schemaVersion}') = 'string'",
      "jsonb_typeof(checkpoint #> '{cursor,missionId}') = 'string'",
      "jsonb_typeof(checkpoint #> '{cursor,nodeIndex}') = 'number'",
      "jsonb_typeof(checkpoint #> '{cursor,nodeId}') = 'string'",
      "jsonb_typeof(checkpoint #> '{cursor,nodeKind}') = 'string'",
      "jsonb_typeof(checkpoint #> '{cursor,stepVersion}') = 'number'",
      "jsonb_typeof(checkpoint #> '{cursor,contractPhase}') = 'string'",
    ];

    const compact = (value: string): string =>
      value.replace(/\s+/g, "");

    const actualClauses = requiredJsonGuardConditionFor10E6()
      .trim()
      .split(/\s+AND\s+/)
      .map(compact)
      .sort();

    assert.deepEqual(
      actualClauses,
      expectedClauses.map(compact).sort(),
      "Every required JSON type must remain mandatory in the AND conjunction",
    );
  },
);
