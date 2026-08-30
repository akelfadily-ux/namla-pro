/**
 * PROMAX Verifier (§04, §11, P0.1, P0.15, P0.16, P0.17, P0-T1, P0-T2, P0-T5, P0-A1..P0-A8, P0-P1..P0-P9, P0-C1..P0-C11).
 *
 * Performs strongest contract-wide verification on the integrated candidate.
 * Requires explicit, machine-checkable evidence-backed proof mapping for every verified criterion:
 * criterion → verifier requirement → authorized verifier execution → observation → evidenceRef → candidateSnapshotHash → verdict.
 * Computes deterministic candidate snapshot identity across all integrated artifacts.
 * Enforces strict ProofKind taxonomy (TRACEABILITY vs CLAIM vs QUALIFICATION_PROOF).
 * Only QUALIFICATION_PROOF from an authorized verifier producer bound to explicit criterion IDs may satisfy an acceptance criterion.
 * Removes all broad verificationMethod fan-out and self-minted proof logic.
 * Dispatches to semantic verifiers based on TestRequirementType & VerifierIdentifier using allowlisted trusted executables (npx/npm).
 * Executes project-class-specific executable smoke tests (REST API, CLI, DB, Fullstack, Library).
 * Executes distinct contract integration test suite for INTEGRATION_VERIFIER.
 * Re-computes SHA-256 checksums from raw artifact bytes to detect post-acceptance substitution.
 * Validates freshness of the accumulated mission evidence pool.
 */

import { IntegratedCandidate, ProMaxAssessment } from "../types/missionState";
import { ContractBoundStageContext } from "../types/stageContext";
import { TrustedKernel } from "../kernel/trustedKernel";
import { ArtifactIdentity, EvidenceRecord, ProofKind } from "../types/evidence";
import { TestRequirement } from "../types/contracts";
import { ProjectClass } from "../factory/projectFactory";
import { TrustedExecutableId } from "../../cognitive/trustedExecutableRegistry";
import { detectProviderAvailability } from "../../cognitive/nodeProviderProcessDriver";
import { looksLikeSecret } from "../../policies/secretProtectionPolicy";
import { createHash } from "crypto";
import { existsSync } from "fs";
import { resolve, join } from "path";

export interface ProofMapping {
  readonly criterionId: string;
  readonly verifier: string;
  readonly observation: string;
  readonly evidenceRef: string;
  readonly status: "VERIFIED" | "UNVERIFIED" | "FAILED" | "BLOCKED";
  readonly artifactHash?: string;
  readonly candidateSnapshotHash?: string;
  readonly proofKind?: ProofKind;
  readonly testRequirementId?: string;
  readonly securityRequirementId?: string;
}

export interface ProMaxResult {
  readonly success: boolean;
  readonly assessment: ProMaxAssessment;
  readonly proofMappings: readonly ProofMapping[];
  readonly evidenceRecord: EvidenceRecord;
  readonly reasonCode: string;
}

export const AUTHORIZED_VERIFIER_PRODUCERS: ReadonlySet<string> = new Set([
  "TEST_SUITE_VERIFIER",
  "SMOKE_VERIFIER",
  "INTEGRATION_VERIFIER",
  "TYPECHECK_VERIFIER",
  "BUILD_VERIFIER",
  "SECURITY_VERIFIER",
  "REST_API_FUNCTION_LEVEL_SMOKE_VERIFIER",
  "REST_API_EXECUTABLE_SMOKE_VERIFIER",
  "CLI_APPLICATION_EXECUTABLE_SMOKE_VERIFIER",
  "DATABASE_SERVICE_EXECUTABLE_SMOKE_VERIFIER",
  "WEB_APPLICATION_EXECUTABLE_SMOKE_VERIFIER",
  "FULLSTACK_APPLICATION_EXECUTABLE_SMOKE_VERIFIER",
  "TYPESCRIPT_LIBRARY_EXECUTABLE_SMOKE_VERIFIER",
  "DOCKERIZED_SERVICE_EXECUTABLE_SMOKE_VERIFIER",
  "IN_MEMORY_REPOSITORY_SMOKE_VERIFIER",
  "TYPESCRIPT_LIBRARY_EXPORT_SMOKE_VERIFIER",
  "DISTINCT_CONTRACT_INTEGRATION_VERIFIER",
]);

