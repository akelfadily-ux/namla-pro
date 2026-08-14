/**
 * MissionWorkspace: a bounded, isolated area under `workspaces/<mission-id>/`.
 * Every operation is PROPOSED (recorded as data) before it is ever applied —
 * the same propose-then-apply discipline the C0-C2 capability stack already
 * uses for project files. No access outside the mission's own root, no
 * access to Namla source, no secret-shaped filename, ever.
 *
 * Reuses `isSecretLikeFilename` (src/inspector/fileClassifier.ts) — the
 * same strict content-read gate the inspector uses — so ".env", "secret",
 * "token", "credential", "password", "apikey", certificate, and SSH-shaped
 * names are refused here too, not a second, drifted copy of that list.
 */

import { randomUUID } from "crypto";
import { createHash } from "crypto";
import { isSecretLikeFilename } from "../inspector/fileClassifier";
import type {
  AppliedFileOperation,
  ProposedFileOperation,
  WorkspaceBoundaryViolation,
  WorkspaceDriver,
} from "./missionWorkspaceTypes";
import { ReceiptLog } from "../core/receiptLog";

function fingerprint(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

export type WorkspaceBoundaryReasonCode =
  | "empty-path"
  | "absolute-path"
  | "path-traversal"
  | "outside-mission-root"
  | "targets-namla-source"
  | "protected-name-segment"
  | "content-too-large";

export const MAX_MISSION_FILE_BYTES = 200000 as const;

export function checkWorkspaceBoundary(
  missionId: string,
  targetRelativePath: string,
  contentByteLength: number
): { ok: true } | { ok: false; reasonCode: WorkspaceBoundaryReasonCode } {
  const path = targetRelativePath.replace(/\\/g, "/");
  if (path.trim().length === 0) return { ok: false, reasonCode: "empty-path" };
  if (/^([A-Za-z]:|\/)/.test(path)) return { ok: false, reasonCode: "absolute-path" };
  if (path.split("/").some((segment) => segment === "..")) return { ok: false, reasonCode: "path-traversal" };

  const missionRoot = `workspaces/${missionId}/`;
  if (path.startsWith("src/") || path.startsWith("docs/") || path === "NAMLA_BUILD_LAW.md" || path === "SAFETY_INVARIANTS.md") {
    return { ok: false, reasonCode: "targets-namla-source" };
  }
  // Every mission-scoped path is treated as relative to its own root, so a
  // builder ant can never even express a path that resolves outside it.
  if (path.startsWith("workspaces/") && !path.startsWith(missionRoot)) {
    return { ok: false, reasonCode: "outside-mission-root" };
  }

  const basename = path.split("/").pop() ?? path;
  if (isSecretLikeFilename(basename)) return { ok: false, reasonCode: "protected-name-segment" };

  if (contentByteLength > MAX_MISSION_FILE_BYTES) return { ok: false, reasonCode: "content-too-large" };

  return { ok: true };
}

export class MissionWorkspace {
  private readonly proposed: ProposedFileOperation[] = [];
  private readonly applied: AppliedFileOperation[] = [];
  private readonly violations: WorkspaceBoundaryViolation[] = [];

  constructor(
    private readonly missionId: string,
    private readonly driver: WorkspaceDriver,
    private readonly receiptLog: ReceiptLog
  ) {}

  /** Record a proposed write. Returns false (and records a violation) if the path is out of bounds. */
  propose(params: { targetRelativePath: string; content: string; changeKind: "create" | "modify"; antId: string }): boolean {
    const boundary = checkWorkspaceBoundary(this.missionId, params.targetRelativePath, Buffer.byteLength(params.content, "utf8"));
    if (!boundary.ok) {
      this.violations.push({ targetRelativePath: params.targetRelativePath, reasonCode: boundary.reasonCode });
      this.receiptLog.create({
        summary: "Mission workspace write refused: outside the bounded workspace root.",
        status: "refused",
        links: { missionId: this.missionId, antId: params.antId },
        details: { targetRelativePath: params.targetRelativePath, reasonCode: boundary.reasonCode },
      });
      return false;
    }

    this.proposed.push({
      operationId: `op-${randomUUID()}`,
      missionId: this.missionId,
      targetRelativePath: params.targetRelativePath,
      changeKind: params.changeKind,
      content: params.content,
      contentFingerprint: fingerprint(params.content),
      proposedByAntId: params.antId,
      proposedAt: new Date().toISOString(),
    });
    return true;
  }

  /** Apply every currently-proposed operation through the injected driver, then clear the queue. */
  applyProposed(): readonly AppliedFileOperation[] {
    const newlyApplied: AppliedFileOperation[] = [];
    for (const operation of this.proposed) {
      this.driver.write(operation.targetRelativePath, operation.content);
      const record: AppliedFileOperation = {
        operationId: operation.operationId,
        targetRelativePath: operation.targetRelativePath,
        contentFingerprint: operation.contentFingerprint,
        appliedAt: new Date().toISOString(),
      };
      this.applied.push(record);
      newlyApplied.push(record);
    }
    this.proposed.length = 0;

    this.receiptLog.create({
      summary: "Mission workspace applied its proposed file operations.",
      status: "completed",
      links: { missionId: this.missionId },
      details: { appliedCount: newlyApplied.length },
    });

    return newlyApplied;
  }

  read(targetRelativePath: string): string | undefined {
    return this.driver.read(targetRelativePath);
  }

  listAppliedPaths(): readonly string[] {
    return this.driver.list();
  }

  snapshotFiles(): ReadonlyMap<string, string> {
    const snapshot = new Map<string, string>();
    for (const path of this.driver.list()) {
      const content = this.driver.read(path);
      if (content !== undefined) snapshot.set(path, content);
    }
    return snapshot;
  }

  get proposedCount(): number {
    return this.proposed.length;
  }

  get appliedCount(): number {
    return this.applied.length;
  }

  get boundaryViolationCount(): number {
    return this.violations.length;
  }
}
