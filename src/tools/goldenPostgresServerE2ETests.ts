import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Pool } from "pg";
import { execSync } from "child_process";

import { Container } from "../bootstrap/container";
import { NamlaService } from "../application/namla-service";
import { PostgresStateRepository } from "../infrastructure/persistence/postgresStateRepository";
import { RunStatus, TaskStatus } from "../domain/types";
import { ToolAdapter, ModelAdapter } from "../domain/contracts";
import { Gate } from "../application/gate-engine";
import { MigrationRunner } from "../infrastructure/persistence/migrations";

const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
  console.error("GOLDEN POSTGRES RELEASE FAILED: DATABASE_URL environment variable is mandatory for release qualification");
  process.exit(1);
}

test("Full Golden E2E Software Contract against Actual PostgreSQL Server — Positive Path", async () => {
  const pool = new Pool({ connectionString: dbUrl });

  const client = await pool.connect();
  try {
    const runner = new MigrationRunner(client as any);
    await runner.runMigrations();
  } finally {
    client.release();
  }

  const tmpWorkspace = mkdtempSync(join(tmpdir(), "namla-golden-full-pg-pos-"));
  if (process.platform !== "win32") chmodSync(tmpWorkspace, 0o755);

  try {
    const stateRepo = new PostgresStateRepository(pool as any, pool);

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

    const buildTestGate: Gate = {
      name: "BuildAndTestGate",
      evaluate: async (ctx) => {
        const filePath = join(ctx.workspacePath, "src", "server.js");
        const testFilePath = join(ctx.workspacePath, "test", "server.test.js");
        const fileExists = existsSync(filePath);
        let checkPassed = false;
        let output = "";
        let exitCode = 1;

        if (fileExists) {
          try {
            // 1. Syntax check
            execSync(`node -c "${filePath}"`, { stdio: "pipe" });

            // 2. Write generated-project automated test file
            mkdirSync(join(ctx.workspacePath, "test"), { recursive: true });
            const testContent = `
const test = require("node:test");
const assert = require("node:assert/strict");
const { createTodoServer } = require("../src/server.js");

test("Generated Todo Server Instantiation Contract", () => {
  const server = createTodoServer();
  assert.ok(server);
  assert.equal(typeof server.listen, "function");
});
`;
            writeFileSync(testFilePath, testContent, "utf8");

            // 3. Execute real generated-project test command via node --test
            const execRes = execSync(`node --test "${testFilePath}"`, { stdio: "pipe" });
            checkPassed = true;
            exitCode = 0;
            output = execRes.toString("utf8");
          } catch (e: any) {
            checkPassed = false;
            exitCode = e.status || 1;
            output = String(e.stderr?.toString("utf8") || e.stdout?.toString("utf8") || e.message);
          }
        }

        return {
          gate: "BuildAndTestGate",
          passed: fileExists && checkPassed,
          reason: fileExists && checkPassed ? "Generated project build and test command passed" : "Build/test command failed",
          evidence: [
            `cmd: node --test test/server.test.js (exitCode: ${exitCode})`,
            fileExists ? "src/server.js present" : "absent",
            `artifact: src/server.js`,
            output.slice(0, 500),
          ],
          requiredFixes: checkPassed ? [] : ["Fix generated server code and test contract"],
        };
      },
    };

    const supervisor = {
      review: async (input: any) => {
        const gateEvidence = input.gateEvidence || [];
        const passed = gateEvidence.some((g: any) => g.gate === "BuildAndTestGate" && g.passed);
        return {
          approved: passed,
          reason: passed ? "BuildAndTestGate passed" : "BuildAndTestGate failed",
          risks: [],
          requiredFixes: [],
        };
      },
    };

    const executor = {
      execute: async (task: any) => {
        const modelResp = await container.models.generate(task.runId, "openai", {
          system: "Engineer",
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
          authority: { workerId: "worker-pg-e2e", leaseToken: task.leaseToken || "token-pg" },
        };

        await container.tools.execute("filesystem.write", { relativePath: "src/server.js", content: modelResp.value }, toolCtx);

        return {
          artifacts: [{ id: `art-${task.id}`, runId: task.runId, taskId: task.id, type: "code", name: "src/server.js", metadata: {}, createdAt: new Date() }],
          workspacePath: tmpWorkspace,
        };
      },
    };

    const container = Container.createPostgresContainer(pool as any, {
      toolAdapters: [fileWriterTool],
      modelAdapters: [modelAdapter],
      gates: [buildTestGate],
      supervisor,
      taskExecutor: executor,
    });

    const service = new NamlaService(container);

    const summary = await service.createRun({
      goal: "Build Todo REST API on Actual Postgres Server",
      repositoryPath: tmpWorkspace,
      budget: { maxCostUsd: 1.0 },
    });

    await service.processRun(summary.id, { workerId: "worker-pg-e2e", capabilities: ["filesystem.write"] });

    const producedPath = join(tmpWorkspace, "src", "server.js");
    assert.equal(existsSync(producedPath), true);

    // Perform Full HTTP REST Contract Verification
    const { createTodoServer } = require(producedPath);
    const server = createTodoServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as any).port;

    try {
      // 1. POST /todos
      const postRes = await fetch(`http://127.0.0.1:${port}/todos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Golden Postgres Task" }),
      });
      assert.equal(postRes.status, 201);
      const created = (await postRes.json()) as any;
      assert.equal(created.id, "1");

      // 2. GET /todos
      const getRes = await fetch(`http://127.0.0.1:${port}/todos`);
      assert.equal(getRes.status, 200);

      // 3. GET /todos/:id
      const getByIdRes = await fetch(`http://127.0.0.1:${port}/todos/1`);
      assert.equal(getByIdRes.status, 200);

      // 4. PATCH /todos/:id
      const patchRes = await fetch(`http://127.0.0.1:${port}/todos/1`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: true }),
      });
      assert.equal(patchRes.status, 200);

      // 5. DELETE /todos/:id
      const deleteRes = await fetch(`http://127.0.0.1:${port}/todos/1`, { method: "DELETE" });
      assert.equal(deleteRes.status, 204);

      // 6. 404 behavior
      const missingRes = await fetch(`http://127.0.0.1:${port}/todos/1`);
      assert.equal(missingRes.status, 404);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    const runRecord = await stateRepo.getRun(summary.id);
    assert.equal(runRecord?.status, RunStatus.Completed);
  } finally {
    rmSync(tmpWorkspace, { recursive: true, force: true });
    await pool.end();
  }
});

