export abstract class NamlaError extends Error {
  abstract readonly code: string;
  abstract readonly retryable: boolean;

  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ConfigurationError extends NamlaError {
  readonly code = "CONFIGURATION_ERROR";
  readonly retryable = false;
}

export class PermissionDeniedError extends NamlaError {
  readonly code = "PERMISSION_DENIED";
  readonly retryable = false;
}

export class BudgetExceededError extends NamlaError {
  readonly code = "BUDGET_EXCEEDED";
  readonly retryable = false;
}

export enum ProviderBillingState {
  UNBILLED_FAILURE = "UNBILLED_FAILURE",
  BILLED_FAILURE = "BILLED_FAILURE",
  UNKNOWN_BILLING_FAILURE = "UNKNOWN_BILLING_FAILURE",
}

export class ModelProviderError extends NamlaError {
  readonly code = "MODEL_PROVIDER_ERROR";
  readonly billingState: ProviderBillingState;

  constructor(
    message: string,
    readonly retryable: boolean,
    billingState = ProviderBillingState.UNKNOWN_BILLING_FAILURE,
    cause?: unknown,
  ) {
    super(message, cause);
    this.billingState = billingState;
  }
}

export class ToolExecutionError extends NamlaError {
  readonly code = "TOOL_EXECUTION_ERROR";

  constructor(
    message: string,
    readonly retryable: boolean,
    cause?: unknown,
  ) {
    super(message, cause);
  }
}

export class StateConflictError extends NamlaError {
  readonly code = "STATE_CONFLICT";
  readonly retryable = true;
}

export class GateRejectedError extends NamlaError {
  readonly code = "GATE_REJECTED";
  readonly retryable = false;
}
