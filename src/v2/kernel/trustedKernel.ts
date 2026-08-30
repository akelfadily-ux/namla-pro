/**
 * Trusted Kernel Implementation (§08, P0-T4, P0-P1, P0-P2).
 *
 * Single authoritative effect and trust boundary for NAMLA PRO V2.
 * Enforces EffectiveAuthority = HardSecurityPolicy ∩ Authorization ∩ Permit ∩ Scope ∩ Budget ∩ Environment.
 */

import { SafetyGuard } from "../../core/safetyGuard";
import { ReceiptLog } from "../../core/receiptLog";
import { looksLikeSecret } from "../../policies/secretProtectionPolicy";
import { isForbiddenCommand } from "../../policies/commandSafetyPolicy";
import { resolveTrustedExecutable, TrustedExecutableId } from "../../cognitive/trustedExecutableRegistry";
import { buildSafeChildEnv } from "../../cognitive/safeProviderRequest";
import { CapabilityScope, PlanContract } from "../types/contracts";
import { ArtifactIdentity, EnvironmentIdentity, EvidenceRecord, ProofKind } from "../types/evidence";
import { IntegratedCandidate } from "../types/missionState";
import { StageContextBase } from "../types/stageContext";
import {
  getCanonicalWorkspaceRoot,
  resolveWorkspacePath,
  isInsideCandidateWorkspace,
  validateCapabilityScope,
} from "./workspacePathAuthority";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { createHash } from "crypto";
import { spawnSync } from "child_process";

export interface SecurityGateSeam {
  readonly bypassPathContainment?: boolean;
  readonly bypassSecretDetection?: boolean;
  readonly bypassCommandSafety?: boolean;
}

export interface TrustedKernelOptions {
  readonly workspaceRoot: string;
  readonly humanAuthorizationGranted?: boolean;
  readonly securityGateSeam?: SecurityGateSeam;
}

export interface EffectiveAuthorityResult {
  readonly authorized: boolean;
  readonly reasonCode: string;
}

export interface CommandExecutionResult {
  readonly success: boolean;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly reasonCode: string;
  readonly evidenceRecord?: EvidenceRecord;
}

export const KERNEL_RESERVED_PRODUCERS: ReadonlySet<string> = new Set([
  "TRUSTED_KERNEL_COMMAND",
  "TRUSTED_KERNEL",
  "PROMAX_ARTIFACT_CHECK",
  "PROMAX_ARTIFACT_SUBSTITUTION_DETECTED",
  "PROMAX_ASSESSMENT_RECEIPT",
]);

/**
 * Branded permit token for trusted verifier qualification proof creation (P0-RA1).
 * Opaque class instance validated strictly via TrustedKernel's private WeakSet and session binding.
 */
export class TrustedVerifierPermit {
  private readonly brand = Symbol("TrustedVerifierPermit");
  constructor(
    public readonly missionId: string,
    public readonly candidateSnapshotHash: string,
    public readonly sessionId: string
  ) {}
}

export class TrustedKernel {
  private readonly safetyGuard: SafetyGuard;
  private readonly receiptLog: ReceiptLog;
  private readonly workspaceRoot: string;
  private readonly humanAuthorizationGranted: boolean;
  private securityGateSeam: SecurityGateSeam;
  private evidenceCounter = 0;
  private readonly activeVerifierPermits = new WeakSet<TrustedVerifierPermit>();

  constructor(options: TrustedKernelOptions) {
    this.workspaceRoot = getCanonicalWorkspaceRoot(options.workspaceRoot);
    this.humanAuthorizationGranted = options.humanAuthorizationGranted ?? true;
    this.securityGateSeam = options.securityGateSeam ?? {};
    this.safetyGuard = new SafetyGuard();
    this.receiptLog = new ReceiptLog();
  }

  public setSecurityGateSeam(seam: SecurityGateSeam): void {
    this.securityGateSeam = seam;
  }

  public getReceiptLog(): ReceiptLog {
    return this.receiptLog;
  }

