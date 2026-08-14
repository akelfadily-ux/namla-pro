/**
 * digitalWorkspace — the bounded, attributed project workspace (Build Law §24).
 *
 * A workspace is rooted ONLY at `workspaces/digital-operations/<objective-id>/`.
 * Every path is validated against a strict allowlist: no traversal, no absolute
 * or drive path, no backslash/junction trick, no protected name (.env, keys,
 * tokens, credentials, ssh, certs, .git), and never a write to the Namla source
 * tree (guaranteed by the root). Every operation is attributed to
 * objectiveId + taskId + antId + a receipt, carries exact before/after
 * fingerprints, and is bounded (file count, bytes per file, total bytes).
 *
 * The automated runtime uses the IN-MEMORY driver below — it never touches the
 * real filesystem (`realFilesystemWrites` stays 0), so no provider or ant
 * receives real filesystem authority in tests. A real-disk driver is a separate
 * human-only capability (Build Law §24) delegating to the single authorized
 * smoke-workspace fs surface; it is NOT wired here.
 *
 * No fs, no child_process, no network, no wall clock.
 */

export interface WorkspaceLimits {
  readonly maxFiles: number;
  readonly maxBytesPerFile: number;
  readonly maxTotalBytes: number;
}

export const DEFAULT_WORKSPACE_LIMITS: WorkspaceLimits = { maxFiles: 64, maxBytesPerFile: 20000, maxTotalBytes: 200000 };

const PROTECTED_PATTERNS: readonly RegExp[] = [
  /(^|\/)\.env(\.|$|\/)/i,
  /\.(pem|key|crt|cer|p12|pfx)$/i,
  /(^|\/)\.ssh(\/|$)/i,
  /id_rsa/i,
  /(credential|secret|token|password|apikey|api-key)/i,
  /(^|\/)\.git(\/|$)/i,
  /(cookies|login\s?data|browser)/i,
];

export type PathValidation = { readonly ok: true } | { readonly ok: false; readonly reasonCode: string };

/** Validate a workspace-relative path. No traversal, escape, or protected name. */
export function validateWorkspacePath(relPath: string): PathValidation {
  if (relPath.length === 0 || relPath.length > 120) return { ok: false, reasonCode: "path-length" };
  if (relPath.includes("..")) return { ok: false, reasonCode: "path-traversal" };
  if (relPath.startsWith("/") || /^[A-Za-z]:/.test(relPath)) return { ok: false, reasonCode: "absolute-path" };
  if (relPath.includes("\\") || relPath.includes("\0") || relPath.includes("~")) return { ok: false, reasonCode: "illegal-char" };
  if (relPath.startsWith("/") || relPath.endsWith("/")) return { ok: false, reasonCode: "malformed-path" };
  if (!/^[A-Za-z0-9._/-]+$/.test(relPath)) return { ok: false, reasonCode: "illegal-char" };
  for (const p of PROTECTED_PATTERNS) if (p.test(relPath)) return { ok: false, reasonCode: "protected-path" };
  return { ok: true };
}

/** Deterministic content fingerprint (FNV-1a over the string). No randomness. */
export function fingerprint(content: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < content.length; i += 1) {
    h ^= content.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `fp-${h.toString(16).padStart(8, "0")}-${content.length}`;
}

export type WorkspaceOperation = "create" | "modify" | "read" | "list" | "apply-artifact" | "store-evidence";

export interface WorkspaceAttribution {
  readonly objectiveId: string;
  readonly taskId: string;
  readonly antId: string;
}

export interface WorkspaceReceipt {
  readonly receiptId: string;
  readonly objectiveId: string;
  readonly taskId: string;
  readonly antId: string;
  readonly operation: WorkspaceOperation;
  readonly relPath: string;
  readonly beforeFingerprint: string | null;
  readonly afterFingerprint: string | null;
  readonly bytes: number;
}

export type WorkspaceWriteResult = { readonly ok: true; readonly receipt: WorkspaceReceipt } | { readonly ok: false; readonly reasonCode: string };

interface WorkspaceFile {
  content: string;
  createdByObjective: string;
}

/**
 * The in-memory workspace driver: a real bounded workspace MODEL with enforced
 * boundaries and receipts, backed by memory (never disk) in automated runs.
 */
export class InMemoryWorkspaceDriver {
  readonly driverKind = "in-memory-fake" as const;
  readonly realFilesystemWrites = 0 as const;
  private readonly root: string;
  private readonly files = new Map<string, WorkspaceFile>();
  private readonly receipts: WorkspaceReceipt[] = [];
  private boundaryViolations = 0;
  private totalBytes = 0;
  private receiptSeq = 0;

  constructor(readonly objectiveId: string, private readonly limits: WorkspaceLimits = DEFAULT_WORKSPACE_LIMITS, rootPrefix = "workspaces/digital-operations") {
    this.root = `${rootPrefix}/${objectiveId}/`;
  }

