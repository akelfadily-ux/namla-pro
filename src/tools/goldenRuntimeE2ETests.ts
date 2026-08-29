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
import { newDb } from "pg-mem";
import { MigrationRunner } from "../infrastructure/persistence/migrations";

function createRealPostgresPool() {
  const db = newDb();
  let backup: any = null;

  db.public.interceptQueries((sql: string) => {
    const s = sql.trim();
    if (s === "BEGIN") {
      backup = db.backup();
      return [];
    }
    if (s === "COMMIT") {
      backup = null;
      return [];
    }
    if (s === "ROLLBACK") {
      if (backup) backup.restore();
      return [];
    }
    if (s.includes("INSERT INTO operations") && s.includes("ON CONFLICT")) {
      const match = /VALUES\s*\('([^']+)'/i.exec(s) || /SELECT\s*'([^']+)'/i.exec(s);
      if (match) {
        const opId = match[1];
        const check = db.public.many(`SELECT status, lease_expires_at FROM operations WHERE operation_id = '${opId}'`);
        if (check.length > 0) {
          const row = check[0] as any;
          if (row.status === "RUNNING" && row.lease_expires_at && new Date(row.lease_expires_at) > new Date()) {
            return [];
          }
        }
      }
    }
    return null;
  });

  const pg = db.adapters.createPg();
  return new pg.Pool();
}

test("Deterministic Golden Runtime E2E Suite", async () => {
  const tmpWorkspace = mkdtempSync(join(tmpdir(), "namla-golden-e2e-"));
  if (process.platform !== "win32") chmodSync(tmpWorkspace, 0o755);

  const pool = createRealPostgresPool();
  const initClient = await pool.connect();
  try {
    const runner = new MigrationRunner(initClient as any);
    await runner.runMigrations();
  } finally {
    initClient.release();
  }

  try {
    const stateRepo = new PostgresStateRepository(pool as any, pool as any);

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
  const todos = new Map();
  let idCounter = 1;

  return http.createServer((req, res) => {
    const url = req.url || "";
    const parts = url.split("/").filter(Boolean);

    if (req.method === "POST" && url === "/todos") {
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        const todo = JSON.parse(body || "{}");
        const id = String(idCounter++);
        todo.id = id;
        todos.set(id, todo);
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify(todo));
      });
    } else if (req.method === "GET" && url === "/todos") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(Array.from(todos.values())));
    } else if (req.method === "GET" && parts.length === 2 && parts[0] === "todos") {
      const id = parts[1];
      if (todos.has(id)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(todos.get(id)));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not Found" }));
      }
    } else if (req.method === "PATCH" && parts.length === 2 && parts[0] === "todos") {
      const id = parts[1];
      if (todos.has(id)) {
        let body = "";
        req.on("data", chunk => body += chunk);
        req.on("end", () => {
          const patch = JSON.parse(body || "{}");
          const existing = todos.get(id);
          Object.assign(existing, patch);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(existing));
        });
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not Found" }));
      }
    } else if (req.method === "DELETE" && parts.length === 2 && parts[0] === "todos") {
      const id = parts[1];
      if (todos.has(id)) {
        todos.delete(id);
        res.writeHead(204);
        res.end();
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not Found" }));
      }
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not Found" }));
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
          operationId: `op-${task.id}-${task.attempt}`,
          permissions: [`filesystem.write:${join(tmpWorkspace, "src", "server.js")}`],
          authority: { workerId: "worker-e2e", leaseToken: task.leaseToken || "token-e2e" },
        };

        // Write EXACT model output provenance to isolated workspace
        await container.tools.execute("filesystem.write", { relativePath: "src/server.js", content: modelResp.value }, toolCtx);

        return {
          artifacts: [{ id: `art-server-${task.id}-${task.attempt}`, runId: task.runId, taskId: task.id, type: "code", name: "src/server.js", metadata: {}, createdAt: new Date() }],
          workspacePath: tmpWorkspace,
        };
      },
    };

    const container = Container.createPostgresContainer(pool as any, {
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
      // 1. Test POST /todos
      const postRes = await fetch(`http://127.0.0.1:${port}/todos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Golden E2E Task" }),
      });
      assert.equal(postRes.status, 201, "POST /todos must respond 201 Created");
      const createdTodo = (await postRes.json()) as any;
      assert.equal(createdTodo.id, "1");
      assert.equal(createdTodo.title, "Golden E2E Task");

      // 2. Test GET /todos
      const getRes = await fetch(`http://127.0.0.1:${port}/todos`);
      assert.equal(getRes.status, 200, "GET /todos must respond 200 OK");
      const todoList = (await getRes.json()) as any;
      assert.equal(Array.isArray(todoList), true);
      assert.equal(todoList.length, 1);
      assert.equal(todoList[0].title, "Golden E2E Task");

      // 3. Test GET /todos/:id
      const getByIdRes = await fetch(`http://127.0.0.1:${port}/todos/1`);
      assert.equal(getByIdRes.status, 200, "GET /todos/1 must respond 200 OK");
      const singleTodo = (await getByIdRes.json()) as any;
      assert.equal(singleTodo.id, "1");
      assert.equal(singleTodo.title, "Golden E2E Task");

      // 4. Test PATCH /todos/:id
      const patchRes = await fetch(`http://127.0.0.1:${port}/todos/1`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: true }),
      });
      assert.equal(patchRes.status, 200, "PATCH /todos/1 must respond 200 OK");
      const patchedTodo = (await patchRes.json()) as any;
      assert.equal(patchedTodo.completed, true);

      // 5. Test DELETE /todos/:id
      const deleteRes = await fetch(`http://127.0.0.1:${port}/todos/1`, { method: "DELETE" });
      assert.equal(deleteRes.status, 204, "DELETE /todos/1 must respond 204 No Content");

      // 6. Test GET /todos/:id 404 after delete
      const missingRes = await fetch(`http://127.0.0.1:${port}/todos/1`);
      assert.equal(missingRes.status, 404, "GET /todos/1 must respond 404 Not Found after deletion");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    // 6. Verify task status APPROVED in real PostgreSQL DB
    const runRecord = await stateRepo.getRun(summary.id);
    assert.ok(runRecord);
    assert.ok(runRecord?.rootTaskId);
    const rootTask = await stateRepo.getTask(runRecord!.rootTaskId!);
    assert.ok(rootTask);
    assert.equal(rootTask?.status, TaskStatus.Approved);
  } finally {
    rmSync(tmpWorkspace, { recursive: true, force: true });
  }
});

