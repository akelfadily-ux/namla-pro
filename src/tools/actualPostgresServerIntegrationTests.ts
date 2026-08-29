import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";

import { MigrationRunner } from "../infrastructure/persistence/migrations";
import { PostgresStateRepository } from "../infrastructure/persistence/postgresStateRepository";
import { PostgresUnitOfWork } from "../infrastructure/persistence/postgresUnitOfWork";
import { AntRole, RunStatus, TaskStatus } from "../domain/types";
import { StateConflictError } from "../domain/errors";

const dbUrl = process.env.DATABASE_URL;

test("Actual PostgreSQL Server Integration & Multi-Session Concurrency Suite", { skip: !dbUrl ? "Skipped: DATABASE_URL environment variable absent" : false }, async (t) => {
  const pool = new Pool({ connectionString: dbUrl });

  t.after(async () => {
    await pool.end();
  });

  // Run production migrations on actual PostgreSQL server
  const client = await pool.connect();
  try {
    const runner = new MigrationRunner(client as any);
    await runner.runMigrations();
  } finally {
    client.release();
  }

  await t.test("UnitOfWork COMMIT and ROLLBACK on actual PostgreSQL server", async () => {
    const uow = new PostgresUnitOfWork(pool as any);
    const runId = "11111111-1111-1111-1111-111111111111";

    await uow.transaction(async (state) => {
      await state.createRun({
        id: runId,
        status: RunStatus.Created,
        goal: "Actual Postgres UOW Test",
        budgetLimits: { maxCostUsd: 10.0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    const checkRes = await pool.query("SELECT * FROM runs WHERE id = $1", [runId]);
    assert.equal(checkRes.rows.length, 1);

    const failedRunId = "22222222-2222-2222-2222-222222222222";
    await assert.rejects(async () => {
      await uow.transaction(async (state) => {
        await state.createRun({
          id: failedRunId,
          status: RunStatus.Created,
          goal: "Rollback Test",
          budgetLimits: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        throw new Error("Forced failure");
      });
    });

    const checkRes2 = await pool.query("SELECT * FROM runs WHERE id = $1", [failedRunId]);
    assert.equal(checkRes2.rows.length, 0);
  });

  await t.test("Actual Multi-Session Concurrency Race for maxConcurrency", async () => {
    const runId = "33333333-3333-3333-3333-333333333333";
    const repo = new PostgresStateRepository(pool as any, pool);

    await repo.createRun({
      id: runId,
      status: RunStatus.Running,
      goal: "Multi Session Max Concurrency Race",
      budgetLimits: { maxConcurrency: 4 },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Create 10 tasks for this run
    const taskIds: string[] = [];
    for (let i = 0; i < 10; i++) {
      const taskId = `task-conc-${i}-${Date.now()}`;
      taskIds.push(taskId);
      await repo.createTask({
        id: taskId,
        runId,
        title: `Task ${i}`,
        description: "Desc",
        status: TaskStatus.Created,
        role: AntRole.Engineer,
        attempt: 0,
        maxAttempts: 3,
        depth: 0,
        requirements: [],
        dependencies: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    // 100 simultaneous workers racing to claim task leases across independent backend sessions using start barrier
    let startBarrier = false;

    const claimWorker = async (workerIndex: number, targetTaskId: string) => {
      while (!startBarrier) {
        await new Promise((r) => setTimeout(r, 1));
      }
      return repo.claimTaskLease(targetTaskId, `worker-${workerIndex}`, 60_000, { maxConcurrency: 4 });
    };

    const promises = [];
    for (let i = 0; i < 100; i++) {
      const targetTaskId = taskIds[i % taskIds.length];
      promises.push(claimWorker(i, targetTaskId));
    }

    startBarrier = true;
    const results = await Promise.all(promises);

    const successfulClaims = results.filter(Boolean);
    assert.ok(
      successfulClaims.length <= 4,
      `With maxConcurrency=4, successful active claims (${successfulClaims.length}) MUST NOT exceed 4`,
    );
  });
});
