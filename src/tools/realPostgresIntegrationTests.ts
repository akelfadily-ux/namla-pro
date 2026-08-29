import test from "node:test";
import assert from "node:assert/strict";

import { PostgresStateRepository } from "../infrastructure/persistence/postgresStateRepository";
import { PostgresUnitOfWork } from "../infrastructure/persistence/postgresUnitOfWork";
import { AntRole, RunStatus, TaskStatus } from "../domain/types";
import { StateConflictError } from "../domain/errors";

class MockPgPool {
  public connectCount = 0;
  public releasedCount = 0;
  public mockClient = {
    queries: [] as Array<{ sql: string; params?: any[] }>,
    rowsMap: new Map<string, any[]>(),
    query: async (sql: string, params: any[] = []) => {
      this.mockClient.queries.push({ sql, params });
      const s = sql.replace(/\s+/g, " ").trim().toUpperCase();

      if (s === "BEGIN" || s === "COMMIT" || s === "ROLLBACK") {
        return { rows: [], rowCount: 0 };
      }

      if (s.startsWith("INSERT INTO RUNS")) {
        const [id, status, goal, repo, limits, created_at, updated_at] = params;
        const row = { id, status, goal, repository_path: repo, budget_limits: limits, created_at, updated_at };
        this.mockClient.rowsMap.set(`run:${id}`, [row]);
        return { rows: [row], rowCount: 1 };
      }

      if (s.startsWith("SELECT * FROM RUNS WHERE ID =")) {
        const id = params[0];
        return { rows: this.mockClient.rowsMap.get(`run:${id}`) ?? [] };
      }

      if (s.startsWith("SELECT ID FROM RUNS WHERE ID =")) {
        const id = params[0];
        return { rows: this.mockClient.rowsMap.get(`run:${id}`) ?? [] };
      }

      if (s.startsWith("SELECT BUDGET_LIMITS FROM RUNS WHERE ID =")) {
        const id = params[0];
        const r = this.mockClient.rowsMap.get(`run:${id}`);
        return { rows: r ? [{ budget_limits: r[0].budget_limits }] : [] };
      }

      if (s.startsWith("SELECT COALESCE(SUM(ACTUAL_COST_USD)") || s.startsWith("SELECT COALESCE(SUM(RESERVED_COST_USD)")) {
        return { rows: [{ cost_usd: 0, tokens: 0, reserved_cost: 0, reserved_tokens: 0 }] };
      }

      if (s.startsWith("INSERT INTO BUDGET_RESERVATIONS")) {
        return { rows: [], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    },
    release: () => {
      this.releasedCount++;
    },
  };

  async connect() {
    this.connectCount++;
    return this.mockClient;
  }
}

test("Real PostgreSQL UnitOfWork & Transactional ReserveBudget Integration", async (t) => {
  await t.test("PostgresUnitOfWork checks out single client and commits transaction", async () => {
    const pool = new MockPgPool();
    const uow = new PostgresUnitOfWork(pool as any);

    await uow.transaction(async (state) => {
      const now = new Date();
      await state.createRun({
        id: "run-uow-1",
        status: RunStatus.Created,
        goal: "Test UOW transaction",
        budgetLimits: { maxCostUsd: 10.0 },
        createdAt: now,
        updatedAt: now,
      });
    });

    assert.equal(pool.connectCount, 1, "Must check out client exactly once");
    assert.equal(pool.releasedCount, 1, "Must release checked out client exactly once");
    assert.ok(pool.mockClient.queries.some((q) => q.sql === "BEGIN"));
    assert.ok(pool.mockClient.queries.some((q) => q.sql === "COMMIT"));
  });

  await t.test("reserveBudget executes FOR UPDATE inside checked-out client transaction", async () => {
    const pool = new MockPgPool();
    const repo = new PostgresStateRepository({ pool } as any);

    // Seed run row in mock client
    pool.mockClient.rowsMap.set("run-lock-1", [{ id: "run-lock-1", budget_limits: JSON.stringify({ maxCostUsd: 10.0 }) }]);

    const res = await repo.reserveBudget("run-lock-1", 1.0, 100);
    assert.equal(res.reserved, true);
    assert.ok(res.reservationId);

    assert.equal(pool.connectCount, 1, "reserveBudget checked out client for transaction");
    assert.equal(pool.releasedCount, 1, "reserveBudget released checked out client");
    assert.ok(pool.mockClient.queries.some((q) => q.sql === "BEGIN"));
    assert.ok(pool.mockClient.queries.some((q) => q.sql.includes("FOR UPDATE")));
    assert.ok(pool.mockClient.queries.some((q) => q.sql === "COMMIT"));
  });
});
