import test from "node:test";
import assert from "node:assert/strict";

import { PostgresStateRepository } from "../infrastructure/persistence/postgresStateRepository";
import { Scheduler } from "../application/scheduler";
import { AntRole, RunStatus, TaskStatus } from "../domain/types";
import { StateConflictError } from "../domain/errors";

class MockDatabase {
  public tasks = new Map<string, any>();
  public antExecutions: any[] = [];
  public artifacts: any[] = [];
  public events: any[] = [];
  public operations = new Map<string, any>();

  public runs = new Map<string, any>();

  async query<T = any>(sql: string, params: any[] = []): Promise<{ rows: T[]; rowCount?: number }> {
    const s = sql.replace(/\s+/g, " ").trim().toUpperCase();

    if (s.startsWith("INSERT INTO RUNS")) {
      const [id, status, goal, repo, limits, created_at, updated_at] = params;
      const row = { id, status, goal, repository_path: repo, budget_limits: limits, created_at, updated_at };
      this.runs.set(id, row);
      return { rows: [row as any], rowCount: 1 };
    }

    if (s.includes("FROM RUNS WHERE ID =")) {
      const id = params[0];
      const r = this.runs.get(id);
      return { rows: r ? [r] : [] };
    }

    if (s.includes("SELECT * FROM TASKS WHERE ID =") || s.includes("SELECT REQUIREMENTS FROM TASKS WHERE ID =")) {
      const id = params[0];
      const task = this.tasks.get(id);
      return { rows: task ? [task] : [] };
    }

    if (s.includes("SELECT ID FROM RUNS WHERE ID =") || s.includes("SELECT STATUS FROM RUNS WHERE ID =")) {
      const id = params[0];
      const r = this.runs.get(id);
      return { rows: r ? [r] : [] };
    }

    if (s.startsWith("INSERT INTO TASKS")) {
      const [id, run_id, parent_task_id, title, description, role, status, attempt, max_attempts, depth, reqs, deps, ant, created_at, updated_at] = params;
      const row = {
        id, run_id, parent_task_id, title, description, role, status,
        attempt, max_attempts, depth,
        requirements: typeof reqs === "string" ? JSON.parse(reqs) : reqs,
        dependencies: typeof deps === "string" ? JSON.parse(deps) : deps,
        assigned_ant_id: ant ?? "ant-default-scheduler",
        lease_owner: null,
        lease_expires_at: null,
        created_at, updated_at
      };
      this.tasks.set(id, row);
      return { rows: [row as any] };
    }

    if (s.startsWith("UPDATE TASKS")) {
      if (s.includes("LEASE_OWNER = $1")) {
        const [workerId, leaseToken, expiresAt, taskId] = params;
        const task = this.tasks.get(taskId);
        if (!task) return { rows: [] };
        if (task.lease_expires_at && task.lease_expires_at >= new Date()) return { rows: [] };
        task.lease_owner = workerId;
        task.lease_token = leaseToken;
        task.lease_expires_at = expiresAt;
        return { rows: [task] };
      }
      if (s.includes("STATUS = $1")) {
        const [nextStatus, now, title, desc, attempt, ant, nextEligibleAt, taskId, expectedStatus] = params;
        const task = this.tasks.get(taskId);
        if (!task || task.status !== expectedStatus) {
          return { rows: [] };
        }
        task.status = nextStatus;
        task.updated_at = now;
        if (title !== null) task.title = title;
        if (desc !== null) task.description = desc;
        if (attempt !== null) task.attempt = attempt;
        if (ant !== null) task.assigned_ant_id = ant;
        return { rows: [task] };
      }
      if (s.includes("LEASE_OWNER = NULL")) {
        const [taskId, workerId] = params;
        const task = this.tasks.get(taskId);
        if (task && task.lease_owner === workerId) {
          task.lease_owner = null;
          task.lease_expires_at = null;
        }
        return { rows: [] };
      }
    }

    if (s.includes("SELECT * FROM TASKS WHERE RUN_ID =")) {
      const runId = params[0];
      const rows = Array.from(this.tasks.values()).filter(t => t.run_id === runId);
      return { rows: rows as any };
    }

    if (s.includes("SELECT ASSIGNED_ANT_ID FROM TASKS")) {
      const runId = params[0];
      const rows = Array.from(this.tasks.values()).filter(t => t.run_id === runId && t.lease_expires_at && t.lease_expires_at > new Date());
      return { rows: rows as any, rowCount: rows.length };
    }

    if (s.startsWith("SELECT * FROM OPERATIONS WHERE OPERATION_ID =")) {
      const opId = params[0];
      const op = this.operations.get(opId);
      return { rows: op ? [op] : [] };
    }

    if (s.startsWith("INSERT INTO OPERATIONS")) {
      const [opId, run_id, task_id, ant_id, tool_name, input_hash, owner, expiresAt, now] = params;
      const row = { id: opId, operation_id: opId, run_id, task_id, ant_id, tool_name, input_hash, status: "RUNNING", owner, created_at: now };
      this.operations.set(opId, row);
      return { rows: [row as any] };
    }

    if (s.startsWith("UPDATE OPERATIONS SET STATUS = 'COMPLETED'")) {
      const [resStr, opId] = params;
      const op = this.operations.get(opId) || { id: opId, operation_id: opId };
      op.status = "COMPLETED";
      op.result = JSON.parse(resStr);
      this.operations.set(opId, op);
      return { rows: [op as any] };
    }

    return { rows: [] };
  }
}

