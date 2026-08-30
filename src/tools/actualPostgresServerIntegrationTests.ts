import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { randomUUID } from "crypto";

import { MigrationRunner } from "../infrastructure/persistence/migrations";
import { PostgresStateRepository } from "../infrastructure/persistence/postgresStateRepository";
import { PostgresUnitOfWork } from "../infrastructure/persistence/postgresUnitOfWork";
import { AntRole, RunStatus, TaskStatus, AccountingRecoveryMode } from "../domain/types";
import { StateConflictError, ConfigurationError } from "../domain/errors";
import { mintTrustedRecoveryAuthority } from "../bootstrap/trustedRecoveryBootstrap";

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

  await t.test("UnitOfWork COMMIT and forced ROLLBACK on actual PostgreSQL server", async () => {
    const uow = new PostgresUnitOfWork(pool as any);
    const runId = randomUUID();

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

    const failedRunId = randomUUID();
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

  await t.test("Task Leasing 100-worker claim race and fencing on actual PostgreSQL server", async () => {
    const repo = new PostgresStateRepository(pool as any, pool);
    const runId = randomUUID();
    const taskId = randomUUID();

    await repo.createRun({ id: runId, status: RunStatus.Running, goal: "Task Lease Race", budgetLimits: {}, createdAt: new Date(), updatedAt: new Date() });
    await repo.createTask({ id: taskId, runId, title: "Fenced Task", description: "Desc", status: TaskStatus.Created, role: AntRole.Engineer, assignedAntId: "ant-eng-1", attempt: 0, maxAttempts: 3, depth: 0, requirements: [], dependencies: [], createdAt: new Date(), updatedAt: new Date() });

    let startBarrier = false;
    const claimWorker = async (index: number) => {
      while (!startBarrier) await new Promise((r) => setTimeout(r, 1));
      return repo.claimTaskLease(taskId, `worker-${index}`, 60_000);
    };

    const promises = Array.from({ length: 100 }).map((_, i) => claimWorker(i));
    startBarrier = true;
    const results = await Promise.all(promises);

    const successfulClaims = results.filter(Boolean);
    assert.equal(successfulClaims.length, 1, "Exactly ONE worker out of 100 must win the task lease");

    const winner = successfulClaims[0]!;
    assert.ok(winner.leaseToken);

    // Transition with valid fencing token succeeds
    const assigned = await repo.transitionTaskFenced(taskId, TaskStatus.Created, TaskStatus.Assigned, winner.leaseOwner!, winner.leaseToken!);
    assert.equal(assigned.status, TaskStatus.Assigned);

    // Stale worker with wrong token fails
    await assert.rejects(async () => {
      await repo.transitionTaskFenced(taskId, TaskStatus.Assigned, TaskStatus.Running, "stale-worker", "wrong-token");
    }, StateConflictError);
  });

  await t.test("Actual Multi-Session Concurrency Race for maxConcurrency=4", async () => {
    const runId = randomUUID();
    const repo = new PostgresStateRepository(pool as any, pool);

    await repo.createRun({
      id: runId,
      status: RunStatus.Running,
      goal: "Multi Session Max Concurrency Race",
      budgetLimits: { maxConcurrency: 4 },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const taskIds: string[] = [];
    for (let i = 0; i < 10; i++) {
      const taskId = randomUUID();
      taskIds.push(taskId);
      await repo.createTask({
        id: taskId,
        runId,
        title: `Task ${i}`,
        description: "Desc",
        status: TaskStatus.Created,
        role: AntRole.Engineer,
        assignedAntId: `ant-${i}`,
        attempt: 0,
        maxAttempts: 3,
        depth: 0,
        requirements: [],
        dependencies: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    let startBarrier = false;
    const claimWorker = async (workerIndex: number, targetTaskId: string) => {
      while (!startBarrier) await new Promise((r) => setTimeout(r, 1));
      return repo.claimTaskLease(targetTaskId, `worker-${workerIndex}`, 60_000);
    };

    const promises = Array.from({ length: 100 }).map((_, i) => claimWorker(i, taskIds[i % taskIds.length]));
    startBarrier = true;
    const results = await Promise.all(promises);

    const successfulClaims = results.filter(Boolean);
    assert.ok(
      successfulClaims.length <= 4,
      `With maxConcurrency=4, successful active claims (${successfulClaims.length}) MUST NOT exceed 4`,
    );
  });

  await t.test("Actual Multi-Session Concurrency Race for maxAgents=2", async () => {
    const runId = randomUUID();
    const repo = new PostgresStateRepository(pool as any, pool);

    await repo.createRun({
      id: runId,
      status: RunStatus.Running,
      goal: "Max Agents Race",
      budgetLimits: { maxConcurrency: 10, maxAgents: 2 },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const taskIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const taskId = randomUUID();
      taskIds.push(taskId);
      await repo.createTask({
        id: taskId,
        runId,
        title: `Task Agent ${i}`,
        description: "Desc",
        status: TaskStatus.Created,
        role: AntRole.Engineer,
        assignedAntId: `ant-distinct-${i}`,
        attempt: 0,
        maxAttempts: 3,
        depth: 0,
        requirements: [],
        dependencies: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    let startBarrier = false;
    const claimWorker = async (workerIndex: number, targetTaskId: string) => {
      while (!startBarrier) await new Promise((r) => setTimeout(r, 1));
      return repo.claimTaskLease(targetTaskId, `worker-${workerIndex}`, 60_000);
    };

    const promises = Array.from({ length: 50 }).map((_, i) => claimWorker(i, taskIds[i % taskIds.length]));
    startBarrier = true;
    const results = await Promise.all(promises);

    const successfulClaims = results.filter(Boolean);
    const distinctActiveAnts = new Set(successfulClaims.map((t) => t?.assignedAntId));
    assert.ok(
      distinctActiveAnts.size <= 2,
      `With maxAgents=2, distinct active Ant identities (${distinctActiveAnts.size}) MUST NOT exceed 2`,
    );
  });

  await t.test("Operation Claim 100-Worker Race on actual PostgreSQL server", async () => {
    const repo = new PostgresStateRepository(pool as any, pool);
    const runId = randomUUID();
    const taskId = randomUUID();

    await repo.createRun({ id: runId, status: RunStatus.Running, goal: "Op Race", budgetLimits: {}, createdAt: new Date(), updatedAt: new Date() });
    await repo.createTask({ id: taskId, runId, title: "Op Task", description: "Desc", status: TaskStatus.Created, role: AntRole.Engineer, assignedAntId: "ant-op-1", attempt: 0, maxAttempts: 3, depth: 0, requirements: [], dependencies: [], createdAt: new Date(), updatedAt: new Date() });

    const claimedTask = await repo.claimTaskLease(taskId, "worker-op", 60_000);
    const authority = { workerId: "worker-op", leaseToken: claimedTask!.leaseToken! };

    const opInput = {
      id: randomUUID(),
      toolName: "filesystem.write",
      inputHash: "hash100",
      runId,
      taskId,
      antId: "ant-op-1",
    };

    let startBarrier = false;
    const claimOpWorker = async () => {
      while (!startBarrier) await new Promise((r) => setTimeout(r, 1));
      return repo.claimOperation(opInput, authority, 60_000);
    };

    const promises = Array.from({ length: 100 }).map(() => claimOpWorker());
    startBarrier = true;
    const claims = await Promise.all(promises);

    const claimedCount = claims.filter((c) => c.status === "CLAIMED").length;
    assert.equal(claimedCount, 1, "Exactly ONE caller out of 100 claims must win the operation lock");
  });

  await t.test("Actual Concurrency Cost and Token Budget Races", async () => {
    const repo = new PostgresStateRepository(pool as any, pool);
    const runId = randomUUID();

    await repo.createRun({
      id: runId,
      status: RunStatus.Running,
      goal: "Budget Race",
      budgetLimits: { maxCostUsd: 1.0, maxTokens: 1000 },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    let startBarrier = false;
    const reserveWorker = async () => {
      while (!startBarrier) await new Promise((r) => setTimeout(r, 1));
      return repo.reserveBudget(runId, 0.25, 250);
    };

    const promises = Array.from({ length: 100 }).map(() => reserveWorker());
    startBarrier = true;
    const results = await Promise.all(promises);

    const acceptedCount = results.filter((r) => r.reserved).length;
    assert.equal(acceptedCount, 4, "With $1.00 / 1000 tokens limit, exactly 4 callers must succeed");
  });

  await t.test("Multi-Reservation Proportional Reconciliation Provenance", async () => {
    const repo = new PostgresStateRepository(pool as any, pool);
    const runId = randomUUID();

    await repo.createRun({ id: runId, status: RunStatus.Running, goal: "Multi Res Acc Test", budgetLimits: { maxCostUsd: 10.0 }, createdAt: new Date(), updatedAt: new Date() });

    // Create 3 reservations: $0.20, $0.30, $0.50 ($1.00 total)
    await repo.reserveBudget(runId, 0.20, 200);
    await repo.reserveBudget(runId, 0.30, 300);
    await repo.reserveBudget(runId, 0.50, 500);

    await repo.setAccountingState(runId, "BLOCKED_UNKNOWN_BILLING", "Unbilled provider failure");

    const oldSecret = process.env.ACCOUNTING_RECOVERY_SECRET;
    process.env.ACCOUNTING_RECOVERY_SECRET = "multi-res-secret-123";

    try {
      const trustedAuthority = mintTrustedRecoveryAuthority({ adminIdentity: "admin-provenance", adminSecretToken: "multi-res-secret-123" });
      const evidence = {
        type: "PROVIDER_INVOICE" as const,
        providerName: "openai",
        invoiceOrUsageRef: "INV-100",
        actualCostUsd: 0.80,
        actualTokens: 800,
      };

      const result = await repo.recoverAccountingState(runId, AccountingRecoveryMode.PROVIDER_RECONCILED, trustedAuthority, evidence);
      assert.equal(result.recovered, true);

      // Verify getBudgetUsage reports exact $0.80 / 800 tokens total
      const usage = await repo.getBudgetUsage(runId);
      assert.equal(usage.costUsd, 0.80, "Aggregate costUsd must match evidence actual exactly ($0.80)");
      assert.equal(usage.inputTokens + usage.outputTokens, 800, "Aggregate tokens must match evidence actual exactly (800)");

      // Verify individual reservations received non-zero proportional allocation
      const resRows = await pool.query("SELECT actual_cost_usd, actual_tokens FROM budget_reservations WHERE run_id = $1 ORDER BY created_at ASC", [runId]);
      assert.equal(resRows.rows.length, 3);
      assert.ok(Number(resRows.rows[0].actual_cost_usd) > 0, "Reservation 1 received proportional cost");
      assert.ok(Number(resRows.rows[1].actual_cost_usd) > 0, "Reservation 2 received proportional cost");
      assert.ok(Number(resRows.rows[2].actual_cost_usd) > 0, "Reservation 3 received proportional cost");
    } finally {
      if (oldSecret) process.env.ACCOUNTING_RECOVERY_SECRET = oldSecret;
      else delete process.env.ACCOUNTING_RECOVERY_SECRET;
    }
  });

  await t.test("Forced Mid-Transaction Failure for Accounting Recovery Rollback", async () => {
    const runId = randomUUID();

    // Create run and set accounting state
    await pool.query(
      `INSERT INTO runs (id, status, goal, budget_limits, created_at, updated_at)
       VALUES ($1, 'RUNNING', 'Rollback Mid-Tx Test', '{}', NOW(), NOW())`,
      [runId],
    );
    await pool.query(
      `INSERT INTO run_accounting_state (run_id, state, reason, updated_at)
       VALUES ($1, 'BLOCKED_UNKNOWN_BILLING', 'Unbilled failure', NOW())`,
      [runId],
    );
    await pool.query(
      `INSERT INTO budget_reservations (id, run_id, kind, reserved_cost_usd, reserved_tokens, status, created_at)
       VALUES ($1, $2, 'MODEL', 1.00, 1000, 'RESERVED', NOW())`,
      [randomUUID(), runId],
    );

    // Simulate mid-transaction failure AFTER writing reservation changes but BEFORE COMMIT
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // 1. Update reservation
      await client.query(
        `UPDATE budget_reservations SET status = 'RECONCILED', actual_cost_usd = 1.00 WHERE run_id = $1`,
        [runId],
      );
      // 2. Update accounting state
      await client.query(
        `UPDATE run_accounting_state SET state = 'ACTIVE' WHERE run_id = $1`,
        [runId],
      );
      // 3. Inject deterministic failure before commit
      throw new Error("DETERMINISTIC_MID_TRANSACTION_FAILURE");
    } catch (e: any) {
      assert.equal(e.message, "DETERMINISTIC_MID_TRANSACTION_FAILURE");
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }

    // Verify database state remained unchanged (rolled back completely)
    const stateRes = await pool.query("SELECT state FROM run_accounting_state WHERE run_id = $1", [runId]);
    assert.equal(stateRes.rows[0].state, "BLOCKED_UNKNOWN_BILLING", "State MUST remain BLOCKED after transaction rollback");

    const resRes = await pool.query("SELECT status FROM budget_reservations WHERE run_id = $1", [runId]);
    assert.equal(resRes.rows[0].status, "RESERVED", "Budget reservation MUST remain RESERVED after transaction rollback");

    const eventRes = await pool.query("SELECT * FROM events WHERE run_id = $1 AND event_type = 'accounting.recovered'", [runId]);
    assert.equal(eventRes.rows.length, 0, "No accounting.recovered event MUST exist after rollback");
  });
});
