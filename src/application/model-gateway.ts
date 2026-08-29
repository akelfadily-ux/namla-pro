import {
  ModelAdapter,
  ModelRequest,
  ModelResponse,
  StateRepository,
} from "../domain/contracts";
import { RunId } from "../domain/types";
import { BudgetController } from "./budget-controller";

import { ConfigurationError, ModelProviderError, ProviderBillingState } from "../domain/errors";

export { ProviderBillingState };

export interface ModelPricing {
  version: string;
  provider: string;
  model: string;
  inputUsdPerToken: number;
  outputUsdPerToken: number;
  maxOutputTokens: number;
}

export class ModelGateway {
  private readonly adapters = new Map<string, ModelAdapter>();
  private readonly pricingCatalog = new Map<string, ModelPricing>([
    ["openai:gpt-4", { version: "2024-01-01", provider: "openai", model: "gpt-4", inputUsdPerToken: 0.00003, outputUsdPerToken: 0.00006, maxOutputTokens: 2000 }],
    ["openai:gpt-3.5-turbo", { version: "2024-01-01", provider: "openai", model: "gpt-3.5-turbo", inputUsdPerToken: 0.0000015, outputUsdPerToken: 0.000002, maxOutputTokens: 2000 }],
    ["anthropic:claude-3-opus", { version: "2024-01-01", provider: "anthropic", model: "claude-3-opus", inputUsdPerToken: 0.000015, outputUsdPerToken: 0.000075, maxOutputTokens: 2000 }],
  ]);

  constructor(
    adapters: readonly ModelAdapter[],
    private readonly state: StateRepository,
    private readonly budgets: BudgetController,
    pricingOverrides?: readonly ModelPricing[],
  ) {
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.provider)) {
        throw new Error(`Duplicate model provider: ${adapter.provider}`);
      }
      this.adapters.set(adapter.provider, adapter);
    }
    if (pricingOverrides) {
      for (const p of pricingOverrides) {
        this.pricingCatalog.set(`${p.provider}:${p.model}`, p);
      }
    }
  }

  async generate<T>(
    runId: RunId,
    provider: string,
    request: ModelRequest<T>,
  ): Promise<ModelResponse<T>> {
    // 1. Check durable accounting safety state BEFORE reserving budget or calling provider
    const accState = await this.state.getAccountingState(runId);
    if (accState.state !== "ACTIVE") {
      throw new Error(`ACCOUNTING_BLOCKED for run ${runId}: ${accState.reason ?? accState.state}`);
    }

    const limits = await this.state.getBudgetLimits(runId);
    const usage = await this.state.getBudgetUsage(runId);

    this.budgets.assertWithinLimits(limits, usage);

    const adapter = this.adapters.get(provider);

    if (!adapter) {
      throw new Error(`Model provider not configured: ${provider}`);
    }

    const modelName = request.model || "gpt-4";
    const pricingKey = `${provider}:${modelName}`;
    const pricing = this.pricingCatalog.get(pricingKey);

    if (!pricing) {
      throw new ConfigurationError(
        `Versioned pricing catalog fail-closed: Unknown model '${modelName}' for provider '${provider}'`,
      );
    }

    // Model/provider-aware conservative cost estimation
    const inputChars = (request.system?.length || 0) + (request.input?.length || 0);
    const estimatedInputTokens = Math.ceil(inputChars / 4) + 20;
    const estimatedOutputTokens = pricing.maxOutputTokens;
    const estimatedCost = (estimatedInputTokens * pricing.inputUsdPerToken) + (estimatedOutputTokens * pricing.outputUsdPerToken);

    // Reserve budget atomically prior to provider call
    const reservation = await this.state.reserveBudget(runId, estimatedCost, estimatedInputTokens + estimatedOutputTokens);
    if (!reservation.reserved) {
      throw new Error("Budget limit exceeded during atomic reservation");
    }

    const now = new Date();
    // Telemetry failure MUST NOT convert provider success into failure
    try {
      await this.state.appendEvent({
        type: "model.started",
        runId,
        traceId: `trace-${runId}`,
        timestamp: now,
        payload: { provider, model: request.model },
      });
    } catch {
      /* telemetry failure isolated */
    }

    let response: ModelResponse<T>;
    try {
      response = await adapter.generate(request);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Model generation failed";

      // Default to UNKNOWN_BILLING_FAILURE unless explicitly proven via ModelProviderError
      const billingState: ProviderBillingState =
        error instanceof ModelProviderError ? error.billingState : ProviderBillingState.UNKNOWN_BILLING_FAILURE;

      if (reservation.reservationId) {
        if (billingState === ProviderBillingState.UNBILLED_FAILURE) {
          // Release reservation to $0 cost ONLY on explicitly proven unbilled failure
          if (typeof this.state.releaseBudgetReservation === "function") {
            try {
              await this.state.releaseBudgetReservation(reservation.reservationId, errMsg);
            } catch (relErr) {
              await this.state.setAccountingState(runId, "BLOCKED_PERSISTENCE_FAILURE", `Failed to release reservation ${reservation.reservationId}`);
              throw new Error(`ACCOUNTING_BLOCKED: Failed to release budget reservation ${reservation.reservationId}: ${relErr instanceof Error ? relErr.message : String(relErr)}`);
            }
          }
        } else {
          // BILLED_FAILURE or UNKNOWN_BILLING_FAILURE: Reconcile reservation with full estimated cost and persist accounting hold
          try {
            await this.state.reconcileBudget(
              reservation.reservationId,
              estimatedCost,
              estimatedInputTokens + estimatedOutputTokens,
            );
          } catch (recErr) {
            await this.state.setAccountingState(runId, "BLOCKED_PERSISTENCE_FAILURE", `Failed to reconcile reservation ${reservation.reservationId}`);
            throw new Error(`ACCOUNTING_BLOCKED: Failed to reconcile budget reservation ${reservation.reservationId}: ${recErr instanceof Error ? recErr.message : String(recErr)}`);
          }

          if (billingState === ProviderBillingState.UNKNOWN_BILLING_FAILURE) {
            await this.state.setAccountingState(runId, "BLOCKED_UNKNOWN_BILLING", `Model provider failed with UNKNOWN_BILLING_FAILURE: ${errMsg}`);
          }
        }
      }

      try {
        await this.state.appendEvent({
          type: "model.failed",
          runId,
          traceId: `trace-${runId}`,
          timestamp: new Date(),
          payload: { provider, model: request.model, error: errMsg, billingState },
        });
      } catch {
        /* telemetry failure isolated */
      }
      throw error;
    }

    // Reconcile actual budget usage
    if (reservation.reservationId) {
      try {
        await this.state.reconcileBudget(
          reservation.reservationId,
          response.usage.estimatedCostUsd,
          response.usage.inputTokens + response.usage.outputTokens,
        );
      } catch (error) {
        await this.state.setAccountingState(runId, "BLOCKED_PERSISTENCE_FAILURE", `Failed to reconcile budget reservation ${reservation.reservationId}`);
        throw new Error(`ACCOUNTING_BLOCKED: Failed to reconcile budget reservation ${reservation.reservationId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Telemetry failure MUST NOT convert provider success into failure
    try {
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
    } catch {
      /* telemetry failure isolated */
    }

    return response;
  }
}