  public evaluateEffectiveAuthority(
    capability: CapabilityScope,
    contract: PlanContract | undefined,
    budgetRemaining: number
  ): EffectiveAuthorityResult {
    if (!this.securityGateSeam.bypassPathContainment) {
      const pathRes = resolveWorkspacePath(this.workspaceRoot, capability.target);
      if (!pathRes.ok) {
        return { authorized: false, reasonCode: `HARD_POLICY_VIOLATION: ${pathRes.reasonCode}` };
      }
    }

    if (!this.securityGateSeam.bypassSecretDetection && looksLikeSecret(capability.target)) {
      return { authorized: false, reasonCode: "HARD_POLICY_VIOLATION: Secret pattern detected in target path" };
    }

    if (!this.humanAuthorizationGranted) {
      return { authorized: false, reasonCode: "AUTHORIZATION_REFUSED: Human/BuildLaw authorization required" };
    }

    if (contract) {
      const scopeMatch = contract.allowedCapabilities.some(
        (allowedScope) =>
          allowedScope.capability === capability.capability &&
          validateCapabilityScope(capability.target, allowedScope.target) &&
          (!capability.readOnly || allowedScope.readOnly === capability.readOnly)
      );
      if (!scopeMatch) {
        return { authorized: false, reasonCode: "PLAN_CONTRACT_SCOPE_EXCEEDED" };
      }
    }

    if (budgetRemaining <= 0) {
      return { authorized: false, reasonCode: "BUDGET_EXHAUSTED" };
    }

    return { authorized: true, reasonCode: "OK" };
  }

  public isInsideCandidateWorkspace(candidateWorkspaceRelPath: string, artifactPath: string) {
    return isInsideCandidateWorkspace(candidateWorkspaceRelPath, artifactPath);
  }

  public workspaceFileExists(relativePath: string): boolean {
    const pathRes = resolveWorkspacePath(this.workspaceRoot, relativePath);
    if (!pathRes.ok) return false;
    return existsSync(pathRes.canonicalPath || pathRes.absolutePath);
  }

