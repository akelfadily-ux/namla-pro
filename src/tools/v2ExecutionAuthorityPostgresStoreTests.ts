import test from "node:test";
import assert from "node:assert/strict";

import {
  fingerprintOperationIdentity,
} from "../v2/kernel/operationIdentity";

import {
  PostgresCheckpointClient,
  PostgresCheckpointDatabase,
  PostgresCheckpointQueryResult,
} from "../v2/persistence/postgresMissionCheckpointStore";

import {
  PostgresExecutionAuthorityStore,
} from "../v2/persistence/postgresExecutionAuthorityStore";

const NOW = 1_800_000_000_000;

const DEFAULT_VALUE = {
  path: "a.txt",
  text: "hello",
};

interface Step {
  readonly contains: string;
  readonly rows: readonly unknown[];
}

class ScriptedDatabase
  implements PostgresCheckpointDatabase
{
  public transactionCount = 0;
  public readonly calls: string[] = [];
  private index = 0;

  public constructor(
    private readonly steps:
      readonly Step[],
  ) {}

  private async execute<T>(
    sql: string,
  ): Promise<PostgresCheckpointQueryResult<T>> {
    const step =
      this.steps[this.index];

    assert.ok(
      step,
      `Unexpected SQL: ${sql}`,
    );

    assert.ok(
      sql.includes(step.contains),
      `Expected SQL containing ${step.contains}`,
    );

    this.index += 1;
    this.calls.push(sql);

    return {
      rows:
        step.rows as readonly T[],
      rowCount:
        step.rows.length,
    };
  }

  public async query<T = unknown>(
    sql: string,
  ): Promise<PostgresCheckpointQueryResult<T>> {
    return this.execute<T>(sql);
  }

  public async transaction<T>(
    work: (
      client: PostgresCheckpointClient,
    ) => Promise<T>,
  ): Promise<T> {
    this.transactionCount += 1;

    return work({
      query:
        async <R = unknown>(
          sql: string,
        ): Promise<
          PostgresCheckpointQueryResult<R>
        > => this.execute<R>(sql),
    });
  }

  public assertComplete(): void {
    assert.equal(
      this.index,
      this.steps.length,
    );
  }
}

function authority() {
  return {
    missionId: "mission-1",
    taskId: "task-1",
    workerId: "worker-a",
    authorityScope:
      "PRO/COLONY_A/task-1",
    leaseToken: "lease-a",
    leaseEpoch: 1,
    expiresAt: NOW + 60_000,
  } as const;
}

function currentFingerprint(
  value: unknown = DEFAULT_VALUE,
): string {
  return fingerprintOperationIdentity({
    missionId: "mission-1",
    authorityScope:
      "PRO/COLONY_A/task-1",
    operationType:
      "tool.filesystem.write",
    value,
  });
}

function leaseRow(
  overrides:
    Record<string, unknown> = {},
) {
  return {
    mission_id: "mission-1",
    task_id: "task-1",
    worker_id: "worker-a",
    authority_scope:
      "PRO/COLONY_A/task-1",
    lease_token: "lease-a",
    lease_epoch: "1",
    lease_expires_at:
      new Date(NOW + 60_000),
    now_ms: String(NOW),
    ...overrides,
  };
}

function operationRow(
  overrides:
    Record<string, unknown> = {},
) {
  return {
    mission_id: "mission-1",
    operation_key: "op-1",
    task_id: "task-1",
    authority_scope:
      "PRO/COLONY_A/task-1",
    operation_type:
      "tool.filesystem.write",
    input_fingerprint:
      currentFingerprint(),
    status: "RUNNING",
    claim_owner_worker_id:
      "worker-a",
    claim_task_lease_token:
      "lease-a",
    claim_task_lease_epoch: "1",
    claim_token: "claim-a",
    claim_epoch: "1",
    claim_expires_at:
      new Date(NOW + 30_000),
    result: null,
    error_text: null,
    created_at:
      new Date(NOW - 1000),
    updated_at:
      new Date(NOW - 1000),
    finished_at: null,
    ...overrides,
  };
}

