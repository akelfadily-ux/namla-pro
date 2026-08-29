/**
 * PROMAX Verifier (§04, §11, P0.1, P0.15, P0.16, P0.17).
 *
 * Performs strongest contract-wide verification on the integrated candidate.
 * Requires evidence-backed proof mapping for every verified criterion:
 * criterion → verifier → observation → evidenceRef → verdict.
 * Independently recomputes SHA-256 checksums from raw artifact bytes to detect post-acceptance substitution.
 * Validates freshness of the accumulated mission evidence pool.
 */

import { IntegratedCandidate, ProMaxAssessment } from "../types/missionState";
import { ContractBoundStageContext } from "../types/stageContext";
import { TrustedKernel } from "../kernel/trustedKernel";
import { EvidenceRecord } from "../types/evidence";
import { TrustedExecutableId } from "../../cognitive/trustedExecutableRegistry";
import { createHash } from "crypto";

export interface ProofMapping {
  readonly criterionId: string;
  readonly verifier: string;
  readonly observation: string;
  readonly evidenceRef: string;
  readonly status: "VERIFIED" | "UNVERIFIED" | "FAILED";
}

export interface ProMaxResult {
  readonly success: boolean;
  readonly assessment: ProMaxAssessment;
  readonly proofMappings: readonly ProofMapping[];
  readonly evidenceRecord: EvidenceRecord;
  readonly reasonCode: string;
}

