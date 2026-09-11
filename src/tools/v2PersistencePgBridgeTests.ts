import test from "node:test";
import assert from "node:assert/strict";

import {
  Pool,
} from "pg";

import {
  PgCheckpointDatabase,
  PostgresTransactionRollbackError,
} from "../v2/persistence/pgCheckpointDatabase";

interface FakeQueryResult {
  readonly rows: readonly unknown[];
  readonly rowCount: number;
}

class FakeClient {
  public readonly calls: string[] = [];
  public releaseCount = 0;

  public failOn:
    string | null = null;

  public rollbackFails = false;

  public async query(
    sql: string,
  ): Promise<FakeQueryResult> {
    this.calls.push(sql);

    if (
      sql === "ROLLBACK" &&
      this.rollbackFails
    ) {
      throw new Error("rollback-failed");
    }

    if (
      this.failOn !== null &&
      sql === this.failOn
    ) {
      throw new Error(
        `failed:${sql}`,
      );
    }

    return {
      rows: [],
      rowCount: 0,
    };
  }

  public release(): void {
    this.releaseCount += 1;
  }
}

class FakePool {
  public readonly directCalls: string[] = [];

  public constructor(
    public readonly client: FakeClient,
  ) {}

  public async query(
    sql: string,
  ): Promise<FakeQueryResult> {
    this.directCalls.push(sql);

    return {
      rows: [
        {
          value: "ok",
        },
      ],
      rowCount: 1,
    };
  }

  public async connect(): Promise<FakeClient> {
    return this.client;
  }
}

function asPool(
  pool: FakePool,
): Pool {
  return pool as unknown as Pool;
}

test(
  "pg bridge delegates non-transaction queries to the pool",
  async () => {
    const client =
      new FakeClient();

    const pool =
      new FakePool(client);

    const db =
      new PgCheckpointDatabase(
        asPool(pool),
      );

    const result =
      await db.query<{ value: string }>(
        "SELECT 1",
      );

    assert.deepEqual(
      result.rows,
      [
        {
          value: "ok",
        },
      ],
    );

    assert.deepEqual(
      pool.directCalls,
      ["SELECT 1"],
    );
  },
);

test(
  "pg bridge commits a successful transaction and releases once",
  async () => {
    const client =
      new FakeClient();

    const db =
      new PgCheckpointDatabase(
        asPool(
          new FakePool(client),
        ),
      );

    const result =
      await db.transaction(
        async (tx) => {
          await tx.query("WORK");
          return "done";
        },
      );

    assert.equal(result, "done");

    assert.deepEqual(
      client.calls,
      [
        "BEGIN",
        "WORK",
        "COMMIT",
      ],
    );

    assert.equal(
      client.releaseCount,
      1,
    );
  },
);

test(
  "pg bridge rolls back failed work and releases once",
  async () => {
    const client =
      new FakeClient();

    client.failOn = "WORK";

    const db =
      new PgCheckpointDatabase(
        asPool(
          new FakePool(client),
        ),
      );

    await assert.rejects(
      db.transaction(
        async (tx) => {
          await tx.query("WORK");
        },
      ),
      /failed:WORK/,
    );

    assert.deepEqual(
      client.calls,
      [
        "BEGIN",
        "WORK",
        "ROLLBACK",
      ],
    );

    assert.equal(
      client.releaseCount,
      1,
    );
  },
);

test(
  "pg bridge attempts rollback if COMMIT fails",
  async () => {
    const client =
      new FakeClient();

    client.failOn = "COMMIT";

    const db =
      new PgCheckpointDatabase(
        asPool(
          new FakePool(client),
        ),
      );

    await assert.rejects(
      db.transaction(
        async (tx) => {
          await tx.query("WORK");
        },
      ),
      /failed:COMMIT/,
    );

    assert.deepEqual(
      client.calls,
      [
        "BEGIN",
        "WORK",
        "COMMIT",
        "ROLLBACK",
      ],
    );

    assert.equal(
      client.releaseCount,
      1,
    );
  },
);

test(
  "pg bridge reports rollback failure explicitly",
  async () => {
    const client =
      new FakeClient();

    client.failOn = "WORK";
    client.rollbackFails = true;

    const db =
      new PgCheckpointDatabase(
        asPool(
          new FakePool(client),
        ),
      );

    await assert.rejects(
      db.transaction(
        async (tx) => {
          await tx.query("WORK");
        },
      ),
      (
        error: unknown,
      ) => {
        assert.ok(
          error instanceof
            PostgresTransactionRollbackError,
        );

        assert.match(
          String(
            error.transactionError,
          ),
          /failed:WORK/,
        );

        assert.match(
          String(
            error.rollbackError,
          ),
          /rollback-failed/,
        );

        return true;
      },
    );

    assert.equal(
      client.releaseCount,
      1,
    );
  },
);

test(
  "pg bridge releases even if BEGIN fails",
  async () => {
    const client =
      new FakeClient();

    client.failOn = "BEGIN";

    const db =
      new PgCheckpointDatabase(
        asPool(
          new FakePool(client),
        ),
      );

    await assert.rejects(
      db.transaction(
        async () => "unused",
      ),
      /failed:BEGIN/,
    );

    assert.deepEqual(
      client.calls,
      ["BEGIN"],
    );

    assert.equal(
      client.releaseCount,
      1,
    );
  },
);