test(
  "R1B-PG2 atomically acquires a new task lease",
  async () => {
    const db =
      new ScriptedDatabase([
        {
          contains:
            "INSERT INTO namla_v2_task_execution_leases",
          rows: [leaseRow()],
        },
      ]);

    const store =
      new PostgresExecutionAuthorityStore(
        db,
        () => "lease-a",
      );

    const result =
      await store.acquireTaskLease({
        missionId: "mission-1",
        taskId: "task-1",
        workerId: "worker-a",
        authorityScope:
          "PRO/COLONY_A/task-1",
      });

    assert.equal(result.ok, true);
    assert.equal(result.status, "ACQUIRED");
    assert.equal(
      result.ok
        ? result.authority.leaseEpoch
        : null,
      1,
    );

    db.assertComplete();
  },
);

test(
  "R1B-PG2 refuses active lease ownership conflict",
  async () => {
    const db =
      new ScriptedDatabase([
        {
          contains:
            "INSERT INTO namla_v2_task_execution_leases",
          rows: [],
        },
        {
          contains:
            "FROM namla_v2_task_execution_leases",
          rows: [
            leaseRow({
              worker_id:
                "worker-other",
            }),
          ],
        },
      ]);

    const store =
      new PostgresExecutionAuthorityStore(
        db,
        () => "lease-new",
      );

    const result =
      await store.acquireTaskLease({
        missionId: "mission-1",
        taskId: "task-1",
        workerId: "worker-a",
        authorityScope:
          "PRO/COLONY_A/task-1",
      });

    assert.equal(result.ok, false);
    assert.equal(
      result.reasonCode,
      "held-by-other",
    );

    db.assertComplete();
  },
);

test(
  "R1B-PG2 refuses authority-scope mutation during takeover",
  async () => {
    const db =
      new ScriptedDatabase([
        {
          contains:
            "INSERT INTO namla_v2_task_execution_leases",
          rows: [],
        },
        {
          contains:
            "FROM namla_v2_task_execution_leases",
          rows: [
            leaseRow({
              authority_scope:
                "PRO/COLONY_B/task-1",
            }),
          ],
        },
      ]);

    const store =
      new PostgresExecutionAuthorityStore(
        db,
        () => "lease-new",
      );

    const result =
      await store.acquireTaskLease({
        missionId: "mission-1",
        taskId: "task-1",
        workerId: "worker-a",
        authorityScope:
          "PRO/COLONY_A/task-1",
      });

    assert.equal(result.ok, false);
    assert.equal(
      result.reasonCode,
      "binding-mismatch",
    );

    db.assertComplete();
  },
);

test(
  "R1B-PG2 renews only exact live fenced lease",
  async () => {
    const db =
      new ScriptedDatabase([
        {
          contains:
            "UPDATE namla_v2_task_execution_leases",
          rows: [
            leaseRow({
              lease_expires_at:
                new Date(NOW + 120_000),
            }),
          ],
        },
      ]);

    const store =
      new PostgresExecutionAuthorityStore(
        db,
      );

    const result =
      await store.renewTaskLease(
        authority(),
      );

    assert.equal(result.ok, true);
    assert.equal(result.status, "RENEWED");

    db.assertComplete();
  },
);

test(
  "R1B-PG2 stale lease renewal is refused",
  async () => {
    const db =
      new ScriptedDatabase([
        {
          contains:
            "UPDATE namla_v2_task_execution_leases",
          rows: [],
        },
      ]);

    const store =
      new PostgresExecutionAuthorityStore(
        db,
      );

    const result =
      await store.renewTaskLease(
        authority(),
      );

    assert.equal(result.ok, false);
    assert.equal(
      result.reasonCode,
      "authority-lost",
    );

    db.assertComplete();
  },
);

