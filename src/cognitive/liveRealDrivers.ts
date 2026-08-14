/**
 * liveRealDrivers — the REAL workspace + verification drivers for the human live
 * objective (Build Law §26). Both delegate to the already-authorized boundaries:
 * the real-fs writes go through `smokeWorkspace` (one of exactly two fs-mutation
 * modules), and the real verification spawn goes through
 * `nodeProviderProcessDriver` (the one `child_process` importer). This module
 * therefore adds NO new fs or child_process importer.
 *
 * Neither driver is imported by any automated demo/test — automated verification
 * uses the in-memory workspace + fake verification driver, so `realFilesystemWrites`
 * and real verification spawns stay 0 there.
 */

import { ensureLiveObjectiveWorkspace, writeLiveObjectiveFile } from "./smokeWorkspace";
import type { SmokeWorkspaceResult } from "./smokeWorkspace";
import { runVerificationCommand } from "./nodeProviderProcessDriver";
import type { VerificationSandboxExecutor } from "./verificationSandbox";
import type { VerificationCommandId } from "./nodeProviderProcessDriver";
import type { VerificationDriver, VerificationOutcome } from "../digital/digitalVerification";
import type { LiveWorkspaceApplier } from "../digital/liveObjectiveRunner";

function fnv(content: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < content.length; i += 1) {
    h ^= content.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `fp-${h.toString(16).padStart(8, "0")}-${content.length}`;
}

export interface LiveWorkspaceReceipt {
  readonly relPath: string;
  readonly beforeFingerprint: string | null;
  readonly afterFingerprint: string;
  readonly bytes: number;
}

/**
 * The real-fs live workspace driver. It creates the objective workspace under an
 * isolated `workspaces/<base>/<objective-id>/` root (default
 * `digital-live-objective`; the civilization live path passes `namla-civilization`
 * with its own allowlisted `ensureCivilizationWorkspace`) and applies reviewed
 * files through the bounded `writeLiveObjectiveFile` boundary. It satisfies the
 * runner's `LiveWorkspaceApplier` contract and records real writes + receipts.
 */
export class RealLiveWorkspaceDriver implements LiveWorkspaceApplier {
  private writes = 0;
  private violations = 0;
  private readonly files = new Map<string, string>();
  private readonly receipts: LiveWorkspaceReceipt[] = [];
  private readonly handleAbsolutePath: string | null;
  readonly ready: boolean;

  constructor(
    readonly objectiveId: string,
    private readonly perFileByteCap = 20000,
    private readonly maxFiles = 24,
    private readonly baseDir = "workspaces/digital-live-objective",
    ensureWorkspace: (workspaceId: string) => SmokeWorkspaceResult = ensureLiveObjectiveWorkspace
  ) {
    const ensured = ensureWorkspace(`${baseDir}/${objectiveId}`);
    this.ready = ensured.ok;
    this.handleAbsolutePath = ensured.ok ? ensured.handle.absolutePath : null;
  }

  get workspaceRoot(): string {
    return `${this.baseDir}/${this.objectiveId}/`;
  }
  get absolutePath(): string | null {
    return this.handleAbsolutePath;
  }
  get fileCount(): number {
    return this.files.size;
  }
  get workspaceBoundaryViolations(): number {
    return this.violations;
  }
  get realFilesystemWrites(): number {
    return this.writes;
  }
  get allReceipts(): readonly LiveWorkspaceReceipt[] {
    return this.receipts;
  }

  applyArtifact(relPath: string, content: string, attr: { objectiveId: string; taskId: string; antId: string }): { readonly ok: boolean } {
    if (!this.ready || !this.handleAbsolutePath) {
      this.violations += 1;
      return { ok: false };
    }
    if (attr.objectiveId !== this.objectiveId) {
      this.violations += 1;
      return { ok: false };
    }
    if (!this.files.has(relPath) && this.files.size >= this.maxFiles) {
      this.violations += 1;
      return { ok: false };
    }
    const before = this.files.has(relPath) ? fnv(this.files.get(relPath) as string) : null;
    const result = writeLiveObjectiveFile({ workspaceId: this.workspaceRoot, absolutePath: this.handleAbsolutePath }, relPath, content, this.perFileByteCap);
    if (!result.ok) {
      this.violations += 1;
      return { ok: false };
    }
    this.files.set(relPath, content);
    this.writes += 1;
    this.receipts.push({ relPath, beforeFingerprint: before, afterFingerprint: fnv(content), bytes: content.length });
    return { ok: true };
  }
}

/**
 * The real, human-only verification driver. It runs an allowlisted command as a
 * bounded real process (via the one `child_process` module) with cwd exactly the
 * objective workspace. It refuses any command not in the human-approved list.
 */
export class RealBackedVerificationDriver implements VerificationDriver {
  readonly kind = "real-live" as const;
  private execs = 0;

  /**
   * §35: `humanAuthorized` and `sandbox` are supplied by the trusted CLI
   * composition root, which has already acquired the typed human confirmation
   * and composed (or failed to compose) a verified sandbox. Neither is invented
   * here — a leaf driver that authorized itself would defeat the gate — and
   * `sandbox: null` means verification is unavailable, never that it may run on
   * the host.
   */
  constructor(
    private readonly workspaceAbsolutePath: string,
    private readonly allowedCommands: readonly VerificationCommandId[],
    private readonly timeoutMs = 120000,
    private readonly maxOutputBytes = 65536,
    private readonly humanAuthorized = false,
    private readonly sandbox: VerificationSandboxExecutor | null = null,
  ) {}

  get realVerificationExecutions(): number {
    return this.execs;
  }

  run(commandId: string, _workspaceRoot: string, _defectPresent: boolean): VerificationOutcome {
    void _workspaceRoot;
    void _defectPresent;
    const id = commandId as VerificationCommandId;
    if (!this.allowedCommands.includes(id)) {
      return { commandId, status: "failed", failureCategory: "invalid-path", outputLineCount: 0, realProcessExecutions: 0, realNetworkCalls: 0 };
    }
    const result = runVerificationCommand({ commandId: id, workingDirectoryAbsolute: this.workspaceAbsolutePath, timeoutMs: this.timeoutMs, maxOutputBytes: this.maxOutputBytes, humanAuthorized: this.humanAuthorized, sandbox: this.sandbox });
    if (result.ran) this.execs += 1;
    return {
      commandId,
      status: result.status,
      failureCategory: result.status === "passed" ? null : "type-error",
      outputLineCount: result.outputLineCount,
      realProcessExecutions: result.ran ? 1 : 0,
      realNetworkCalls: 0,
    };
  }
}
