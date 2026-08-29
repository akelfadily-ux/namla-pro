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

    const todoServerCode = `
const http = require("http");
function createTodoServer() {
  const todos = [];
  return http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/todos") {
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        const todo = JSON.parse(body || "{}");
        todo.id = String(todos.length + 1);
        todos.push(todo);
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify(todo));
      });
    } else if (req.method === "GET" && req.url === "/todos") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(todos));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
}
module.exports = { createTodoServer };
`;

    const modelAdapter: ModelAdapter = {
      provider: "openai",
      generate: async <T>(req: any) => ({
        value: req.validate ? req.validate(todoServerCode) : (todoServerCode as unknown as T),
        usage: { inputTokens: 150, outputTokens: 250, estimatedCostUsd: 0.015 },
        provider: "openai",
        model: "gpt-4",
      }),
    };

    const buildGate: Gate = {
      name: "BuildGate",
      evaluate: async (ctx) => {
        const filePath = join(ctx.workspacePath, "src", "server.js");
        const fileExists = existsSync(filePath);
        let syntaxValid = false;
        if (fileExists) {
          try {
            require(filePath);
            syntaxValid = true;
          } catch {
            syntaxValid = false;
          }
        }
        const passed = fileExists && syntaxValid;
        return {
          gate: "BuildGate",
          passed,
          reason: passed ? "Server source file generated and successfully loaded by Node" : "Missing or invalid src/server.js",
          evidence: [fileExists ? "src/server.js present" : "absent", syntaxValid ? "Node require syntax check passed" : "syntax failed"],
          requiredFixes: [],
        };
      },
    };

    const supervisor = {
      review: async (input: any) => {
        const gateEvidence = input.gateEvidence || [];
        const buildGatePassed = gateEvidence.some((g: any) => g.gate === "BuildGate" && g.passed);
        return {
          approved: buildGatePassed,
          reason: buildGatePassed
            ? "Todo REST API code physically written from model output provenance and verified by BuildGate"
            : "BuildGate failed evidence check",
          risks: [],
          requiredFixes: [],
        };
      },
    };

    const executor = {
      execute: async (task: any) => {
        // Generate code via ModelGateway to guarantee exact model output provenance
        const modelResp = await container.models.generate(task.runId, "openai", {
          system: "You are an expert engineer",
          input: "Generate Todo REST API",
          validate: (v: any) => String(v),
        });

        const toolCtx = {
          runId: task.runId,
          taskId: task.id,
          antId: "ant-engineer",
          traceId: `trace-${task.runId}`,
          operationId: `op-${task.id}`,
          permissions: [`filesystem.write:${join(tmpWorkspace, "src", "server.js")}`],
          authority: { workerId: "worker-e2e", leaseToken: task.leaseToken || "token-e2e" },
        };

        // Write EXACT model output provenance to isolated workspace
        await container.tools.execute("filesystem.write", { relativePath: "src/server.js", content: modelResp.value }, toolCtx);

        return {
          artifacts: [{ id: "art-server", runId: task.runId, taskId: task.id, type: "code", name: "src/server.js", metadata: {}, createdAt: new Date() }],
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
    assert.equal(modelResponse.value, todoServerCode);

    // 3. Process Run (Namla Loop: EXECUTE -> TEST -> VERIFY -> REVIEW -> APPROVE)
    await service.processRun(summary.id, "worker-e2e");

    // 4. Verify physical workspace file exists with model output provenance
    const producedPath = join(tmpWorkspace, "src", "server.js");
    assert.equal(existsSync(producedPath), true, "File must physically exist in isolated workspace");
    const writtenCode = readFileSync(producedPath, "utf8");
    assert.equal(writtenCode.includes("createTodoServer"), true, "File must contain model generated Todo server code");

    // 5. Perform real HTTP REST Acceptance Tests against running in-process server
    const { createTodoServer } = require(producedPath);
    const server = createTodoServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as any).port;

    try {
      // Test POST /todos
      const postRes = await fetch(`http://127.0.0.1:${port}/todos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Golden E2E Task" }),
      });
      assert.equal(postRes.status, 201, "POST /todos must respond 201 Created");
      const createdTodo = (await postRes.json()) as any;
      assert.equal(createdTodo.id, "1");
      assert.equal(createdTodo.title, "Golden E2E Task");

      // Test GET /todos
      const getRes = await fetch(`http://127.0.0.1:${port}/todos`);
      assert.equal(getRes.status, 200, "GET /todos must respond 200 OK");
      const todoList = (await getRes.json()) as any;
      assert.equal(Array.isArray(todoList), true);
      assert.equal(todoList.length, 1);
      assert.equal(todoList[0].title, "Golden E2E Task");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    // 6. Verify task status APPROVED
    const tasks = Array.from(db.tasks.values());
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].status, TaskStatus.Approved);
  } finally {
    rmSync(tmpWorkspace, { recursive: true, force: true });
  }
});
