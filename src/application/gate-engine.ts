import { Artifact, TaskRecord } from "../domain/types";

export interface GateContext {
  task: TaskRecord;
  artifacts: readonly Artifact[];
  workspacePath: string;
}

export interface GateResult {
  gate: string;
  passed: boolean;
  reason: string;
  evidence: readonly string[];
  requiredFixes: readonly string[];
}

export interface Gate {
  readonly name: string;
  evaluate(context: GateContext): Promise<GateResult>;
}

export class GateEngine {
  constructor(private readonly gates: readonly Gate[]) {}

  async evaluate(context: GateContext): Promise<GateResult[]> {
    const results: GateResult[] = [];

    for (const gate of this.gates) {
      const result = await gate.evaluate(context);
      results.push(result);

      if (!result.passed) {
        return results;
      }
    }

    return results;
  }

  static passed(results: readonly GateResult[]): boolean {
    return results.length > 0 && results.every((r) => r.passed);
  }
}
