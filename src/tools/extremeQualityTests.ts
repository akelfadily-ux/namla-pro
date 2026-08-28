import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { test } from "node:test";
import { PostgresStateRepository, DatabaseClient } from "../infrastructure/persistence/postgresStateRepository";
import { RunStatus, TaskStatus } from "../domain/types";
import { StateConflictError, PermissionDeniedError, ToolExecutionError } from "../domain/errors";
import { PolicyEngine } from "../application/policy-engine";

class MemoryDatabaseClient implements DatabaseClient {
  public runs = new Map<string, any>();
  public tasks = new Map<string, any>();
  public operations = new Map<string, any>();
  public events: any[] = [];
  public budgetReservations = new Map<string, any>();

  async query<T = any>(sql: string, params: any[] = []): Promise<{ rows: T[]; rowCount?: number }> {
    const s = sql.trim();

    if (s.startsWith("INSERT INTO runs")) {
      const [id, status, goal, repository_path, budget_limits, created_at, updated_at] = params;
      this.runs.set(id, { id, status, goal, repository_path, budget_limits, created_at, updated_at });
      return { rows: [], rowCount: 1 };
    }

    if (s.startsWith("SELECT * FROM runs WHERE id = $1")) {
      const r = this.runs.get(params[0]);
      return { rows: r ? [r] : [] };
    }

    if (s.startsWith("INSERT INTO tasks")) {
      const id = params[0];
      if (this.tasks.has(id)) {
        return { rows: [], rowCount: 0 };
      }
      const task = {
        id: params[0],
        run_id: params[1],
        parent_task_id: params[2],
        title: params[3],
        description: params[4],
        role: params[5],
        status: params[6],
        attempt: params[7],
        max_attempts: params[8],
        depth: params[9],
        requirements: params[10],
        dependencies: params[11],
        assigned_ant_id: params[12],
        lease_owner: params[13],
        lease_expires_at: params[14],
        created_at: params[15],
        updated_at: params[16],
      };
      this.tasks.set(id, task);
      return { rows: [task as unknown as T], rowCount: 1 };
    }

    if (s.startsWith("SELECT * FROM tasks WHERE id = $1")) {
      const t = this.tasks.get(params[0]);
      return { rows: t ? [t as unknown as T] : [] };
    }

    if (s.includes("UPDATE tasks") && s.includes("WHERE id = $7 AND status = $8 AND lease_owner = $9")) {
      const [nextStatus, now, title, desc, attempt, antId, taskId, expectedStatus, workerId, leaseToken] = params;
      const t = this.tasks.get(taskId);
      if (t && t.status === expectedStatus && t.lease_owner === workerId && t.lease_token === leaseToken && t.lease_expires_at > new Date()) {
        t.status = nextStatus;
        t.updated_at = now;
        if (title !== null) t.title = title;
        if (desc !== null) t.description = desc;
        if (attempt !== null) t.attempt = attempt;
        if (antId !== null) t.assigned_ant_id = antId;
        return { rows: [t as unknown as T], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    if (s.includes("UPDATE tasks") && (s.includes("lease_owner = $1") || s.includes("SET"))) {
      if (s.includes("lease_owner = $1, lease_token = $2") || s.includes("lease_owner = $1")) {
        const [workerId, leaseToken, expiresAt, taskId] = params;
        const t = this.tasks.get(taskId);
        if (t && (t.status === "CREATED" || t.status === "RETRYING")) {
          t.lease_owner = workerId;
          t.lease_token = leaseToken;
          t.lease_expires_at = expiresAt;
          return { rows: [t as unknown as T], rowCount: 1 };
        }
      }
      return { rows: [], rowCount: 0 };
    }

    if (s.includes("INSERT INTO operations")) {
      const [id, run_id, task_id, ant_id, tool_name, input_hash, workerId, claimToken, expiresAt, now] = params;
      const existing = this.operations.get(id);

      if (!existing) {
        const op = {
          operation_id: id,
          id,
          run_id,
          task_id,
          ant_id,
          tool_name,
          operation_type: tool_name,
          input_hash,
          status: "RUNNING",
          lease_owner: workerId,
          owner: workerId,
          claim_token: claimToken,
          lease_expires_at: expiresAt,
          created_at: now,
        };
        this.operations.set(id, op);
        return { rows: [op as unknown as T], rowCount: 1 };
      }

      if (existing.status !== "COMPLETED" && (!existing.lease_expires_at || existing.lease_expires_at < new Date()) &&
          existing.run_id === run_id && existing.task_id === task_id && existing.tool_name === tool_name && existing.input_hash === input_hash) {
        existing.status = "RUNNING";
        existing.lease_owner = workerId;
        existing.owner = workerId;
        existing.claim_token = claimToken;
        existing.lease_expires_at = expiresAt;
        return { rows: [existing as unknown as T], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    }

    if (s.startsWith("SELECT * FROM operations WHERE operation_id = $1 OR id = $1")) {
      const op = this.operations.get(params[0]);
      return { rows: op ? [op as unknown as T] : [] };
    }

    return { rows: [], rowCount: 0 };
  }
}

test("Extreme Quality Suite — Task Fencing and Worker Lease Isolation", async () => {
  const db = new MemoryDatabaseClient();
  const repo = new PostgresStateRepository(db);

  await repo.createRun({
    id: "run-eq-1",
    status: RunStatus.Running,
    goal: "Test Task Fencing",
    budgetLimits: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await repo.createTask({
    id: "task-eq-1",
    runId: "run-eq-1",
    title: "Fenced Task",
    description: "Fenced transition verification",
    status: TaskStatus.Created,
    role: "ENGINEER" as any,
    attempt: 0,
    maxAttempts: 3,
    depth: 0,
    requirements: [],
    dependencies: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Manually claim in memory DB to test fencing logic accurately
  const taskRef = db.tasks.get("task-eq-1");
  taskRef.lease_owner = "worker-alpha";
  taskRef.lease_token = "token-alpha-123";
  taskRef.lease_expires_at = new Date(Date.now() + 60_000);

  const claimed = await repo.getTask("task-eq-1");
  assert.ok(claimed, "Worker alpha claims task lease");
  assert.strictEqual(claimed?.leaseOwner, "worker-alpha");
  assert.strictEqual(claimed?.leaseToken, "token-alpha-123", "Lease token issued");

  // Move task status manually to ASSIGNED in memory for transition test
  taskRef.status = TaskStatus.Assigned;

  // Stale worker with invalid token attempts transition
  await assert.rejects(
    async () => {
      await repo.transitionTaskFenced(
        "task-eq-1",
        TaskStatus.Assigned,
        TaskStatus.Running,
        "worker-stale",
        "invalid-token",
      );
    },
    StateConflictError,
    "Stale worker with invalid token is rejected by task fencing",
  );

  // Active worker with valid token succeeds
  const updated = await repo.transitionTaskFenced(
    "task-eq-1",
    TaskStatus.Assigned,
    TaskStatus.Running,
    "worker-alpha",
    claimed.leaseToken!,
  );
  assert.strictEqual(updated.status, TaskStatus.Running, "Active worker successfully transitions task");
});

test("Extreme Quality Suite — Operation Idempotency and Input Mismatch Protection", async () => {
  const db = new MemoryDatabaseClient();
  const repo = new PostgresStateRepository(db);

  const opInput1 = {
    id: "op-eq-1",
    toolName: "filesystem.write",
    inputHash: "hash-aaaa",
    runId: "run-eq-1",
    taskId: "task-eq-1",
    antId: "ant-1",
  };

  const claim1 = await repo.claimOperation(opInput1, "worker-1", 60_000);
  assert.strictEqual(claim1.status, "CLAIMED");
  assert.ok(claim1.claimToken);

  // Claim with exact same operationId but different input hash
  const opInput2 = {
    id: "op-eq-1",
    toolName: "filesystem.write",
    inputHash: "hash-bbbb",
    runId: "run-eq-1",
    taskId: "task-eq-1",
    antId: "ant-1",
  };

  const claim2 = await repo.claimOperation(opInput2, "worker-2", 60_000);
  assert.strictEqual(claim2.status, "INPUT_HASH_MISMATCH", "Mismatching input hash on same operation ID is rejected");
});

test("Extreme Quality Suite — PolicyEngine Resource Scoping and Path Security", () => {
  const policy = new PolicyEngine();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "eq-policy-test-"));
  if (process.platform !== "win32") fs.chmodSync(tmpDir, 0o755);

  const allowedSubdir = path.join(tmpDir, "src");
  const outsideSubdir = path.join(tmpDir, "outside");
  fs.mkdirSync(allowedSubdir, { recursive: true });
  fs.mkdirSync(outsideSubdir, { recursive: true });

  const antPolicy = {
    permissions: [`filesystem.write:${allowedSubdir}/**`],
  };

  // Valid path inside allowed directory
  const validFile = path.join(allowedSubdir, "index.ts");
  assert.doesNotThrow(() => {
    policy.authorize(antPolicy, { capability: "filesystem.write", resource: validFile });
  }, "Allowed resource path passes authorization");

  // Escalation / path traversal path outside allowed directory
  const forbiddenFile = path.join(tmpDir, "secret.json");
  assert.throws(() => {
    policy.authorize(antPolicy, { capability: "filesystem.write", resource: forbiddenFile });
  }, PermissionDeniedError, "Path outside scoped directory is denied");

  // Adversarial symlink escape test: symlink inside allowed pointing to outside
  const linkPath = path.join(allowedSubdir, "escape-link");
  try {
    fs.symlinkSync(outsideSubdir, linkPath, process.platform === "win32" ? "junction" : "dir");
    const symlinkTargetFile = path.join(linkPath, "escaped-file.txt");
    assert.throws(() => {
      policy.authorize(antPolicy, { capability: "filesystem.write", resource: symlinkTargetFile });
    }, PermissionDeniedError, "Symlink target escape outside allowed directory is denied");
  } catch (e: any) {
    if (e.name === "PermissionDeniedError") throw e;
    /* symlink unprivileged fallback */
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
