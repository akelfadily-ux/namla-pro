import test from "node:test";
import assert from "node:assert/strict";

import { Container } from "../bootstrap/container";
import { NamlaService } from "../application/namla-service";
import { PostgresStateRepository } from "../infrastructure/persistence/postgresStateRepository";
import { AntRole, TaskStatus } from "../domain/types";
import { ToolAdapter, ModelAdapter } from "../domain/contracts";
import { Gate } from "../application/gate-engine";

class MemoryDatabase {
  public tasks = new Map<string, any>();
  public events: any[] = [];
  public operations = new Map<string, any>();

  async query<T = any>(sql: string, params: any[] = []): Promise<{ rows: T[] }> {
    const s = sql.replace(/\s+/g, " ").trim().toUpperCase();

    if (s.startsWith("SELECT * FROM TASKS WHERE ID =")) {
      const id = params[0];
      const task = this.tasks.get(id);
      return { rows: task ? [task] : [] };
    }

    if (s.startsWith("INSERT INTO TASKS")) {
      const [id, run_id, parent_task_id, title, description, role, status, attempt, max_attempts, depth, reqs, deps, ant, created_at, updated_at] = params;
      const row = {
        id, run_id, parent_task_id, title, description, role, status,
        attempt, max_attempts, depth,
        requirements: typeof reqs === "string" ? JSON.parse(reqs) : reqs,
        dependencies: typeof deps === "string" ? JSON.parse(deps) : deps,
        assigned_ant_id: ant,
        lease_owner: null,
        lease_expires_at: null,
        created_at, updated_at
      };
      this.tasks.set(id, row);
      return { rows: [row as any] };
    }

    if (s.startsWith("UPDATE TASKS")) {
      if (s.includes("SET STATUS = $1")) {
        const [nextStatus, now, title, desc, attempt, ant, taskId, expectedStatus] = params;
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
    }

    if (s.startsWith("SELECT * FROM TASKS WHERE RUN_ID =")) {
      const runId = params[0];
      const rows = Array.from(this.tasks.values()).filter(t => t.run_id === runId && (t.status === TaskStatus.Created || t.status === TaskStatus.Retrying));
      return { rows: rows as any };
    }

    if (s.startsWith("INSERT INTO EVENTS")) {
      this.events.push(params);
      return { rows: [] };
    }

    if (s.startsWith("SELECT RESULT FROM OPERATIONS WHERE OPERATION_ID =")) {
      const opId = params[0];
      const op = this.operations.get(opId);
      return { rows: op ? [op] : [] };
    }

    if (s.startsWith("INSERT INTO OPERATIONS")) {
      const [opId, res] = params;
      const row = { operation_id: opId, result: res };
      this.operations.set(opId, row);
      return { rows: [row as any] };
    }

    return { rows: [] };
  }
}

test("Golden E2E Software Task Execution", async () => {
  const db = new MemoryDatabase();
  const stateRepo = new PostgresStateRepository(db);

  const testTool: ToolAdapter<{ cmd: string }, { stdout: string }> = {
    name: "shell",
    validateInput: (i: any) => ({ cmd: String(i.cmd) }),
    execute: async (input) => ({ stdout: "ALL TESTS PASSED\n" }),
  };

  const modelAdapter: ModelAdapter = {
    provider: "openai",
    generate: async <T>(req: any) => ({
      value: req.validate ? req.validate("Generated Solution Code") : ("Generated Solution Code" as unknown as T),
      usage: { inputTokens: 100, outputTokens: 200, estimatedCostUsd: 0.01 },
      provider: "openai",
      model: "gpt-4",
    }),
  };

  const passGate: Gate = {
    name: "BuildGate",
    evaluate: async () => ({
      gate: "BuildGate",
      passed: true,
      reason: "Compilation succeeded",
      evidence: ["tsc exit 0"],
      requiredFixes: [],
    }),
  };

  const supervisor = {
    review: async () => ({
      approved: true,
      reason: "Verified against requirements",
      risks: [],
      requiredFixes: [],
    }),
  };

  const executor = {
    execute: async (task: any) => ({
      artifacts: [{ id: "art-1", runId: task.runId, type: "code", name: "solution.ts", metadata: {}, createdAt: new Date() }],
      workspacePath: "/workspace/app",
    }),
  };

  const container = new Container({
    stateRepository: stateRepo,
    toolAdapters: [testTool],
    modelAdapters: [modelAdapter],
    gates: [passGate],
    supervisor,
    taskExecutor: executor,
  });

  const service = new NamlaService(container);

  // 1. Create Run
  const summary = await service.createRun({
    goal: "Build a production-quality Todo REST API",
    budget: { maxCostUsd: 1.0 },
  });

  assert.match(summary.id, /^run-/);
  assert.equal(summary.status, "CREATED");

  // 2. Process Run (Namla Loop: EXECUTE -> TEST -> VERIFY -> REVIEW -> APPROVE)
  await service.processRun(summary.id, "worker-1");

  const tasks = Array.from(db.tasks.values());
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].status, TaskStatus.Approved);
});
