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

  async execute<I, O>(
    toolName: string,
    rawInput: unknown,
    context: ToolExecutionContext,
    timeoutMs = 60_000,
  ): Promise<O> {
    const existing = await this.state.getOperationResult<O>(
      context.operationId,
    );

    if (existing !== null) {
      return existing;
    }

    const adapter = this.tools.get(toolName);

    if (!adapter) {
      throw new ToolExecutionError(`Unknown tool: ${toolName}`, false);
    }

    this.policy.authorize(
      { permissions: context.permissions },
      { capability: `tool:${toolName}` },
    );

    const input = adapter.validateInput(rawInput);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const output = await adapter.execute(
        input,
        context,
        controller.signal,
      );

      await this.state.saveOperationResult(context.operationId, output);

      return output as O;
    } catch (error) {
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
