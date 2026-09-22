import test from "node:test";
import assert from "node:assert/strict";

import {
  PostgresExecutionAuthorityStore,
} from "../v2/persistence/postgresExecutionAuthorityStore";

import type {
  PostgresCheckpointClient,
  PostgresCheckpointDatabase,
  PostgresCheckpointQueryResult,
} from "../v2/persistence/postgresMissionCheckpointStore";

const NOW = 1_800_000_000_000;

interface Step {
  readonly contains: string;
  readonly rows: readonly unknown[];
}

class ScriptedDb
  implements PostgresCheckpointDatabase {
  public readonly calls:
    string[] = [];

  private index = 0;

  public constructor(
    private readonly steps:
      readonly Step[],
  ) {}

  public async query<T = unknown>(
    sql: string,
  ): Promise<
    PostgresCheckpointQueryResult<T>
  > {
    throw new Error(
      `Unexpected direct query: ${sql}`,
    );
  }

  public async transaction<T>(
    work: (
      client:
        PostgresCheckpointClient,
    ) => Promise<T>,
  ): Promise<T> {
    const client:
      PostgresCheckpointClient = {
        query:
          async <R = unknown>(
            sql: string,
          ): Promise<
            PostgresCheckpointQueryResult<R>
          > => {
            const step =
              this.steps[
                this.index
              ];

            assert.ok(
              step,
              `Unexpected SQL: ${sql}`,
            );

            assert.ok(
              sql.includes(
                step.contains,
              ),
              `Expected SQL containing ${step.contains}`,
            );

            this.index += 1;
            this.calls.push(sql);

            return {
              rows:
                step.rows as
                  readonly R[],
              rowCount:
                step.rows.length,
            };
          },
      };

    return work(client);
  }

  public assertComplete(): void {
    assert.equal(
      this.index,
      this.steps.length,
    );
  }
}

function authorityRow(
  expiresAt = NOW + 60_000,
) {
  return {
    mission_id:
      "mission-1",
    task_id:
      "task-1",
    worker_id:
      "worker-1",
    authority_scope:
      "PRO/COLONY_A/task-1",
    lease_token:
      "lease-1",
    lease_epoch:
      "1",
    lease_expires_at:
      new Date(expiresAt),
    now_ms:
      String(NOW),
  };
}

function operationRow() {
  return {
    mission_id:
      "mission-1",
    operation_key:
      "op-1",
    task_id:
      "task-1",
    authority_scope:
      "PRO/COLONY_A/task-1",
    operation_type:
      "productization.tool-dispatch.v1",
    input_fingerprint:
      "a".repeat(64),
    status:
      "RUNNING",
    claim_owner_worker_id:
      "worker-1",
    claim_task_lease_token:
      "lease-1",
    claim_task_lease_epoch:
      "1",
    claim_token:
      "claim-1",
    claim_epoch:
      "1",
    claim_expires_at:
      new Date(
        NOW + 30_000,
      ),
    result:
      null,
    error_text:
      null,
    created_at:
      new Date(
        NOW - 100,
      ),
    updated_at:
      new Date(
        NOW - 100,
      ),
    finished_at:
      null,
  };
}

function authority() {
  return {
    missionId:
      "mission-1",
    taskId:
      "task-1",
    workerId:
      "worker-1",
    authorityScope:
      "PRO/COLONY_A/task-1",
    leaseToken:
      "lease-1",
    leaseEpoch:
      1,
    expiresAt:
      NOW + 60_000,
  };
}

test(
  "C9A PostgreSQL claim fence locks current task and operation rows and performs no write",
  async () => {
    const db =
      new ScriptedDb([
        {
          contains:
            "FROM namla_v2_task_execution_leases",
          rows: [
            authorityRow(),
          ],
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
      await store.validateOperationClaim({
        operationKey:
          "op-1",
        authority:
          authority(),
        claimToken:
          "claim-1",
        claimEpoch:
          1,
      });

    assert.equal(
      result.ok,
      true,
    );

    assert.equal(
      result.status,
      "VALID",
    );

    assert.equal(
      db.calls.some(
        (sql) =>
          /^\s*(?:INSERT|UPDATE|DELETE)\b/u.test(
            sql,
          ),
      ),
      false,
    );

    db.assertComplete();
  },
);

test(
  "C9A PostgreSQL claim fence refuses a wrong claim token without mutation",
  async () => {
    const db =
      new ScriptedDb([
        {
          contains:
            "FROM namla_v2_task_execution_leases",
          rows: [
            authorityRow(),
          ],
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
      await store.validateOperationClaim({
        operationKey:
          "op-1",
        authority:
          authority(),
        claimToken:
          "wrong",
        claimEpoch:
          1,
      });

    assert.equal(
      result.ok,
      false,
    );

    if (result.ok) {
      assert.fail();
    }

    assert.equal(
      result.reasonCode,
      "claim-token-mismatch",
    );

    db.assertComplete();
  },
);

test(
  "C9A PostgreSQL claim fence refuses an expired task lease before reading the operation row",
  async () => {
    const db =
      new ScriptedDb([
        {
          contains:
            "FROM namla_v2_task_execution_leases",
          rows: [
            authorityRow(NOW),
          ],
        },
      ]);

    const store =
      new PostgresExecutionAuthorityStore(
        db,
      );

    const result =
      await store.validateOperationClaim({
        operationKey:
          "op-1",
        authority:
          authority(),
        claimToken:
          "claim-1",
        claimEpoch:
          1,
      });

    assert.equal(
      result.ok,
      false,
    );

    if (result.ok) {
      assert.fail();
    }

    assert.equal(
      result.reasonCode,
      "task-authority-expired",
    );

    db.assertComplete();
  },
);
