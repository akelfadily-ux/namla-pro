/**
 * Trusted Kernel Implementation (§08).
 *
 * Single authoritative effect and trust boundary for NAMLA PRO V2.
 * Enforces EffectiveAuthority = HardSecurityPolicy ∩ Authorization ∩ Permit ∩ Scope ∩ Budget ∩ Environment.
 */

import { SafetyGuard } from "../../core/safetyGuard";
import { ReceiptLog } from "../../core/receiptLog";
import { isInsideProjectRoot } from "../../policies/fileBoundaryPolicy";
import { looksLikeSecret } from "../../policies/secretProtectionPolicy";
import { isForbiddenCommand } from "../../policies/commandSafetyPolicy";
import { resolveTrustedExecutable, TrustedExecutableId } from "../../cognitive/trustedExecutableRegistry";
import { buildSafeChildEnv } from "../../cognitive/safeProviderRequest";
import { CapabilityScope, PlanContract } from "../types/contracts";
import { ArtifactIdentity, EnvironmentIdentity, EvidenceRecord } from "../types/evidence";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, join, dirname, isAbsolute } from "path";
import { createHash } from "crypto";
import { spawnSync } from "child_process";

export interface TrustedKernelOptions {
  readonly workspaceRoot: string;
  readonly humanAuthorizationGranted?: boolean;
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

export class TrustedKernel {
  private readonly safetyGuard: SafetyGuard;
  private readonly receiptLog: ReceiptLog;
  private readonly workspaceRoot: string;
  private readonly humanAuthorizationGranted: boolean;

  constructor(options: TrustedKernelOptions) {
    this.workspaceRoot = resolve(options.workspaceRoot);
    this.humanAuthorizationGranted = options.humanAuthorizationGranted ?? true;
    this.safetyGuard = new SafetyGuard();
    this.receiptLog = new ReceiptLog();
  }

  public getReceiptLog(): ReceiptLog {
    return this.receiptLog;
  }

