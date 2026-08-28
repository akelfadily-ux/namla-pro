import { StateRepository } from "../domain/contracts";
import { TaskRecord, TaskStatus } from "../domain/types";
import { GateEngine, GateContext } from "./gate-engine";
import { Supervisor } from "./supervisor";

export interface TaskExecutor {
  execute(
    task: TaskRecord,
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
    workerId?: string,
    leaseToken?: string,
  ): Promise<void> {
    let task = await this.state.getTask(taskId);

    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Heartbeat setup if worker lease details provided
    let heartbeatTimer: NodeJS.Timeout | undefined;
    const abortController = new AbortController();

    if (workerId && leaseToken) {
      heartbeatTimer = setInterval(async () => {
        try {
          const renewed = await this.state.renewTaskLease(taskId, workerId, leaseToken, 30_000);
          if (!renewed) {
            abortController.abort(new Error(`Lease renewal lost for task ${taskId}`));
            if (heartbeatTimer) clearInterval(heartbeatTimer);
          }
        } catch {
          // Ignore transient errors
        }
      }, 10_000);
    }

    if (task.status === TaskStatus.Assigned) {
      task = leaseToken && workerId && this.state.transitionTaskFenced
        ? await this.state.transitionTaskFenced(
            task.id,
            TaskStatus.Assigned,
            TaskStatus.Running,
            workerId,
            leaseToken,
          )
        : await this.state.transitionTask(
            task.id,
            TaskStatus.Assigned,
            TaskStatus.Running,
          );
    }

    try {
      const execution = await this.executor.execute(task);

      // Persist AntExecution record
      await this.state.saveAntExecution({
        antId: task.assignedAntId || "ant-worker",
        runId: task.runId,
        taskId: task.id,
        role: task.role,
        attempt: task.attempt,
        startedAt: new Date(),
        finishedAt: new Date(),
        status: TaskStatus.Testing,
      });

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

      task = await this.state.transitionTask(
        task.id,
        TaskStatus.Running,
        TaskStatus.Testing,
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

        await this.handleFailure(task, failedGate?.reason || "Automated gate rejected task");
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

      task = await this.state.transitionTask(
        task.id,
        TaskStatus.Testing,
        TaskStatus.Review,
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

        await this.handleFailure(task, decision.reason);
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

      await this.state.transitionTask(
        task.id,
        TaskStatus.Review,
        TaskStatus.Approved,
      );
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
  ): Promise<void> {
    const shouldRetry = task.attempt + 1 < task.maxAttempts;

    await this.state.appendEvent({
      type: shouldRetry ? "task.retrying" : "task.failed",
      runId: task.runId,
      taskId: task.id,
      traceId: `trace-${task.runId}`,
      timestamp: new Date(),
      payload: { reason, attempt: task.attempt + 1, maxAttempts: task.maxAttempts },
    });

    if (shouldRetry) {
      await this.state.transitionTask(
        task.id,
        task.status,
        TaskStatus.Retrying,
        {
          attempt: task.attempt + 1,
          updatedAt: new Date(),
        },
      );
      return;
    }

    await this.state.transitionTask(
      task.id,
      task.status,
      TaskStatus.Failed,
      {
        updatedAt: new Date(),
      },
    );
  }
}
