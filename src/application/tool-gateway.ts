import { createHash } from "crypto";
import {
  StateRepository,
  ToolAdapter,
  ToolExecutionContext,
} from "../domain/contracts";
import { ToolExecutionError } from "../domain/errors";
import { PolicyEngine } from "./policy-engine";

export class ToolGateway {
  private readonly tools = new Map<string, ToolAdapter<any, any>>();

  constructor(
    adapters: readonly ToolAdapter[],
    private readonly state: StateRepository,
    private readonly policy: PolicyEngine,
  ) {
    for (const adapter of adapters) {
      if (this.tools.has(adapter.name)) {
        throw new Error(`Duplicate tool registered: ${adapter.name}`);
      }
      this.tools.set(adapter.name, adapter);
    }
  }

  canonicalizeAndHashInput(rawInput: unknown): string {
    const stringified = JSON.stringify(rawInput, Object.keys(rawInput as object || {}).sort());
    return createHash("sha256").update(stringified || "").digest("hex");
  }

  async execute<I, O>(
    toolName: string,
    rawInput: unknown,
    context: ToolExecutionContext,
    timeoutMs = 60_000,
    workerId = "worker-1",
  ): Promise<O> {
    const adapter = this.tools.get(toolName);

    if (!adapter) {
      throw new ToolExecutionError(`Unknown tool: ${toolName}`, false);
    }

    this.policy.authorize(
      { permissions: context.permissions },
      { capability: `tool:${toolName}` },
    );

    const input = adapter.validateInput(rawInput);
    const inputHash = this.canonicalizeAndHashInput(input);

    const claim = await this.state.claimOperation(
      {
        id: context.operationId,
        toolName,
        inputHash,
        runId: context.runId,
        taskId: context.taskId,
        antId: context.antId,
      },
      workerId,
      timeoutMs,
    );

    if (claim.status === "INPUT_HASH_MISMATCH") {
      throw new ToolExecutionError(
        `Operation ID ${context.operationId} was previously used with different input hash`,
        false,
      );
    }

    if (claim.status === "COMPLETED") {
      await this.state.appendEvent({
        type: "tool.replayed",
        runId: context.runId,
        taskId: context.taskId,
        traceId: context.traceId,
        timestamp: new Date(),
        payload: { operationId: context.operationId, toolName },
      });
      return claim.record?.result as O;
    }

    if (claim.status === "RUNNING_OTHER_LEASE") {
      throw new ToolExecutionError(
        `Operation ${context.operationId} is currently being executed by another worker`,
        true,
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    await this.state.appendEvent({
      type: "tool.started",
      runId: context.runId,
      taskId: context.taskId,
      traceId: context.traceId,
      timestamp: new Date(),
      payload: { operationId: context.operationId, toolName },
    });

    try {
      const output = await adapter.execute(
        input,
        context,
        controller.signal,
      );

      await this.state.completeOperation(context.operationId, workerId, output);

      await this.state.appendEvent({
        type: "tool.completed",
        runId: context.runId,
        taskId: context.taskId,
        traceId: context.traceId,
        timestamp: new Date(),
        payload: { operationId: context.operationId, toolName },
      });

      return output as O;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Execution failed";
      await this.state.failOperation(context.operationId, workerId, errMsg);

      await this.state.appendEvent({
        type: "tool.failed",
        runId: context.runId,
        taskId: context.taskId,
        traceId: context.traceId,
        timestamp: new Date(),
        payload: { operationId: context.operationId, toolName, error: errMsg },
      });

      if (controller.signal.aborted) {
        throw new ToolExecutionError(
          `${toolName} timed out after ${timeoutMs}ms`,
          true,
          error,
        );
      }

      if (error instanceof ToolExecutionError) {
        throw error;
      }

      throw new ToolExecutionError(
        `${toolName} execution failed`,
        true,
        error,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
