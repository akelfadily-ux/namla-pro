/**
 * LEGGO Component Integrator (§04, §11).
 *
 * Integrates compatible, validated components from Colony A and B into a unified candidate.
 * Preserves source traceability and copies project workspace configs.
 */

import { ComparisonAssessment, IntegratedCandidate, WorkPackage } from "../types/missionState";
import { ColonyExecutionResult } from "../colony/colonyExecutor";
import { ContractBoundStageContext } from "../types/stageContext";
import { TrustedKernel } from "../kernel/trustedKernel";
import { EvidenceRecord } from "../types/evidence";

export interface LeggoResult {
  readonly success: boolean;
  readonly integratedCandidate?: IntegratedCandidate;
  readonly evidenceRecord?: EvidenceRecord;
  readonly reasonCode: string;
}

export class LeggoIntegrator {
  public integrate(
    workPackage: WorkPackage,
    assessment: ComparisonAssessment,
    resultA: ColonyExecutionResult,
    resultB: ColonyExecutionResult,
    context: ContractBoundStageContext,
    kernel: TrustedKernel
  ): LeggoResult {
    if (assessment.recommendedAction === "REWORK_AB" || assessment.recommendedAction === "REPLAN") {
      return {
        success: false,
        reasonCode: `LEGGO_REFUSED: Assessment recommended ${assessment.recommendedAction}`,
      };
    }

    const integratedWorkspaceRelPath = `workspaces/v2-missions/${context.missionId}/leggo-integrated`;
    const targetFile = workPackage.taskSpec.targetFiles[0] ?? "src/index.ts";

    // Copy project config templates into integrated workspace
    this.copyWorkspaceConfigs(kernel, integratedWorkspaceRelPath);

    let chosenContent = "";
    let source: "COLONY_A" | "COLONY_B" | "MERGED" = "MERGED";

    if (assessment.recommendedAction === "SELECT_A" || (assessment.recommendedAction === "MERGE_BOTH" && resultA.success)) {
      const readA = kernel.safeReadWorkspaceFile(
        `workspaces/v2-missions/${context.missionId}/colony_a/${workPackage.id}/${targetFile}`
      );
      if (readA.success && readA.content) {
        chosenContent = readA.content;
        source = "COLONY_A";
      }
    }

    if (!chosenContent && (assessment.recommendedAction === "SELECT_B" || resultB.success)) {
      const readB = kernel.safeReadWorkspaceFile(
        `workspaces/v2-missions/${context.missionId}/colony_b/${workPackage.id}/${targetFile}`
      );
      if (readB.success && readB.content) {
        chosenContent = readB.content;
        source = "COLONY_B";
      }
    }

    if (!chosenContent) {
      return {
        success: false,
        reasonCode: "LEGGO_FAILED: Unable to resolve source content for integration",
      };
    }

    const writeResult = kernel.safeWriteWorkspaceFile(
      `${integratedWorkspaceRelPath}/${targetFile}`,
      chosenContent,
      context.missionId,
      workPackage.id
    );

    if (!writeResult.success || !writeResult.artifact) {
      return {
        success: false,
        reasonCode: `LEGGO_WRITE_FAILED: ${writeResult.reasonCode}`,
      };
    }

    const candidateId = `candidate-${context.missionId}`;
    const integratedCandidate: IntegratedCandidate = {
      candidateId,
      missionId: context.missionId,
      integratedArtifacts: [writeResult.artifact],
      resolvedConflicts: assessment.disagreements,
      sourceTraceability: {
        [targetFile]: source,
      },
      workspacePath: integratedWorkspaceRelPath,
    };

    const evidenceRecord = kernel.emitEvidence(
      "LEGGO",
      context.missionId,
      "LEGGO",
      {
        candidateId,
        integratedArtifactCount: 1,
        source,
      },
      writeResult.artifact,
      workPackage.id
    );

    return {
      success: true,
      integratedCandidate,
      evidenceRecord,
      reasonCode: "OK",
    };
  }

  private copyWorkspaceConfigs(kernel: TrustedKernel, targetWorkspaceRelPath: string): void {
    const commonConfigs = ["package.json", "tsconfig.json", "Dockerfile"];
    for (const f of commonConfigs) {
      const read = kernel.safeReadWorkspaceFile(f);
      if (read.success && read.content) {
        kernel.safeWriteWorkspaceFile(`${targetWorkspaceRelPath}/${f}`, read.content, "system");
      }
    }
  }
}