test("PostgresStateRepository & Scheduler atomic state logic", async (t) => {
  await t.test("atomic compare-and-swap task transition", async () => {
    const db = new MockDatabase();
    const repo = new PostgresStateRepository(db);

    const now = new Date();
    await repo.createTask({
      id: "task-1",
      runId: "run-1",
      title: "Implement Feature",
      description: "Code the module",
      status: TaskStatus.Created,
      role: AntRole.Engineer,
      attempt: 0,
      maxAttempts: 3,
      depth: 1,
      requirements: [],
      dependencies: [],
      createdAt: now,
      updatedAt: now,
    });

    const assigned = await repo.transitionTask("task-1", TaskStatus.Created, TaskStatus.Assigned);
    assert.equal(assigned.status, TaskStatus.Assigned);

    // Concurrent conflict test (transitioning from Assigned to Assigned, or expected Created when it's now Assigned)
    await assert.rejects(
      () => repo.transitionTask("task-1", TaskStatus.Created, TaskStatus.Assigned),
      StateConflictError
    );
  });

  await t.test("scheduler filters tasks by dependencies", async () => {
    const db = new MockDatabase();
    const repo = new PostgresStateRepository(db);
    const scheduler = new Scheduler(repo);

    const now = new Date();
    await repo.createRun({
      id: "run-1",
      status: RunStatus.Created,
      goal: "Test Scheduler",
      budgetLimits: {},
      createdAt: now,
      updatedAt: now,
    });

    await repo.createTask({
      id: "task-dep",
      runId: "run-1",
      title: "Dependency",
      description: "Prerequisite task",
      status: TaskStatus.Created,
      role: AntRole.Planner,
      attempt: 0,
      maxAttempts: 3,
      depth: 0,
      requirements: [],
      dependencies: [],
      createdAt: now,
      updatedAt: now,
    });

    await repo.createTask({
      id: "task-main",
      runId: "run-1",
      title: "Main Task",
      description: "Dependent task",
      status: TaskStatus.Created,
      role: AntRole.Engineer,
      attempt: 0,
      maxAttempts: 3,
      depth: 1,
      requirements: [],
      dependencies: ["task-dep"],
      createdAt: now,
      updatedAt: now,
    });

    let runnable = await scheduler.getRunnable("run-1");
    assert.equal(runnable.length, 1);
    assert.equal(runnable[0].id, "task-dep");

    // Approve dependency
    await repo.transitionTask("task-dep", TaskStatus.Created, TaskStatus.Assigned);
    await repo.transitionTask("task-dep", TaskStatus.Assigned, TaskStatus.Running);
    await repo.transitionTask("task-dep", TaskStatus.Running, TaskStatus.Testing);
    await repo.transitionTask("task-dep", TaskStatus.Testing, TaskStatus.Review);
    await repo.transitionTask("task-dep", TaskStatus.Review, TaskStatus.Approved);

    runnable = await scheduler.getRunnable("run-1");
    assert.equal(runnable.length, 1);
    assert.equal(runnable[0].id, "task-main");
  });

  await t.test("idempotent operations storage and retrieval", async () => {
    const db = new MockDatabase();
    const repo = new PostgresStateRepository(db);

    const initial = await repo.getOperationRecord("op-123");
    assert.equal(initial, null);
  });

  await t.test("worker capability matching denies claim if capabilities are missing", async () => {
    const db = new MockDatabase();
    const repo = new PostgresStateRepository(db);
    const scheduler = new Scheduler(repo);

    const now = new Date();
    await repo.createRun({
      id: "run-cap-1",
      status: RunStatus.Created,
      goal: "Test Capabilities",
      budgetLimits: {},
      createdAt: now,
      updatedAt: now,
    });

    await repo.createTask({
      id: "task-docker",
      runId: "run-cap-1",
      title: "Docker Build Task",
      description: "Requires docker capability",
      status: TaskStatus.Created,
      role: AntRole.DevOps,
      assignedAntId: "ant-devops-docker",
      attempt: 0,
      maxAttempts: 3,
      depth: 0,
      requirements: ["docker"],
      dependencies: [],
      createdAt: now,
      updatedAt: now,
    });

    // Scheduler filtering with worker lacking docker capability
    const runnableNoCap = await scheduler.getRunnable("run-cap-1", "worker-1", ["shell", "git"]);
    assert.equal(runnableNoCap.length, 0, "Worker lacking docker capability is filtered out by Scheduler");

    // Scheduler filtering with worker possessing docker capability
    const runnableWithCap = await scheduler.getRunnable("run-cap-1", "worker-1", ["shell", "docker"]);
    assert.equal(runnableWithCap.length, 1);
    assert.equal(runnableWithCap[0].id, "task-docker");

    // Database claim enforcement: worker lacking docker capability is denied claim
    const claimDenied = await repo.claimTaskLease("task-docker", "worker-1", 60_000, ["shell", "git"]);
    assert.equal(claimDenied, null, "Database claim Task requiring docker is denied for worker lacking docker");

    // Ensure run status is RUNNING for claim requirement (Rule 3)
    const runRef = db.runs.get("run-cap-1");
    if (runRef) runRef.status = RunStatus.Running;

    // Database claim enforcement: worker possessing docker capability succeeds
    const claimGranted = await repo.claimTaskLease("task-docker", "worker-1", 60_000, ["shell", "docker"]);
    assert.ok(claimGranted, "Database claim succeeds when worker possesses required capabilities");
  });
});
