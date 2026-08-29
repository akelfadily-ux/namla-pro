import { StateRepository } from "../domain/contracts";
import { TaskRecord, TaskStatus } from "../domain/types";
import { GateEngine, GateContext } from "./gate-engine";
import { Supervisor } from "./supervisor";

export interface TaskExecutionAuthority {
  workerId: string;
  leaseToken: string;
}

export interface TaskExecutor {
  execute(
    task: TaskRecord,
    context: {
      signal: AbortSignal;
      workerId: string;
      leaseToken: string;
    },
  ): Promise<{
    artifacts: any[];
    workspacePath: string;
  }>;
}

export class NamlaLoop {
  constructor(
    private readonly state: StateRepository,
    private readonly executor: TaskExecutor,
    private readonly gates: GateEngine,
    private readonly supervisor: Supervisor,
  ) {}

  async executeTask(
    taskId: string,
    authority: TaskExecutionAuthority,
  ): Promise<void> {
    let task = await this.state.getTask(taskId);

    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const { workerId, leaseToken } = authority;

    // Heartbeat setup for worker lease
    let heartbeatTimer: NodeJS.Timeout | undefined;
    const abortController = new AbortController();

    heartbeatTimer = setInterval(async () => {
      try {
        const renewed = await this.state.renewTaskLease(taskId, workerId, leaseToken, 30_000);
        if (!renewed) {
          abortController.abort(new Error(`Lease renewal lost for task ${taskId}`));
          if (heartbeatTimer) clearInterval(heartbeatTimer);
        }
      } catch {
        abortController.abort(new Error(`Lease heartbeat network failure for task ${taskId}`));
        if (heartbeatTimer) clearInterval(heartbeatTimer);
      }
    }, 10_000);
    if (heartbeatTimer && typeof heartbeatTimer.unref === "function") {
      heartbeatTimer.unref();
    }

    if (task.status === TaskStatus.Assigned) {
      task = await this.state.transitionTaskFenced(
        task.id,
        TaskStatus.Assigned,
        TaskStatus.Running,
        workerId,
        leaseToken,
      );
    }

    const logicalAntId = task.assignedAntId ?? (task.role ? `ant-${String(task.role).toLowerCase()}` : null);
    if (!logicalAntId) {
      throw new Error(`Execution error: Task ${task.id} requires an assigned Ant or AntRole identity`);
    }

    const executionStartTime = new Date();
    await this.state.saveAntExecution({
      antId: logicalAntId,
      runId: task.runId,
      taskId: task.id,
      role: task.role,
      attempt: task.attempt,
      startedAt: executionStartTime,
      status: TaskStatus.Running,
    });

    try {
      if (abortController.signal.aborted) {
        throw new Error(`Worker lease lost before execution start for task ${task.id}`);
      }

      const execution = await this.executor.execute(task, {
        signal: abortController.signal,
        workerId,
        leaseToken,
      });

      if (abortController.signal.aborted) {
        throw new Error(`Worker lease lost during execution for task ${task.id}`);
      }

      // Mark AntExecution as testing upon successful executor execution
      if (typeof this.state.updateAntExecution === "function") {
        await this.state.updateAntExecution({
          antId: logicalAntId,
          runId: task.runId,
          taskId: task.id,
          attempt: task.attempt,
          finishedAt: new Date(),
          status: TaskStatus.Testing,
        });
      }

      // Persist produced Artifacts
      if (execution.artifacts && Array.isArray(execution.artifacts)) {
        for (const art of execution.artifacts) {
          await this.state.saveArtifact({
            id: art.id || `art-${Date.now()}`,
            runId: task.runId,
            taskId: task.id,
            antId: task.assignedAntId,
            type: art.type || "code",
            name: art.name || "unnamed-artifact",
            path: art.path,
            uri: art.uri,
            metadata: art.metadata || {},
            createdAt: art.createdAt || new Date(),
          });
        }
      }

      task = await this.state.transitionTaskFenced(
        task.id,
        TaskStatus.Running,
        TaskStatus.Testing,
        workerId,
        leaseToken,
      );

      const gateContext: GateContext = {
        task,
        artifacts: execution.artifacts,
        workspacePath: execution.workspacePath,
      };

      await this.state.appendEvent({
        type: "gate.started",
        runId: task.runId,
        taskId: task.id,
        traceId: `trace-${task.runId}`,
        timestamp: new Date(),
        payload: { taskTitle: task.title },
      });

      const gateResults = await this.gates.evaluate(gateContext);

      if (!GateEngine.passed(gateResults)) {
        const failedGate = gateResults.find((r) => !r.passed);
        await this.state.appendEvent({
          type: "gate.failed",
          runId: task.runId,
          taskId: task.id,
          traceId: `trace-${task.runId}`,
          timestamp: new Date(),
          payload: { results: gateResults, reason: failedGate?.reason },
        });

        await this.handleFailure(task, failedGate?.reason || "Automated gate rejected task", authority);
        return;
      }

      await this.state.appendEvent({
        type: "gate.passed",
        runId: task.runId,
        taskId: task.id,
        traceId: `trace-${task.runId}`,
        timestamp: new Date(),
        payload: { results: gateResults },
      });

      task = await this.state.transitionTaskFenced(
        task.id,
        TaskStatus.Testing,
        TaskStatus.Review,
        workerId,
        leaseToken,
      );

      await this.state.appendEvent({
        type: "supervisor.review.started",
        runId: task.runId,
        taskId: task.id,
        traceId: `trace-${task.runId}`,
        timestamp: new Date(),
        payload: { taskTitle: task.title },
      });

      const decision = await this.supervisor.review({
        task,
        artifacts: execution.artifacts,
        gateEvidence: gateResults,
      });

      if (!decision.approved) {
        await this.state.appendEvent({
          type: "supervisor.rejected",
          runId: task.runId,
          taskId: task.id,
          traceId: `trace-${task.runId}`,
          timestamp: new Date(),
          payload: { reason: decision.reason, risks: decision.risks, requiredFixes: decision.requiredFixes },
        });

        await this.handleFailure(task, decision.reason, authority);
        return;
      }

      await this.state.appendEvent({
        type: "supervisor.approved",
        runId: task.runId,
        taskId: task.id,
        traceId: `trace-${task.runId}`,
        timestamp: new Date(),
        payload: { reason: decision.reason, risks: decision.risks },
      });

      await this.state.transitionTaskFenced(
        task.id,
        TaskStatus.Review,
        TaskStatus.Approved,
        workerId,
        leaseToken,
      );

      // Terminal AntExecution update to APPROVED after supervisor approval
      if (typeof this.state.updateAntExecution === "function") {
        await this.state.updateAntExecution({
          antId: logicalAntId,
          runId: task.runId,
          taskId: task.id,
          attempt: task.attempt,
          finishedAt: new Date(),
          status: TaskStatus.Approved,
        });
      }
    } catch (error) {
      const latest = await this.state.getTask(taskId);

      if (
        latest &&
        latest.status !== TaskStatus.Failed &&
        latest.status !== TaskStatus.Cancelled &&
        latest.status !== TaskStatus.Approved
      ) {
        await this.handleFailure(
          latest,
          error instanceof Error
            ? error.message
            : "Unknown execution failure",
          authority,
        );
      }

      throw error;
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    }
  }

