import { BudgetExceededError } from "../domain/errors";
import { BudgetLimits, BudgetUsage } from "../domain/types";

export class BudgetController {
  assertWithinLimits(
    limits: BudgetLimits,
    usage: BudgetUsage,
  ): void {
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
