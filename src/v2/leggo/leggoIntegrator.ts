/**
 * LEGGO Component Integrator (§04, §11, P0.18, P0-A3).
 *
 * Integrates compatible, validated components from Colony A and B into a unified candidate.
 * Preserves all cumulative artifacts across all WorkPackages in the mission DAG so the final candidate represents the complete project state.
 * Emits explicit acceptanceCriteria claims in evidence details for downstream ProMax criterion binding.
 */

import { ComparisonAssessment, IntegratedCandidate, WorkPackage } from "../types/missionState";
import { ColonyExecutionResult } from "../colony/colonyExecutor";
import { ContractBoundStageContext } from "../types/stageContext";
import { TrustedKernel } from "../kernel/trustedKernel";
import { ArtifactIdentity, EvidenceRecord } from "../types/evidence";

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
    kernel: TrustedKernel,
    previousCandidate?: IntegratedCandidate
  ): LeggoResult {
    if (assessment.recommendedAction === "REWORK_AB" || assessment.recommendedAction === "REPLAN") {
      return {
        success: false,
        reasonCode: `LEGGO_REFUSED: Assessment recommended ${assessment.recommendedAction}`,
      };
    }

    const integratedWorkspaceRelPath = `workspaces/v2-missions/${context.missionId}/leggo-integrated`;

    // Preserve ProjectFactory workspace configs without overwriting integrated files
    this.copyWorkspaceConfigs(kernel, integratedWorkspaceRelPath);

    const cumulativeArtifactsMap = new Map<string, ArtifactIdentity>();
    const sourceTraceability: Record<string, "COLONY_A" | "COLONY_B" | "MERGED"> = {
      ...(previousCandidate?.sourceTraceability ?? {}),
    };

    if (previousCandidate) {
      for (const art of previousCandidate.integratedArtifacts) {
        cumulativeArtifactsMap.set(art.path, art);
      }
    }

    const targetFiles = workPackage.taskSpec.targetFiles.length > 0 ? workPackage.taskSpec.targetFiles : ["src/index.ts"];
    let lastArtifact: ArtifactIdentity | undefined;

    for (const targetFile of targetFiles) {
      let chosenContent = "";
      let source: "COLONY_A" | "COLONY_B" | "MERGED" = "MERGED";

      if (assessment.recommendedAction === "SELECT_A" || (assessment.recommendedAction === "MERGE_BOTH" && resultA.success)) {
        const artA = resultA.outputArtifacts.find((a) => a.path.endsWith(targetFile));
        if (artA) {
          const readA = kernel.safeReadWorkspaceFile(artA.path);
          if (readA.success && readA.content) {
            chosenContent = readA.content;
            source = "COLONY_A";
          }
        }
      }

      if (!chosenContent && (assessment.recommendedAction === "SELECT_B" || resultB.success)) {
        const artB = resultB.outputArtifacts.find((a) => a.path.endsWith(targetFile));
        if (artB) {
          const readB = kernel.safeReadWorkspaceFile(artB.path);
          if (readB.success && readB.content) {
            chosenContent = readB.content;
            source = "COLONY_B";
          }
        }
      }

      if (!chosenContent) {
        const readRoot = kernel.safeReadWorkspaceFile(targetFile);
        if (readRoot.success && readRoot.content) {
          chosenContent = readRoot.content;
          source = "MERGED";
        } else {
          return {
            success: false,
            reasonCode: `LEGGO_FAILED: Unable to resolve source content for ${targetFile}`,
          };
        }
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

      cumulativeArtifactsMap.set(writeResult.artifact.path, writeResult.artifact);
      sourceTraceability[targetFile] = source;
      lastArtifact = writeResult.artifact;
    }

    const integratedArtifacts = Array.from(cumulativeArtifactsMap.values());
    const candidateId = `candidate-${context.missionId}`;

    const integratedCandidate: IntegratedCandidate = {
      candidateId,
      missionId: context.missionId,
      integratedArtifacts,
      resolvedConflicts: [
        ...(previousCandidate?.resolvedConflicts ?? []),
        ...assessment.disagreements,
      ],
      sourceTraceability,
      workspacePath: integratedWorkspaceRelPath,
    };

    const evidenceRecord = kernel.emitEvidence(
      "LEGGO",
      context.missionId,
      "LEGGO",
      {
        candidateId,
        integratedArtifactCount: integratedArtifacts.length,
        sourceTraceability,
        acceptanceCriteria: workPackage.acceptanceCriteria.map((ac) => ac.id),
      },
      lastArtifact,
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
    const commonConfigs = [
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
    for (const f of commonConfigs) {
      const targetRead = kernel.safeReadWorkspaceFile(`${targetWorkspaceRelPath}/${f}`);
      if (!targetRead.success) {
        const read = kernel.safeReadWorkspaceFile(f);
        if (read.success && read.content) {
          kernel.safeWriteWorkspaceFile(`${targetWorkspaceRelPath}/${f}`, read.content, "system");
        }
      }
    }
  }
}
