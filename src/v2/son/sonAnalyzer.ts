/**
 * SON Differential Analyzer (§04, §11).
 */

import { ColonyExecutionResult } from "../colony/colonyExecutor";
import { ComparisonAssessment, WorkPackage } from "../types/missionState";
import { ContractBoundStageContext } from "../types/stageContext";

export class SonAnalyzer {
  public compareResults(
    workPackage: WorkPackage,
    resultA: ColonyExecutionResult,
    resultB: ColonyExecutionResult,
    context: ContractBoundStageContext
  ): ComparisonAssessment {
    const agreements: string[] = [];
    const disagreements: string[] = [];
    const missingCriteria: string[] = [];
    const contradictoryAssumptions: string[] = [];
    const evidenceGaps: string[] = [];

    if (resultA.evidenceRecords.length === 0) {
      evidenceGaps.push("Colony A missing required execution evidence");
    }
    if (resultB.evidenceRecords.length === 0) {
      evidenceGaps.push("Colony B missing required execution evidence");
    }

    const artifactA = resultA.outputArtifacts[0];
    const artifactB = resultB.outputArtifacts[0];

    let correlatedFailureRisk = false;

    if (!resultA.success && !resultB.success) {
      correlatedFailureRisk = true;
      disagreements.push("Both colonies failed execution with potential correlated root cause");
    } else if (resultA.success && resultB.success) {
      if (artifactA && artifactB && artifactA.sha256 === artifactB.sha256) {
        agreements.push("Both colonies produced identical byte-for-byte output hashes");
      } else {
        agreements.push("Both colonies completed successfully with differing implementation details");
        disagreements.push("Implementation code structure differs between Colony A and Colony B");
      }
    } else if (resultA.success && !resultB.success) {
      disagreements.push("Colony A succeeded while Colony B failed execution");
    } else {
      disagreements.push("Colony B succeeded while Colony A failed execution");
    }

    for (const criterion of workPackage.acceptanceCriteria) {
      if (criterion.required) {
        agreements.push(`Acceptance criterion ${criterion.id} (${criterion.verificationMethod}) targeted by both colonies`);
      }
    }

    let scoreA = resultA.success ? 100 : 0;
    let scoreB = resultB.success ? 100 : 0;

    if (resultA.evidenceRecords.length > 0) scoreA += 10;
    if (resultB.evidenceRecords.length > 0) scoreB += 10;

    let recommendedAction: "MERGE_BOTH" | "SELECT_A" | "SELECT_B" | "REWORK_AB" | "REPLAN" = "MERGE_BOTH";

    if (!resultA.success && !resultB.success) {
      recommendedAction = "REWORK_AB";
    } else if (resultA.success && !resultB.success) {
      recommendedAction = "SELECT_A";
    } else if (!resultA.success && resultB.success) {
      recommendedAction = "SELECT_B";
    } else {
      recommendedAction = "MERGE_BOTH";
    }

    return {
      workPackageId: workPackage.id,
      agreements,
      disagreements,
      missingCriteria,
      contradictoryAssumptions,
      evidenceGaps,
      correlatedFailureRisk,
      strengthScores: {
        colonyA: scoreA,
        colonyB: scoreB,
      },
      recommendedAction,
    };
  }
}