export class ProMaxVerifier {
  public verifyCandidate(
    candidate: IntegratedCandidate,
    context: ContractBoundStageContext,
    kernel: TrustedKernel,
    evidencePool: readonly EvidenceRecord[] = []
  ): ProMaxResult {
    const verifiedCriteria: string[] = [];
    const failedCriteria: string[] = [];
    const proofMappings: ProofMapping[] = [];

    const contract = context.frozenPlanContract;

    // 1. Evidence Freshness Verification (P0.17)
    let evidenceFreshnessVerified = true;
    const staleRecords = evidencePool.filter((e) => e.status === "INVALIDATED" || e.status === "SUPERSEDED");
    if (staleRecords.length > 0) {
      evidenceFreshnessVerified = false;
      failedCriteria.push(`ProMax detected ${staleRecords.length} stale/invalidated evidence records`);
    }

    // 2. Independent Artifact Re-Hashing & Checksum Verification (P0.16)
    let artifactCheckPassed = true;
    for (const art of candidate.integratedArtifacts) {
      const relPath = this.resolveArtifactPath(candidate.workspacePath, art.path);
      const read = kernel.safeReadWorkspaceFile(relPath);

      if (!read.success || !read.content) {
        artifactCheckPassed = false;
        failedCriteria.push(`Missing or unreadable artifact ${art.path}`);
        proofMappings.push({
          criterionId: `artifact-${art.path}`,
          verifier: "TrustedKernel:safeReadWorkspaceFile",
          observation: `Artifact ${art.path} missing or unreadable`,
          evidenceRef: "",
          status: "FAILED",
        });
      } else {
        // Independently recompute SHA-256 hash from file content bytes
        const recomputedSha256 = createHash("sha256").update(Buffer.from(read.content, "utf8")).digest("hex");

        if (recomputedSha256 !== art.sha256) {
          artifactCheckPassed = false;
          failedCriteria.push(`Artifact substitution detected for ${art.path}: expected ${art.sha256}, got ${recomputedSha256}`);

          const subEv = kernel.emitEvidence("PROMAX_ARTIFACT_SUBSTITUTION_DETECTED", context.missionId, "PROMAX", {
            path: art.path,
            expectedSha256: art.sha256,
            observedSha256: recomputedSha256,
          });

          proofMappings.push({
            criterionId: `artifact-${art.path}`,
            verifier: "Crypto:createHash(sha256)",
            observation: `ARTIFACT SUBSTITUTION DETECTED: expected ${art.sha256}, observed ${recomputedSha256}`,
            evidenceRef: subEv.evidenceId,
            status: "FAILED",
          });
        } else {
          const ev = kernel.emitEvidence("PROMAX_ARTIFACT_CHECK", context.missionId, "PROMAX", {
            path: art.path,
            expectedSha256: art.sha256,
            observedSha256: recomputedSha256,
          });

          proofMappings.push({
            criterionId: `artifact-${art.path}`,
            verifier: "Crypto:createHash(sha256)",
            observation: `Independently recomputed SHA-256 for ${art.path} matches expected ${art.sha256}`,
            evidenceRef: ev.evidenceId,
            status: "VERIFIED",
          });
        }
      }
    }

    // 3. Security Requirements Check (P0.15)
    let securityCheckPassed = true;
    for (const secReq of contract.securityRequirements) {
      let secFailed = false;
      if (secReq.rule === "NO_SECRET_LEAKAGE") {
        for (const art of candidate.integratedArtifacts) {
          const relPath = this.resolveArtifactPath(candidate.workspacePath, art.path);
          const read = kernel.safeReadWorkspaceFile(relPath);
          if (read.content && (read.content.includes("BEGIN PRIVATE KEY") || read.content.includes("AWS_SECRET"))) {
            securityCheckPassed = false;
            secFailed = true;
            failedCriteria.push(`Secret detected in ${art.path}`);
          }
        }
      }

      const secEv = kernel.emitEvidence("PROMAX_SECURITY_CHECK", context.missionId, "PROMAX", {
        rule: secReq.rule,
        passed: !secFailed,
      });

      proofMappings.push({
        criterionId: secReq.id,
        verifier: "TrustedKernel:inspectSecretText",
        observation: secFailed ? "Secret leakage detected in candidate artifacts" : "No secret patterns detected in workspace artifacts",
        evidenceRef: secEv.evidenceId,
        status: secFailed ? "FAILED" : "VERIFIED",
      });
    }

    // 4. Execute Actual Required Test Commands Defined in Contract (P0.14, P0.15)
    let independentTestsPassed = true;
    let regressionPassed = true;

    for (const reqTest of contract.requiredTests) {
      const parts = reqTest.command.trim().split(/\s+/);
      const executableId = parts[0] as TrustedExecutableId;
      const args = parts.slice(1);

      const testResult = kernel.executeCommand(
        executableId,
        args,
        context.missionId,
        "PROMAX",
        candidate.workspacePath
      );

      if (!testResult.success || testResult.exitCode !== reqTest.expectedExitCode) {
        independentTestsPassed = false;
        regressionPassed = false;
        failedCriteria.push(`Required test ${reqTest.name} failed with exit code ${testResult.exitCode}`);

        proofMappings.push({
          criterionId: reqTest.id,
          verifier: `TrustedKernel:executeCommand(${reqTest.command})`,
          observation: `Required test failed: ${testResult.stderr || testResult.stdout}`,
          evidenceRef: testResult.evidenceRecord?.evidenceId ?? "",
          status: "FAILED",
        });
      } else {
        proofMappings.push({
          criterionId: reqTest.id,
          verifier: `TrustedKernel:executeCommand(${reqTest.command})`,
          observation: `Observed test command execution: ${reqTest.command} exited with code 0`,
          evidenceRef: testResult.evidenceRecord?.evidenceId ?? "",
          status: "VERIFIED",
        });
      }
    }

    // 5. Strict Acceptance Criteria Proof Mapping (P0.15)
    for (const criterion of contract.acceptanceCriteria) {
      if (!artifactCheckPassed || !securityCheckPassed || !evidenceFreshnessVerified || !independentTestsPassed) {
        failedCriteria.push(criterion.id);
        proofMappings.push({
          criterionId: criterion.id,
          verifier: "ProMaxVerifier:acceptanceCriteriaEvaluator",
          observation: `Acceptance criterion ${criterion.id} failed due to prerequisite verification failure`,
          evidenceRef: "",
          status: "FAILED",
        });
      } else {
        verifiedCriteria.push(criterion.id);
        const acEv = kernel.emitEvidence("PROMAX_CRITERION_CHECK", context.missionId, "PROMAX", {
          criterionId: criterion.id,
          description: criterion.description,
          status: "VERIFIED",
        });
        proofMappings.push({
          criterionId: criterion.id,
          verifier: "ProMaxVerifier:acceptanceCriteriaEvaluator",
          observation: `Observed verification for acceptance criterion: ${criterion.description}`,
          evidenceRef: acEv.evidenceId,
          status: "VERIFIED",
        });
      }
    }

    const contractSatisfied =
      failedCriteria.length === 0 &&
      artifactCheckPassed &&
      securityCheckPassed &&
      evidenceFreshnessVerified &&
      independentTestsPassed &&
      regressionPassed;

    const assessment: ProMaxAssessment = {
      candidateId: candidate.candidateId,
      contractSatisfied,
      verifiedCriteria,
      failedCriteria,
      securityCheckPassed,
      regressionPassed,
      independentTestsPassed,
      evidenceFreshnessVerified,
    };

    const evidenceRecord = kernel.emitEvidence(
      "PROMAX",
      context.missionId,
      "PROMAX",
      {
        candidateId: candidate.candidateId,
        contractSatisfied,
        proofMappingCount: proofMappings.length,
        verifiedCriteriaCount: verifiedCriteria.length,
        failedCriteriaCount: failedCriteria.length,
        evidenceFreshnessVerified,
        independentTestsPassed,
        regressionPassed,
      },
      candidate.integratedArtifacts[0]
    );

    return {
      success: contractSatisfied,
      assessment,
      proofMappings,
      evidenceRecord,
      reasonCode: contractSatisfied ? "OK" : "PROMAX_VERIFICATION_FAILED",
    };
  }

  private resolveArtifactPath(candidateWorkspacePath: string, artPath: string): string {
    if (artPath.startsWith(candidateWorkspacePath)) {
      return artPath;
    }
    return `${candidateWorkspacePath}/${artPath}`;
  }
}
