import { TaskStatus } from "./types";

const transitions: Record<TaskStatus, readonly TaskStatus[]> = {
  [TaskStatus.Created]: [
    TaskStatus.Assigned,
    TaskStatus.Cancelled,
  ],

  [TaskStatus.Assigned]: [
    TaskStatus.Running,
    TaskStatus.Cancelled,
    TaskStatus.Blocked,
  ],

  [TaskStatus.Running]: [
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
