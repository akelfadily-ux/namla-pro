import test from "node:test";
import assert from "node:assert/strict";

import { BudgetController } from "../application/budget-controller";
import { PolicyEngine } from "../application/policy-engine";
import { ToolGateway } from "../application/tool-gateway";
import { GateEngine, Gate } from "../application/gate-engine";
import { NamlaLoop } from "../application/namla-loop";
import { BudgetExceededError, PermissionDeniedError, ToolExecutionError } from "../domain/errors";
import { AntRole, TaskStatus } from "../domain/types";
import { ToolAdapter, ToolExecutionContext } from "../domain/contracts";

class MockStateRepository {
  public operations = new Map<string, any>();
  public tasks = new Map<string, any>();

  async claimOperation(op: any, workerId: string): Promise<any> {
    const existing = this.operations.get(op.id);
    if (existing) {
      if (existing.inputHash && existing.inputHash !== op.inputHash) {
        return { status: "INPUT_HASH_MISMATCH", record: existing };
      }
      if (existing.status === "COMPLETED") {
        return { status: "COMPLETED", record: existing };
      }
    }
    const claimToken = "claim-test-token";
    const record = { ...op, status: "RUNNING", owner: workerId, claimToken };
    this.operations.set(op.id, record);
    return { status: "CLAIMED", record, claimToken };
  }

  async completeOperation(opId: string, workerId: string, claimToken: string, result: any): Promise<boolean> {
    const op = this.operations.get(opId) || { id: opId };
    op.status = "COMPLETED";
    op.result = result;
    this.operations.set(opId, op);
    return true;
  }

  async failOperation(opId: string, workerId: string, claimToken: string, error: string): Promise<boolean> {
    const op = this.operations.get(opId) || { id: opId };
    op.status = "FAILED";
    op.error = error;
    this.operations.set(opId, op);
    return true;
  }

  async getOperationRecord(opId: string): Promise<any> {
    return this.operations.get(opId) ?? null;
  }

  async getOperationResult<T>(opId: string): Promise<T | null> {
    const op = this.operations.get(opId);
    return (op && op.status === "COMPLETED") ? op.result : null;
  }

  async saveOperationResult<T>(opId: string, val: T): Promise<void> {
    this.completeOperation(opId, "system", "legacy-token", val);
  }

  async getTask(taskId: string): Promise<any> {
    return this.tasks.get(taskId) ?? null;
  }

  async transitionTask(id: string, expected: TaskStatus, next: TaskStatus, patch?: any): Promise<any> {
    const t = this.tasks.get(id);
    if (!t || t.status !== expected) throw new Error("Transition conflict");
    t.status = next;
    if (patch) Object.assign(t, patch);
    return t;
  }

  async getBudgetLimits() { return {}; }
  async getBudgetUsage() { return { costUsd: 0, inputTokens: 0, outputTokens: 0, modelCalls: 0, toolCalls: 0, startedAt: new Date() }; }
  async saveTask() {}
  async listRunnableTasks() { return []; }
  async saveAntExecution() {}
  async saveArtifact() {}
  async appendEvent() {}
}

test("Application Core Components Unit Tests", async (t) => {
  await t.test("BudgetController enforces limits", () => {
    const ctrl = new BudgetController();

    assert.doesNotThrow(() => {
      ctrl.assertWithinLimits({ maxCostUsd: 10 }, { costUsd: 5, inputTokens: 10, outputTokens: 10, modelCalls: 1, toolCalls: 1, startedAt: new Date() });
    });

    assert.throws(() => {
      ctrl.assertWithinLimits({ maxCostUsd: 10 }, { costUsd: 10, inputTokens: 10, outputTokens: 10, modelCalls: 1, toolCalls: 1, startedAt: new Date() });
    }, BudgetExceededError);
  });

  await t.test("PolicyEngine authorizes capabilities", () => {
    const engine = new PolicyEngine();

    assert.doesNotThrow(() => {
      engine.authorize({ permissions: ["tool:shell.test"] }, { capability: "tool:shell.test" });
    });

    assert.throws(() => {
      engine.authorize({ permissions: ["tool:shell.test"] }, { capability: "tool:deployment.production" });
    }, PermissionDeniedError);
  });

  await t.test("ToolGateway executes tools and enforces idempotency", async () => {
    const state = new MockStateRepository();
    const policy = new PolicyEngine();

    let execCount = 0;
    const mockTool: ToolAdapter<{ cmd: string }, { exitCode: number }> = {
      name: "shell",
      validateInput: (i: any) => ({ cmd: String(i.cmd) }),
      execute: async (input) => {
        execCount++;
        return { exitCode: 0 };
      },
    };

    const gateway = new ToolGateway([mockTool], state as any, policy);
    const ctx: ToolExecutionContext = {
      runId: "run-1",
      taskId: "task-1",
      antId: "ant-1",
      traceId: "trace-1",
      operationId: "op-unique-123",
      permissions: ["tool:shell"],
    };

    const res1 = await gateway.execute("shell", { cmd: "npm test" }, ctx);
    assert.deepEqual(res1, { exitCode: 0 });
    assert.equal(execCount, 1);

    // Re-execution with same operationId returns cached result without running tool again
    const res2 = await gateway.execute("shell", { cmd: "npm test" }, ctx);
    assert.deepEqual(res2, { exitCode: 0 });
    assert.equal(execCount, 1);
  });

  await t.test("NamlaLoop manages full task review and approval workflow", async () => {
    const state = new MockStateRepository();
    state.tasks.set("task-1", {
      id: "task-1",
      runId: "run-1",
      title: "Test Task",
      status: TaskStatus.Assigned,
      attempt: 0,
      maxAttempts: 3,
    });

    const executor = {
      execute: async () => ({ artifacts: [], workspacePath: "/tmp/ws" }),
    };

    const passGate: Gate = {
      name: "passGate",
      evaluate: async () => ({ gate: "passGate", passed: true, reason: "ok", evidence: [], requiredFixes: [] }),
    };

    const gates = new GateEngine([passGate]);
    const supervisor = {
      review: async () => ({ approved: true, reason: "Looks good", risks: [], requiredFixes: [] }),
    };

    const loop = new NamlaLoop(state as any, executor, gates, supervisor);
    await loop.executeTask("task-1");

    const finalTask = await state.getTask("task-1");
    assert.equal(finalTask.status, TaskStatus.Approved);
  });
});
