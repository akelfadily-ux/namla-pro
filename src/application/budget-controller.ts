import { BudgetExceededError, ConfigurationError } from "../domain/errors";
import { BudgetLimits, BudgetUsage } from "../domain/types";

export class BudgetController {
  validateLimits(limits: BudgetLimits): void {
    if (limits.maxCostUsd !== undefined) {
      if (typeof limits.maxCostUsd !== "number" || !Number.isFinite(limits.maxCostUsd) || limits.maxCostUsd < 0 || limits.maxCostUsd > 1_000_000) {
        throw new ConfigurationError("BudgetLimits.maxCostUsd must be a finite number between 0 and 1,000,000");
      }
    }
    if (limits.maxTokens !== undefined) {
      if (typeof limits.maxTokens !== "number" || !Number.isSafeInteger(limits.maxTokens) || limits.maxTokens < 0 || limits.maxTokens > 1_000_000_000) {
        throw new ConfigurationError("BudgetLimits.maxTokens must be a safe integer between 0 and 1,000,000,000");
      }
    }
    if (limits.maxConcurrency !== undefined) {
      if (typeof limits.maxConcurrency !== "number" || !Number.isSafeInteger(limits.maxConcurrency) || limits.maxConcurrency < 1 || limits.maxConcurrency > 1_000) {
        throw new ConfigurationError("BudgetLimits.maxConcurrency must be a safe integer between 1 and 1,000");
      }
    }
    if (limits.maxAgents !== undefined) {
      if (typeof limits.maxAgents !== "number" || !Number.isSafeInteger(limits.maxAgents) || limits.maxAgents < 1 || limits.maxAgents > 1_000) {
        throw new ConfigurationError("BudgetLimits.maxAgents must be a safe integer between 1 and 1,000");
      }
    }
    if (limits.maxDepth !== undefined) {
      if (typeof limits.maxDepth !== "number" || !Number.isSafeInteger(limits.maxDepth) || limits.maxDepth < 0 || limits.maxDepth > 100) {
        throw new ConfigurationError("BudgetLimits.maxDepth must be a safe integer between 0 and 100");
      }
    }
  }

  assertWithinLimits(
    limits: BudgetLimits,
    usage: BudgetUsage,
  ): void {
    this.validateLimits(limits);

    if (
      limits.maxCostUsd !== undefined &&
      usage.costUsd >= limits.maxCostUsd
    ) {
      throw new BudgetExceededError(
        `Run cost limit exceeded: ${usage.costUsd}/${limits.maxCostUsd}`,
      );
    }

    const totalTokens = usage.inputTokens + usage.outputTokens;

    if (
      limits.maxTokens !== undefined &&
      totalTokens >= limits.maxTokens
    ) {
      throw new BudgetExceededError(
        `Token limit exceeded: ${totalTokens}/${limits.maxTokens}`,
      );
    }

    if (
      limits.maxModelCalls !== undefined &&
      usage.modelCalls >= limits.maxModelCalls
    ) {
      throw new BudgetExceededError(
        "Maximum model calls exceeded",
      );
    }

    if (
      limits.maxToolCalls !== undefined &&
      usage.toolCalls >= limits.maxToolCalls
    ) {
      throw new BudgetExceededError(
        "Maximum tool calls exceeded",
      );
    }

    if (
      limits.maxRuntimeMs !== undefined &&
      Date.now() - usage.startedAt.getTime() >= limits.maxRuntimeMs
    ) {
      throw new BudgetExceededError(
        "Maximum run duration exceeded",
      );
    }
  }
}
