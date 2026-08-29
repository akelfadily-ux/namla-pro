/**
 * Colony Executor Implementation (§04, §10).
 */

import { WorkPackage, WorkPackageExecution } from "../types/missionState";
import { ContractBoundStageContext } from "../types/stageContext";
import { TrustedKernel } from "../kernel/trustedKernel";
import { ArtifactIdentity, EvidenceRecord } from "../types/evidence";

export interface ColonyExecutionResult {
  readonly success: boolean;
  readonly executionId: string;
  readonly colonyId: "COLONY_A" | "COLONY_B";
  readonly outputArtifacts: readonly ArtifactIdentity[];
  readonly evidenceRecords: readonly EvidenceRecord[];
  readonly reasonCode: string;
}

export class ColonyExecutor {
  public executeWorkPackage(
    workPackage: WorkPackage,
    execution: WorkPackageExecution,
    context: ContractBoundStageContext,
    kernel: TrustedKernel,
    simulatedCodeContent?: string
  ): ColonyExecutionResult {
    const colonyWorkspaceRelPath = `workspaces/v2-missions/${context.missionId}/${execution.colonyId.toLowerCase()}/${workPackage.id}`;

    const artifactName = workPackage.taskSpec.targetFiles[0] ?? "src/index.ts";
    const relativeFilePath = `${colonyWorkspaceRelPath}/${artifactName}`;

    const defaultContent =
      execution.colonyId === "COLONY_A"
        ? `// Solution by ${execution.colonyId}\nexport function executeTask(): string { return "Result A for ${workPackage.taskSpec.name}"; }\n`
        : `// Solution by ${execution.colonyId}\nexport function executeTask(): string { return "Result B for ${workPackage.taskSpec.name}"; }\n`;

    const contentToWrite = simulatedCodeContent ?? defaultContent;

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
      },
      writeResult.artifact,
      workPackage.id,
      execution.executionId
    );

    return {
      success: true,
      executionId: execution.executionId,
      colonyId: execution.colonyId,
      outputArtifacts: [writeResult.artifact],
      evidenceRecords: [evidence],
      reasonCode: "OK",
    };
  }
}
