/**
 * NAMLA LAB Packager (§04, §12).
 */

import { DeliveryPackage, IntegratedCandidate, ProMaxAssessment } from "../types/missionState";
import { ContractBoundStageContext } from "../types/stageContext";
import { TrustedKernel } from "../kernel/trustedKernel";
import { EvidenceRecord } from "../types/evidence";

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
    if (!proMaxAssessment.contractSatisfied) {
      return {
        success: false,
        reasonCode: "NAMLA_LAB_REFUSED: ProMax verification failed, unverified candidate cannot be packaged",
      };
    }

    const checksums: Record<string, string> = {};
    for (const art of candidate.integratedArtifacts) {
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