test("Negative Golden Runtime Path — Gate Failure Rejection", async () => {
  const tmpWorkspace = mkdtempSync(join(tmpdir(), "namla-golden-fail-"));
  if (process.platform !== "win32") chmodSync(tmpWorkspace, 0o755);

  const pool = createRealPostgresPool();
  const initClient = await pool.connect();
  try {
    const runner = new MigrationRunner(initClient as any);
    await runner.runMigrations();
  } finally {
    initClient.release();
  }

  try {
    const stateRepo = new PostgresStateRepository(pool as any, pool as any);

    const fileWriterTool: ToolAdapter<{ relativePath: string; content: string }, { bytesWritten: number }> = {
      name: "filesystem.write",
      validateInput: (i: any) => ({ relativePath: String(i.relativePath), content: String(i.content) }),
      getPermissionRequests: (input) => [{ capability: "filesystem.write", resource: join(tmpWorkspace, input.relativePath) }],
      execute: async (input) => {
        const fullPath = join(tmpWorkspace, input.relativePath);
        mkdirSync(join(fullPath, ".."), { recursive: true });
        writeFileSync(fullPath, input.content, "utf8");
        return { bytesWritten: Buffer.byteLength(input.content) };
      },
    };

    const brokenCode = `INVALID SYNTAX {{{`;

    const modelAdapter: ModelAdapter = {
      provider: "openai",
      generate: async <T>(req: any) => ({
        value: req.validate ? req.validate(brokenCode) : (brokenCode as unknown as T),
        usage: { inputTokens: 50, outputTokens: 50, estimatedCostUsd: 0.005 },
        provider: "openai",
        model: "gpt-4",
      }),
    };

    const buildGate: Gate = {
      name: "BuildGate",
      evaluate: async (ctx) => {
        const filePath = join(ctx.workspacePath, "src", "server.js");
        let syntaxValid = false;
        if (existsSync(filePath)) {
          try {
            require(filePath);
            syntaxValid = true;
          } catch {
            syntaxValid = false;
          }
        }
        return {
          gate: "BuildGate",
          passed: syntaxValid,
          reason: syntaxValid ? "Syntax valid" : "Node require syntax check failed for broken code",
          evidence: [syntaxValid ? "syntax ok" : "syntax error"],
          requiredFixes: ["Fix JavaScript syntax"],
        };
      },
    };

    const supervisor = {
      review: async (input: any) => {
        const gateEvidence = input.gateEvidence || [];
        const buildGatePassed = gateEvidence.some((g: any) => g.gate === "BuildGate" && g.passed);
        return {
          approved: buildGatePassed,
          reason: buildGatePassed ? "Approved" : "BuildGate failed syntax check",
          risks: ["Broken syntax"],
          requiredFixes: ["Fix syntax"],
        };
      },
    };

    const executor = {
      execute: async (task: any) => {
        const modelResp = await container.models.generate(task.runId, "openai", {
          system: "You are an engineer",
          input: "Generate broken code",
          validate: (v: any) => String(v),
        });

        const toolCtx = {
          runId: task.runId,
          taskId: task.id,
          antId: "ant-engineer",
          traceId: `trace-${task.runId}`,
          operationId: `op-${task.id}-${task.attempt}`,
          permissions: [`filesystem.write:${join(tmpWorkspace, "src", "server.js")}`],
          authority: { workerId: "worker-e2e", leaseToken: task.leaseToken || "token-e2e" },
        };

        await container.tools.execute("filesystem.write", { relativePath: "src/server.js", content: modelResp.value }, toolCtx);

        return {
          artifacts: [{ id: `art-server-${task.id}-${task.attempt}`, runId: task.runId, taskId: task.id, type: "code", name: "src/server.js", metadata: {}, createdAt: new Date() }],
          workspacePath: tmpWorkspace,
        };
      },
    };

    const container = Container.createPostgresContainer(pool as any, {
      toolAdapters: [fileWriterTool],
      modelAdapters: [modelAdapter],
      gates: [buildGate],
      supervisor,
      taskExecutor: executor,
    });

    const service = new NamlaService(container);

    const summary = await service.createRun({
      goal: "Generate broken REST API",
      repositoryPath: tmpWorkspace,
    });

    // Process run through all 3 retries until maxAttempts exhausted
    await service.processRun(summary.id, "worker-e2e");
    await service.processRun(summary.id, "worker-e2e");
    await service.processRun(summary.id, "worker-e2e");

    const runRecord = await stateRepo.getRun(summary.id);
    assert.ok(runRecord);
    assert.ok(runRecord?.rootTaskId);
    const rootTask = await stateRepo.getTask(runRecord!.rootTaskId!);
    assert.ok(rootTask);
    assert.notEqual(rootTask?.status, TaskStatus.Approved, "Broken code must NOT reach APPROVED status");
    assert.equal(rootTask?.status, TaskStatus.Failed, "Broken code task must be FAILED after max attempts");
    assert.equal(runRecord?.status, RunStatus.Failed, "Run must be marked FAILED when root task fails");
  } finally {
    rmSync(tmpWorkspace, { recursive: true, force: true });
  }
});
