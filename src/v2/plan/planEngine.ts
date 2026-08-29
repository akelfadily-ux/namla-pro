/**
 * PLAN Engine (§04, §09, P0.13).
 *
 * Produces an objective-derived draft engineering plan.
 * Dynamically decomposes objectives into multi-task WorkPackage DAGs.
 */

import { EerOutput } from "../eer/eerEngine";
import { DraftPlan, TaskSpec, AcceptanceCriterion } from "../types/contracts";
import { PreFreezeStageContext } from "../types/stageContext";

export class PlanEngine {
  public generatePlan(eer: EerOutput, context: PreFreezeStageContext): DraftPlan {
    const lowerObj = eer.originalObjective.toLowerCase();
    const tasks: TaskSpec[] = [];
    const acceptanceCriteria: AcceptanceCriterion[] = [];

    if (
      lowerObj.includes("rest") ||
      lowerObj.includes("crud") ||
      lowerObj.includes("routes") ||
      lowerObj.includes("api") ||
      lowerObj.includes("rest_api")
    ) {
      tasks.push(
        {
          id: "task-bootstrap",
          name: "Project Bootstrap & Config",
          description: "Initialize package.json, tsconfig.json, and server structure",
          targetFiles: ["package.json", "tsconfig.json"],
          dependencies: [],
          capabilityRequirements: ["filesystem.write"],
        },
        {
          id: "task-server",
          name: "Server Entry Point",
          description: "Initialize main server entry point",
          targetFiles: ["src/server.ts"],
          dependencies: ["task-bootstrap"],
          capabilityRequirements: ["filesystem.write"],
        },
        {
          id: "task-domain-model",
          name: "Domain Models & Entities",
          description: "Define domain data entities and interfaces",
          targetFiles: ["src/models/entity.ts"],
          dependencies: ["task-server"],
          capabilityRequirements: ["filesystem.write"],
        },
        {
          id: "task-persistence",
          name: "Persistence & Repository Layer",
          description: "Implement data persistence and repository handlers",
          targetFiles: ["src/repositories/repository.ts"],
          dependencies: ["task-domain-model"],
          capabilityRequirements: ["filesystem.write"],
        },
        {
          id: "task-validation",
          name: "Request Validation & Middleware",
          description: "Implement input validation and error handling middleware",
          targetFiles: ["src/validation/validator.ts", "src/middleware/errorHandler.ts"],
          dependencies: ["task-domain-model"],
          capabilityRequirements: ["filesystem.write"],
        },
        {
          id: "task-routes",
          name: "REST Routes & Controllers",
          description: "Implement API endpoints and controller logic",
          targetFiles: ["src/routes/apiRoutes.ts"],
          dependencies: ["task-persistence", "task-validation"],
          capabilityRequirements: ["filesystem.write"],
        },
        {
          id: "task-unit-tests",
          name: "Unit Tests",
          description: "Implement unit tests for domain and validation logic",
          targetFiles: ["tests/unit.test.ts"],
          dependencies: ["task-validation"],
          capabilityRequirements: ["filesystem.write", "process.execute"],
        },
        {
          id: "task-integration-tests",
          name: "Integration Tests & API Endpoints",
          description: "Implement end-to-end integration tests for REST routes",
          targetFiles: ["tests/integration.test.ts"],
          dependencies: ["task-routes", "task-unit-tests"],
          capabilityRequirements: ["filesystem.write", "process.execute"],
        }
      );

      acceptanceCriteria.push(
        { id: "ac-rest-health", description: "REST API health endpoint responds 200 OK", verificationMethod: "TEST", required: true },
        { id: "ac-rest-crud", description: "CRUD endpoints process valid data correctly", verificationMethod: "TEST", required: true },
        { id: "ac-rest-validation", description: "Invalid requests return 400 Bad Request", verificationMethod: "TEST", required: true },
        { id: "ac-typecheck", description: "TypeScript compilation completes without errors", verificationMethod: "TEST", required: true },
        { id: "ac-security", description: "No credentials or secret patterns exposed", verificationMethod: "SECURITY_CHECK", required: true }
      );
    } else if (lowerObj.includes("cli")) {
      tasks.push(
        {
          id: "task-cli-config",
          name: "CLI Package Configuration",
          description: "Define executable bin entry in package.json",
          targetFiles: ["package.json", "tsconfig.json"],
          dependencies: [],
          capabilityRequirements: ["filesystem.write"],
        },
        {
          id: "task-cli-core",
          name: "CLI Parser & Command Logic",
          description: "Implement argument parsing and CLI command handling",
          targetFiles: ["src/cli.ts"],
          dependencies: ["task-cli-config"],
          capabilityRequirements: ["filesystem.write"],
        },
        {
          id: "task-cli-tests",
          name: "CLI Unit & Integration Tests",
          description: "Implement tests verifying CLI command execution and options",
          targetFiles: ["tests/cli.test.ts"],
          dependencies: ["task-cli-core"],
          capabilityRequirements: ["filesystem.write", "process.execute"],
        }
      );

      acceptanceCriteria.push(
        { id: "ac-cli-exec", description: "CLI executes and returns help output", verificationMethod: "TEST", required: true },
        { id: "ac-typecheck", description: "TypeScript compilation completes without errors", verificationMethod: "TEST", required: true }
      );
    } else {
      // General multi-task engineering DAG
      tasks.push(
        {
          id: "task-impl",
          name: "Core Implementation",
          description: `Implement solution logic for: ${eer.originalObjective}`,
          targetFiles: ["src/index.ts"],
          dependencies: [],
          capabilityRequirements: eer.requiredCapabilities,
        },
        {
          id: "task-test",
          name: "Unit & Verification Tests",
          description: "Implement test suite for core functionality",
          targetFiles: ["tests/index.test.ts"],
          dependencies: ["task-impl"],
          capabilityRequirements: ["filesystem.write", "process.execute"],
        }
      );

      acceptanceCriteria.push(
        { id: "ac-typecheck", description: "Code compiles cleanly with tsc --noEmit", verificationMethod: "TEST", required: true },
        { id: "ac-tests", description: "Unit and integration tests pass", verificationMethod: "TEST", required: true },
        { id: "ac-security", description: "Security invariants and path containment hold", verificationMethod: "SECURITY_CHECK", required: true }
      );
    }

    return {
      draftId: `draft-${eer.missionId}-v2`,
      objective: eer.originalObjective,
      tasks,
      acceptanceCriteria,
      riskClassification: eer.riskClass,
      estimatedBudgets: {
        maxVirtualTicks: Math.min(context.budgets.virtualTicks, 100),
        maxProviderCalls: Math.min(context.budgets.providerCalls, 20),
        maxFixAttempts: Math.min(context.budgets.maxFixAttempts, 3),
      },
    };
  }
}