test("Golden E2E Software Task Execution against Actual PostgreSQL Server — Negative Path", async () => {
  const pool = new Pool({ connectionString: dbUrl });

  const client = await pool.connect();
  try {
    const runner = new MigrationRunner(client as any);
    await runner.runMigrations();
  } finally {
    client.release();
  }

  const tmpWorkspace = mkdtempSync(join(tmpdir(), "namla-golden-full-pg-neg-"));
  if (process.platform !== "win32") chmodSync(tmpWorkspace, 0o755);

  try {
    const stateRepo = new PostgresStateRepository(pool as any, pool);

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

    const buildTestGate: Gate = {
      name: "BuildAndTestGate",
      evaluate: async (ctx) => {
        const filePath = join(ctx.workspacePath, "src", "server.js");
        let checkPassed = false;
        if (existsSync(filePath)) {
          try {
            execSync(`node -c "${filePath}"`, { stdio: "pipe" });
            checkPassed = true;
          } catch {
            checkPassed = false;
          }
        }
        return {
          gate: "BuildAndTestGate",
          passed: checkPassed,
          reason: checkPassed ? "Syntax ok" : "node -c check failed on broken code",
          evidence: [checkPassed ? "ok" : "syntax error"],
          requiredFixes: ["Fix syntax"],
        };
      },
    };

    const supervisor = {
      review: async (input: any) => {
        const gateEvidence = input.gateEvidence || [];
        const passed = gateEvidence.some((g: any) => g.gate === "BuildAndTestGate" && g.passed);
        return {
          approved: passed,
          reason: passed ? "Approved" : "BuildAndTestGate failed",
          risks: ["Broken syntax"],
          requiredFixes: ["Fix syntax"],
        };
      },
    };

    const executor = {
      execute: async (task: any) => {
        const modelResp = await container.models.generate(task.runId, "openai", {
          system: "Engineer",
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
          authority: { workerId: "worker-pg-e2e", leaseToken: task.leaseToken || "token-pg" },
        };

        await container.tools.execute("filesystem.write", { relativePath: "src/server.js", content: modelResp.value }, toolCtx);

        return {
          artifacts: [{ id: `art-${task.id}`, runId: task.runId, taskId: task.id, type: "code", name: "src/server.js", metadata: {}, createdAt: new Date() }],
          workspacePath: tmpWorkspace,
        };
      },
    };

    const container = Container.createPostgresContainer(pool as any, {
      toolAdapters: [fileWriterTool],
      modelAdapters: [modelAdapter],
      gates: [buildTestGate],
      supervisor,
      taskExecutor: executor,
    });

    const service = new NamlaService(container);

    const summary = await service.createRun({
      goal: "Generate broken code on Actual Postgres Server",
      repositoryPath: tmpWorkspace,
    });

    // Process run through 3 retries
    await service.processRun(summary.id, { workerId: "worker-pg-e2e", capabilities: ["filesystem.write"] });
    await pool.query("UPDATE tasks SET next_eligible_at = NULL WHERE run_id = $1", [summary.id]);
    await service.processRun(summary.id, { workerId: "worker-pg-e2e", capabilities: ["filesystem.write"] });
    await pool.query("UPDATE tasks SET next_eligible_at = NULL WHERE run_id = $1", [summary.id]);
    await service.processRun(summary.id, { workerId: "worker-pg-e2e", capabilities: ["filesystem.write"] });

    const runRecord = await stateRepo.getRun(summary.id);
    assert.equal(runRecord?.status, RunStatus.Failed, "Broken code run MUST be FAILED");
  } finally {
    rmSync(tmpWorkspace, { recursive: true, force: true });
    await pool.end();
  }
});
