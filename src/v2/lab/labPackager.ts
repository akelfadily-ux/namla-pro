/**
 * NAMLA LAB Packager (§04, §12, P0-T6).
 *
 * Package only accepted results. Fail closed if:
 * - ProMax contractSatisfied is false
 * - any required TestRequirement is FAILED or BLOCKED
 * - any acceptance criterion is UNVERIFIED or FAILED
 * - evidence is stale/invalidated
 * - artifact identity or SHA-256 hash no longer matches proof
 */

import { DeliveryPackage, IntegratedCandidate, ProMaxAssessment } from "../types/missionState";
import { ContractBoundStageContext } from "../types/stageContext";
import { TrustedKernel } from "../kernel/trustedKernel";
import { EvidenceRecord } from "../types/evidence";
import { createHash } from "crypto";

export interface LabResult {
  readonly success: boolean;
  readonly deliveryPackage?: DeliveryPackage;
  readonly evidenceRecord?: EvidenceRecord;
  readonly reasonCode: string;
}

export class LabPackager {
  public packageDeliverables(
    candidate: IntegratedCandidate,
    proMaxAssessment: ProMaxAssessment,
    context: ContractBoundStageContext,
    kernel: TrustedKernel,
    stageEvidence: readonly EvidenceRecord[]
  ): LabResult {
    // 1. Check contractSatisfied
    if (!proMaxAssessment.contractSatisfied) {
      return {
        success: false,
        reasonCode: "NAMLA_LAB_REFUSED: ProMax verification failed, unverified candidate cannot be packaged",
      };
    }

    // 2. Check evidence freshness
    if (!proMaxAssessment.evidenceFreshnessVerified) {
      return {
        success: false,
        reasonCode: "NAMLA_LAB_REFUSED: Stale or invalidated evidence detected in mission assessment",
      };
    }

    const staleInStage = stageEvidence.some((e) => e.status === "INVALIDATED" || e.status === "SUPERSEDED");
    if (staleInStage) {
      return {
        success: false,
        reasonCode: "NAMLA_LAB_REFUSED: Stale or invalidated evidence present in stage evidence pool",
      };
    }

    // 3. Check test requirements and criteria
    if (!proMaxAssessment.independentTestsPassed) {
      return {
        success: false,
        reasonCode: "NAMLA_LAB_REFUSED: Required test requirements failed or blocked",
      };
    }

    if (!proMaxAssessment.securityCheckPassed) {
      return {
        success: false,
        reasonCode: "NAMLA_LAB_REFUSED: Security requirements check failed",
      };
    }

    if (proMaxAssessment.failedCriteria.length > 0) {
      return {
        success: false,
        reasonCode: `NAMLA_LAB_REFUSED: ${proMaxAssessment.failedCriteria.length} acceptance criteria failed or unverified`,
      };
    }

    // 4. Verify artifact identity & current disk hashes match candidate specifications (P0-CB1)
    const checksums: Record<string, string> = {};
    for (const art of candidate.integratedArtifacts) {
      // Enforce segment-aware candidate workspace boundary containment
      const candCheck = kernel.isInsideCandidateWorkspace(candidate.workspacePath, art.path);
      if (!candCheck.ok) {
        return {
          success: false,
          reasonCode: `NAMLA_LAB_REFUSED: Artifact ${art.path} escapes candidate workspace boundary (${candCheck.reasonCode})`,
        };
      }

      const relPath = candCheck.resolvedRelPath;

      const read = kernel.safeReadWorkspaceFile(relPath);
      if (!read.success || read.content === undefined) {
        return {
          success: false,
          reasonCode: `NAMLA_LAB_REFUSED: Artifact ${art.path} missing or unreadable on disk`,
        };
      }

      const diskHash = createHash("sha256").update(Buffer.from(read.content, "utf8")).digest("hex");
      if (diskHash !== art.sha256) {
        return {
          success: false,
          reasonCode: `NAMLA_LAB_REFUSED: Artifact hash mismatch for ${art.path}: expected ${art.sha256}, found ${diskHash}`,
        };
      }

      checksums[art.path] = art.sha256;
    }

    const deliveryId = `deliv-${context.missionId}`;
    const evidenceRefs = stageEvidence.map((ev) => ev.evidenceId);

    const deliveryPackage: DeliveryPackage = {
      deliveryId,
      missionId: context.missionId,
      contractVersion: context.frozenPlanContract.version,
      artifacts: candidate.integratedArtifacts,
      deliveryManifest: {
        checksums,
        stageReceipts: kernel.getReceiptLog().list().map((r) => r.receiptId),
        evidenceRefs,
      },
      timestamp: Date.now(),
      verified: true,
    };

    const evidenceRecord = kernel.emitEvidence(
      "NAMLA_LAB",
      context.missionId,
      "NAMLA_LAB",
      {
        deliveryId,
        artifactCount: candidate.integratedArtifacts.length,
        verified: true,
      },
      candidate.integratedArtifacts[0]
    );

    return {
      success: true,
      deliveryPackage,
      evidenceRecord,
      reasonCode: "OK",
    };
  }
}
