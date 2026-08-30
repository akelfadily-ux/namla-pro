import test from "node:test";
import assert from "node:assert/strict";

import { PostgresStateRepository } from "../infrastructure/persistence/postgresStateRepository";
import { AntRole, RunStatus, TaskStatus } from "../domain/types";
import { StateConflictError } from "../domain/errors";

class MockPgClient {
  public rowsMap = new Map<string, any[]>();
  public queries: Array<{ sql: string; params?: any[] }> = [];

  async query<T = any>(sql: string, params: any[] = []): Promise<{ rows: T[]; rowCount?: number }> {
    this.queries.push({ sql, params });
    const normalized = sql.replace(/\s+/g, " ").trim().toUpperCase();

    if (normalized.startsWith("INSERT INTO RUNS")) {
      const [id, root_task_id, status, goal, repo, limits, created_at, updated_at] = params;
      const row = { id, root_task_id, status, goal, repository_path: repo, budget_limits: limits, created_at, updated_at };
      this.rowsMap.set(`run:${id}`, [row]);
      return { rows: [row as any], rowCount: 1 };
    }

    if (normalized.startsWith("SELECT * FROM RUNS WHERE ID =")) {
      const id = params[0];
      const row = this.rowsMap.get(`run:${id}`);
      return { rows: row ?? [] };
    }

    if (normalized.startsWith("UPDATE RUNS SET STATUS =")) {
      const [nextStatus, now, id, expectedStatus] = params;
      const existing = this.rowsMap.get(`run:${id}`);
      if (!existing || existing[0].status !== expectedStatus) {
        return { rows: [], rowCount: 0 };
      }
      existing[0].status = nextStatus;
      existing[0].updated_at = now;
      return { rows: existing, rowCount: 1 };
    }

    if (normalized.startsWith("INSERT INTO TASKS")) {
      const id = params[0];
      if (this.rowsMap.has(`task:${id}`)) {
        return { rows: [], rowCount: 0 };
      }
      const row = {
        id, run_id: params[1], parent_task_id: params[2], title: params[3], description: params[4],
        role: params[5], status: params[6], attempt: params[7], max_attempts: params[8], depth: params[9],
        requirements: params[10], dependencies: params[11], assigned_ant_id: params[12],
        lease_owner: params[13], lease_expires_at: params[14], created_at: params[15], updated_at: params[16]
      };
      this.rowsMap.set(`task:${id}`, [row]);
      return { rows: [row as any], rowCount: 1 };
    }

    if (normalized.startsWith("UPDATE TASKS SET LEASE_OWNER =")) {
      const [workerId, expiresAt, id] = params;
      const existing = this.rowsMap.get(`task:${id}`);
      if (!existing) return { rows: [], rowCount: 0 };
      existing[0].lease_owner = workerId;
      existing[0].lease_expires_at = expiresAt;
      return { rows: existing, rowCount: 1 };
    }

    if (normalized.startsWith("SELECT * FROM OPERATIONS WHERE OPERATION_ID =")) {
      const id = params[0];
      const row = this.rowsMap.get(`op:${id}`);
      return { rows: row ?? [] };
    }

    if (normalized.startsWith("INSERT INTO OPERATIONS")) {
      const [opId, run_id, task_id, ant_id, type, tool_name, input_hash, workerId, claimToken, expiresAt, now] = params;
      const row = { id: opId, operation_id: opId, run_id, task_id, ant_id, tool_name, input_hash, status: "RUNNING", owner: workerId, claim_token: claimToken, lease_expires_at: expiresAt, created_at: now };
      this.rowsMap.set(`op:${opId}`, [row]);
      return { rows: [row as any], rowCount: 1 };
    }

    if (normalized.startsWith("UPDATE OPERATIONS SET STATUS = 'COMPLETED'")) {
      const [resStr, opId] = params;
      const existing = this.rowsMap.get(`op:${opId}`);
      if (!existing) return { rows: [], rowCount: 0 };
      existing[0].status = "COMPLETED";
      existing[0].result = JSON.parse(resStr);
      return { rows: existing, rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  }
}

test("PostgresStateRepository integration semantics", async (t) => {
  await t.test("atomic operation claim and fencing tokens", async () => {
    const db = new MockPgClient();
    const repo = new PostgresStateRepository(db);

    const op = {
      id: "op-fence-1",
      toolName: "filesystem.write",
      inputHash: "hash123",
      runId: "run-100",
      taskId: "task-1",
      antId: "ant-1",
    };

    const claim1 = await repo.claimOperation(op, { workerId: "worker-1", leaseToken: "token-1" });
    assert.equal(claim1.status, "CLAIMED");
    assert.ok(claim1.claimToken);

    // Complete with matching token
    const completed = await repo.completeOperation("op-fence-1", "worker-1", claim1.claimToken!, { result: "ok" });
    assert.equal(completed, true);
  });

  await t.test("persists Run and enforces CAS transitions", async () => {
    const db = new MockPgClient();
    const repo = new PostgresStateRepository(db);

    const now = new Date();
    await repo.createRun({
      id: "run-100",
      status: RunStatus.Created,
      goal: "Test Postgres Run persistence",
      budgetLimits: { maxCostUsd: 5.0 },
      createdAt: now,
      updatedAt: now,
    });

    const run = await repo.getRun("run-100");
    assert.ok(run);
    assert.equal(run?.status, RunStatus.Created);

    const transitioned = await repo.transitionRun("run-100", RunStatus.Created, RunStatus.Planning);
    assert.equal(transitioned.status, RunStatus.Planning);

    await assert.rejects(
      () => repo.transitionRun("run-100", RunStatus.Created, RunStatus.Planning),
      StateConflictError,
    );
  });

  await t.test("createTask throws StateConflictError on duplicate insert", async () => {
    const db = new MockPgClient();
    const repo = new PostgresStateRepository(db);
    const now = new Date();

    const task = {
      id: "task-unique-1",
      runId: "run-100",
      title: "Unique Task",
      description: "Must not duplicate",
      status: TaskStatus.Created,
      role: AntRole.Engineer,
      attempt: 0,
      maxAttempts: 3,
      depth: 0,
      requirements: [],
      dependencies: [],
      createdAt: now,
      updatedAt: now,
    };

    await repo.createTask(task);
    await assert.rejects(() => repo.createTask(task), StateConflictError);
  });

  await t.test("claimTaskLease denies claim when Run status is not RUNNING", async () => {
    const db = new MockPgClient();
    const repo = new PostgresStateRepository(db);

    await repo.createRun({ id: "run-planning", status: RunStatus.Planning, goal: "Goal", budgetLimits: {}, createdAt: new Date(), updatedAt: new Date() });
    await repo.createTask({
      id: "t-planning",
      runId: "run-planning",
      title: "Title",
      description: "Desc",
      status: TaskStatus.Created,
      role: AntRole.Engineer,
      assignedAntId: "ant-1",
      attempt: 0,
      maxAttempts: 3,
      depth: 0,
      requirements: [],
      dependencies: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const claimInPlanning = await repo.claimTaskLease("t-planning", "worker-1");
    assert.equal(claimInPlanning, null, "Claim MUST be denied when Run is in PLANNING state");
  });
});
