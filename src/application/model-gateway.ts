import {
  ModelAdapter,
  ModelRequest,
  ModelResponse,
  StateRepository,
} from "../domain/contracts";
import { RunId } from "../domain/types";
import { BudgetController } from "./budget-controller";

export class ModelGateway {
  private readonly adapters = new Map<string, ModelAdapter>();

  constructor(
    adapters: readonly ModelAdapter[],
    private readonly state: StateRepository,
    private readonly budgets: BudgetController,
  ) {
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.provider)) {
        throw new Error(`Duplicate model provider: ${adapter.provider}`);
      }
      this.adapters.set(adapter.provider, adapter);
    }
  }

  async generate<T>(
    runId: RunId,
    provider: string,
    request: ModelRequest<T>,
  ): Promise<ModelResponse<T>> {
    const limits = await this.state.getBudgetLimits(runId);
    const usage = await this.state.getBudgetUsage(runId);

    this.budgets.assertWithinLimits(limits, usage);

    const adapter = this.adapters.get(provider);

    if (!adapter) {
      throw new Error(`Model provider not configured: ${provider}`);
    }

    const now = new Date();
    await this.state.appendEvent({
      type: "model.started",
      runId,
      traceId: `trace-${runId}`,
      timestamp: now,
      payload: { provider, model: request.model },
    });

    try {
      const response = await adapter.generate(request);

      await this.state.appendEvent({
        type: "model.completed",
        runId,
        traceId: `trace-${runId}`,
        timestamp: new Date(),
        payload: {
          provider,
          model: response.model,
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          costUsd: response.usage.estimatedCostUsd,
        },
      });

      return response;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Model generation failed";
      await this.state.appendEvent({
        type: "model.failed",
        runId,
        traceId: `trace-${runId}`,
        timestamp: new Date(),
        payload: { provider, model: request.model, error: errMsg },
      });
      throw error;
    }
  }
}