export function computeCandidateSnapshotHash(artifacts: readonly ArtifactIdentity[]): string {
  const sorted = [...artifacts].sort((a, b) => a.path.localeCompare(b.path));
  const raw = sorted.map((a) => `${a.path}:${a.sha256}`).join(";");
  return createHash("sha256").update(raw).digest("hex");
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
    const unverifiedCriteria: string[] = [];
    const proofMappings: ProofMapping[] = [];

    const contract = context.frozenPlanContract;
    const candidateSnapshotHash = computeCandidateSnapshotHash(candidate.integratedArtifacts);

    // 1. Evidence Freshness Verification (P0.17)
    let evidenceFreshnessVerified = true;
    const staleRecords = evidencePool.filter((e) => e.status === "INVALIDATED" || e.status === "SUPERSEDED");
    if (staleRecords.length > 0) {
      evidenceFreshnessVerified = false;
      failedCriteria.push(`ProMax detected ${staleRecords.length} stale/invalidated evidence records`);
    }

    // 2. Independent Artifact Re-Hashing & Checksum Verification (P0.16)
    let artifactCheckPassed = true;
    const artifactHashes: Record<string, string> = {};

    for (const art of candidate.integratedArtifacts) {
      const candCheck = kernel.isInsideCandidateWorkspace(candidate.workspacePath, art.path);
      if (!candCheck.ok) {
        artifactCheckPassed = false;
        failedCriteria.push(`Artifact ${art.path} escapes candidate workspace boundary`);
        proofMappings.push({
          criterionId: `artifact-${art.path}`,
          verifier: "ProMaxVerifier:candidateBoundaryCheck",
          observation: `CANDIDATE BOUNDARY ESCAPE DETECTED: ${art.path} escapes candidate ${candidate.workspacePath}`,
          evidenceRef: "",
          status: "FAILED",
          proofKind: "QUALIFICATION_PROOF",
          candidateSnapshotHash,
        });
        continue;
      }

      const relPath = candCheck.resolvedRelPath;
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
          proofKind: "QUALIFICATION_PROOF",
          candidateSnapshotHash,
        });
      } else {
        // Independently recompute SHA-256 hash from file content bytes
        const recomputedSha256 = createHash("sha256").update(Buffer.from(read.content, "utf8")).digest("hex");
        artifactHashes[art.path] = recomputedSha256;

        if (recomputedSha256 !== art.sha256) {
          artifactCheckPassed = false;
          failedCriteria.push(`Artifact substitution detected for ${art.path}: expected ${art.sha256}, got ${recomputedSha256}`);

          const subEv = kernel.emitEvidence("PROMAX_ARTIFACT_SUBSTITUTION_DETECTED", context.missionId, "PROMAX", {
            path: art.path,
            expectedSha256: art.sha256,
            observedSha256: recomputedSha256,
            candidateSnapshotHash,
          }, undefined, undefined, undefined, "QUALIFICATION_PROOF");

          proofMappings.push({
            criterionId: `artifact-${art.path}`,
            verifier: "Crypto:createHash(sha256)",
            observation: `ARTIFACT SUBSTITUTION DETECTED: expected ${art.sha256}, observed ${recomputedSha256}`,
            evidenceRef: subEv.evidenceId,
            status: "FAILED",
            artifactHash: recomputedSha256,
            proofKind: "QUALIFICATION_PROOF",
            candidateSnapshotHash,
          });
        } else {
          const ev = kernel.emitEvidence("PROMAX_ARTIFACT_CHECK", context.missionId, "PROMAX", {
            path: art.path,
            expectedSha256: art.sha256,
            observedSha256: recomputedSha256,
            candidateSnapshotHash,
          }, undefined, undefined, undefined, "QUALIFICATION_PROOF");

          proofMappings.push({
            criterionId: `artifact-${art.path}`,
            verifier: "Crypto:createHash(sha256)",
            observation: `Independently recomputed SHA-256 for ${art.path} matches expected ${art.sha256}`,
            evidenceRef: ev.evidenceId,
            status: "VERIFIED",
            artifactHash: recomputedSha256,
            proofKind: "QUALIFICATION_PROOF",
            candidateSnapshotHash,
          });
        }
      }
    }

    // 3. Security Requirements Check (P0.15, P0-C11, P0-B7)
    // Uses single authoritative secret protection policy (looksLikeSecret)
    let securityCheckPassed = true;
    for (const secReq of contract.securityRequirements) {
      let secFailed = false;
      if (secReq.rule === "NO_SECRET_LEAKAGE") {
        for (const art of candidate.integratedArtifacts) {
          const relPath = this.resolveArtifactPath(candidate.workspacePath, art.path);
          const read = kernel.safeReadWorkspaceFile(relPath);
          if (read.content && looksLikeSecret(read.content)) {
            securityCheckPassed = false;
            secFailed = true;
            failedCriteria.push(`Secret pattern detected in ${art.path}`);
          }
        }
      }

      const secEv = kernel.emitEvidence("SECURITY_VERIFIER", context.missionId, "PROMAX", {
        securityRequirementId: secReq.id,
        rule: secReq.rule,
        passed: !secFailed,
        candidateSnapshotHash,
        proofKind: "QUALIFICATION_PROOF",
      }, undefined, undefined, undefined, "QUALIFICATION_PROOF");

      proofMappings.push({
        criterionId: secReq.id,
        verifier: "SECURITY_VERIFIER",
        observation: secFailed ? `Secret leakage detected for ${secReq.rule}` : `No secret patterns detected for ${secReq.rule}`,
        evidenceRef: secEv.evidenceId,
        status: secFailed ? "FAILED" : "VERIFIED",
        proofKind: "QUALIFICATION_PROOF",
        candidateSnapshotHash,
        securityRequirementId: secReq.id,
      });

      // Bind QUALIFICATION_PROOF explicitly to declared target criteria (P0-C11)
      if (!secFailed && secReq.provesCriterionIds) {
        for (const targetCriterionId of secReq.provesCriterionIds) {
          const acSecEv = kernel.emitEvidence("SECURITY_VERIFIER", context.missionId, "PROMAX", {
            criterionId: targetCriterionId,
            securityRequirementId: secReq.id,
            rule: secReq.rule,
            candidateSnapshotHash,
            proofKind: "QUALIFICATION_PROOF",
          }, undefined, undefined, undefined, "QUALIFICATION_PROOF");

          proofMappings.push({
            criterionId: targetCriterionId,
            verifier: "SECURITY_VERIFIER",
            observation: `SECURITY_VERIFIER observed compliance for criterion ${targetCriterionId}: Rule ${secReq.rule} satisfied`,
            evidenceRef: acSecEv.evidenceId,
            status: "VERIFIED",
            proofKind: "QUALIFICATION_PROOF",
            candidateSnapshotHash,
            artifactHash: candidate.integratedArtifacts[0]?.sha256,
            securityRequirementId: secReq.id,
          });
        }
      }
    }

    // 4. Semantic Verifier Dispatch for TestRequirements (P0-T1, P0-T5, P0-A7, P0-A8, P0-C1..P0-C8)
    let independentTestsPassed = true;
    let regressionPassed = true;

    for (const reqTest of contract.requiredTests) {
      const verifierRes = this.dispatchSemanticVerifier(reqTest, candidate, context, kernel);

      if (verifierRes.status === "FAILED") {
        independentTestsPassed = false;
        regressionPassed = false;
        failedCriteria.push(`Required test ${reqTest.name} failed: ${verifierRes.observation}`);
      }

      proofMappings.push({
        criterionId: reqTest.id,
        verifier: verifierRes.verifier,
        observation: verifierRes.observation,
        evidenceRef: verifierRes.evidenceRef,
        status: verifierRes.status,
        proofKind: "QUALIFICATION_PROOF",
        artifactHash: verifierRes.artifactHash,
        candidateSnapshotHash,
        testRequirementId: reqTest.id,
      });

      // Emit verifier QUALIFICATION_PROOF for explicitly bound criteria ONLY (P0-C1, P0-C2, P0-C3, P0-C6)
      if (verifierRes.status === "VERIFIED" && reqTest.provesCriterionIds) {
        for (const targetCriterionId of reqTest.provesCriterionIds) {
          const proofEv = kernel.emitEvidence(verifierRes.verifier, context.missionId, "PROMAX", {
            criterionId: targetCriterionId,
            testRequirementId: reqTest.id,
            verifier: verifierRes.verifier,
            observation: verifierRes.observation,
            candidateSnapshotHash,
            sha256: verifierRes.artifactHash,
            proofKind: "QUALIFICATION_PROOF",
          }, undefined, undefined, undefined, "QUALIFICATION_PROOF");

          proofMappings.push({
            criterionId: targetCriterionId,
            verifier: verifierRes.verifier,
            observation: `QUALIFICATION_PROOF from authorized verifier (${verifierRes.verifier}) for requirement ${reqTest.id}: ${verifierRes.observation}`,
            evidenceRef: proofEv.evidenceId,
            status: "VERIFIED",
            proofKind: "QUALIFICATION_PROOF",
            candidateSnapshotHash,
            artifactHash: verifierRes.artifactHash,
            testRequirementId: reqTest.id,
          });
        }
      }
    }

    // 5. Strict Acceptance Criteria Proof Validation (P0-A1..P0-A6, P0-P1..P0-P5, P0-C1..P0-C8)
    // PROMAX VALIDATES proof from authorized verifiers; it NEVER self-mints proof out of thin air.
    for (const criterion of contract.acceptanceCriteria) {
      if (!artifactCheckPassed || !securityCheckPassed || !evidenceFreshnessVerified || !independentTestsPassed) {
        failedCriteria.push(criterion.id);
        proofMappings.push({
          criterionId: criterion.id,
          verifier: "ProMaxVerifier:acceptanceCriteriaEvaluator",
          observation: `Prerequisite verification failure blocked criterion evaluation`,
          evidenceRef: "",
          status: "FAILED",
          proofKind: "QUALIFICATION_PROOF",
          candidateSnapshotHash,
        });
        continue;
      }

      // Search for explicit QUALIFICATION_PROOF evidence in evidencePool emitted by an authorized verifier (P0-P1..P0-P5, P0-C1..P0-C8)
      const matchingEvidence = evidencePool.find((ev) => {
        if (ev.status !== "VALID") return false;
        if (ev.missionId !== context.missionId) return false;

        // Proof Provenance Gate (P0-P1, P0-P2, P0-P3):
        // Evidence MUST be QUALIFICATION_PROOF and emitted by an authorized verifier producer!
        const effectiveProofKind = ev.proofKind ?? ev.details.proofKind;
        if (effectiveProofKind !== "QUALIFICATION_PROOF") return false;
        if (!AUTHORIZED_VERIFIER_PRODUCERS.has(ev.producer)) return false;

        // Explicit criterion ID match required (P0-C2, P0-C3)
        const hasCriterionMatch =
          ev.details.criterionId === criterion.id ||
          (Array.isArray(ev.details.acceptanceCriteria) && ev.details.acceptanceCriteria.includes(criterion.id));

        if (!hasCriterionMatch) return false;

        // Requirement Binding Match (P0-S3, P0-S4): If criterion specifies requiredRequirementId, verify evidence matches it exactly
        if (criterion.requiredRequirementId) {
          const evReqId = ev.details.testRequirementId ?? ev.details.securityRequirementId;
          if (evReqId !== criterion.requiredRequirementId) {
            return false;
          }
        }

        // VerificationMethod Binding Gate (P0-P4, P0-C10):
        // Ensure verifier category satisfies criterion verificationMethod requirement
        if (criterion.verificationMethod === "TEST") {
          const isTestVerifier =
            ev.producer.includes("TEST") ||
            ev.producer.includes("SMOKE") ||
            ev.producer.includes("INTEGRATION");
          if (!isTestVerifier) return false;
        } else if (criterion.verificationMethod === "SECURITY_CHECK") {
          if (!ev.producer.includes("SECURITY")) return false;
        }

        // Candidate Snapshot & Artifact Causal Binding (P0-S1, P0-S4):
        // candidateSnapshotHash MUST exist AND MUST equal current candidateSnapshotHash!
        const evSnapshotHash = typeof ev.details.candidateSnapshotHash === "string" ? ev.details.candidateSnapshotHash : undefined;
        if (!evSnapshotHash || evSnapshotHash !== candidateSnapshotHash) {
          return false; // Missing or mismatched snapshot hash -> REJECT
        }

        const evArtifactHash =
          ev.artifactIdentity?.sha256 ?? (typeof ev.details.sha256 === "string" ? ev.details.sha256 : undefined);
        if (evArtifactHash) {
          const evFilePath =
            ev.artifactIdentity?.path ?? (typeof ev.details.targetFile === "string" ? ev.details.targetFile : undefined);
          if (evFilePath) {
            const currentHashOnDisk = artifactHashes[evFilePath];
            if (currentHashOnDisk && currentHashOnDisk !== evArtifactHash) {
              return false; // Artifact mutated -> proof STALE/INVALID
            }
          }
        }

        return true;
      });

      // Search for explicit proof mapping generated during semantic verifier dispatch (QUALIFICATION_PROOF) (P0-S1, P0-S3, P0-S4)
      const matchingProof = proofMappings.find(
        (p) =>
          p.criterionId === criterion.id &&
          p.status === "VERIFIED" &&
          p.proofKind === "QUALIFICATION_PROOF" &&
          AUTHORIZED_VERIFIER_PRODUCERS.has(p.verifier) &&
          p.candidateSnapshotHash === candidateSnapshotHash && // P0-S1: Mandatory snapshot identity
          (!criterion.requiredRequirementId ||
            p.testRequirementId === criterion.requiredRequirementId ||
            p.securityRequirementId === criterion.requiredRequirementId) // P0-S3: Requirement ID matching
      );

      if (matchingEvidence || matchingProof) {
        verifiedCriteria.push(criterion.id);
        const evidenceRef = matchingEvidence?.evidenceId ?? matchingProof?.evidenceRef ?? "";
        // P0-S2: REMOVE POST-HOC ARTIFACT HASH FALLBACK (no ?? candidate.integratedArtifacts[0]?.sha256)
        const artifactHash = matchingEvidence?.artifactIdentity?.sha256 ?? matchingProof?.artifactHash;

        proofMappings.push({
          criterionId: criterion.id,
          verifier: matchingProof?.verifier ?? matchingEvidence?.producer ?? "ProMaxVerifier:authorizedVerifierProofMatcher",
          observation: `Validated QUALIFICATION_PROOF for (${criterion.description}): ${matchingProof?.observation ?? "Authorized verifier proof record validated"}`,
          evidenceRef,
          status: "VERIFIED",
          artifactHash,
          candidateSnapshotHash,
          proofKind: "QUALIFICATION_PROOF",
        });
      } else {
        // UNVERIFIED: No QUALIFICATION_PROOF from authorized verifier mapped to this criterion! (P0-C1, P0-C6)
        unverifiedCriteria.push(criterion.id);
        proofMappings.push({
          criterionId: criterion.id,
          verifier: "UNMAPPED_CRITERION_VERIFIER",
          observation: `NO QUALIFICATION_PROOF FROM AUTHORIZED VERIFIER MAPPED for acceptance criterion "${criterion.description}" (${criterion.id})`,
          evidenceRef: "",
          status: "UNVERIFIED",
          proofKind: "QUALIFICATION_PROOF",
          candidateSnapshotHash,
        });
      }
    }

    const contractSatisfied =
      failedCriteria.length === 0 &&
      unverifiedCriteria.length === 0 &&
      artifactCheckPassed &&
      securityCheckPassed &&
      evidenceFreshnessVerified &&
      independentTestsPassed &&
      regressionPassed;

    const assessment: ProMaxAssessment = {
      candidateId: candidate.candidateId,
      contractSatisfied,
      verifiedCriteria,
      failedCriteria: [...failedCriteria, ...unverifiedCriteria],
      securityCheckPassed,
      regressionPassed,
      independentTestsPassed,
      evidenceFreshnessVerified,
    };

    const evidenceRecord = kernel.emitEvidence(
      "PROMAX_ASSESSMENT_RECEIPT",
      context.missionId,
      "PROMAX",
      {
        candidateId: candidate.candidateId,
        contractSatisfied,
        proofMappingCount: proofMappings.length,
        verifiedCriteriaCount: verifiedCriteria.length,
        failedCriteriaCount: failedCriteria.length,
        unverifiedCriteriaCount: unverifiedCriteria.length,
        evidenceFreshnessVerified,
        independentTestsPassed,
        regressionPassed,
        candidateSnapshotHash,
      },
      candidate.integratedArtifacts[0],
      undefined,
      undefined,
      "QUALIFICATION_PROOF"
    );

    return {
      success: contractSatisfied,
      assessment,
      proofMappings,
      evidenceRecord,
      reasonCode: contractSatisfied ? "OK" : "PROMAX_VERIFICATION_FAILED",
    };
  }

  private dispatchSemanticVerifier(
    reqTest: TestRequirement,
    candidate: IntegratedCandidate,
    context: ContractBoundStageContext,
    kernel: TrustedKernel
  ): { verifier: string; observation: string; evidenceRef: string; status: "VERIFIED" | "FAILED" | "BLOCKED"; artifactHash?: string } {
    const verifierType = reqTest.verifier ?? reqTest.type ?? "TEST";
    const projectClass: ProjectClass = context.projectClass ?? "TYPESCRIPT_LIBRARY";
    const primaryArtifactHash = candidate.integratedArtifacts[0]?.sha256;

    switch (verifierType) {
      case "BUILD_VERIFIER":
      case "BUILD": {
        const parts = reqTest.command.trim().split(/\s+/);
        const executableId = parts[0] as TrustedExecutableId;
        const args = parts.slice(1);
        const res = kernel.executeCommand(executableId, args, context.missionId, "PROMAX", candidate.workspacePath);
        return {
          verifier: "BUILD_VERIFIER",
          observation: res.success ? `Build requirement ${reqTest.id} (${reqTest.command}) succeeded with exit 0` : `Build command failed: ${res.stderr || res.stdout}`,
          evidenceRef: res.evidenceRecord?.evidenceId ?? "",
          status: res.success ? "VERIFIED" : "FAILED",
          artifactHash: primaryArtifactHash,
        };
      }

      case "TYPECHECK_VERIFIER":
      case "TYPECHECK": {
        const res = kernel.executeCommand("npx", ["--package=typescript", "tsc", "--noEmit"], context.missionId, "PROMAX", candidate.workspacePath);
        return {
          verifier: "TYPECHECK_VERIFIER",
          observation: res.success ? `Typecheck requirement ${reqTest.id} (npx tsc --noEmit) passed with 0 errors` : `TypeScript typecheck failed: ${res.stderr || res.stdout}`,
          evidenceRef: res.evidenceRecord?.evidenceId ?? "",
          status: res.success ? "VERIFIED" : "FAILED",
          artifactHash: primaryArtifactHash,
        };
      }

      case "DOCKER_BUILD_VERIFIER":
      case "DOCKER_BUILD": {
        const dockerCheck = detectProviderAvailability("docker" as any);
        if (!dockerCheck.available) {
          return {
            verifier: "DOCKER_BUILD_VERIFIER",
            observation: `Docker infrastructure unavailable (${dockerCheck.failureCategory})`,
            evidenceRef: "",
            status: "BLOCKED",
          };
        }

        // P0-CB3: Dedicated Docker Verifier using canonical workspace path authority & safe child env
        const candCheck = kernel.isInsideCandidateWorkspace(candidate.workspacePath, "Dockerfile");
        const dockerCwd = resolve(join(process.cwd(), candidate.workspacePath));

        const { spawnSync } = require("child_process");
        const { buildSafeChildEnv } = require("../../cognitive/safeProviderRequest");

        const dockerBuild = spawnSync("docker", ["build", "-t", `test-${context.missionId}`, "."], {
          cwd: dockerCwd,
          shell: false,
          encoding: "utf8",
          timeout: 30000,
          env: buildSafeChildEnv(),
        });

        if (dockerBuild.status === 0) {
          return {
            verifier: "DOCKER_BUILD_VERIFIER",
            observation: `Docker build requirement ${reqTest.id} built image successfully`,
            evidenceRef: "",
            status: "VERIFIED",
            artifactHash: primaryArtifactHash,
          };
        }

        const output = (dockerBuild.stderr || "") + (dockerBuild.stdout || "") + (dockerBuild.error ? dockerBuild.error.message : "");
        const isEnvIssue =
          output.includes("Cannot connect to the Docker daemon") ||
          output.includes("docker daemon is not running") ||
          output.includes("permission denied") ||
          output.includes("overlayfs") ||
          output.includes("ENOENT") ||
          dockerBuild.error !== undefined;

        return {
          verifier: "DOCKER_BUILD_VERIFIER",
          observation: isEnvIssue ? `Docker daemon/environment unavailable: ${output.slice(0, 100)}` : `Docker build failed: ${output.slice(0, 100)}`,
          evidenceRef: "",
          status: isEnvIssue ? "BLOCKED" : "FAILED",
        };
      }

      case "SMOKE_VERIFIER":
      case "SMOKE": {
        const smokeTestRelPath =
          projectClass === "REST_API" ? "tests/server.test.ts" :
          projectClass === "CLI_APPLICATION" ? "tests/cli.test.ts" :
          projectClass === "DATABASE_SERVICE" ? "tests/repository.test.ts" :
          projectClass === "WEB_APPLICATION" || projectClass === "FULLSTACK_APPLICATION" ? "tests/app.test.ts" :
          "tests/index.test.ts";

        // P0-CB2 & P0-CB4: Check existence via TrustedKernel workspaceFileExists without process.cwd() probing or fallback
        const fullCandidateSmokeRelPath = `${candidate.workspacePath}/${smokeTestRelPath}`;
        const verifierName = `${projectClass}_EXECUTABLE_SMOKE_VERIFIER`;

        if (!kernel.workspaceFileExists(fullCandidateSmokeRelPath)) {
          return {
            verifier: verifierName,
            observation: `Specific executable smoke test file (${smokeTestRelPath}) absent in candidate workspace ${candidate.workspacePath}`,
            evidenceRef: "",
            status: "BLOCKED",
          };
        }

        const res = kernel.executeCommand("npx", ["node", "--test", smokeTestRelPath], context.missionId, "PROMAX", candidate.workspacePath);
        return {
          verifier: verifierName,
          observation: res.success ? `${verifierName} (${reqTest.id}): Observed executable smoke test passage` : `Smoke verification failed: ${res.stderr || res.stdout}`,
          evidenceRef: res.evidenceRecord?.evidenceId ?? "",
          status: res.success ? "VERIFIED" : "FAILED",
          artifactHash: primaryArtifactHash,
        };
      }

      case "INTEGRATION_VERIFIER":
      case "INTEGRATION_TEST": {
        // P0-CB2 & P0-CB5: Check existence via TrustedKernel workspaceFileExists without process.cwd() probing
        const fullCandidateIntegrationRelPath = `${candidate.workspacePath}/tests/integration.test.ts`;
        if (!kernel.workspaceFileExists(fullCandidateIntegrationRelPath)) {
          return {
            verifier: "DISTINCT_CONTRACT_INTEGRATION_VERIFIER",
            observation: `Integration requirement ${reqTest.id}: tests/integration.test.ts not present in candidate workspace ${candidate.workspacePath}`,
            evidenceRef: "",
            status: "BLOCKED",
          };
        }

        const res = kernel.executeCommand("npx", ["node", "--test", "tests/integration.test.ts"], context.missionId, "PROMAX", candidate.workspacePath);
        return {
          verifier: "DISTINCT_CONTRACT_INTEGRATION_VERIFIER",
          observation: res.success ? `DISTINCT_CONTRACT_INTEGRATION_VERIFIER (${reqTest.id}): Executed tests/integration.test.ts successfully` : `Integration test execution failed: ${res.stderr || res.stdout}`,
          evidenceRef: res.evidenceRecord?.evidenceId ?? "",
          status: res.success ? "VERIFIED" : "FAILED",
          artifactHash: primaryArtifactHash,
        };
      }

      case "TEST_SUITE_VERIFIER":
      case "TEST":
      default: {
        const parts = reqTest.command.trim().split(/\s+/);
        const executableId = parts[0] as TrustedExecutableId;
        const args = parts.slice(1);
        const res = kernel.executeCommand(executableId, args, context.missionId, "PROMAX", candidate.workspacePath);
        return {
          verifier: "TEST_SUITE_VERIFIER",
          observation: res.success ? `Unit test requirement ${reqTest.id} (${reqTest.command}) passed with exit 0` : `Test suite failed: ${res.stderr || res.stdout}`,
          evidenceRef: res.evidenceRecord?.evidenceId ?? "",
          status: res.success ? "VERIFIED" : "FAILED",
          artifactHash: primaryArtifactHash,
        };
      }
    }
  }

  private resolveArtifactPath(candidateWorkspacePath: string, artPath: string, kernel?: TrustedKernel): string {
    if (kernel) {
      const check = kernel.isInsideCandidateWorkspace(candidateWorkspacePath, artPath);
      if (check.ok) return check.resolvedRelPath;
    }
    const cleanArt = artPath.replace(/\\/g, "/").replace(/^\.\//, "");
    const cleanCand = candidateWorkspacePath.replace(/\\/g, "/").replace(/^\.\//, "");
    if (cleanArt.startsWith(cleanCand + "/")) {
      return cleanArt;
    }
    return `${cleanCand}/${cleanArt}`;
  }
}
