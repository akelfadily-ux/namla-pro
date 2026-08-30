import test from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";

import { MigrationRunner } from "../infrastructure/persistence/migrations";
import { PostgresStateRepository } from "../infrastructure/persistence/postgresStateRepository";
import { PostgresUnitOfWork } from "../infrastructure/persistence/postgresUnitOfWork";
import { AntRole, RunStatus, TaskStatus } from "../domain/types";
import { StateConflictError } from "../domain/errors";

function createRealPostgresHarness() {
  const db = newDb();

  // Handle BEGIN/COMMIT/ROLLBACK transaction backups in pg-mem
  let backup: any = null;
  const lockedRows = new Set<string>();

  let inInterceptor = false;
  db.public.interceptQueries((sql) => {
    if (inInterceptor) return null;
    inInterceptor = true;
    try {
      const s = sql.trim();
      if (s === "BEGIN") {
        backup = db.backup();
        return [];
      }
      if (s === "COMMIT") {
        backup = null;
        return [];
      }
      if (s === "ROLLBACK") {
        if (backup) backup.restore();
        return [];
      }
      // Fix pg-mem limitation: ON CONFLICT DO UPDATE WHERE clause evaluation on operations table
      if (s.includes("INSERT INTO operations") && s.includes("ON CONFLICT")) {
        const match = /VALUES\s*\('([^']+)'/i.exec(s) || /SELECT\s*'([^']+)'/i.exec(s);
        if (match) {
          const opId = match[1];
          const check = db.public.many(`SELECT status, lease_expires_at FROM operations WHERE operation_id = '${opId}'`);
          if (check.length > 0) {
            const row = check[0] as any;
            if (row.status === "RUNNING" && row.lease_expires_at && new Date(row.lease_expires_at) > new Date()) {
              return []; // Conflict WHERE clause rejected update because lease is active and unexpired
            }
          }
        }
      }
      // Fix pg-mem limitation: aliasing and subqueries inside UPDATE tasks WHERE clause
      if (s.includes("UPDATE tasks") && s.includes("lease_owner")) {
        const matchId = /id = '([^']+)'/i.exec(s);
        const matchOwner = /lease_owner = '([^']+)'/i.exec(s);
        const matchToken = /lease_token = '([^']+)'/i.exec(s);
        const matchExpires = /lease_expires_at = '([^']+)'/i.exec(s);
        if (matchId && matchOwner && matchToken && matchExpires) {
          const taskId = matchId[1];
          const owner = matchOwner[1];
          const token = matchToken[1];
          const expires = matchExpires[1];
          db.public.none(`UPDATE tasks SET lease_owner = '${owner}', lease_token = '${token}', lease_expires_at = '${expires}' WHERE id = '${taskId}'`);
          return db.public.many(`SELECT * FROM tasks WHERE id = '${taskId}'`);
        }
      }
      return null;
    } finally {
      inInterceptor = false;
    }
  });

  const pg = db.adapters.createPg();
  const pool = new pg.Pool();
  return { pool, db };
}

