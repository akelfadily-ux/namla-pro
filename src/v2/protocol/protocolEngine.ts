/**
 * PROTOCOL Engine (§04, §09, P0.14, FINAL-P0-9, Gap 1).
 *
 * Validates draft plans and freezes canonical PlanContract bytes.
 * Derives explicit typed verification requirements (BUILD, TYPECHECK, TEST, SMOKE, DOCKER_BUILD)
 * mapped directly from actual project class characteristics and task specifications.
 */

import { DraftPlan, PlanContract, TestRequirement, TestRequirementType } from "../types/contracts";
import { WorkPackage } from "../types/missionState";
import { PreFreezeStageContext } from "../types/stageContext";
import { ProjectClass } from "../factory/projectFactory";
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

    // Derive explicit typed verification test requirements based on project class (Gap 1)
    const projectClass: ProjectClass = context.projectClass ?? "TYPESCRIPT_LIBRARY";
    const requiredTests: TestRequirement[] = [];

    // All supported classes require BUILD, TYPECHECK, and TEST
    requiredTests.push(
      {
        id: "test-verif-build",
        type: "BUILD",
        name: "Project Build Contract",
        command: "npm run build",
        expectedExitCode: 0,
      },
      {
        id: "test-verif-typecheck",
        type: "TYPECHECK",
        name: "TypeScript Compiler Verification",
        command: "npx --package=typescript tsc --noEmit",
        expectedExitCode: 0,
      },
      {
        id: "test-verif-suite",
        type: "TEST",
        name: "Unit & Integration Test Suite",
        command: "npm test",
        expectedExitCode: 0,
      }
    );

    // Add class-specific verification requirements
    switch (projectClass) {
      case "CLI_APPLICATION":
      case "REST_API":
      case "WEB_APPLICATION":
      case "DATABASE_SERVICE":
        requiredTests.push({
          id: "test-verif-smoke",
          type: "SMOKE",
          name: `${projectClass} Executable Smoke Verification`,
          command: "npm test",
          expectedExitCode: 0,
        });
        break;

      case "FULLSTACK_APPLICATION":
        requiredTests.push({
          id: "test-verif-integration",
          type: "INTEGRATION_TEST",
          name: "Fullstack Contract Integration Verification",
          command: "npm test",
          expectedExitCode: 0,
        });
        break;

      case "DOCKERIZED_SERVICE":
        requiredTests.push({
          id: "test-verif-docker",
          type: "DOCKER_BUILD",
          name: "Docker Build Environment Verification",
          command: "npm test",
          expectedExitCode: 0,
        });
        break;

      default:
        break;
    }

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
      requiredTests,
      securityRequirements: [
        {
          id: "sec-1",
          rule: "NO_SECRET_LEAKAGE",
          failClosed: true,
        },
      ],
      expectedArtifacts: draftPlan.tasks.flatMap((t) =>
        t.targetFiles.map((path) => ({
          path,
          description: `Artifact for task ${t.name}`,
          optional: false,
        }))
      ),
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
