import {
  StateRepository,
  ToolAdapter,
  ToolExecutionContext,
} from "../domain/contracts";
import { ToolExecutionError } from "../domain/errors";
import { PolicyEngine } from "./policy-engine";
import { fingerprintOperation } from "./operation-fingerprint";

export class ToolGateway {
  private readonly tools = new Map<string, ToolAdapter<any, any>>();

  private static readonly PRIVILEGED_PREFIXES = ["filesystem.", "shell", "git", "github", "docker", "deployment", "db."];

  constructor(
    adapters: readonly ToolAdapter[],
    private readonly state: StateRepository,
    private readonly policy: PolicyEngine,
  ) {
    for (const adapter of adapters) {
      if (this.tools.has(adapter.name)) {
        throw new Error(`Duplicate tool registered: ${adapter.name}`);
      }
      const isPrivileged = ToolGateway.PRIVILEGED_PREFIXES.some((p) => adapter.name.startsWith(p));
      if (isPrivileged && typeof adapter.getPermissionRequests !== "function") {
        throw new Error(`CONFIGURATION ERROR: Privileged tool '${adapter.name}' must implement getPermissionRequests`);
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
    const effectiveWorkerId = context.authority?.workerId ?? "worker-1";
    const adapter = this.tools.get(toolName);

    if (!adapter) {
      throw new ToolExecutionError(`Unknown tool: ${toolName}`, false);
    }

    const input = adapter.validateInput(rawInput);

    const reqs = typeof adapter.getPermissionRequests === "function"
      ? adapter.getPermissionRequests(input, context)
      : [{ capability: `tool:${toolName}` }];

    for (const req of reqs) {
      this.policy.authorize({ permissions: context.permissions }, req, (req as any).gitOperation);
    }

    if (!context.authority || !context.authority.workerId || !context.authority.leaseToken) {
      throw new ToolExecutionError(
        `TASK_AUTHORITY_LOST for ${context.taskId}: Tool execution requires valid task authority (workerId and leaseToken)`,
        false,
      );
    }

    const workerId = context.authority.workerId;

    // 1. Prove active task lease authority BEFORE claiming operation or performing side effects
    const isPrivileged = ToolGateway.PRIVILEGED_PREFIXES.some((p) => toolName.startsWith(p));
    if (isPrivileged) {
      const task = await this.state.getTask(context.taskId);
      const isLeaseActive = task?.leaseExpiresAt ? new Date(task.leaseExpiresAt) > new Date() : false;
      if (
        !task ||
        !task.leaseOwner ||
        task.leaseOwner !== workerId ||
        task.leaseToken !== context.authority.leaseToken ||
        !isLeaseActive
      ) {
        throw new ToolExecutionError(
          `TASK_AUTHORITY_LOST for ${context.taskId}: worker ${workerId} with lease token ${context.authority.leaseToken} does not hold an active unexpired task lease`,
          false,
        );
      }
    }

    // 2. Fingerprint input and claim operation atomically with task authority check
    const inputHash = fingerprintOperation({
      runId: context.runId,
      taskId: context.taskId,
      toolName,
      value: input,
    });

    const claim = await this.state.claimOperation(
      {
        id: context.operationId,
        toolName,
        inputHash,
        runId: context.runId,
        taskId: context.taskId,
        antId: context.antId,
      },
      context.authority,
      timeoutMs,
    );

    if (claim.status === "TASK_AUTHORITY_LOST") {
      throw new ToolExecutionError(
        `TASK_AUTHORITY_LOST for ${context.taskId}: worker ${context.authority?.workerId} with lease token ${context.authority?.leaseToken} does not hold an active unexpired task lease`,
        false,
      );
    }

    if (claim.status === "INPUT_HASH_MISMATCH") {
      throw new ToolExecutionError(
        `Operation ID ${context.operationId} was previously used with different input hash or context`,
        false,
      );
    }

    if (claim.status === "COMPLETED") {
      // Telemetry failure MUST NOT turn successful side effects into failure
      try {
        await this.state.appendEvent({
          type: "tool.replayed",
          runId: context.runId,
          taskId: context.taskId,
          traceId: context.traceId,
          timestamp: new Date(),
          payload: { operationId: context.operationId, toolName },
        });
      } catch {
        /* telemetry failure isolated */
      }
      return claim.record?.result as O;
    }

    if (claim.status === "RUNNING_OTHER_LEASE") {
      throw new ToolExecutionError(
        `Operation ${context.operationId} is currently being executed by another worker`,
        true,
      );
    }

    const claimToken = claim.claimToken;
    if (!claimToken) {
      throw new ToolExecutionError(
        `Internal invariant error: Operation ${context.operationId} claimed without valid claim token`,
        false,
      );
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      await this.state.appendEvent({
        type: "tool.started",
        runId: context.runId,
        taskId: context.taskId,
        traceId: context.traceId,
        timestamp: new Date(),
        payload: { operationId: context.operationId, toolName },
      });
    } catch {
      /* telemetry failure isolated */
    }

    let output: O;
    try {
      output = await adapter.execute(input, context, controller.signal);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Execution failed";
      try {
        await this.state.failOperation(context.operationId, workerId, claimToken, errMsg);
      } catch {
        /* ignore */
      }

      try {
        await this.state.appendEvent({
          type: "tool.failed",
          runId: context.runId,
          taskId: context.taskId,
          traceId: context.traceId,
          timestamp: new Date(),
          payload: { operationId: context.operationId, toolName, error: errMsg },
        });
      } catch {
        /* telemetry failure isolated */
      }

      if (controller.signal.aborted) {
        throw new ToolExecutionError(`${toolName} timed out after ${timeoutMs}ms`, true, error);
      }
      if (error instanceof ToolExecutionError) throw error;
      throw new ToolExecutionError(`${toolName} execution failed`, true, error);
    } finally {
      clearTimeout(timer);
    }

    // Mark completed WITH fencing token
    const completedOk = await this.state.completeOperation(context.operationId, workerId, claimToken, output);
    if (!completedOk) {
      throw new ToolExecutionError(
        `Operation ${context.operationId} lost worker ownership before completion`,
        true,
      );
    }

    // Telemetry failure MUST NOT convert a completed operation into failure
    try {
      await this.state.appendEvent({
        type: "tool.completed",
        runId: context.runId,
        taskId: context.taskId,
        traceId: context.traceId,
        timestamp: new Date(),
        payload: { operationId: context.operationId, toolName },
      });
    } catch {
      /* telemetry failure isolated */
    }

    return output;
  }
}
