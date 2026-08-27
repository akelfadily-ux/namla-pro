import { Artifact, TaskRecord } from "../domain/types";

export interface SupervisorDecision {
  approved: boolean;
  reason: string;
  risks: readonly string[];
  requiredFixes: readonly string[];
}

export interface Supervisor {
  review(input: {
    task: TaskRecord;
    artifacts: readonly Artifact[];
    gateEvidence: readonly unknown[];
  }): Promise<SupervisorDecision>;
}
