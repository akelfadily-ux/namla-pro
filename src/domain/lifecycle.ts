import { RunStatus, TaskStatus } from "./types";

const runTransitions: Record<RunStatus, readonly RunStatus[]> = {
  [RunStatus.Created]: [RunStatus.Planning, RunStatus.Cancelled],
  [RunStatus.Planning]: [RunStatus.Running, RunStatus.Failed, RunStatus.Cancelled],
  [RunStatus.Running]: [RunStatus.Paused, RunStatus.Completed, RunStatus.Failed, RunStatus.Cancelled],
  [RunStatus.Paused]: [RunStatus.Running, RunStatus.Cancelled],
  [RunStatus.Completed]: [],
  [RunStatus.Failed]: [],
  [RunStatus.Cancelled]: [],
};

export class InvalidRunTransitionError extends Error {
  constructor(public readonly from: RunStatus, public readonly to: RunStatus) {
    super(`Invalid run transition: ${from} -> ${to}`);
    this.name = "InvalidRunTransitionError";
  }
}

export function assertRunTransition(from: RunStatus, to: RunStatus): void {
  if (!runTransitions[from].includes(to)) {
    throw new InvalidRunTransitionError(from, to);
  }
}

const transitions: Record<TaskStatus, readonly TaskStatus[]> = {
  [TaskStatus.Created]: [
    TaskStatus.Assigned,
    TaskStatus.Blocked,
    TaskStatus.Failed,
    TaskStatus.Cancelled,
  ],

  [TaskStatus.Assigned]: [
    TaskStatus.Running,
    TaskStatus.Retrying,
    TaskStatus.Cancelled,
    TaskStatus.Blocked,
  ],

  [TaskStatus.Running]: [
    TaskStatus.Running,
    TaskStatus.Testing,
    TaskStatus.Blocked,
    TaskStatus.Retrying,
    TaskStatus.Failed,
    TaskStatus.Cancelled,
  ],

  [TaskStatus.Testing]: [
    TaskStatus.Review,
    TaskStatus.Retrying,
    TaskStatus.Failed,
    TaskStatus.Cancelled,
  ],

  [TaskStatus.Review]: [
    TaskStatus.Approved,
    TaskStatus.Retrying,
    TaskStatus.Failed,
    TaskStatus.Cancelled,
  ],

  [TaskStatus.Retrying]: [
    TaskStatus.Assigned,
    TaskStatus.Blocked,
    TaskStatus.Failed,
    TaskStatus.Cancelled,
  ],

  [TaskStatus.Blocked]: [
    TaskStatus.Assigned,
    TaskStatus.Cancelled,
    TaskStatus.Failed,
  ],

  [TaskStatus.Approved]: [],

  [TaskStatus.Failed]: [],

  [TaskStatus.Cancelled]: [],
};

export class InvalidTaskTransitionError extends Error {
  constructor(
    public readonly from: TaskStatus,
    public readonly to: TaskStatus,
  ) {
    super(`Invalid task transition: ${from} -> ${to}`);
    this.name = "InvalidTaskTransitionError";
  }
}

export function assertTaskTransition(
  from: TaskStatus,
  to: TaskStatus,
): void {
  if (!transitions[from].includes(to)) {
    throw new InvalidTaskTransitionError(from, to);
  }
}
