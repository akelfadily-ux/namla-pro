/**
 * PROTOCOL Engine (§04, §09, P0.14, FINAL-P0-9, P0-T1, P0-C1..P0-C3, P0-C11).
 *
 * Validates draft plans and freezes canonical PlanContract bytes.
 * Derives explicit typed verification requirements (BUILD, TYPECHECK, TEST, SMOKE, DOCKER_BUILD)
 * with dedicated semantic verifier identifiers (BUILD_VERIFIER, TYPECHECK_VERIFIER, etc.)
 * and explicit provesCriterionIds bindings mapping verifiers strictly to target acceptance criteria.
 */

import { DraftPlan, PlanContract, TestRequirement, TestRequirementType, VerifierIdentifier, SecurityRequirement } from "../types/contracts";
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

    // Derive explicit typed verification test requirements based on project class (P0-T1, P0-C2)
    const projectClass: ProjectClass = context.projectClass ?? "TYPESCRIPT_LIBRARY";
    const requiredTests: TestRequirement[] = [];

    // Helper to find criteria strictly bound to a requirement ID
    const findCriteriaForReq = (reqId: string): string[] | undefined => {
      const matched = draftPlan.acceptanceCriteria
        .filter((ac) => ac.requiredRequirementId === reqId)
        .map((ac) => ac.id);
      return matched.length > 0 ? matched : undefined;
    };

    // All supported classes require BUILD, TYPECHECK, and TEST with dedicated verifier IDs & provesCriterionIds
    requiredTests.push(
      {
        id: "test-verif-build",
        type: "BUILD",
        verifier: "BUILD_VERIFIER",
        name: "Project Build Contract",
        command: "npm run build",
        expectedExitCode: 0,
        provesCriterionIds: findCriteriaForReq("test-verif-build"),
      },
      {
        id: "test-verif-typecheck",
        type: "TYPECHECK",
        verifier: "TYPECHECK_VERIFIER",
        name: "TypeScript Compiler Verification",
        command: "npx --package=typescript tsc --noEmit",
        expectedExitCode: 0,
        provesCriterionIds: findCriteriaForReq("test-verif-typecheck"),
      },
      {
        id: "test-verif-suite",
        type: "TEST",
        verifier: "TEST_SUITE_VERIFIER",
        name: "Unit & Integration Test Suite",
        command: "npm test",
        expectedExitCode: 0,
        provesCriterionIds: findCriteriaForReq("test-verif-suite"),
      }
    );

    // Add class-specific verification requirements with semantic verifiers (P0-T1, P0-C2)
    switch (projectClass) {
      case "CLI_APPLICATION":
      case "REST_API":
      case "WEB_APPLICATION":
      case "DATABASE_SERVICE":
        requiredTests.push({
          id: "test-verif-smoke",
          type: "SMOKE",
          verifier: "SMOKE_VERIFIER",
          name: `${projectClass} Executable Smoke Verification`,
          command: "npm test",
          expectedExitCode: 0,
          provesCriterionIds: findCriteriaForReq("test-verif-smoke"),
        });
        break;

      case "FULLSTACK_APPLICATION":
        requiredTests.push({
          id: "test-verif-integration",
          type: "INTEGRATION_TEST",
          verifier: "INTEGRATION_VERIFIER",
          name: "Fullstack Contract Integration Verification",
          command: "npm test",
          expectedExitCode: 0,
          provesCriterionIds: findCriteriaForReq("test-verif-integration"),
        });
        break;

      case "DOCKERIZED_SERVICE":
        requiredTests.push({
          id: "test-verif-docker",
          type: "DOCKER_BUILD",
          verifier: "DOCKER_BUILD_VERIFIER",
          name: "Docker Build Environment Verification",
          command: "docker build -t test .",
          expectedExitCode: 0,
          provesCriterionIds: findCriteriaForReq("test-verif-docker"),
        });
        break;

      default:
        break;
    }

    const securityCriteriaIds = draftPlan.acceptanceCriteria
      .filter((ac) => ac.verificationMethod === "SECURITY_CHECK" || ac.requiredRequirementId === "sec-1")
      .map((ac) => ac.id);

    const securityRequirements: SecurityRequirement[] = [
      {
        id: "sec-1",
        rule: "NO_SECRET_LEAKAGE",
        failClosed: true,
        provesCriterionIds: securityCriteriaIds.length > 0 ? securityCriteriaIds : undefined,
      },
    ];

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
      securityRequirements,
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
