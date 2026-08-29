import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { randomUUID } from "crypto";

import { MigrationRunner } from "../infrastructure/persistence/migrations";
import { PostgresStateRepository } from "../infrastructure/persistence/postgresStateRepository";
import { PostgresUnitOfWork } from "../infrastructure/persistence/postgresUnitOfWork";
import { AntRole, RunStatus, TaskStatus, AccountingRecoveryMode } from "../domain/types";
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
    await repo.createTask({ id: taskId, runId, title: "Fenced Task", description: "Desc", status: TaskStatus.Created, role: AntRole.Engineer, attempt: 0, maxAttempts: 3, depth: 0, requirements: [], dependencies: [], createdAt: new Date(), updatedAt: new Date() });

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
      return repo.claimTaskLease(targetTaskId, `worker-${workerIndex}`, 60_000, { maxConcurrency: 4 });
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

  await t.test("Cancellation Race: Worker claim denied when Run is CANCELLED", async () => {
    const repo = new PostgresStateRepository(pool as any, pool);
    const runId = randomUUID();
    const taskId = randomUUID();

    await repo.createRun({ id: runId, status: RunStatus.Created, goal: "Cancel Race", budgetLimits: {}, createdAt: new Date(), updatedAt: new Date() });
    await repo.createTask({ id: taskId, runId, title: "Cancel Task", description: "Desc", status: TaskStatus.Created, role: AntRole.Engineer, attempt: 0, maxAttempts: 3, depth: 0, requirements: [], dependencies: [], createdAt: new Date(), updatedAt: new Date() });

    await repo.transitionRun(runId, RunStatus.Created, RunStatus.Cancelled);

    const claimed = await repo.claimTaskLease(taskId, "worker-cancelled", 60_000);
    assert.equal(claimed, null, "Claim MUST be denied when run status is CANCELLED");
  });

  await t.test("Operation Claim 100-Worker Race on actual PostgreSQL server", async () => {
    const repo = new PostgresStateRepository(pool as any, pool);
    const runId = randomUUID();
    const taskId = randomUUID();

    await repo.createRun({ id: runId, status: RunStatus.Running, goal: "Op Race", budgetLimits: {}, createdAt: new Date(), updatedAt: new Date() });
    await repo.createTask({ id: taskId, runId, title: "Op Task", description: "Desc", status: TaskStatus.Created, role: AntRole.Engineer, attempt: 0, maxAttempts: 3, depth: 0, requirements: [], dependencies: [], createdAt: new Date(), updatedAt: new Date() });

    const claimedTask = await repo.claimTaskLease(taskId, "worker-op", 60_000);
    const authority = { workerId: "worker-op", leaseToken: claimedTask!.leaseToken! };

    const opInput = {
      id: randomUUID(),
      toolName: "filesystem.write",
      inputHash: "hash100",
      runId,
      taskId,
      antId: "ant-op",
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

  await t.test("Budget Reservation 100-Caller Race on actual PostgreSQL server", async () => {
    const repo = new PostgresStateRepository(pool as any, pool);
    const runId = randomUUID();

    await repo.createRun({
      id: runId,
      status: RunStatus.Running,
      goal: "Budget Race",
      budgetLimits: { maxCostUsd: 1.0 },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    let startBarrier = false;
    const reserveWorker = async () => {
      while (!startBarrier) await new Promise((r) => setTimeout(r, 1));
      return repo.reserveBudget(runId, 0.25, 100);
    };

    const promises = Array.from({ length: 100 }).map(() => reserveWorker());
    startBarrier = true;
    const results = await Promise.all(promises);

    const acceptedCount = results.filter((r) => r.reserved).length;
    assert.equal(acceptedCount, 4, "With $1.00 limit and $0.25 requests, exactly 4 callers must succeed");
  });

  await t.test("Accounting Recovery Transaction Rollback on actual PostgreSQL server", async () => {
    const repo = new PostgresStateRepository(pool as any, pool);
    const runId = randomUUID();

    await repo.createRun({ id: runId, status: RunStatus.Running, goal: "Acc Test", budgetLimits: {}, createdAt: new Date(), updatedAt: new Date() });
    await repo.setAccountingState(runId, "BLOCKED_UNKNOWN_BILLING", "Unbilled failure");

    const { mintTrustedRecoveryAuthority } = require("../bootstrap/trustedRecoveryBootstrap");

    // Unauthenticated/untrusted caller authority MUST be rejected
    const untrustedAuthority = { identity: "admin-fake", permissions: ["accounting:recover"] };
    const validEvidence = { type: "HUMAN_ADMIN_AUDIT" as const, adminIdentity: "admin-fake", approvalTicket: "TICKET-1", reconciledCostUsd: 0.50, reconciledTokens: 100 };

    await assert.rejects(async () => {
      await repo.recoverAccountingState(runId, AccountingRecoveryMode.HUMAN_RECONCILED, untrustedAuthority as any, validEvidence);
    }, "Unauthenticated caller claiming admin identity MUST be rejected");

    // Trusted recovery authority succeeds
    const trustedAuthority = mintTrustedRecoveryAuthority({ adminIdentity: "admin-real" });
    const result = await repo.recoverAccountingState(runId, AccountingRecoveryMode.HUMAN_RECONCILED, trustedAuthority, validEvidence);
    assert.equal(result.recovered, true);

    const state = await repo.getAccountingState(runId);
    assert.equal(state.state, "ACTIVE");
  });
});
