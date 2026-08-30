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

  await t.test("Task Lease Expiry using PostgreSQL NOW() and replacement worker recovery", async () => {
    const repo = new PostgresStateRepository(pool as any, pool);
    const runId = randomUUID();
    const taskId = randomUUID();

    await repo.createRun({ id: runId, status: RunStatus.Running, goal: "Expiry Test", budgetLimits: {}, createdAt: new Date(), updatedAt: new Date() });
    await repo.createTask({ id: taskId, runId, title: "Expiring Task", description: "Desc", status: TaskStatus.Created, role: AntRole.Engineer, assignedAntId: "ant-exp-1", attempt: 0, maxAttempts: 3, depth: 0, requirements: [], dependencies: [], createdAt: new Date(), updatedAt: new Date() });

    // Worker 1 claims lease with 1ms duration (expires immediately in PostgreSQL NOW())
    const claimed1 = await repo.claimTaskLease(taskId, "worker-1", 1);
    assert.ok(claimed1);
    const token1 = claimed1.leaseToken!;

    // Wait 50ms so NOW() > lease_expires_at
    await new Promise((r) => setTimeout(r, 50));

    // Stale owner cannot renew after expiry
    const renewed = await repo.renewTaskLease(taskId, "worker-1", token1, 60_000);
    assert.equal(renewed, false, "Stale owner renewal MUST fail after lease expiry");

    // Stale owner cannot perform fenced transition
    await assert.rejects(async () => {
      await repo.transitionTaskFenced(taskId, TaskStatus.Created, TaskStatus.Assigned, "worker-1", token1);
    }, StateConflictError, "Stale owner transition MUST fail after lease expiry");

    // Replacement worker can claim after valid expiry
    const replacementClaim = await repo.claimTaskLease(taskId, "worker-2", 60_000);
    assert.ok(replacementClaim, "Replacement worker MUST acquire lease after previous lease expires");
    assert.equal(replacementClaim.leaseOwner, "worker-2");

    // Previous worker remains fenced
    await assert.rejects(async () => {
      await repo.transitionTaskFenced(taskId, TaskStatus.Created, TaskStatus.Assigned, "worker-1", token1);
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

  await t.test("Operation Claim 100-Worker Race and Complete/Fail Fencing", async () => {
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

    const winnerClaim = claims.find((c) => c.status === "CLAIMED")!;
    const claimToken = winnerClaim.claimToken!;

    // Complete operation with wrong worker fails
    const wrongWorkerComp = await repo.completeOperation(opInput.id, "wrong-worker", claimToken, { ok: true });
    assert.equal(wrongWorkerComp, false, "completeOperation MUST fail for wrong worker");

    // Complete operation with wrong claim token fails
    const wrongTokenComp = await repo.completeOperation(opInput.id, "worker-op", "wrong-claim-token", { ok: true });
    assert.equal(wrongTokenComp, false, "completeOperation MUST fail for wrong claim token");

    // Fail operation with wrong claim token fails
    const wrongTokenFail = await repo.failOperation(opInput.id, "worker-op", "wrong-claim-token", "error");
    assert.equal(wrongTokenFail, false, "failOperation MUST fail for wrong claim token");

    // Valid completion succeeds
    const validComp = await repo.completeOperation(opInput.id, "worker-op", claimToken, { ok: true });
    assert.equal(validComp, true, "completeOperation MUST succeed for valid owner and claimToken");

    // Completed operation replay returns COMPLETED
    const replayClaim = await repo.claimOperation(opInput, authority, 60_000);
    assert.equal(replayClaim.status, "COMPLETED", "Completed operation claim replay MUST return COMPLETED");
  });

  await t.test("Stale Task authority cannot claim Operation", async () => {
    const repo = new PostgresStateRepository(pool as any, pool);
    const runId = randomUUID();
    const taskId = randomUUID();

    await repo.createRun({ id: runId, status: RunStatus.Running, goal: "Stale Op Test", budgetLimits: {}, createdAt: new Date(), updatedAt: new Date() });
    await repo.createTask({ id: taskId, runId, title: "Task", description: "Desc", status: TaskStatus.Created, role: AntRole.Engineer, assignedAntId: "ant-1", attempt: 0, maxAttempts: 3, depth: 0, requirements: [], dependencies: [], createdAt: new Date(), updatedAt: new Date() });

    const opInput = {
      id: randomUUID(),
      toolName: "filesystem.write",
      inputHash: "hash-stale",
      runId,
      taskId,
      antId: "ant-1",
    };

    // Stale authority (no active task lease in DB)
    const staleAuth = { workerId: "worker-unleased", leaseToken: "fake-token" };
    const claimRes = await repo.claimOperation(opInput, staleAuth, 60_000);
    assert.equal(claimRes.status, "TASK_AUTHORITY_LOST", "Stale task authority MUST be denied operation claim");
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

  await t.test("Cancellation Race: Independent session cancellation denies claim and operation", async () => {
    const repo = new PostgresStateRepository(pool as any, pool);
    const runId = randomUUID();
    const taskId = randomUUID();

    await repo.createRun({ id: runId, status: RunStatus.Running, goal: "Cancel Race", budgetLimits: {}, createdAt: new Date(), updatedAt: new Date() });
    await repo.createTask({ id: taskId, runId, title: "Cancel Task", description: "Desc", status: TaskStatus.Created, role: AntRole.Engineer, assignedAntId: "ant-cancel-1", attempt: 0, maxAttempts: 3, depth: 0, requirements: [], dependencies: [], createdAt: new Date(), updatedAt: new Date() });

    // Client session 2 cancels run
    const client2 = await pool.connect();
    try {
      await client2.query("UPDATE runs SET status = 'CANCELLED' WHERE id = $1", [runId]);
    } finally {
      client2.release();
    }

    // Client session 1 attempts task claim
    const claimed = await repo.claimTaskLease(taskId, "worker-cancelled", 60_000);
    assert.equal(claimed, null, "Task claim MUST be denied on CANCELLED run");

    // Stale authority attempt to claim operation on cancelled run
    const cancelOpInput = { id: randomUUID(), toolName: "shell", inputHash: "h1", runId, taskId, antId: "ant-cancel-1" };
    const staleOpClaim = await repo.claimOperation(
      cancelOpInput,
      { workerId: "worker-cancelled", leaseToken: "stale-token" },
      60_000,
    );
    assert.equal(staleOpClaim.status, "TASK_AUTHORITY_LOST", "Operation claim MUST return TASK_AUTHORITY_LOST after cancellation");
  });

  await t.test("Worker Capability Matching on actual PostgreSQL server", async () => {
    const repo = new PostgresStateRepository(pool as any, pool);
    const runId = randomUUID();
    const taskId = randomUUID();

    await repo.createRun({ id: runId, status: RunStatus.Running, goal: "Capability Test", budgetLimits: {}, createdAt: new Date(), updatedAt: new Date() });
    await repo.createTask({ id: taskId, runId, title: "Docker Task", description: "Desc", status: TaskStatus.Created, role: AntRole.DevOps, assignedAntId: "ant-devops-1", attempt: 0, maxAttempts: 3, depth: 0, requirements: ["docker"], dependencies: [], createdAt: new Date(), updatedAt: new Date() });

    // Incapable worker denied
    const denied = await repo.claimTaskLease(taskId, "worker-lacks-docker", 60_000, ["shell", "git"]);
    assert.equal(denied, null, "Worker lacking docker capability MUST be denied claim");

    // Capable worker granted
    const granted = await repo.claimTaskLease(taskId, "worker-has-docker", 60_000, ["shell", "docker"]);
    assert.ok(granted, "Worker possessing docker capability MUST succeed");
  });

  await t.test("Multi-Reservation Aggregate Reconciliation Ledger Provenance", async () => {
    const repo = new PostgresStateRepository(pool as any, pool);
    const runId = randomUUID();

    await repo.createRun({ id: runId, status: RunStatus.Running, goal: "Multi Res Acc Test", budgetLimits: { maxCostUsd: 10.0 }, createdAt: new Date(), updatedAt: new Date() });

    // Create 3 reservations
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

      // Verify reconciliation ledger row was created and old reserved rows settled
      const ledgerRes = await pool.query("SELECT * FROM budget_reservations WHERE run_id = $1 AND kind = 'RECONCILIATION'", [runId]);
      assert.equal(ledgerRes.rows.length, 1, "Dedicated RECONCILIATION ledger row MUST be created");
      assert.equal(Number(ledgerRes.rows[0].actual_cost_usd), 0.80);
    } finally {
      if (oldSecret) process.env.ACCOUNTING_RECOVERY_SECRET = oldSecret;
      else delete process.env.ACCOUNTING_RECOVERY_SECRET;
    }
  });

  await t.test("Production recoverAccountingState Fault Injection Mid-Transaction Rollback", async () => {
    const repo = new PostgresStateRepository(pool as any, pool);
    const runId = randomUUID();

    await repo.createRun({ id: runId, status: RunStatus.Running, goal: "Rollback Mid-Tx Test", budgetLimits: {}, createdAt: new Date(), updatedAt: new Date() });
    await repo.setAccountingState(runId, "BLOCKED_UNKNOWN_BILLING", "Unbilled failure");
    await repo.reserveBudget(runId, 1.00, 1000);

    const oldSecret = process.env.ACCOUNTING_RECOVERY_SECRET;
    process.env.ACCOUNTING_RECOVERY_SECRET = "rollback-secret-key-999";

    try {
      const trustedAuthority = mintTrustedRecoveryAuthority({ adminIdentity: "admin-rollback", adminSecretToken: "rollback-secret-key-999" });
      const validEvidence = { type: "HUMAN_ADMIN_AUDIT" as const, adminIdentity: "admin-rollback", approvalTicket: "TICKET-100", reconciledCostUsd: 1.00, reconciledTokens: 1000 };

      // Pass fault injection hook throwing error right before COMMIT
      await assert.rejects(async () => {
        await repo.recoverAccountingState(
          runId,
          AccountingRecoveryMode.HUMAN_RECONCILED,
          trustedAuthority,
          validEvidence,
          async () => {
            throw new Error("FAULT_INJECTION_BEFORE_COMMIT");
          },
        );
      }, /FAULT_INJECTION_BEFORE_COMMIT/);

      // Verify database state remained unchanged (rolled back completely)
      const state = await repo.getAccountingState(runId);
      assert.equal(state.state, "BLOCKED_UNKNOWN_BILLING", "State MUST remain BLOCKED after fault injection rollback");

      const eventRes = await pool.query("SELECT * FROM events WHERE run_id = $1 AND event_type = 'accounting.recovered'", [runId]);
      assert.equal(eventRes.rows.length, 0, "No accounting.recovered event MUST exist after rollback");

      // Verify subsequent valid recovery call succeeds safely
      const retryResult = await repo.recoverAccountingState(runId, AccountingRecoveryMode.HUMAN_RECONCILED, trustedAuthority, validEvidence);
      assert.equal(retryResult.recovered, true, "Subsequent valid recovery retry MUST succeed safely");

      const finalState = await repo.getAccountingState(runId);
      assert.equal(finalState.state, "ACTIVE", "Accounting state MUST be ACTIVE after successful recovery");
    } finally {
      if (oldSecret) process.env.ACCOUNTING_RECOVERY_SECRET = oldSecret;
      else delete process.env.ACCOUNTING_RECOVERY_SECRET;
    }
  });
});