  get workspaceRoot(): string {
    return this.root;
  }
  get fileCount(): number {
    return this.files.size;
  }
  get workspaceBoundaryViolations(): number {
    return this.boundaryViolations;
  }
  get allReceipts(): readonly WorkspaceReceipt[] {
    return this.receipts;
  }

  private newReceipt(op: WorkspaceOperation, attr: WorkspaceAttribution, relPath: string, before: string | null, after: string | null, bytes: number): WorkspaceReceipt {
    const receipt: WorkspaceReceipt = {
      receiptId: `wsr-${this.objectiveId}-${this.receiptSeq++}`,
      objectiveId: attr.objectiveId,
      taskId: attr.taskId,
      antId: attr.antId,
      operation: op,
      relPath,
      beforeFingerprint: before,
      afterFingerprint: after,
      bytes,
    };
    if (this.receipts.length < 5000) this.receipts.push(receipt);
    return receipt;
  }

  private reject(reasonCode: string): WorkspaceWriteResult {
    this.boundaryViolations += 1;
    return { ok: false, reasonCode };
  }

  private write(op: "create" | "modify" | "apply-artifact" | "store-evidence", relPath: string, content: string, attr: WorkspaceAttribution): WorkspaceWriteResult {
    if (attr.objectiveId !== this.objectiveId) return this.reject("objective-mismatch");
    const validation = validateWorkspacePath(relPath);
    if (!validation.ok) return this.reject(validation.reasonCode);
    if (content.length > this.limits.maxBytesPerFile) return this.reject("file-too-large");
    const existing = this.files.get(relPath);
    if (op === "modify" && !existing) return this.reject("modify-nonexistent");
    if (op === "modify" && existing && existing.createdByObjective !== this.objectiveId) return this.reject("modify-foreign-file");
    if (!existing && this.files.size >= this.limits.maxFiles) return this.reject("too-many-files");
    const before = existing ? fingerprint(existing.content) : null;
    const newTotal = this.totalBytes - (existing ? existing.content.length : 0) + content.length;
    if (newTotal > this.limits.maxTotalBytes) return this.reject("workspace-too-large");
    this.files.set(relPath, { content, createdByObjective: this.objectiveId });
    this.totalBytes = newTotal;
    const after = fingerprint(content);
    return { ok: true, receipt: this.newReceipt(op, attr, relPath, before, after, content.length) };
  }

  createFile(relPath: string, content: string, attr: WorkspaceAttribution): WorkspaceWriteResult {
    if (this.files.has(relPath)) return this.reject("already-exists");
    return this.write("create", relPath, content, attr);
  }

  modifyFile(relPath: string, content: string, attr: WorkspaceAttribution): WorkspaceWriteResult {
    return this.write("modify", relPath, content, attr);
  }

  /** Apply a reviewed artifact (create-or-overwrite) through the same boundary. */
  applyArtifact(relPath: string, content: string, attr: WorkspaceAttribution): WorkspaceWriteResult {
    return this.upsert("apply-artifact", relPath, content, attr);
  }

  storeEvidence(relPath: string, content: string, attr: WorkspaceAttribution): WorkspaceWriteResult {
    return this.upsert("store-evidence", relPath, content, attr);
  }

  private upsert(op: "apply-artifact" | "store-evidence", relPath: string, content: string, attr: WorkspaceAttribution): WorkspaceWriteResult {
    if (attr.objectiveId !== this.objectiveId) return this.reject("objective-mismatch");
    const validation = validateWorkspacePath(relPath);
    if (!validation.ok) return this.reject(validation.reasonCode);
    if (content.length > this.limits.maxBytesPerFile) return this.reject("file-too-large");
    const existing = this.files.get(relPath);
    if (!existing && this.files.size >= this.limits.maxFiles) return this.reject("too-many-files");
    const before = existing ? fingerprint(existing.content) : null;
    const newTotal = this.totalBytes - (existing ? existing.content.length : 0) + content.length;
    if (newTotal > this.limits.maxTotalBytes) return this.reject("workspace-too-large");
    this.files.set(relPath, { content, createdByObjective: this.objectiveId });
    this.totalBytes = newTotal;
    return { ok: true, receipt: this.newReceipt(op, attr, relPath, before, fingerprint(content), content.length) };
  }

  readFile(relPath: string, attr: WorkspaceAttribution): { ok: true; content: string; receipt: WorkspaceReceipt } | { ok: false; reasonCode: string } {
    const validation = validateWorkspacePath(relPath);
    if (!validation.ok) {
      this.boundaryViolations += 1;
      return { ok: false, reasonCode: validation.reasonCode };
    }
    const file = this.files.get(relPath);
    if (!file) return { ok: false, reasonCode: "not-found" };
    const fp = fingerprint(file.content);
    return { ok: true, content: file.content, receipt: this.newReceipt("read", attr, relPath, fp, fp, file.content.length) };
  }

  listPaths(): readonly string[] {
    return [...this.files.keys()].sort().slice(0, this.limits.maxFiles);
  }
}
