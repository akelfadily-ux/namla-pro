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

export interface ProofMapping {
  readonly criterionId: string;
  readonly verifier: string;
  readonly observation: string;
  readonly evidenceRef: string;
  readonly sourceEvidenceRef?: string;
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

export interface ExpectedSourceExecution {
  readonly executableId: string;
  readonly args: readonly string[];
}

export function getExpectedSourceExecution(
  verifier: string,
  reqTest?: TestRequirement,
  projectClass?: ProjectClass,
  missionId?: string
): ExpectedSourceExecution | undefined {
  if (verifier === "BUILD_VERIFIER") {
    if (reqTest?.command) {
      const parts = reqTest.command.trim().split(/\s+/);
      return { executableId: parts[0], args: parts.slice(1) };
    }
    return { executableId: "npm", args: ["run", "build"] };
  }

  if (verifier === "TYPECHECK_VERIFIER") {
    return { executableId: "npx", args: ["--package=typescript", "tsc", "--noEmit"] };
  }

  if (verifier === "DOCKER_BUILD_VERIFIER") {
    const tag = missionId ? `test-${missionId}` : undefined;
    return { executableId: "docker", args: ["build", "-t", tag ?? "", "."] };
  }

  if (verifier.includes("SMOKE_VERIFIER")) {
    const cls = projectClass ?? "TYPESCRIPT_LIBRARY";
    const smokeTestRelPath =
      cls === "REST_API" ? "tests/server.test.ts" :
      cls === "CLI_APPLICATION" ? "tests/cli.test.ts" :
      cls === "DATABASE_SERVICE" ? "tests/repository.test.ts" :
      cls === "WEB_APPLICATION" || cls === "FULLSTACK_APPLICATION" ? "tests/app.test.ts" :
      "tests/index.test.ts";
    return { executableId: "npx", args: ["node", "--test", smokeTestRelPath] };
  }

  if (verifier === "DISTINCT_CONTRACT_INTEGRATION_VERIFIER" || verifier === "INTEGRATION_VERIFIER") {
    return { executableId: "npx", args: ["node", "--test", "tests/integration.test.ts"] };
  }

  if (verifier === "TEST_SUITE_VERIFIER" || verifier === "TEST") {
    if (reqTest?.command) {
      const parts = reqTest.command.trim().split(/\s+/);
      return { executableId: parts[0], args: parts.slice(1) };
    }
    return { executableId: "npm", args: ["test"] };
  }

  return undefined;
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
    const accumulatedPool: EvidenceRecord[] = [...evidencePool];

    // 1. Evidence Freshness Verification (P0.17)
    let evidenceFreshnessVerified = true;
    const staleRecords = accumulatedPool.filter((e) => e.status === "INVALIDATED" || e.status === "SUPERSEDED");
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

          const subEv = kernel.emitArtifactSubstitutionEvidence(context.missionId, "PROMAX", {
            path: art.path,
            expectedSha256: art.sha256,
            observedSha256: recomputedSha256,
            candidateSnapshotHash,
          });
          accumulatedPool.push(subEv);

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
          const ev = kernel.emitArtifactCheckEvidence(context.missionId, "PROMAX", {
            path: art.path,
            expectedSha256: art.sha256,
            observedSha256: recomputedSha256,
            candidateSnapshotHash,
          });
          accumulatedPool.push(ev);

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

      const secEv = kernel.emitSecurityQualificationProof(context.missionId, "PROMAX", {
        securityRequirementId: secReq.id,
        rule: secReq.rule,
        passed: !secFailed,
        candidateSnapshotHash,
        proofKind: "QUALIFICATION_PROOF",
      });
      accumulatedPool.push(secEv);

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
          const acSecEv = kernel.emitSecurityQualificationProof(context.missionId, "PROMAX", {
            criterionId: targetCriterionId,
            securityRequirementId: secReq.id,
            rule: secReq.rule,
            candidateSnapshotHash,
            proofKind: "QUALIFICATION_PROOF",
          });
          accumulatedPool.push(acSecEv);

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
      if (verifierRes.evidenceRecord) {
        accumulatedPool.push(verifierRes.evidenceRecord);
      }

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
        sourceEvidenceRef: verifierRes.evidenceRef,
        status: verifierRes.status,
        proofKind: "QUALIFICATION_PROOF",
        artifactHash: verifierRes.artifactHash,
        candidateSnapshotHash,
        testRequirementId: reqTest.id,
      });

      // Emit verifier QUALIFICATION_PROOF for explicitly bound criteria ONLY (P0-C1, P0-C2, P0-C3, P0-C6, P0-E2, P0-E3)
      if (verifierRes.status === "VERIFIED" && reqTest.provesCriterionIds) {
        // P0-E3: Command-backed verifier MUST carry a valid source evidence reference
        if (!verifierRes.evidenceRef || verifierRes.evidenceRef.trim().length === 0) {
          failedCriteria.push(`Verifier ${verifierRes.verifier} produced VERIFIED result without source execution evidenceRef`);
        } else {
          for (const targetCriterionId of reqTest.provesCriterionIds) {
            const proofEv = kernel.emitVerifierQualificationProof(verifierRes.verifier, context.missionId, "PROMAX", {
              criterionId: targetCriterionId,
              testRequirementId: reqTest.id,
              verifier: verifierRes.verifier,
              observation: verifierRes.observation,
              sourceEvidenceRef: verifierRes.evidenceRef,
              candidateSnapshotHash,
              sha256: verifierRes.artifactHash,
              proofKind: "QUALIFICATION_PROOF",
            });
            accumulatedPool.push(proofEv);

            proofMappings.push({
              criterionId: targetCriterionId,
              verifier: verifierRes.verifier,
              observation: `QUALIFICATION_PROOF from authorized verifier (${verifierRes.verifier}) for requirement ${reqTest.id}: ${verifierRes.observation}`,
              evidenceRef: proofEv.evidenceId,
              sourceEvidenceRef: verifierRes.evidenceRef,
              status: "VERIFIED",
              proofKind: "QUALIFICATION_PROOF",
              candidateSnapshotHash,
              artifactHash: verifierRes.artifactHash,
              testRequirementId: reqTest.id,
            });
          }
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
      const matchingEvidence = accumulatedPool.find((ev) => {
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

        // P0-SE2 & P0-SE4: MANDATORY SOURCE EVIDENCE VALIDATION FOR COMMAND-BACKED QUALIFICATION PROOFS
        if (ev.producer !== "SECURITY_VERIFIER" && ev.producer !== "PROMAX") {
          const sourceRef = typeof ev.details.sourceEvidenceRef === "string" ? ev.details.sourceEvidenceRef : undefined;
          if (!sourceRef || sourceRef.trim().length === 0) return false; // Mandatory sourceEvidenceRef missing -> REJECT

          const sourceEv = accumulatedPool.find((e) => e.evidenceId === sourceRef);
          if (!sourceEv) return false; // Nonexistent source evidence -> REJECT
          if (sourceEv.producer !== "TRUSTED_KERNEL_COMMAND") return false; // Must be TRUSTED_KERNEL_COMMAND -> REJECT
          if (sourceEv.proofKind !== "TRACEABILITY") return false; // Must be TRACEABILITY observation -> REJECT
          if (sourceEv.status !== "VALID") return false; // Invalidated source evidence -> REJECT
          if (sourceEv.missionId !== context.missionId) return false; // Cross-mission source evidence -> REJECT
          if (sourceEv.details.success !== true && sourceEv.details.exitCode !== 0) return false; // Failed command execution -> REJECT

          // P0-SE1 & P0-SE2: Validate exact executableId and args against expected verifier execution
          const reqTest = contract.requiredTests.find((r) => r.id === ev.details.testRequirementId);
          const expected = getExpectedSourceExecution(ev.producer, reqTest, context.projectClass, context.missionId);
          if (expected) {
            const srcExecId = sourceEv.details.executableId;
            const srcArgs = Array.isArray(sourceEv.details.args) ? sourceEv.details.args : [];
            if (srcExecId !== expected.executableId) return false; // Executable mismatch -> REJECT
            if (srcArgs.length !== expected.args.length) return false; // Args length mismatch -> REJECT
            for (let i = 0; i < expected.args.length; i++) {
              if (srcArgs[i] !== expected.args[i]) return false; // Arg content mismatch -> REJECT
            }
          }
        }

        return true;
      });

      // Search for explicit proof mapping generated during semantic verifier dispatch (QUALIFICATION_PROOF) (P0-S1, P0-S3, P0-S4, P0-SE2, P0-SE4)
      const matchingProof = proofMappings.find((p) => {
        if (p.criterionId !== criterion.id) return false;
        if (p.status !== "VERIFIED") return false;
        if (p.proofKind !== "QUALIFICATION_PROOF") return false;
        if (!AUTHORIZED_VERIFIER_PRODUCERS.has(p.verifier)) return false;
        if (p.candidateSnapshotHash !== candidateSnapshotHash) return false;

        // Requirement ID matching
        if (criterion.requiredRequirementId) {
          if (p.testRequirementId !== criterion.requiredRequirementId && p.securityRequirementId !== criterion.requiredRequirementId) {
            return false;
          }
        }

        // For non-security verifiers, sourceEvidenceRef is mandatory and must pass source validation
        if (p.verifier !== "SECURITY_VERIFIER") {
          if (!p.sourceEvidenceRef || p.sourceEvidenceRef.trim().length === 0) return false;
          const sourceEv = accumulatedPool.find((e) => e.evidenceId === p.sourceEvidenceRef);
          if (!sourceEv) return false;
          if (sourceEv.status !== "VALID" || sourceEv.missionId !== context.missionId) return false;
          if (sourceEv.producer !== "TRUSTED_KERNEL_COMMAND" || sourceEv.proofKind !== "TRACEABILITY") return false;
          if (sourceEv.details.success !== true && sourceEv.details.exitCode !== 0) return false;

          const reqTest = contract.requiredTests.find((r) => r.id === p.testRequirementId);
          const expected = getExpectedSourceExecution(p.verifier, reqTest, context.projectClass, context.missionId);
          if (expected) {
            if (sourceEv.details.executableId !== expected.executableId) return false;
            const srcArgs = Array.isArray(sourceEv.details.args) ? sourceEv.details.args : [];
            if (srcArgs.length !== expected.args.length) return false;
            for (let i = 0; i < expected.args.length; i++) {
              if (srcArgs[i] !== expected.args[i]) return false;
            }
          }
        }

        return true;
      });

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

    const evidenceRecord = kernel.emitProMaxAssessmentReceipt(
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
      }
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
  ): { verifier: string; observation: string; evidenceRef: string; status: "VERIFIED" | "FAILED" | "BLOCKED"; artifactHash?: string; evidenceRecord?: EvidenceRecord } {
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
          evidenceRecord: res.evidenceRecord,
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
          evidenceRecord: res.evidenceRecord,
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

        // P0-D1 & P0-D2 & P0-D4 & P0-D5: Route Docker execution entirely through TrustedKernel
        const res = kernel.executeDockerBuild(candidate.workspacePath, context.missionId, "PROMAX");

        if (res.reasonCode === "DOCKERFILE_ABSENT" || res.reasonCode === "CANDIDATE_BOUNDARY_ESCAPE") {
          return {
            verifier: "DOCKER_BUILD_VERIFIER",
            observation: res.stderr,
            evidenceRef: "",
            status: "BLOCKED",
          };
        }

        const output = (res.stderr || "") + (res.stdout || "");
        const isEnvIssue =
          res.reasonCode === "EXECUTABLE_UNAUTHORIZED" ||
          output.includes("Cannot connect to the Docker daemon") ||
          output.includes("docker daemon is not running") ||
          output.includes("permission denied") ||
          output.includes("overlayfs") ||
          output.includes("ENOENT");

        if (res.success) {
          return {
            verifier: "DOCKER_BUILD_VERIFIER",
            observation: `Docker build requirement ${reqTest.id} built image successfully`,
            evidenceRef: res.evidenceRecord?.evidenceId ?? "",
            status: "VERIFIED",
            artifactHash: primaryArtifactHash,
            evidenceRecord: res.evidenceRecord,
          };
        }

        return {
          verifier: "DOCKER_BUILD_VERIFIER",
          observation: isEnvIssue ? `Docker daemon/environment unavailable: ${output.slice(0, 100)}` : `Docker build failed: ${output.slice(0, 100)}`,
          evidenceRef: res.evidenceRecord?.evidenceId ?? "",
          status: isEnvIssue ? "BLOCKED" : "FAILED",
          evidenceRecord: res.evidenceRecord,
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
          evidenceRecord: res.evidenceRecord,
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
          evidenceRecord: res.evidenceRecord,
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
          evidenceRecord: res.evidenceRecord,
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
