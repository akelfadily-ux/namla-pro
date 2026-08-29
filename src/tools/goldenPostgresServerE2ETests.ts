import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Pool } from "pg";

import { Container } from "../bootstrap/container";
import { NamlaService } from "../application/namla-service";
import { PostgresStateRepository } from "../infrastructure/persistence/postgresStateRepository";
import { RunStatus, TaskStatus } from "../domain/types";
import { ToolAdapter, ModelAdapter } from "../domain/contracts";
import { Gate } from "../application/gate-engine";
import { MigrationRunner } from "../infrastructure/persistence/migrations";

const dbUrl = process.env.DATABASE_URL;

test("Golden E2E Software Task Execution against Actual PostgreSQL Server", { skip: !dbUrl ? "Skipped: DATABASE_URL environment variable absent" : false }, async () => {
  const pool = new Pool({ connectionString: dbUrl });

  const client = await pool.connect();
  try {
    const runner = new MigrationRunner(client as any);
    await runner.runMigrations();
  } finally {
    client.release();
  }

  const tmpWorkspace = mkdtempSync(join(tmpdir(), "namla-golden-pg-"));
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

    const modelAdapter: ModelAdapter = {
      provider: "openai",
      generate: async <T>(req: any) => ({
        value: req.validate ? req.validate("export function todo() { return 'ok'; }") : ("export function todo() { return 'ok'; }" as unknown as T),
        usage: { inputTokens: 50, outputTokens: 50, estimatedCostUsd: 0.005 },
        provider: "openai",
        model: "gpt-4",
      }),
    };

    const buildGate: Gate = {
      name: "BuildGate",
      evaluate: async (ctx) => {
        const todoPath = join(ctx.workspacePath, "src", "index.ts");
        const exists = existsSync(todoPath);
        return {
          gate: "BuildGate",
          passed: exists,
          reason: exists ? "Source produced" : "Missing src/index.ts",
          evidence: [exists ? "exists" : "absent"],
          requiredFixes: [],
        };
      },
    };

    const supervisor = {
      review: async () => ({
        approved: true,
        reason: "Source written and verified",
        risks: [],
        requiredFixes: [],
      }),
    };

    const executor = {
      execute: async (task: any) => {
        const fullPath = join(tmpWorkspace, "src", "index.ts");
        mkdirSync(join(fullPath, ".."), { recursive: true });
        writeFileSync(fullPath, "export function todo() { return 'ok'; }", "utf8");

        return {
          artifacts: [{ id: `art-${task.id}`, runId: task.runId, type: "code", name: "src/index.ts", metadata: {}, createdAt: new Date() }],
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
      goal: "Build Todo REST API on Actual Postgres Server",
      repositoryPath: tmpWorkspace,
      budget: { maxCostUsd: 1.0 },
    });

    await service.processRun(summary.id, "worker-pg-e2e");

    const producedFile = join(tmpWorkspace, "src", "index.ts");
    assert.equal(existsSync(producedFile), true);
    assert.equal(readFileSync(producedFile, "utf8"), "export function todo() { return 'ok'; }");

    const runRecord = await stateRepo.getRun(summary.id);
    assert.equal(runRecord?.status, RunStatus.Completed);
  } finally {
    rmSync(tmpWorkspace, { recursive: true, force: true });
    await pool.end();
  }
});