test(
  "R1B-PG2 operation claim locks task authority before operation row",
  async () => {
    const db =
      new ScriptedDatabase([
        {
          contains:
            "FROM namla_v2_task_execution_leases",
          rows: [leaseRow()],
        },
        {
          contains:
            "FROM namla_v2_operation_claims",
          rows: [],
        },
        {
          contains:
            "INSERT INTO namla_v2_operation_claims",
          rows: [
            {
              operation_key: "op-1",
            },
          ],
        },
      ]);

    const store =
      new PostgresExecutionAuthorityStore(
        db,
        () => "claim-new",
      );

    const result =
      await store.claimOperation({
        operationKey: "op-1",
        operationType:
          "tool.filesystem.write",
        value: DEFAULT_VALUE,
        authority: authority(),
      });

    assert.equal(result.ok, true);
    assert.equal(result.status, "CLAIMED");
    assert.equal(db.transactionCount, 1);
    assert.match(db.calls[0], /FOR UPDATE/);
    assert.match(db.calls[1], /FOR UPDATE/);

    db.assertComplete();
  },
);

test(
  "R1B-PG2 durable authority mismatch refuses before operation access",
  async () => {
    const db =
      new ScriptedDatabase([
        {
          contains:
            "FROM namla_v2_task_execution_leases",
          rows: [
            leaseRow({
              worker_id:
                "worker-other",
            }),
          ],
        },
      ]);

    const store =
      new PostgresExecutionAuthorityStore(
        db,
      );

    const result =
      await store.claimOperation({
        operationKey: "op-1",
        operationType:
          "tool.filesystem.write",
        value: DEFAULT_VALUE,
        authority: authority(),
      });

    assert.equal(result.ok, false);
    assert.equal(
      result.reasonCode,
      "task-authority-mismatch",
    );

    db.assertComplete();
  },
);

test(
  "R1B-PG2 completed operation replays persisted value without write",
  async () => {
    const db =
      new ScriptedDatabase([
        {
          contains:
            "FROM namla_v2_task_execution_leases",
          rows: [leaseRow()],
        },
        {
          contains:
            "FROM namla_v2_operation_claims",
          rows: [
            operationRow({
              status: "COMPLETED",
              result: {
                ok: true,
                value: 7,
              },
              finished_at:
                new Date(NOW - 100),
            }),
          ],
        },
      ]);

    const store =
      new PostgresExecutionAuthorityStore(
        db,
      );

    const result =
      await store.claimOperation({
        operationKey: "op-1",
        operationType:
          "tool.filesystem.write",
        value: DEFAULT_VALUE,
        authority: authority(),
      });

    assert.equal(result.ok, true);
    assert.equal(
      result.status,
      "REPLAY_COMPLETED",
    );

    assert.deepEqual(
      result.ok
        ? result.completedValue
        : undefined,
      {
        ok: true,
        value: 7,
      },
    );

    db.assertComplete();
  },
);

test(
  "R1B-PG2 expired operation takeover increments epoch and SQL-fences old claim",
  async () => {
    const existing =
      operationRow({
        claim_expires_at:
          new Date(NOW - 1),
      });

    const db =
      new ScriptedDatabase([
        {
          contains:
            "FROM namla_v2_task_execution_leases",
          rows: [leaseRow()],
        },
        {
          contains:
            "FROM namla_v2_operation_claims",
          rows: [existing],
        },
        {
          contains:
            "UPDATE namla_v2_operation_claims",
          rows: [
            {
              operation_key: "op-1",
            },
          ],
        },
      ]);

    const store =
      new PostgresExecutionAuthorityStore(
        db,
        () => "claim-new",
      );

    const result =
      await store.claimOperation({
        operationKey: "op-1",
        operationType:
          "tool.filesystem.write",
        value: DEFAULT_VALUE,
        authority: authority(),
      });

    assert.equal(result.ok, true);
    assert.equal(result.status, "CLAIMED");

    assert.equal(
      result.ok
        ? result.record?.claimEpoch
        : undefined,
      2,
    );

    assert.match(
      db.calls[2],
      /claim_token = \$10/,
    );

    assert.match(
      db.calls[2],
      /claim_epoch = \$11/,
    );

    db.assertComplete();
  },
);

