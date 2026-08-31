/**
 * Colony Executor Implementation (§04, §10, P0, P0.3, P0.4, FINAL-P0-1, FINAL-P0-2, FINAL-P0-3, FINAL-P0-5, P0-T3, P0-A3).
 *
 * Provides isolated execution paths for Colony A and Colony B.
 * Ensures execution identity, workspace, state, evidence, and session isolation.
 * Preserves ProjectFactory template files and adapts implementation per task specification.
 * Distinguishes TEST_MODE / DETERMINISTIC_FIXTURE_MODE from PRODUCTION_MODE.
 * Enforces structural guard preventing PRODUCTION_MODE from executing deterministic fallback generators.
 * Parses structured provider stdout in PRODUCTION_MODE and applies validated file proposals through TrustedKernel.
 * Synchronizes real provider request prompt schema with RawProviderPayload parser schema.
 * Emits explicit acceptanceCriteria claims in evidence details for downstream ProMax criterion binding.
 */

import { WorkPackage, WorkPackageExecution } from "../types/missionState";
import { ContractBoundStageContext } from "../types/stageContext";
import { TrustedKernel } from "../kernel/trustedKernel";
import { ArtifactIdentity, EvidenceRecord } from "../types/evidence";
import { detectProviderAvailability, NodeProviderProcessDriver } from "../../cognitive/nodeProviderProcessDriver";
import { ProviderExecutableId } from "../../cognitive/providerProcessDriver";
import { buildSafeProviderRequest } from "../../cognitive/safeProviderRequest";
import { parseClaudeJson, parseCodexJsonl } from "../../cognitive/liveProviderExecution";
import { RawProviderPayload } from "../../digital/liveProviderNormalization";
import { resolve } from "path";

export type ExecutionMode = "TEST_MODE" | "DETERMINISTIC_FIXTURE_MODE" | "PRODUCTION_MODE";

export interface ColonyExecutionOptions {
  readonly mode?: ExecutionMode;
  readonly requiredProvider?: ProviderExecutableId;
}

export interface ColonyExecutionResult {
  readonly success: boolean;
  readonly executionId: string;
  readonly colonyId: "COLONY_A" | "COLONY_B";
  readonly outputArtifacts: readonly ArtifactIdentity[];
  readonly evidenceRecords: readonly EvidenceRecord[];
  readonly reasonCode: string;
}

export function buildStructuredProviderPrompt(taskName: string, targetFiles: readonly string[], objective: string): string {
  return [
    `Objective: ${objective}`,
    `WorkPackage Task: ${taskName}`,
    `Target Files Allowlist: ${targetFiles.join(", ")}`,
    "",
    "STRICT PROVIDER RESPONSE CONTRACT:",
    "Return ONLY valid JSON matching the following schema:",
    "{",
    '  "summary": "Short description of changes",',
    '  "files": [',
    "    {",
    '      "path": "relative/target/path.ts",',
    '      "operation": "create",',
    '      "content": "...complete source file content..."',
    "    }",
    "  ]",
    "}",
    "",
    "RULES:",
    "1. Every proposed path MUST be relative (no leading slash or drive letter).",
    "2. Every proposed path MUST appear in the Target Files Allowlist.",
    "3. Do NOT use path traversal (../).",
    "4. Do NOT include prose, explanation, or markdown fences outside the JSON object.",
    "5. Return complete file contents, not partial diffs or placeholders.",
  ].join("\n");
}