  private async handleFailure(
    task: TaskRecord,
    reason: string,
    authority: TaskExecutionAuthority,
  ): Promise<void> {
    const shouldRetry = task.attempt + 1 < task.maxAttempts;

    const logicalAntId = task.assignedAntId ?? (task.role ? `ant-${String(task.role).toLowerCase()}` : `ant-worker-${task.id}`);

    // Persist AntExecution failure status using updateAntExecution to preserve original startedAt
    if (typeof this.state.updateAntExecution === "function") {
      await this.state.updateAntExecution({
        antId: logicalAntId,
        runId: task.runId,
        taskId: task.id,
        attempt: task.attempt,
        finishedAt: new Date(),
        status: shouldRetry ? TaskStatus.Retrying : TaskStatus.Failed,
      });
    }

    await this.state.appendEvent({
      type: shouldRetry ? "task.retrying" : "task.failed",
      runId: task.runId,
      taskId: task.id,
      traceId: `trace-${task.runId}`,
      timestamp: new Date(),
      payload: { reason, attempt: task.attempt + 1, maxAttempts: task.maxAttempts },
    });

    if (shouldRetry) {
      await this.state.transitionTaskFenced(
        task.id,
        task.status,
        TaskStatus.Retrying,
        authority.workerId,
        authority.leaseToken,
        {
          attempt: task.attempt + 1,
          updatedAt: new Date(),
        },
      );
      return;
    }

    await this.state.transitionTaskFenced(
      task.id,
      task.status,
      TaskStatus.Failed,
      authority.workerId,
      authority.leaseToken,
      {
        updatedAt: new Date(),
      },
    );
  }
}