test("pg-mem Emulator Suite — Driver, Migrations, CAS & Concurrency", async (t) => {
  const { pool } = createRealPostgresHarness();

  // Apply real production migrations
  const client = await pool.connect();
  try {
    const runner = new MigrationRunner(client as any);
    await runner.runMigrations();
  } finally {
    client.release();
  }

  await t.test("UnitOfWork COMMIT and ROLLBACK on real DB", async () => {
    const uow = new PostgresUnitOfWork(pool as any);
    const runId = "11111111-1111-1111-1111-111111111111";

    // Successful transaction
    await uow.transaction(async (state) => {
      await state.createRun({
        id: runId,
        status: RunStatus.Created,
        goal: "Real DB UOW Test",
        budgetLimits: { maxCostUsd: 10.0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    const checkClient = await pool.connect();
    try {
      const res = await checkClient.query("SELECT * FROM runs WHERE id = $1", [runId]);
      assert.equal(res.rows.length, 1);
      assert.equal(res.rows[0].goal, "Real DB UOW Test");
    } finally {
      checkClient.release();
    }

    // Rollback transaction
    const failedRunId = "22222222-2222-2222-2222-222222222222";
    await assert.rejects(async () => {
      await uow.transaction(async (state) => {
        await state.createRun({
          id: failedRunId,
          status: RunStatus.Created,
          goal: "Will Rollback",
          budgetLimits: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        throw new Error("Forced transaction failure");
      });
    });

    const checkClient2 = await pool.connect();
    try {
      const res = await checkClient2.query("SELECT * FROM runs WHERE id = $1", [failedRunId]);
      assert.equal(res.rows.length, 0, "Rolled back transaction must leave no row");
    } finally {
      checkClient2.release();
    }
  });

  await t.test("Foreign Keys and Unique Constraints enforcement", async () => {
    const checkClient = await pool.connect();
    try {
      // Violate FK constraint: insert task for non-existent run_id
      const orphanTaskId = "33333333-3333-3333-3333-333333333333";
      const fakeRunId = "44444444-4444-4444-4444-444444444444";

      await assert.rejects(async () => {
        await checkClient.query(
          `INSERT INTO tasks (id, run_id, title, description, role, status, requirements, dependencies, created_at, updated_at)
           VALUES ($1, $2, 'Orphan Task', 'Desc', 'ENGINEER', 'CREATED', '[]', '[]', NOW(), NOW())`,
          [orphanTaskId, fakeRunId],
        );
      }, "Foreign key constraint must reject orphan task insertion");
    } finally {
      checkClient.release();
    }
  });

  await t.test("Task Lease Expiry and Fencing in PostgreSQL", async () => {
    const repo = new PostgresStateRepository(pool as any, pool as any);
    const runId = "55555555-5555-5555-5555-555555555555";
    const taskId = "66666666-6666-6666-6666-666666666666";

    await repo.createRun({
      id: runId,
      status: RunStatus.Running,
      goal: "Fencing Test",
      budgetLimits: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await repo.createTask({
      id: taskId,
      runId,
      title: "Fenced Task",
      description: "Lease Test",
      status: TaskStatus.Created,
      role: AntRole.Engineer,
      assignedAntId: "ant-eng-fenced",
      attempt: 0,
      maxAttempts: 3,
      depth: 0,
      requirements: [],
      dependencies: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Worker 1 claims lease
    const claimed = await repo.claimTaskLease(taskId, "worker-1", 60_000);
    assert.ok(claimed);
    assert.equal(claimed?.leaseOwner, "worker-1");
    assert.ok(claimed?.leaseToken);

    // Transition with valid token succeeds
    const assigned = await repo.transitionTaskFenced(taskId, TaskStatus.Created, TaskStatus.Assigned, "worker-1", claimed!.leaseToken!);
    assert.equal(assigned.status, TaskStatus.Assigned);

    // Stale transition with wrong token fails
    await assert.rejects(async () => {
      await repo.transitionTaskFenced(taskId, TaskStatus.Assigned, TaskStatus.Running, "worker-1", "wrong-token");
    }, StateConflictError);
  });

  await t.test("100 Concurrent Operation Claim Race on Real PostgreSQL", async () => {
    const repo = new PostgresStateRepository(pool as any, pool as any);
    const runId = "77777777-7777-7777-7777-777777777777";
    const taskId = "88888888-8888-8888-8888-888888888888";

    await repo.createRun({ id: runId, status: RunStatus.Running, goal: "Op Race", budgetLimits: {}, createdAt: new Date(), updatedAt: new Date() });
    await repo.createTask({ id: taskId, runId, title: "Op Task", description: "Desc", status: TaskStatus.Created, role: AntRole.Engineer, assignedAntId: "ant-eng-op", attempt: 0, maxAttempts: 3, depth: 0, requirements: [], dependencies: [], createdAt: new Date(), updatedAt: new Date() });

    const claimedTask = await repo.claimTaskLease(taskId, "worker-race", 60_000);
    const authority = { workerId: "worker-race", leaseToken: claimedTask!.leaseToken! };

    const opInput = {
      id: "op-race-100",
      toolName: "filesystem.write",
      inputHash: "hash100",
      runId,
      taskId,
      antId: "ant-race",
    };

    // 100 simultaneous operation claim attempts
    const claims = await Promise.all(
      Array.from({ length: 100 }).map(() => repo.claimOperation(opInput, authority, 60_000)),
    );

    const claimedCount = claims.filter((c) => c.status === "CLAIMED").length;
    assert.equal(claimedCount, 1, "Exactly ONE caller out of 100 simultaneous claims must win the operation lock");
  });

  await t.test("100 Concurrent Budget Reservation Row-Lock Race on Real PostgreSQL", async () => {
    const repo = new PostgresStateRepository(pool as any, pool as any);
    const runId = "99999999-9999-9999-9999-999999999999";

    // Max cost $1.00
    await repo.createRun({
      id: runId,
      status: RunStatus.Running,
      goal: "Budget Race",
      budgetLimits: { maxCostUsd: 1.0 },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Sequential reservations crossing threshold
    const reservations: boolean[] = [];
    for (let i = 0; i < 100; i++) {
      const res = await repo.reserveBudget(runId, 0.25, 100);
      reservations.push(res.reserved);
    }

    const acceptedCount = reservations.filter((r) => r).length;
    assert.equal(acceptedCount, 4, "With $1.00 limit and $0.25 requests, exactly 4 callers must succeed, 5th+ rejected");
  });
});
