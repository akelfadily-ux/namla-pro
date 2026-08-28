import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { Container } from "../bootstrap/container";
import { NamlaService } from "../application/namla-service";
import { PostgresStateRepository } from "../infrastructure/persistence/postgresStateRepository";
import { RunStatus, TaskStatus } from "../domain/types";
import { ToolAdapter, ModelAdapter } from "../domain/contracts";
import { Gate } from "../application/gate-engine";

class DeterministicPgDatabase {
  public tasks = new Map<string, any>();
  public runs = new Map<string, any>();
  public events: any[] = [];
  public operations = new Map<string, any>();

  async query<T = any>(sql: string, params: any[] = []): Promise<{ rows: T[]; rowCount?: number }> {
    const s = sql.replace(/\s+/g, " ").trim().toUpperCase();

    if (s.startsWith("INSERT INTO RUNS")) {
      const [id, status, goal, repo, limits, created_at, updated_at] = params;
      const row = { id, status, goal, repository_path: repo, budget_limits: limits, created_at, updated_at };
      this.runs.set(id, row);
      return { rows: [row as any], rowCount: 1 };
    }

    if (s.startsWith("SELECT * FROM RUNS WHERE ID =")) {
      const id = params[0];
      const r = this.runs.get(id);
      return { rows: r ? [r] : [] };
    }

    if (s.startsWith("UPDATE RUNS SET STATUS =")) {
      const [nextStatus, now, id, expectedStatus] = params;
      const r = this.runs.get(id);
      if (!r || r.status !== expectedStatus) return { rows: [], rowCount: 0 };
      r.status = nextStatus;
      r.updated_at = now;
      return { rows: [r as any], rowCount: 1 };
    }

    if (s.startsWith("SELECT * FROM TASKS WHERE ID =")) {
      const id = params[0];
      const task = this.tasks.get(id);
      return { rows: task ? [task] : [] };
    }

    if (s.startsWith("INSERT INTO TASKS")) {
      const [id, run_id, parent_task_id, title, description, role, status, attempt, max_attempts, depth, reqs, deps, ant, lease_owner, lease_expires_at, created_at, updated_at] = params;
      if (this.tasks.has(id)) return { rows: [], rowCount: 0 };
      const row = {
        id, run_id, parent_task_id, title, description, role, status,
        attempt, max_attempts, depth,
        requirements: typeof reqs === "string" ? JSON.parse(reqs) : reqs,
        dependencies: typeof deps === "string" ? JSON.parse(deps) : deps,
        assigned_ant_id: ant,
        lease_owner, lease_expires_at, created_at, updated_at
      };
      this.tasks.set(id, row);
      return { rows: [row as any], rowCount: 1 };
    }

    if (s.startsWith("UPDATE TASKS SET LEASE_OWNER = $1")) {
      const [workerId, leaseToken, expiresAt, taskId] = params;
      const task = this.tasks.get(taskId);
      if (!task) return { rows: [], rowCount: 0 };
      task.lease_owner = workerId;
      task.lease_token = leaseToken;
      task.lease_expires_at = expiresAt;
      return { rows: [task], rowCount: 1 };
    }

    if (s.startsWith("UPDATE TASKS SET LEASE_OWNER = NULL")) {
      const [taskId, workerId] = params;
      const task = this.tasks.get(taskId);
      if (task && task.lease_owner === workerId) {
        task.lease_owner = null;
        task.lease_expires_at = null;
      }
      return { rows: [], rowCount: 1 };
    }

    if (s.startsWith("UPDATE TASKS SET STATUS = $1")) {
      const [nextStatus, now, title, desc, attempt, ant, taskId, expectedStatus] = params;
      const task = this.tasks.get(taskId);
      if (!task || task.status !== expectedStatus) {
        return { rows: [], rowCount: 0 };
      }
      task.status = nextStatus;
      task.updated_at = now;
      if (title !== null) task.title = title;
      if (desc !== null) task.description = desc;
      if (attempt !== null) task.attempt = attempt;
      if (ant !== null) task.assigned_ant_id = ant;
      return { rows: [task], rowCount: 1 };
    }

    if (s.startsWith("SELECT * FROM TASKS WHERE RUN_ID =")) {
      const runId = params[0];
      const rows = Array.from(this.tasks.values()).filter(t => t.run_id === runId && (t.status === TaskStatus.Created || t.status === TaskStatus.Retrying));
      return { rows: rows as any, rowCount: rows.length };
    }

    if (s.startsWith("INSERT INTO EVENTS")) {
      this.events.push(params);
      return { rows: [], rowCount: 1 };
    }

    if (s.startsWith("SELECT * FROM OPERATIONS WHERE OPERATION_ID =")) {
      const opId = params[0];
      const op = this.operations.get(opId);
      return { rows: op ? [op] : [], rowCount: op ? 1 : 0 };
    }

    if (s.startsWith("INSERT INTO BUDGET_RESERVATIONS")) {
      const [id, run_id, kind, cost, tokens, status, created_at] = params;
      this.operations.set(`budget-${id}`, { id, status: "RESERVED" });
      return { rows: [], rowCount: 1 };
    }

    if (s.startsWith("UPDATE BUDGET_RESERVATIONS")) {
      return { rows: [{ id: "res-1" } as unknown as T], rowCount: 1 };
    }

    if (s.startsWith("INSERT INTO OPERATIONS")) {
      const opId = params[0];
      const row = { id: opId, operation_id: opId, run_id: params[1], task_id: params[2], ant_id: params[3], tool_name: params[4], input_hash: params[5], status: "RUNNING", owner: params[6] };
      this.operations.set(opId, row);
      return { rows: [row as any], rowCount: 1 };
    }

    if (s.startsWith("UPDATE OPERATIONS SET STATUS = 'COMPLETED'")) {
      const [resStr, opId] = params;
      const op = this.operations.get(opId);
      if (op) {
        op.status = "COMPLETED";
        op.result = JSON.parse(resStr);
      }
      return { rows: [], rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  }
}

test("Deterministic Golden Runtime E2E Suite", async () => {
  const tmpWorkspace = mkdtempSync(join(tmpdir(), "namla-golden-e2e-"));
  if (process.platform !== "win32") chmodSync(tmpWorkspace, 0o755);

  try {
    const db = new DeterministicPgDatabase();
    const stateRepo = new PostgresStateRepository(db);

    const fileWriterTool: ToolAdapter<{ relativePath: string; content: string }, { bytesWritten: number }> = {
      name: "filesystem.write",
      validateInput: (i: any) => ({ relativePath: String(i.relativePath), content: String(i.content) }),
      getPermissionRequests: (input) => [{ capability: "filesystem.write", resource: join(tmpWorkspace, input.relativePath) }],
      execute: async (input, ctx) => {
        const fullPath = join(tmpWorkspace, input.relativePath);
        mkdirSync(join(fullPath, ".."), { recursive: true });
        writeFileSync(fullPath, input.content, "utf8");
        return { bytesWritten: Buffer.byteLength(input.content) };
      },
    };

    const modelAdapter: ModelAdapter = {
      provider: "openai",
      generate: async <T>(req: any) => ({
        value: req.validate ? req.validate("export function todoApi() { return { status: 200 }; }") : ("export function todoApi() { return { status: 200 }; }" as unknown as T),
        usage: { inputTokens: 100, outputTokens: 100, estimatedCostUsd: 0.01 },
        provider: "openai",
        model: "gpt-4",
      }),
    };

    const buildGate: Gate = {
      name: "BuildGate",
      evaluate: async (ctx) => {
        const fileExists = existsSync(join(ctx.workspacePath, "src", "server.ts"));
        return {
          gate: "BuildGate",
          passed: fileExists,
          reason: fileExists ? "Server source file generated and compiled" : "Missing src/server.ts",
          evidence: [fileExists ? "src/server.ts present" : "absent"],
          requiredFixes: [],
        };
      },
    };

    const supervisor = {
      review: async () => ({
        approved: true,
        reason: "Todo REST API code physically written to isolated workspace and verified by BuildGate",
        risks: [],
        requiredFixes: [],
      }),
    };

    const executor = {
      execute: async (task: any) => {
        // Execute tool call via container tool gateway during execution
        const toolCtx = {
          runId: task.runId,
          taskId: task.id,
          antId: "ant-engineer",
          traceId: `trace-${task.runId}`,
          operationId: `op-${task.id}`,
          permissions: [`filesystem.write:${join(tmpWorkspace, "src", "server.ts")}`],
          authority: { workerId: "worker-e2e", leaseToken: task.leaseToken || "token-e2e" },
        };

        await container.tools.execute("filesystem.write", { relativePath: "src/server.ts", content: "export function todoApi() { return { status: 200 }; }" }, toolCtx);

        return {
          artifacts: [{ id: "art-server", runId: task.runId, taskId: task.id, type: "code", name: "src/server.ts", metadata: {}, createdAt: new Date() }],
          workspacePath: tmpWorkspace,
        };
      },
    };

    const container = Container.createTestContainer({
      stateRepository: stateRepo,
      toolAdapters: [fileWriterTool],
      modelAdapters: [modelAdapter],
      gates: [buildGate],
      supervisor,
      taskExecutor: executor,
    });

    const service = new NamlaService(container);

    // 1. Create Run
    const summary = await service.createRun({
      goal: "Build Todo REST API module",
      repositoryPath: tmpWorkspace,
      budget: { maxCostUsd: 2.0 },
    });

    // Transition Run status from CREATED to RUNNING
    await stateRepo.transitionRun(summary.id, RunStatus.Created, RunStatus.Planning);
    await stateRepo.transitionRun(summary.id, RunStatus.Planning, RunStatus.Running);

    // 2. Invoke ModelGateway through container
    const modelResponse = await container.models.generate(summary.id, "openai", {
      system: "You are an engineer",
      input: "Generate Todo REST API",
      validate: (v: any) => String(v),
    });
    assert.equal(modelResponse.value, "export function todoApi() { return { status: 200 }; }");

    // 3. Process Run (Namla Loop: EXECUTE -> TEST -> VERIFY -> REVIEW -> APPROVE)
    await service.processRun(summary.id, "worker-e2e");

    // 4. Verify physical workspace file exists
    const producedPath = join(tmpWorkspace, "src", "server.ts");
    assert.equal(existsSync(producedPath), true, "File must physically exist in isolated workspace");
    assert.equal(readFileSync(producedPath, "utf8"), "export function todoApi() { return { status: 200 }; }");

    // 5. Verify task status APPROVED
    const tasks = Array.from(db.tasks.values());
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].status, TaskStatus.Approved);
  } finally {
    rmSync(tmpWorkspace, { recursive: true, force: true });
  }
});