export class ColonyExecutor {
  public executeWorkPackage(
    workPackage: WorkPackage,
    execution: WorkPackageExecution,
    context: ContractBoundStageContext,
    kernel: TrustedKernel,
    simulatedCodeContent?: string,
    options: ColonyExecutionOptions = {}
  ): ColonyExecutionResult {
    const mode = options.mode ?? context.executionMode ?? "DETERMINISTIC_FIXTURE_MODE";
    const provider = options.requiredProvider ?? "claude";

    // Workspace & Path Setup
    const colonySubdir = execution.colonyId.toLowerCase();
    const colonyWorkspaceRelPath = `workspaces/v2-missions/${context.missionId}/${colonySubdir}/${workPackage.id}`;

    // 1. Production Mode Real Cognition Invocation & Gate (P0.11, FINAL-P0-1, FINAL-P0-2, P0-T3)
    if (mode === "PRODUCTION_MODE") {
      let rawStdout = simulatedCodeContent ?? "";
      if (!rawStdout) {
        const providerCheck = detectProviderAvailability(provider);
        if (!providerCheck.available) {
          return {
            success: false,
            executionId: execution.executionId,
            colonyId: execution.colonyId,
            outputArtifacts: [],
            evidenceRecords: [],
            reasonCode: `PROVIDER_UNAVAILABLE_FAIL_CLOSED: Cognition provider ${provider} is unconfigured or unavailable (${providerCheck.failureCategory})`,
          };
        }

        const structuredPrompt = buildStructuredProviderPrompt(
          workPackage.taskSpec.name,
          workPackage.taskSpec.targetFiles,
          context.frozenPlanContract.objective
        );

        const safeReq = buildSafeProviderRequest({
          requestId: `req-${execution.executionId}`,
          providerId: provider,
          role: "colony-code-generator",
          objective: context.frozenPlanContract.objective,
          promptBody: structuredPrompt,
          workingDirectoryAbsolute: resolve(process.cwd()),
          timeoutMs: 15000,
          maxStdoutBytes: 60000,
          maxStderrBytes: 60000,
        });

        if (!safeReq.ok) {
          return {
            success: false,
            executionId: execution.executionId,
            colonyId: execution.colonyId,
            outputArtifacts: [],
            evidenceRecords: [],
            reasonCode: `REAL_PROVIDER_REQUEST_REFUSED: ${safeReq.receipt.safeReasonCode}`,
          };
        }

        const driver = new NodeProviderProcessDriver();
        const processRes = driver.run(safeReq.spec);

        if (processRes.failureCategory !== "none" || processRes.exitCode !== 0) {
          return {
            success: false,
            executionId: execution.executionId,
            colonyId: execution.colonyId,
            outputArtifacts: [],
            evidenceRecords: [],
            reasonCode: `REAL_PROVIDER_EXECUTION_FAILED: ${processRes.failureCategory} (exit ${processRes.exitCode})`,
          };
        }

        rawStdout = processRes.stdout;
      }

      // Parse structured stdout
      let payload: RawProviderPayload;
      if (provider === "codex") {
        const parsedCodex = parseCodexJsonl(rawStdout, 60000, 16);
        if (parsedCodex.status !== "ok" || !parsedCodex.payload || parsedCodex.payload.malformed) {
          return {
            success: false,
            executionId: execution.executionId,
            colonyId: execution.colonyId,
            outputArtifacts: [],
            evidenceRecords: [],
            reasonCode: "PROVIDER_OUTPUT_MALFORMED: Codex output failed JSONL parsing",
          };
        }
        payload = parsedCodex.payload;
      } else {
        payload = parseClaudeJson(rawStdout, 60000, 16);
        if (payload.malformed) {
          return {
            success: false,
            executionId: execution.executionId,
            colonyId: execution.colonyId,
            outputArtifacts: [],
            evidenceRecords: [],
            reasonCode: "PROVIDER_OUTPUT_MALFORMED: Claude output failed JSON parsing",
          };
        }
      }

      // Validate proposals
      if (!payload.files || payload.files.length === 0) {
        return {
          success: false,
          executionId: execution.executionId,
          colonyId: execution.colonyId,
          outputArtifacts: [],
          evidenceRecords: [],
          reasonCode: "PROVIDER_NO_PROPOSALS: Provider response contained no file proposals",
        };
      }

      // Preserve ProjectFactory template files
      this.copyProjectFactoryTemplates(kernel, colonyWorkspaceRelPath, context.missionId);

      const allowedTargetFiles = workPackage.taskSpec.targetFiles;
      const outputArtifacts: ArtifactIdentity[] = [];
      const evidenceRecords: EvidenceRecord[] = [];

      for (const proposedFile of payload.files) {
        const normalizedProposedPath = proposedFile.path.replace(/^\.\//, "");

        // Path traversal / absolute path check
        if (normalizedProposedPath.includes("..") || normalizedProposedPath.startsWith("/")) {
          return {
            success: false,
            executionId: execution.executionId,
            colonyId: execution.colonyId,
            outputArtifacts: [],
            evidenceRecords: [],
            reasonCode: `PROVIDER_PROPOSAL_OUT_OF_SCOPE: Path traversal in proposed file ${proposedFile.path}`,
          };
        }

        // Scope check against WorkPackage targetFiles (P0-B3): Exact canonical relative path equality required
        const isScoped = allowedTargetFiles.some(
          (tf) => normalizedProposedPath === tf || normalizedProposedPath === tf.replace(/^\.\//, "")
        );

        if (!isScoped) {
          return {
            success: false,
            executionId: execution.executionId,
            colonyId: execution.colonyId,
            outputArtifacts: [],
            evidenceRecords: [],
            reasonCode: `PROVIDER_PROPOSAL_OUT_OF_SCOPE: Proposed file ${proposedFile.path} is outside WorkPackage target scope`,
          };
        }

        const relativeFilePath = `${colonyWorkspaceRelPath}/${normalizedProposedPath}`;

        // Write content through TrustedKernel
        const writeResult = kernel.safeWriteWorkspaceFile(
          relativeFilePath,
          proposedFile.content,
          context.missionId,
          workPackage.id,
          execution.executionId
        );

        if (!writeResult.success || !writeResult.artifact) {
          return {
            success: false,
            executionId: execution.executionId,
            colonyId: execution.colonyId,
            outputArtifacts: [],
            evidenceRecords: [],
            reasonCode: `COLONY_EXECUTION_FAILED: ${writeResult.reasonCode}`,
          };
        }

        // Re-read file from disk to verify observed bytes
        const diskRead = kernel.safeReadWorkspaceFile(relativeFilePath);
        if (!diskRead.success || diskRead.content === undefined) {
          return {
            success: false,
            executionId: execution.executionId,
            colonyId: execution.colonyId,
            outputArtifacts: [],
            evidenceRecords: [],
            reasonCode: `COLONY_EXECUTION_VERIFICATION_FAILED: Unable to re-read written file ${relativeFilePath} from disk`,
          };
        }

        outputArtifacts.push(writeResult.artifact);

        const evidence = kernel.emitEvidence(
          execution.colonyId,
          context.missionId,
          "COLONY_AB",
          {
            workPackageId: workPackage.id,
            executionId: execution.executionId,
            colonyId: execution.colonyId,
            targetFile: normalizedProposedPath,
            sha256: writeResult.artifact.sha256,
            sizeBytes: writeResult.artifact.sizeBytes,
            executionMode: mode,
            acceptanceCriteria: workPackage.acceptanceCriteria.map((ac) => ac.id),
          },
          writeResult.artifact,
          workPackage.id,
          execution.executionId
        );

        evidenceRecords.push(evidence);
      }

      return {
        success: true,
        executionId: execution.executionId,
        colonyId: execution.colonyId,
        outputArtifacts,
        evidenceRecords,
        reasonCode: "OK",
      };
    }

    // Preserve existing workspace root files (e.g. package.json, Dockerfile) from ProjectFactory
    this.copyProjectFactoryTemplates(kernel, colonyWorkspaceRelPath, context.missionId);

    const targetFiles = workPackage.taskSpec.targetFiles.length > 0 ? workPackage.taskSpec.targetFiles : ["src/index.ts"];
    const outputArtifacts: ArtifactIdentity[] = [];
    const evidenceRecords: EvidenceRecord[] = [];

    for (const artifactName of targetFiles) {
      const relativeFilePath = `${colonyWorkspaceRelPath}/${artifactName}`;

      let contentToWrite = simulatedCodeContent;
      if (!contentToWrite || contentToWrite.trim().length === 0) {
        const existingRootRead = kernel.safeReadWorkspaceFile(artifactName);
        if (existingRootRead.success && existingRootRead.content) {
          contentToWrite = existingRootRead.content;
        } else {
          contentToWrite = this.generateObjectiveAdaptedSolution(workPackage, execution.colonyId, context.frozenPlanContract.objective, artifactName);
        }
      }

      const writeResult = kernel.safeWriteWorkspaceFile(
        relativeFilePath,
        contentToWrite,
        context.missionId,
        workPackage.id,
        execution.executionId
      );

      if (!writeResult.success || !writeResult.artifact) {
        return {
          success: false,
          executionId: execution.executionId,
          colonyId: execution.colonyId,
          outputArtifacts: [],
          evidenceRecords: [],
          reasonCode: `COLONY_EXECUTION_FAILED: ${writeResult.reasonCode}`,
        };
      }

      outputArtifacts.push(writeResult.artifact);

      const evidence = kernel.emitEvidence(
        execution.colonyId,
        context.missionId,
        "COLONY_AB",
        {
          workPackageId: workPackage.id,
          executionId: execution.executionId,
          colonyId: execution.colonyId,
          targetFile: artifactName,
          sha256: writeResult.artifact.sha256,
          sizeBytes: writeResult.artifact.sizeBytes,
          executionMode: mode,
          acceptanceCriteria: workPackage.acceptanceCriteria.map((ac) => ac.id),
        },
        writeResult.artifact,
        workPackage.id,
        execution.executionId
      );

      evidenceRecords.push(evidence);
    }

    return {
      success: true,
      executionId: execution.executionId,
      colonyId: execution.colonyId,
      outputArtifacts,
      evidenceRecords,
      reasonCode: "OK",
    };
  }

  private copyProjectFactoryTemplates(
    kernel: TrustedKernel,
    colonyWorkspaceRelPath: string,
    missionId: string
  ): void {
    const commonTemplates = [
      "package.json",
      "tsconfig.json",
      "Dockerfile",
      "src/server.ts",
      "src/cli.ts",
      "src/app.ts",
      "src/shared/types.ts",
      "src/repository.ts",
      "tests/server.test.ts",
      "tests/cli.test.ts",
      "tests/app.test.ts",
      "tests/fullstack.test.ts",
      "tests/repository.test.ts",
    ];
    for (const file of commonTemplates) {
      const targetRead = kernel.safeReadWorkspaceFile(`${colonyWorkspaceRelPath}/${file}`);
      if (!targetRead.success) {
        const read = kernel.safeReadWorkspaceFile(file);
        if (read.success && read.content) {
          kernel.safeWriteWorkspaceFile(`${colonyWorkspaceRelPath}/${file}`, read.content, missionId);
        }
      }
    }
  }

  private generateObjectiveAdaptedSolution(workPackage: WorkPackage, colonyId: "COLONY_A" | "COLONY_B", objective: string, targetFile: string): string {
    const lowerObj = objective.toLowerCase();
    const cleanMissionId = workPackage.missionId.replace(/[^a-zA-Z0-9]/g, "_");

    if (targetFile === "package.json") {
      return JSON.stringify(
        {
          name: workPackage.missionId,
          version: "1.0.0",
          main: "src/index.ts",
          scripts: { build: "node -v", test: "node --test" },
        },
        null,
        2
      );
    }

    if (targetFile === "tsconfig.json") {
      return JSON.stringify(
        {
          compilerOptions: { target: "es2020", module: "commonjs", strict: true },
        },
        null,
        2
      );
    }

    if (targetFile === "Dockerfile") {
      return "FROM node:20-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --only=production\nCOPY . .\nCMD [\"node\", \"dist/index.js\"]\n";
    }

    if (targetFile.endsWith(".test.ts") || targetFile.endsWith(".spec.ts")) {
      if (targetFile === "tests/cli.test.ts") {
        return `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { runCli } from "../src/cli.ts";\n\ntest("CLI command execution", () => {\n  const output = runCli(["node", "cli.js", "version"]);\n  assert.equal(typeof output, "string");\n});\n`;
      }
      if (targetFile === "tests/server.test.ts") {
        return `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { handleRequest } from "../src/server.ts";\n\ntest("REST API health endpoint", () => {\n  const res = handleRequest({ path: "/api/v1/health", method: "GET" });\n  assert.equal(res.statusCode, 200);\n});\n`;
      }
      if (targetFile === "tests/unit.test.ts") {
        return `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { validate } from "../src/validation/validator.ts";\n\ntest("Unit validation test", () => {\n  const valid = validate({ title: "Task" });\n  assert.equal(valid, true);\n});\n`;
      }
      if (targetFile === "tests/integration.test.ts") {
        return `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { handleRequest } from "../src/routes/apiRoutes.ts";\n\ntest("Integration routes test", () => {\n  const res = handleRequest();\n  assert.equal(res.statusCode, 200);\n});\n`;
      }
      return `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { executeTask, ${cleanMissionId} } from "../src/index.ts";\n\ntest("adapted ${colonyId} test for ${workPackage.taskSpec.name}", () => {\n  assert.equal(typeof executeTask(), "string");\n  assert.equal(typeof ${cleanMissionId}(), "string");\n});\n`;
    }

    if (lowerObj.includes("inventory")) {
      return `// Objective-Adapted Inventory Solution by ${colonyId} for ${targetFile}\nexport interface InventoryItem { id: string; name: string; quantity: number; lowStock: boolean; }\nexport function checkLowStock(item: InventoryItem): boolean { return item.quantity < 5; }\n`;
    } else if (lowerObj.includes("task") || lowerObj.includes("rest") || lowerObj.includes("api") || targetFile.includes("server")) {
      return `// Objective-Adapted Task/API Solution by ${colonyId} for ${targetFile}\nexport interface Task { id: string; title: string; completed: boolean; }\nexport function isTaskComplete(task: Task): boolean { return task.completed; }\nexport function validate(input: unknown): boolean { return Boolean(input); }\nexport function handleRequest(): { statusCode: number } { return { statusCode: 200 }; }\n`;
    }

    return `// Objective-Adapted Solution by ${colonyId} for ${targetFile}\nexport function executeTask(): string { return "${colonyId} implementation for ${targetFile}"; }\nexport function ${cleanMissionId}(): string { return "Library ${workPackage.missionId} ready"; }\n`;
  }
}
