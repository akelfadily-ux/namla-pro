/**
 * PROTOCOL Engine (§04, §09).
 */

import { DraftPlan, PlanContract, TaskSpec } from "../types/contracts";
import { WorkPackage } from "../types/missionState";
import { PreFreezeStageContext } from "../types/stageContext";
import { createHash } from "crypto";

export interface ProtocolResult {
  readonly success: boolean;
  readonly frozenContract?: PlanContract;
  readonly workPackages: readonly WorkPackage[];
  readonly reasonCode: string;
}

export class ProtocolEngine {
  public freezePlanContract(
    draftPlan: DraftPlan,
    context: PreFreezeStageContext
  ): ProtocolResult {
    if (!draftPlan.tasks || draftPlan.tasks.length === 0) {
      return {
        success: false,
        workPackages: [],
        reasonCode: "PROTOCOL_REJECTED: Plan has no tasks",
      };
    }

    if (!draftPlan.acceptanceCriteria || draftPlan.acceptanceCriteria.length === 0) {
      return {
        success: false,
        workPackages: [],
        reasonCode: "PROTOCOL_REJECTED: Plan has no acceptance criteria",
      };
    }

    const taskIds = new Set<string>();
    for (const task of draftPlan.tasks) {
      if (taskIds.has(task.id)) {
        return {
          success: false,
          workPackages: [],
          reasonCode: `PROTOCOL_REJECTED: Duplicate task ID ${task.id}`,
        };
      }
      taskIds.add(task.id);
    }

    const version = "v1.0.0";
    const frozenAt = Date.now();

    const rawContract = {
      contractId: `contract-${context.missionId}`,
      version,
      objective: draftPlan.objective,
      acceptanceCriteria: draftPlan.acceptanceCriteria,
      constraints: [
        {
          id: "c-1",
          type: "SECURITY" as const,
          description: "Must obey path containment and secret protection policies",
          strict: true,
        },
      ],
      tasks: draftPlan.tasks,
      dependencies: draftPlan.tasks.flatMap((t) =>
        t.dependencies.map((dep) => ({ taskId: t.id, dependsOnTaskId: dep }))
      ),
      allowedCapabilities: draftPlan.tasks.flatMap((t) =>
        t.capabilityRequirements.map((cap) => ({
          capability: cap,
          target: "*",
          readOnly: false,
        }))
      ),
      requiredTests: [
        {
          id: "test-1",
          name: "TypeScript Check",
          command: "npx tsc --noEmit",
          expectedExitCode: 0,
        },
      ],
      securityRequirements: [
        {
          id: "sec-1",
          rule: "NO_SECRET_LEAKAGE",
          failClosed: true,
        },
      ],
      expectedArtifacts: [
        {
          path: "src/index.ts",
          description: "Primary implementation artifact",
          optional: false,
        },
      ],
      evidenceRequirements: [
        {
          type: "BUILD_RECEIPT",
          requiredProducer: "PROMAX",
        },
      ],
      riskClassification: draftPlan.riskClassification,
      completionConditions: [
        {
          id: "comp-1",
          predicate: "ALL_ACCEPTANCE_CRITERIA_VERIFIED",
        },
      ],
      frozenAt,
    };

    const serialized = JSON.stringify(rawContract);
    const contractHash = createHash("sha256").update(serialized).digest("hex");

    const frozenContract: PlanContract = {
      ...rawContract,
      contractHash,
    };

    Object.freeze(frozenContract);

    const workPackages: WorkPackage[] = draftPlan.tasks.map((task) => {
      const wp: WorkPackage = {
        id: `wp-${context.missionId}-${task.id}`,
        missionId: context.missionId,
        contractVersion: version,
        taskSpec: task,
        acceptanceCriteria: draftPlan.acceptanceCriteria,
        inputArtifacts: [],
        readOnly: false,
        maxAttempts: draftPlan.estimatedBudgets.maxFixAttempts,
      };
      return Object.freeze(wp);
    });

    return {
      success: true,
      frozenContract,
      workPackages,
      reasonCode: "OK",
    };
  }
}