  public safeWriteWorkspaceFile(
    relativePath: string,
    content: string,
    missionId: string,
    workPackageId?: string,
    executionId?: string
  ): { readonly success: boolean; readonly artifact?: ArtifactIdentity; readonly reasonCode: string } {
    let resolvedTarget = relativePath;
    let targetAbsolutePath = relativePath;

    if (!this.securityGateSeam.bypassPathContainment) {
      const pathRes = resolveWorkspacePath(this.workspaceRoot, relativePath);
      if (!pathRes.ok) {
        this.receiptLog.create({
          summary: "KERNEL_FILE_WRITE: FORBIDDEN",
          status: "blocked",
          details: { relativePath, reason: pathRes.reasonCode },
        });
        const code = pathRes.reasonCode.startsWith("SYMLINK") ? "SYMLINK_ESCAPE_REFUSED" : "PATH_TRAVERSAL_REFUSED";
        return { success: false, reasonCode: code };
      }
      resolvedTarget = pathRes.normalizedRelativePath;
      targetAbsolutePath = pathRes.absolutePath;
    }

    if (!this.securityGateSeam.bypassSecretDetection && looksLikeSecret(content)) {
      this.receiptLog.create({
        summary: "KERNEL_FILE_WRITE: FORBIDDEN",
        status: "blocked",
        details: { relativePath: resolvedTarget, reason: "Secret detected in content" },
      });
      return { success: false, reasonCode: "SECRET_CONTENT_REFUSED" };
    }

    const dir = dirname(targetAbsolutePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(targetAbsolutePath, content, "utf8");

    // TOCTOU Write Revalidation (P0-B8): Re-read file from disk & verify hash identity
    const verifyRead = this.safeReadWorkspaceFile(resolvedTarget);
    if (!verifyRead.success || verifyRead.content === undefined) {
      return { success: false, reasonCode: "WRITE_VERIFICATION_FAILED: File unreadable after write" };
    }

    const sha256 = createHash("sha256").update(Buffer.from(verifyRead.content, "utf8")).digest("hex");
    const sizeBytes = Buffer.byteLength(verifyRead.content, "utf8");

    const artifact: ArtifactIdentity = {
      artifactId: `art-${createHash("sha256").update(`${resolvedTarget}:${sha256}`).digest("hex").slice(0, 12)}`,
      path: resolvedTarget,
      sha256,
      sizeBytes,
      missionId,
      workPackageId,
      executionId,
    };

    this.receiptLog.create({
      summary: "KERNEL_FILE_WRITE: APPROVED",
      status: "approved",
      details: { relativePath: resolvedTarget, sha256, sizeBytes },
    });

    return { success: true, artifact, reasonCode: "OK" };
  }

  public safeReadWorkspaceFile(relativePath: string): { readonly success: boolean; readonly content?: string; readonly reasonCode: string } {
    let targetAbsolutePath = relativePath;

    if (!this.securityGateSeam.bypassPathContainment) {
      const pathRes = resolveWorkspacePath(this.workspaceRoot, relativePath);
      if (!pathRes.ok) {
        const code = pathRes.reasonCode.startsWith("SYMLINK") ? "SYMLINK_ESCAPE_REFUSED" : "PATH_TRAVERSAL_REFUSED";
        return { success: false, reasonCode: code };
      }
      targetAbsolutePath = pathRes.canonicalPath || pathRes.absolutePath;
    }

    if (!existsSync(targetAbsolutePath)) {
      return { success: false, reasonCode: "FILE_NOT_FOUND" };
    }

    const content = readFileSync(targetAbsolutePath, "utf8");
    return { success: true, content, reasonCode: "OK" };
  }

  public resolveExecutable(id: TrustedExecutableId) {
    return resolveTrustedExecutable(id, { workspaceRoots: [this.workspaceRoot] });
  }

  /**
   * Execute an allowlisted command safely through the Trusted Kernel (P0.2).
   */
  public executeCommand(
    executableId: TrustedExecutableId,
    args: readonly string[],
    missionId: string,
    stageId: string,
    subDirRelative?: string,
    timeoutMs = 15000
  ): CommandExecutionResult {
    const rawCmd = `${executableId} ${args.join(" ")}`;
    if (!this.securityGateSeam.bypassCommandSafety && isForbiddenCommand(rawCmd)) {
      this.receiptLog.create({
        summary: "EXECUTE_COMMAND: FORBIDDEN",
        status: "blocked",
        details: { command: rawCmd, reason: "Forbidden command policy match" },
      });
      return {
        success: false,
        exitCode: null,
        stdout: "",
        stderr: "Forbidden command policy match",
        reasonCode: "FORBIDDEN_COMMAND_REFUSED",
      };
    }

    const resolved = this.resolveExecutable(executableId);
    if (!resolved.ok || !resolved.value.executionAuthorized) {
      this.receiptLog.create({
        summary: "EXECUTE_COMMAND: UNAUTHORIZED",
        status: "blocked",
        details: { executableId, reason: resolved.ok ? resolved.value.authorizationReason : resolved.reasonCode },
      });
      return {
        success: false,
        exitCode: null,
        stdout: "",
        stderr: "Executable resolution or authorization failed",
        reasonCode: "EXECUTABLE_UNAUTHORIZED",
      };
    }

    let targetCwd = this.workspaceRoot;
    if (subDirRelative) {
      const cwdRes = resolveWorkspacePath(this.workspaceRoot, subDirRelative);
      if (!cwdRes.ok) {
        const code = cwdRes.reasonCode.startsWith("SYMLINK") ? "SYMLINK_ESCAPE_REFUSED" : "PATH_TRAVERSAL_REFUSED";
        return {
          success: false,
          exitCode: null,
          stdout: "",
          stderr: `Target working directory invalid: ${cwdRes.reasonCode}`,
          reasonCode: code,
        };
      }
      targetCwd = cwdRes.canonicalPath || cwdRes.absolutePath;
    }

    const outcome = spawnSync(resolved.value.command, [...resolved.value.prefixArgs, ...args], {
      shell: false,
      cwd: targetCwd,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      env: buildSafeChildEnv(),
      encoding: "utf8",
    });

    const stdout = outcome.stdout ?? "";
    const stderr = outcome.stderr ?? "";
    const exitCode = outcome.status;
    const success = exitCode === 0;

    const evidenceRecord = this.emitCommandExecutionEvidence(
      missionId,
      stageId,
      executableId,
      args,
      exitCode,
      success,
      stdout.slice(0, 500),
      stderr.slice(0, 500)
    );

    this.receiptLog.create({
      summary: `EXECUTE_COMMAND: ${success ? "SUCCESS" : "FAILED"}`,
      status: success ? "approved" : "failed",
      details: { executableId, args, exitCode },
    });

    return {
      success,
      exitCode,
      stdout,
      stderr,
      reasonCode: success ? "OK" : `COMMAND_FAILED_EXIT_${exitCode}`,
      evidenceRecord,
    };
  }

  /**
   * Dedicated executeDockerBuild method (P0-D2, P0-D3, P0-D4, P0-D5).
   * Tight authority boundary for Docker build execution.
   */
  public executeDockerBuild(
    subDirRelative: string,
    missionId: string,
    stageId: string,
    tag?: string,
    timeoutMs = 45000
  ): CommandExecutionResult {
    const cwdRes = resolveWorkspacePath(this.workspaceRoot, subDirRelative);
    if (!cwdRes.ok) {
      const code = cwdRes.reasonCode.startsWith("SYMLINK") ? "SYMLINK_ESCAPE_REFUSED" : "PATH_TRAVERSAL_REFUSED";
      return {
        success: false,
        exitCode: null,
        stdout: "",
        stderr: `Target working directory invalid: ${cwdRes.reasonCode}`,
        reasonCode: code,
      };
    }

    const candCheck = this.isInsideCandidateWorkspace(subDirRelative, "Dockerfile");
    if (!candCheck.ok) {
      return {
        success: false,
        exitCode: null,
        stdout: "",
        stderr: `Candidate boundary check failed: Dockerfile escapes candidate workspace ${subDirRelative}`,
        reasonCode: "CANDIDATE_BOUNDARY_ESCAPE",
      };
    }

    const fullDockerfileRelPath = `${subDirRelative}/Dockerfile`;
    if (!this.workspaceFileExists(fullDockerfileRelPath)) {
      return {
        success: false,
        exitCode: null,
        stdout: "",
        stderr: `Dockerfile absent in candidate workspace ${subDirRelative}`,
        reasonCode: "DOCKERFILE_ABSENT",
      };
    }

    const imageTag = tag ?? `test-${missionId}`;
    const args = ["build", "-t", imageTag, "."];

    return this.executeCommand("docker", args, missionId, stageId, subDirRelative, timeoutMs);
  }

  /**
   * Private internal method to emit authentic TRUSTED_KERNEL_COMMAND receipts (P0-RA1).
   * Unforgeable through public emitEvidence API.
   */
  private emitCommandExecutionEvidence(
    missionId: string,
    stageId: string,
    executableId: string,
    args: readonly string[],
    exitCode: number | null,
    success: boolean,
    stdoutSnippet: string,
    stderrSnippet: string
  ): EvidenceRecord {
    return this.createInternalEvidenceRecord(
      "TRUSTED_KERNEL_COMMAND",
      missionId,
      stageId,
      {
        executableId,
        args,
        exitCode,
        success,
        stdoutSnippet,
        stderrSnippet,
      },
      undefined,
      undefined,
      undefined,
      "TRACEABILITY"
    );
  }


  /**
   * Single authoritative entry point to run ProMax verification with an unforgeable verifier permit token (P0-RA1).
   * Instantiates and owns the canonical ProMaxVerifier internally.
   * Caller-supplied verifiers or subclass overrides are strictly NOT accepted (Fix 1 & Fix 5).
   */
  public runProMaxVerification<TCandidate extends IntegratedCandidate, TContext extends StageContextBase>(
    candidate: TCandidate,
    context: TContext,
    evidencePool: readonly EvidenceRecord[] = []
  ): import("../promax/proMaxVerifier").ProMaxResult {
    const { ProMaxVerifier, computeCandidateSnapshotHash } = require("../promax/proMaxVerifier");
    const canonicalVerifier = new ProMaxVerifier();

    const candidateSnapshotHash = computeCandidateSnapshotHash(candidate.integratedArtifacts);
    const sessionId = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const permit = new TrustedVerifierPermit(context.missionId, candidateSnapshotHash, sessionId);

    this.activeVerifierPermits.add(permit);
    try {
      return canonicalVerifier.verifyCandidate(candidate, context, this, permit, evidencePool);
    } finally {
      this.activeVerifierPermits.delete(permit);
    }
  }

  private validateVerifierPermit(
    permit: TrustedVerifierPermit,
    expectedMissionId: string,
    expectedSnapshotHash?: string
  ): void {
    if (!permit || !this.activeVerifierPermits.has(permit)) {
      this.receiptLog.create({
        summary: "EMIT_QUALIFICATION_PROOF: FORBIDDEN",
        status: "blocked",
        details: { reason: "Invalid, expired, or missing TrustedVerifierPermit token" },
      });
      throw new Error("UNAUTHORIZED_VERIFIER_PERMIT: Privileged evidence emission requires an active, kernel-minted TrustedVerifierPermit token");
    }

    if (permit.missionId !== expectedMissionId) {
      this.receiptLog.create({
        summary: "EMIT_QUALIFICATION_PROOF: MISSION_MISMATCH",
        status: "blocked",
        details: { permitMissionId: permit.missionId, expectedMissionId },
      });
      throw new Error(`PERMIT_MISSION_MISMATCH: Permit missionId (${permit.missionId}) does not match context missionId (${expectedMissionId})`);
    }

    if (expectedSnapshotHash && permit.candidateSnapshotHash !== expectedSnapshotHash) {
      this.receiptLog.create({
        summary: "EMIT_QUALIFICATION_PROOF: SNAPSHOT_MISMATCH",
        status: "blocked",
        details: { permitSnapshotHash: permit.candidateSnapshotHash, expectedSnapshotHash },
      });
      throw new Error("PERMIT_SNAPSHOT_MISMATCH: Permit candidateSnapshotHash does not match context candidateSnapshotHash");
    }
  }

  /**
   * Narrow typed method for TEST_SUITE_VERIFIER qualification proof emission (P0-RA1).
   */
  public emitTestQualificationProof(
    permit: TrustedVerifierPermit,
    missionId: string,
    stageId: string,
    details: Record<string, unknown>
  ): EvidenceRecord {
    this.validateVerifierPermit(permit, missionId, typeof details.candidateSnapshotHash === "string" ? details.candidateSnapshotHash : undefined);
    return this.createInternalEvidenceRecord("TEST_SUITE_VERIFIER", missionId, stageId, details, undefined, undefined, undefined, "QUALIFICATION_PROOF");
  }

  /**
   * Narrow typed method for BUILD_VERIFIER qualification proof emission (P0-RA1).
   */
  public emitBuildQualificationProof(
    permit: TrustedVerifierPermit,
    missionId: string,
    stageId: string,
    details: Record<string, unknown>
  ): EvidenceRecord {
    this.validateVerifierPermit(permit, missionId, typeof details.candidateSnapshotHash === "string" ? details.candidateSnapshotHash : undefined);
    return this.createInternalEvidenceRecord("BUILD_VERIFIER", missionId, stageId, details, undefined, undefined, undefined, "QUALIFICATION_PROOF");
  }

  /**
   * Narrow typed method for TYPECHECK_VERIFIER qualification proof emission (P0-RA1).
   */
  public emitTypecheckQualificationProof(
    permit: TrustedVerifierPermit,
    missionId: string,
    stageId: string,
    details: Record<string, unknown>
  ): EvidenceRecord {
    this.validateVerifierPermit(permit, missionId, typeof details.candidateSnapshotHash === "string" ? details.candidateSnapshotHash : undefined);
    return this.createInternalEvidenceRecord("TYPECHECK_VERIFIER", missionId, stageId, details, undefined, undefined, undefined, "QUALIFICATION_PROOF");
  }

  /**
   * Narrow typed method for SMOKE verifiers qualification proof emission (P0-RA1).
   */
  public emitSmokeQualificationProof(
    permit: TrustedVerifierPermit,
    verifierName: string,
    missionId: string,
    stageId: string,
    details: Record<string, unknown>
  ): EvidenceRecord {
    this.validateVerifierPermit(permit, missionId, typeof details.candidateSnapshotHash === "string" ? details.candidateSnapshotHash : undefined);
    const AUTHORIZED_SMOKE_VERIFIERS = new Set([
      "SMOKE_VERIFIER",
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
    ]);
    if (!AUTHORIZED_SMOKE_VERIFIERS.has(verifierName)) {
      throw new Error(`UNAUTHORIZED_SMOKE_VERIFIER: ${verifierName} is not an authorized smoke verifier producer`);
    }
    return this.createInternalEvidenceRecord(verifierName, missionId, stageId, details, undefined, undefined, undefined, "QUALIFICATION_PROOF");
  }

  /**
   * Narrow typed method for DISTINCT_CONTRACT_INTEGRATION_VERIFIER qualification proof emission (P0-RA1).
   */
  public emitIntegrationQualificationProof(
    permit: TrustedVerifierPermit,
    missionId: string,
    stageId: string,
    details: Record<string, unknown>
  ): EvidenceRecord {
    this.validateVerifierPermit(permit, missionId, typeof details.candidateSnapshotHash === "string" ? details.candidateSnapshotHash : undefined);
    return this.createInternalEvidenceRecord("DISTINCT_CONTRACT_INTEGRATION_VERIFIER", missionId, stageId, details, undefined, undefined, undefined, "QUALIFICATION_PROOF");
  }

  /**
   * Narrow typed method for DOCKER_BUILD_VERIFIER qualification proof emission (P0-RA1).
   */
  public emitDockerQualificationProof(
    permit: TrustedVerifierPermit,
    missionId: string,
    stageId: string,
    details: Record<string, unknown>
  ): EvidenceRecord {
    this.validateVerifierPermit(permit, missionId, typeof details.candidateSnapshotHash === "string" ? details.candidateSnapshotHash : undefined);
    return this.createInternalEvidenceRecord("DOCKER_BUILD_VERIFIER", missionId, stageId, details, undefined, undefined, undefined, "QUALIFICATION_PROOF");
  }

  /**
   * Dedicated method for SECURITY_VERIFIER to emit unforgeable QUALIFICATION_PROOF evidence.
   */
  public emitSecurityQualificationProof(
    permit: TrustedVerifierPermit,
    missionId: string,
    stageId: string,
    details: Record<string, unknown>
  ): EvidenceRecord {
    this.validateVerifierPermit(permit, missionId, typeof details.candidateSnapshotHash === "string" ? details.candidateSnapshotHash : undefined);
    return this.createInternalEvidenceRecord("SECURITY_VERIFIER", missionId, stageId, details, undefined, undefined, undefined, "QUALIFICATION_PROOF");
  }

  /**
   * Dedicated method for ProMax artifact check evidence emission requiring valid TrustedVerifierPermit token (P0-RA1).
   */
  public emitArtifactCheckEvidence(
    permit: TrustedVerifierPermit,
    missionId: string,
    stageId: string,
    details: Record<string, unknown>,
    artifactIdentity?: ArtifactIdentity
  ): EvidenceRecord {
    this.validateVerifierPermit(permit, missionId, typeof details.candidateSnapshotHash === "string" ? details.candidateSnapshotHash : undefined);
    return this.createInternalEvidenceRecord(
      "PROMAX_ARTIFACT_CHECK",
      missionId,
      stageId,
      details,
      artifactIdentity,
      undefined,
      undefined,
      "TRACEABILITY"
    );
  }

  /**
   * Dedicated method for ProMax artifact substitution detection requiring valid TrustedVerifierPermit token (P0-RA1).
   */
  public emitArtifactSubstitutionEvidence(
    permit: TrustedVerifierPermit,
    missionId: string,
    stageId: string,
    details: Record<string, unknown>,
    artifactIdentity?: ArtifactIdentity
  ): EvidenceRecord {
    this.validateVerifierPermit(permit, missionId, typeof details.candidateSnapshotHash === "string" ? details.candidateSnapshotHash : undefined);
    return this.createInternalEvidenceRecord(
      "PROMAX_ARTIFACT_SUBSTITUTION_DETECTED",
      missionId,
      stageId,
      details,
      artifactIdentity,
      undefined,
      undefined,
      "TRACEABILITY"
    );
  }

  /**
   * Dedicated method for ProMax contract-wide assessment receipts requiring valid TrustedVerifierPermit token (P0-RA1).
   */
  public emitProMaxAssessmentReceipt(
    permit: TrustedVerifierPermit,
    missionId: string,
    stageId: string,
    details: Record<string, unknown>
  ): EvidenceRecord {
    this.validateVerifierPermit(permit, missionId, typeof details.candidateSnapshotHash === "string" ? details.candidateSnapshotHash : undefined);
    return this.createInternalEvidenceRecord(
      "PROMAX_ASSESSMENT_RECEIPT",
      missionId,
      stageId,
      details,
      undefined,
      undefined,
      undefined,
      "QUALIFICATION_PROOF"
    );
  }

  /**
   * Private internal kernel evidence emission for trusted system processes.
   */
  private emitInternalEvidence(
    producer: string,
    missionId: string,
    stageId: string,
    details: Record<string, unknown>,
    artifactIdentity?: ArtifactIdentity,
    workPackageId?: string,
    executionId?: string,
    explicitProofKind?: ProofKind
  ): EvidenceRecord {
    return this.createInternalEvidenceRecord(
      producer,
      missionId,
      stageId,
      details,
      artifactIdentity,
      workPackageId,
      executionId,
      explicitProofKind ?? "QUALIFICATION_PROOF"
    );
  }

  public emitEvidence(
    producer: string,
    missionId: string,
    stageId: string,
    details: Record<string, unknown>,
    artifactIdentity?: ArtifactIdentity,
    workPackageId?: string,
    executionId?: string,
    explicitProofKind?: ProofKind
  ): EvidenceRecord {
    // P0-RA1 & P0-RA2: PUBLIC API MUST NOT PERMIT RESERVED PRODUCER IMPERSONATION
    if (KERNEL_RESERVED_PRODUCERS.has(producer)) {
      this.receiptLog.create({
        summary: "EMIT_EVIDENCE: BLOCKED",
        status: "blocked",
        details: { producer, reason: "Public emitEvidence cannot mint reserved producer string" },
      });
      throw new Error(`FORBIDDEN_RESERVED_PRODUCER: Public emitEvidence API cannot mint kernel-reserved producer "${producer}"`);
    }

    // PUBLIC API STRICTLY CANNOT MINT QUALIFICATION_PROOF UNDER ANY PRODUCER NAME.
    // QUALIFICATION_PROOF can only be minted via dedicated internal methods:
    // emitVerifierQualificationProof, emitSecurityQualificationProof, or emitProMaxAssessmentReceipt.
    let effectiveProofKind: ProofKind = explicitProofKind ?? (typeof details.proofKind === "string" ? (details.proofKind as ProofKind) : "TRACEABILITY");

    if (effectiveProofKind === "QUALIFICATION_PROOF") {
      this.receiptLog.create({
        summary: "EMIT_EVIDENCE: PROOF_KIND_DOWNGRADED",
        status: "blocked",
        details: { producer, reason: "Public emitEvidence API cannot mint QUALIFICATION_PROOF" },
      });
      if (producer === "COLONY_A" || producer === "COLONY_B" || producer === "COLONY_AB") {
        effectiveProofKind = "CLAIM";
      } else {
        effectiveProofKind = "TRACEABILITY";
      }
    }

    return this.createInternalEvidenceRecord(
      producer,
      missionId,
      stageId,
      details,
      artifactIdentity,
      workPackageId,
      executionId,
      effectiveProofKind
    );
  }

  private createInternalEvidenceRecord(
    producer: string,
    missionId: string,
    stageId: string,
    details: Record<string, unknown>,
    artifactIdentity?: ArtifactIdentity,
    workPackageId?: string,
    executionId?: string,
    proofKind: ProofKind = "TRACEABILITY"
  ): EvidenceRecord {
    this.evidenceCounter += 1;
    const sequenceNumber = Date.now() + this.evidenceCounter;
    const envIdentity: EnvironmentIdentity = {
      platform: process.platform,
      nodeVersion: process.version,
      cwd: process.cwd(),
      envFingerprint: createHash("sha256").update(`${process.platform}:${process.version}`).digest("hex"),
    };

    const evidenceId = `ev-${createHash("sha256").update(`${producer}:${missionId}:${stageId}:${sequenceNumber}:${this.evidenceCounter}`).digest("hex").slice(0, 12)}`;
    const recordContent = JSON.stringify({ evidenceId, producer, missionId, stageId, proofKind, details, artifactIdentity, sequenceNumber });
    const hash = createHash("sha256").update(recordContent).digest("hex");

    const record: EvidenceRecord = {
      evidenceId,
      producer,
      missionId,
      stageId,
      workPackageId,
      executionId,
      proofKind,
      artifactIdentity,
      environmentIdentity: envIdentity,
      timestamp: sequenceNumber,
      sequenceNumber,
      status: "VALID",
      details: { ...details, proofKind },
      hash,
    };

    this.receiptLog.create({
      summary: "EMIT_EVIDENCE: APPROVED",
      status: "approved",
      details: { evidenceId, producer, stageId, proofKind, hash },
    });

    return record;
  }
}
