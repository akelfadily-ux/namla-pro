/**
 * PLAN Engine (§04, §09).
 */

import { EerOutput } from "../eer/eerEngine";
import { DraftPlan, TaskSpec, AcceptanceCriterion } from "../types/contracts";
import { PreFreezeStageContext } from "../types/stageContext";

export class PlanEngine {
  public generatePlan(eer: EerOutput, context: PreFreezeStageContext): DraftPlan {
    const tasks: TaskSpec[] = [
      {
        id: "task-1",
        name: "Implementation",
        description: `Implement solution for: ${eer.originalObjective}`,
        targetFiles: ["src/index.ts"],
        dependencies: [],
        capabilityRequirements: eer.requiredCapabilities,
      },
      {
        id: "task-2",
        name: "Verification",
        description: "Run test suite and typechecks",
        targetFiles: ["tests/index.test.ts"],
        dependencies: ["task-1"],
        capabilityRequirements: ["process.execute"],
      },
    ];

    const acceptanceCriteria: AcceptanceCriterion[] = [
      {
        id: "ac-1",
        description: "Code compiles cleanly with tsc --noEmit",
        verificationMethod: "TEST",
        required: true,
      },
      {
        id: "ac-2",
        description: "Unit and integration tests pass",
        verificationMethod: "TEST",
        required: true,
      },
      {
        id: "ac-3",
        description: "Security invariants and path containment hold",
        verificationMethod: "SECURITY_CHECK",
        required: true,
      },
    ];

    return {
      draftId: `draft-${eer.missionId}-v1`,
      objective: eer.originalObjective,
      tasks,
      acceptanceCriteria,
      riskClassification: eer.riskClass,
      estimatedBudgets: {
        maxVirtualTicks: Math.min(context.budgets.virtualTicks, 100),
        maxProviderCalls: Math.min(context.budgets.providerCalls, 10),
        maxFixAttempts: Math.min(context.budgets.maxFixAttempts, 3),
      },
    };
  }
}