  public evaluateEffectiveAuthority(
    capability: CapabilityScope,
    contract: PlanContract | undefined,
    budgetRemaining: number
  ): EffectiveAuthorityResult {
    const allowed = isInsideProjectRoot(capability.target, this.workspaceRoot);
    if (!allowed) {
      return { authorized: false, reasonCode: "HARD_POLICY_VIOLATION: Target outside workspace root" };
    }

    if (looksLikeSecret(capability.target)) {
      return { authorized: false, reasonCode: "HARD_POLICY_VIOLATION: Secret pattern detected in target path" };
    }

    if (!this.humanAuthorizationGranted) {
      return { authorized: false, reasonCode: "AUTHORIZATION_REFUSED: Human/BuildLaw authorization required" };
    }

    if (contract) {
      const scopeMatch = contract.allowedCapabilities.some(
        (allowedScope) =>
          allowedScope.capability === capability.capability &&
          (allowedScope.target === "*" || capability.target.startsWith(allowedScope.target)) &&
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

  public safeWriteWorkspaceFile(
    relativePath: string,
    content: string,
    missionId: string,
    workPackageId?: string,
    executionId?: string
  ): { readonly success: boolean; readonly artifact?: ArtifactIdentity; readonly reasonCode: string } {
    if (isAbsolute(relativePath) || relativePath.includes(":") || relativePath.includes("%")) {
      this.receiptLog.create({
        summary: "KERNEL_FILE_WRITE: FORBIDDEN",
        status: "blocked",
        details: { relativePath, reason: "Absolute or environment-expanded path forbidden" },
      });
      return { success: false, reasonCode: "PATH_TRAVERSAL_REFUSED" };
    }

    const absolutePath = resolve(join(this.workspaceRoot, relativePath));
    if (!absolutePath.startsWith(this.workspaceRoot)) {
      this.receiptLog.create({
        summary: "KERNEL_FILE_WRITE: FORBIDDEN",
        status: "blocked",
        details: { relativePath, reason: "Path traversal out of workspace" },
      });
      return { success: false, reasonCode: "PATH_TRAVERSAL_REFUSED" };
    }

    if (looksLikeSecret(content)) {
      this.receiptLog.create({
        summary: "KERNEL_FILE_WRITE: FORBIDDEN",
        status: "blocked",
        details: { relativePath, reason: "Secret detected in content" },
      });
      return { success: false, reasonCode: "SECRET_CONTENT_REFUSED" };
    }

    const dir = dirname(absolutePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(absolutePath, content, "utf8");

    const sha256 = createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex");
    const sizeBytes = Buffer.byteLength(content, "utf8");

    const artifact: ArtifactIdentity = {
      artifactId: `art-${createHash("sha256").update(`${relativePath}:${sha256}`).digest("hex").slice(0, 12)}`,
      path: relativePath,
      sha256,
      sizeBytes,
      missionId,
      workPackageId,
      executionId,
    };

    this.receiptLog.create({
      summary: "KERNEL_FILE_WRITE: APPROVED",
      status: "approved",
      details: { relativePath, sha256, sizeBytes },
    });

    return { success: true, artifact, reasonCode: "OK" };
  }

  public safeReadWorkspaceFile(relativePath: string): { readonly success: boolean; readonly content?: string; readonly reasonCode: string } {
    if (isAbsolute(relativePath) || relativePath.includes(":") || relativePath.includes("%")) {
      return { success: false, reasonCode: "PATH_TRAVERSAL_REFUSED" };
    }

    const absolutePath = resolve(join(this.workspaceRoot, relativePath));
    if (!absolutePath.startsWith(this.workspaceRoot)) {
      return { success: false, reasonCode: "PATH_TRAVERSAL_REFUSED" };
    }

    if (!existsSync(absolutePath)) {
      return { success: false, reasonCode: "FILE_NOT_FOUND" };
    }

    const content = readFileSync(absolutePath, "utf8");
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
    if (isForbiddenCommand(rawCmd)) {
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

    const targetCwd = subDirRelative
      ? resolve(join(this.workspaceRoot, subDirRelative))
      : this.workspaceRoot;

    if (!targetCwd.startsWith(this.workspaceRoot)) {
      return {
        success: false,
        exitCode: null,
        stdout: "",
        stderr: "Target working directory outside workspace root",
        reasonCode: "PATH_TRAVERSAL_REFUSED",
      };
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

    const evidenceRecord = this.emitEvidence(
      "TRUSTED_KERNEL_COMMAND",
      missionId,
      stageId,
      {
        executableId,
        args,
        exitCode,
        success,
        stdoutSnippet: stdout.slice(0, 500),
        stderrSnippet: stderr.slice(0, 500),
      }
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

  public emitEvidence(
    producer: string,
    missionId: string,
    stageId: string,
    details: Record<string, unknown>,
    artifactIdentity?: ArtifactIdentity,
    workPackageId?: string,
    executionId?: string
  ): EvidenceRecord {
    const sequenceNumber = Date.now();
    const envIdentity: EnvironmentIdentity = {
      platform: process.platform,
      nodeVersion: process.version,
      cwd: process.cwd(),
      envFingerprint: createHash("sha256").update(`${process.platform}:${process.version}`).digest("hex"),
    };

    const evidenceId = `ev-${createHash("sha256").update(`${producer}:${missionId}:${stageId}:${sequenceNumber}`).digest("hex").slice(0, 12)}`;
    const recordContent = JSON.stringify({ evidenceId, producer, missionId, stageId, details, artifactIdentity, sequenceNumber });
    const hash = createHash("sha256").update(recordContent).digest("hex");

    const record: EvidenceRecord = {
      evidenceId,
      producer,
      missionId,
      stageId,
      workPackageId,
      executionId,
      artifactIdentity,
      environmentIdentity: envIdentity,
      timestamp: sequenceNumber,
      sequenceNumber,
      status: "VALID",
      details,
      hash,
    };

    this.receiptLog.create({
      summary: "EMIT_EVIDENCE: APPROVED",
      status: "approved",
      details: { evidenceId, producer, stageId, hash },
    });

    return record;
  }
}