test(
  "R1B-PG2 stale claim token cannot complete",
  async () => {
    const db =
      new ScriptedDatabase([
        {
          contains:
            "FROM namla_v2_task_execution_leases",
          rows: [leaseRow()],
        },
        {
          contains:
            "FROM namla_v2_operation_claims",
          rows: [
            operationRow(),
          ],
        },
      ]);

    const store =
      new PostgresExecutionAuthorityStore(
        db,
      );

    const result =
      await store.completeOperation({
        operationKey: "op-1",
        authority: authority(),
        claimToken: "stale",
        claimEpoch: 1,
        value: { ok: true },
      });

    assert.equal(result.ok, false);
    assert.equal(
      result.reasonCode,
      "claim-token-mismatch",
    );

    db.assertComplete();
  },
);

test(
  "R1B-PG2 exact claim fence completes durably",
  async () => {
    const db =
      new ScriptedDatabase([
        {
          contains:
            "FROM namla_v2_task_execution_leases",
          rows: [leaseRow()],
        },
        {
          contains:
            "FROM namla_v2_operation_claims",
          rows: [
            operationRow(),
          ],
        },
        {
          contains:
            "UPDATE namla_v2_operation_claims",
          rows: [
            {
              operation_key: "op-1",
            },
          ],
        },
      ]);

    const store =
      new PostgresExecutionAuthorityStore(
        db,
      );

    const result =
      await store.completeOperation({
        operationKey: "op-1",
        authority: authority(),
        claimToken: "claim-a",
        claimEpoch: 1,
        value: { ok: true },
      });

    assert.equal(result.ok, true);
    assert.equal(result.status, "COMPLETED");

    const updateSql =
      db.calls[2];

    assert.match(
      updateSql,
      /claim_task_lease_epoch = \$9/,
    );
    assert.match(
      updateSql,
      /claim_token = \$10/,
    );
    assert.match(
      updateSql,
      /claim_epoch = \$11/,
    );

    db.assertComplete();
  },
);

test(
  "R1B-PG2 exact claim fence fails durably",
  async () => {
    const db =
      new ScriptedDatabase([
        {
          contains:
            "FROM namla_v2_task_execution_leases",
          rows: [leaseRow()],
        },
        {
          contains:
            "FROM namla_v2_operation_claims",
          rows: [
            operationRow(),
          ],
        },
        {
          contains:
            "UPDATE namla_v2_operation_claims",
          rows: [
            {
              operation_key: "op-1",
            },
          ],
        },
      ]);

    const store =
      new PostgresExecutionAuthorityStore(
        db,
      );

    const result =
      await store.failOperation({
        operationKey: "op-1",
        authority: authority(),
        claimToken: "claim-a",
        claimEpoch: 1,
        errorText:
          "provider failed closed",
      });

    assert.equal(result.ok, true);
    assert.equal(result.status, "FAILED");

    db.assertComplete();
  },
);

test(
  "R1B-PG2 refuses finalize when durable task authority expired",
  async () => {
    const db =
      new ScriptedDatabase([
        {
          contains:
            "FROM namla_v2_task_execution_leases",
          rows: [
            leaseRow({
              lease_expires_at:
                new Date(NOW),
            }),
          ],
        },
      ]);

    const store =
      new PostgresExecutionAuthorityStore(
        db,
      );

    const result =
      await store.completeOperation({
        operationKey: "op-1",
        authority: authority(),
        claimToken: "claim-a",
        claimEpoch: 1,
        value: { ok: true },
      });

    assert.equal(result.ok, false);
    assert.equal(
      result.reasonCode,
      "task-authority-expired",
    );

    db.assertComplete();
  },
);