/**
 * ProjectInspector is Phase 1's read-only local project inspector. It walks
 * the project tree using only readdir/lstat (plus a tightly guarded
 * readSmallTextFile), checks every path against FileBoundaryPolicy before
 * touching it, skips secret-like and oversized content, and produces a
 * ProjectSnapshot plus an ActionReceipt for every inspection — including
 * refusals.
 *
 * Phase 1 guarantees, per the NAMLA_BUILD_LAW Phase 1 amendment:
 * - Read-only: no fs write API is imported or called anywhere in this file.
 * - Inside the project root only: every path is boundary-checked first.
 * - Symlinks are never followed (a symlink inside the root could point
 *   outside it, so following one would silently escape the boundary).
 * - Secret-like filenames are skipped, never opened, never sized.
 */

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { fingerprint } from "../core/redaction";
import type { ActionReceipt, ReceiptStatus } from "../types/receiptTypes";
import { ReceiptLog } from "../core/receiptLog";
import type {
  CreateTargetInspection,
  CreateTargetInspectionReasonCode,
} from "../application/createTargetInspectionTypes";
import { isInsideProjectRoot } from "../policies/fileBoundaryPolicy";
import type { InspectionBoundProjectRoot } from "../application/createTargetBinding";
import {
  extensionOf,
  isIgnoredFolder,
  isSecretLikeFilename,
  isSecretLikeFilenameForWalk,
  isTextFileExtension,
} from "./fileClassifier";
import type {
  InspectedFile,
  InspectedFolder,
  InspectionRisk,
  InspectorOptions,
  ProjectSnapshot,
  SkippedItem,
} from "./inspectorTypes";

const DEFAULT_MAX_FILE_SIZE_BYTES = 1_000_000; // 1 MB: larger files are skipped
const DEFAULT_MAX_ENTRIES = 5_000; // runaway guard for the tree walk
const DEFAULT_MAX_READ_FILE_BYTES = 262_144; // 256 KB cap for readSmallTextFile

export interface InspectionResult {
  snapshot: ProjectSnapshot;
  receipt: ActionReceipt;
}

export interface ReadTextResult {
  content?: string;
  receipt: ActionReceipt;
}

export class ProjectInspector {
  private readonly projectRoot: string;
  private readonly receiptLog: ReceiptLog;
  private readonly maxFileSizeBytes: number;
  private readonly maxEntries: number;
  private readonly maxReadFileBytes: number;

  /**
   * The ONE minting site for `InspectionBoundProjectRoot` (§33).
   *
   * A create target is derived from a root plus an approved relative path, so
   * the root is an authorization input and must not be an arbitrary caller
   * string. This accessor hands out the resolved root ONLY after confirming on
   * the real filesystem that it exists and is a directory — the same condition
   * `inspect()` requires — and returns `null` when it cannot be proven, so the
   * write boundary fails closed rather than deriving a target under a root
   * that does not exist.
   *
   * This is the only `as InspectionBoundProjectRoot` in the codebase, and it
   * lives here because ProjectInspector already owns this root and is already
   * the module permitted to read filesystem metadata.
   */
  get inspectionBoundProjectRoot(): InspectionBoundProjectRoot | null {
    try {
      if (!fs.existsSync(this.projectRoot)) return null;
      if (!fs.lstatSync(this.projectRoot).isDirectory()) return null;
    } catch {
      return null;
    }
    return this.projectRoot as InspectionBoundProjectRoot;
  }

  constructor(projectRoot: string, receiptLog: ReceiptLog, options: InspectorOptions = {}) {
    this.projectRoot = path.resolve(projectRoot);
    this.receiptLog = receiptLog;
    this.maxFileSizeBytes = options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.maxReadFileBytes = options.maxReadFileBytes ?? DEFAULT_MAX_READ_FILE_BYTES;
  }

  inspect(requestedByAntId: string): InspectionResult {
    if (!fs.existsSync(this.projectRoot) || !fs.lstatSync(this.projectRoot).isDirectory()) {
      const receipt = this.receiptLog.create({
        summary: `Inspection refused: project root is not an existing directory.`,
        status: "refused",
        links: { antId: requestedByAntId },
      });
      return { snapshot: this.emptySnapshot(), receipt };
    }

    const folders: InspectedFolder[] = [];
    const files: InspectedFile[] = [];
    const skipped: SkippedItem[] = [];
    let entriesWalked = 0;
    let truncated = false;

    const walk = (absoluteFolder: string, relativeFolder: string): { fileCount: number; subfolderCount: number } => {
      let fileCount = 0;
      let subfolderCount = 0;

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(absoluteFolder, { withFileTypes: true });
      } catch {
        skipped.push({ relativePath: relativeFolder || ".", kind: "folder", reason: "unreadable" });
        return { fileCount, subfolderCount };
      }

      for (const entry of entries) {
        if (entriesWalked >= this.maxEntries) {
          truncated = true;
          return { fileCount, subfolderCount };
        }
        entriesWalked += 1;

        const relativePath = relativeFolder ? `${relativeFolder}/${entry.name}` : entry.name;
        const absolutePath = path.join(absoluteFolder, entry.name);

        if (!isInsideProjectRoot(absolutePath, this.projectRoot)) {
          skipped.push({ relativePath, kind: "other", reason: "outside-project-root" });
          continue;
        }

        if (entry.isSymbolicLink()) {
          // Never follow symlinks: a link inside the root can target a path
          // outside it, which would bypass the boundary check silently.
          skipped.push({ relativePath, kind: "symlink", reason: "symlink" });
          continue;
        }

        if (entry.isDirectory()) {
          if (isIgnoredFolder(entry.name)) {
            skipped.push({ relativePath, kind: "folder", reason: "ignored-folder" });
            continue;
          }
          const childCounts = walk(absolutePath, relativePath);
          folders.push({
            relativePath,
            name: entry.name,
            fileCount: childCounts.fileCount,
            subfolderCount: childCounts.subfolderCount,
          });
          subfolderCount += 1;
          continue;
        }

        if (entry.isFile()) {
          // Walk gate: source files that merely mention secret concepts are
          // listed; real secret stores are skipped. readSmallTextFile applies
          // the stricter isSecretLikeFilename gate before any content read.
          if (isSecretLikeFilenameForWalk(entry.name)) {
            skipped.push({ relativePath, kind: "file", reason: "secret-like-name" });
            continue;
          }

          let stats: fs.Stats;
          try {
            stats = fs.lstatSync(absolutePath);
          } catch {
            skipped.push({ relativePath, kind: "file", reason: "unreadable" });
            continue;
          }

          if (stats.size > this.maxFileSizeBytes) {
            skipped.push({ relativePath, kind: "file", reason: "over-size-limit" });
            continue;
          }

          files.push({
            relativePath,
            name: entry.name,
            extension: extensionOf(entry.name),
            sizeBytes: stats.size,
            modifiedAt: stats.mtime.toISOString(),
          });
          fileCount += 1;
          continue;
        }

        skipped.push({ relativePath, kind: "other", reason: "unreadable" });
      }

      return { fileCount, subfolderCount };
    };

    walk(this.projectRoot, "");

    const snapshot = this.buildSnapshot(folders, files, skipped, truncated);

    const receipt = this.receiptLog.create({
      summary: `Read-only inspection completed: ${snapshot.summary.totalFolders} folder(s), ${snapshot.summary.totalFiles} file(s), ${snapshot.summary.totalSkipped} skipped.`,
      status: "completed",
      links: { antId: requestedByAntId },
      details: {
        snapshotId: snapshot.snapshotId,
        totalSizeBytes: snapshot.summary.totalSizeBytes,
        riskCount: snapshot.risks.length,
      },
    });

    return { snapshot, receipt };
  }

  /**
   * Guarded read of one small text file. Refusals are receipted, never
   * silent. This is the only content-reading path in Phase 1.
   */
  readSmallTextFile(relativePath: string, requestedByAntId: string): ReadTextResult {
    // Refusal receipts are fully redacted, matching ProposalFactory's
    // standard: the refused path must not appear in the summary (refused
    // paths are often exactly the secret-like names ReceiptLog rejects,
    // turning a clean refusal into a crash) and not raw in details either —
    // only non-reversible metadata (length + short fingerprint) for
    // correlation. The caller already knows which path it asked for.
    const refuse = (reason: string): ReadTextResult => ({
      receipt: this.receiptLog.create({
        summary: `Read refused: ${reason}.`,
        status: "refused",
        links: { antId: requestedByAntId },
        details: {
          relativePathLength: relativePath.length,
          relativePathFingerprint: fingerprint(relativePath),
        },
      }),
    });

    if (!isInsideProjectRoot(relativePath, this.projectRoot)) {
      return refuse("path is outside the project root");
    }

    const fileName = path.basename(relativePath);
    if (isSecretLikeFilename(fileName)) {
      // Wording note: this reason string must not contain the word
      // "secret" itself — ReceiptLog scans summaries with looksLikeSecret
      // and would throw, turning the refusal into a crash.
      return refuse("filename matches a protected name");
    }

    if (!isTextFileExtension(extensionOf(fileName))) {
      return refuse("extension is not on the safe text-file list");
    }

    const absolutePath = path.resolve(this.projectRoot, relativePath);

    let stats: fs.Stats;
    try {
      stats = fs.lstatSync(absolutePath);
    } catch {
      return refuse("file does not exist or is unreadable");
    }

    if (stats.isSymbolicLink()) {
      return refuse("symlinks are never followed");
    }

    if (!stats.isFile()) {
      return refuse("target is not a regular file");
    }

    if (stats.size > this.maxReadFileBytes) {
      return refuse(`file is larger than the ${this.maxReadFileBytes}-byte read limit`);
    }

    const content = fs.readFileSync(absolutePath, "utf8");

    // High-signal content check: a PEM block marker means key material,
    // regardless of how innocent the filename looked. The broad keyword list
    // is NOT applied to content here because this project's own safety
    // documentation legitimately contains words like "secret" and "token".
    if (content.toLowerCase().includes("-----begin")) {
      return refuse("content contains a PEM key block marker");
    }

    // Path goes into details, not the summary, for the same reason as in
    // refuse(): folder segments of the path were never secret-name-checked,
    // and ReceiptLog rejects secret-like summaries by throwing.
    const receipt = this.receiptLog.create({
      summary: `Read-only file read completed (${stats.size} bytes).`,
      status: "completed",
      links: { antId: requestedByAntId },
      details: { relativePath },
    });

    return { content, receipt };
  }

  /**
   * Capability C1 — read-only create-target metadata inspection.
   *
   * Inspects a proposed create target against the REAL local filesystem
   * using only metadata operations (existsSync/lstatSync/readdirSync/
   * realpathSync.native). It reads NO file content and performs NO mutation:
   * no create, write, append, mkdir, rename, copy, unlink, rm, or chmod is
   * imported or called anywhere in this method (or this file).
   *
   * The result is observational only — it is never authority for a write
   * (authoritativeForWrite is a literal false). The filesystem may change
   * after inspection, so C2 must repeat every one of these checks
   * immediately before any exclusive-create.
   *
   * Redaction: the raw path never enters a receipt; only its fingerprint,
   * length, boolean findings, counts, and fixed reason codes do.
   */
  inspectCreateTarget(
    normalizedRelativePath: string,
    structuralPolicyPassed: boolean,
    requestedByAntId: string
  ): CreateTargetInspection {
    const reasonCodes: CreateTargetInspectionReasonCode[] = [];
    const pathFingerprint = fingerprint(normalizedRelativePath);
    const pathLength = normalizedRelativePath.length;
    let inspectedEntryCount = 0;

    // Fail-closed defaults: every finding starts "unsafe" until proven.
    let targetExists = false;
    let caseInsensitiveCollision = false;
    let parentExists = false;
    let parentIsDirectory = false;
    let parentChainInsideProject = false;
    let parentChainContainsLink = false;
    let targetIsLink = false;
    let realParentInsideProject = false;
    let completed = false;

    const finalize = (status: ReceiptStatus): CreateTargetInspection => {
      const receipt = this.receiptLog.create({
        summary: `Read-only create-target metadata inspection ${
          status === "failed" ? "did not complete" : "completed"
        }.`,
        status,
        links: { antId: requestedByAntId },
        details: {
          normalizedRelativePathFingerprint: pathFingerprint,
          normalizedRelativePathLength: pathLength,
          inspectedEntryCount,
          reasonCodeCount: reasonCodes.length,
        },
      });
      return {
        normalizedRelativePathFingerprint: pathFingerprint,
        normalizedRelativePathLength: pathLength,
        targetExists,
        caseInsensitiveCollision,
        parentExists,
        parentIsDirectory,
        parentChainInsideProject,
        parentChainContainsLink,
        targetIsLink,
        realParentInsideProject,
        structuralPolicyPassed,
        filesystemInspectionCompleted: completed,
        inspectedEntryCount,
        simulated: true,
        executed: false,
        authoritativeForWrite: false,
        inspectionReceiptId: receipt.receiptId,
        reasonCodes: reasonCodes.length > 0 ? reasonCodes : ["target-inspection-clean"],
      };
    };

    try {
      const absoluteTarget = path.resolve(this.projectRoot, normalizedRelativePath);

      // Boundary: the lexical target must resolve inside the project root.
      if (!isInsideProjectRoot(absoluteTarget, this.projectRoot)) {
        reasonCodes.push("target-escapes-root");
        completed = true;
        return finalize("blocked");
      }
      parentChainInsideProject = true;

      const parentDir = path.dirname(absoluteTarget);

      // Build the ancestor chain [parentDir ... projectRoot].
      const chain: string[] = [];
      let cursor = parentDir;
      let reachedRoot = false;
      for (let i = 0; i < 4096; i += 1) {
        chain.push(cursor);
        if (path.resolve(cursor) === this.projectRoot) {
          reachedRoot = true;
          break;
        }
        const up = path.dirname(cursor);
        if (up === cursor) break; // hit filesystem root without meeting projectRoot
        cursor = up;
      }
      if (!reachedRoot) {
        parentChainInsideProject = false;
        reasonCodes.push("target-escapes-root");
        completed = true;
        return finalize("blocked");
      }

      // Link/reparse surface scan of every EXISTING ancestor (lstat, no follow).
      for (const ancestor of chain) {
        let stat: fs.Stats;
        try {
          stat = fs.lstatSync(ancestor);
        } catch {
          continue; // a non-existent ancestor is not itself a link surface
        }
        inspectedEntryCount += 1;
        if (stat.isSymbolicLink()) parentChainContainsLink = true;
      }

      // Parent existence + directory-ness (lstat, never follow a link).
      let parentStat: fs.Stats | undefined;
      try {
        parentStat = fs.lstatSync(parentDir);
      } catch {
        parentStat = undefined;
      }
      if (parentStat !== undefined && parentStat.isSymbolicLink()) {
        // A symlinked parent is a link surface, not a usable directory.
        parentChainContainsLink = true;
      }
      parentExists =
        parentStat !== undefined && parentStat.isDirectory() && !parentStat.isSymbolicLink();
      parentIsDirectory = parentExists;

      // Real-parent containment via realpath (resolves junctions/links). Use
      // the deepest existing ancestor when the immediate parent is absent.
      const lexicalForReal = parentExists ? parentDir : this.deepestExistingAncestor(chain);
      try {
        const realParent = fs.realpathSync.native(lexicalForReal);
        realParentInsideProject = isInsideProjectRoot(realParent, this.projectRoot);
        // Divergence beyond case means a junction/link redirected the chain.
        if (realParent.toLowerCase() !== path.resolve(lexicalForReal).toLowerCase()) {
          parentChainContainsLink = true;
        }
      } catch {
        // realpath failed; fall back to the lexical containment already proven.
        realParentInsideProject = parentChainInsideProject;
      }

      // Sibling scan: exact vs case-variant collision (read-only listing).
      if (parentIsDirectory) {
        const base = path.basename(absoluteTarget);
        const baseLower = base.toLowerCase();
        let entries: string[] = [];
        try {
          entries = fs.readdirSync(parentDir);
        } catch {
          entries = [];
        }
        let exact = false;
        let variant = false;
        for (const name of entries) {
          inspectedEntryCount += 1;
          if (name === base) exact = true;
          else if (name.toLowerCase() === baseLower) variant = true;
        }
        targetExists = exact;
        caseInsensitiveCollision = variant && !exact;

        if (exact) {
          try {
            if (fs.lstatSync(absoluteTarget).isSymbolicLink()) targetIsLink = true;
          } catch {
            // exact match from readdir but lstat raced; treat as an existing file
          }
        }
      }

      // Order findings into reason codes (most fundamental boundary first).
      if (!realParentInsideProject) reasonCodes.push("real-parent-escapes-root");
      if (parentChainContainsLink) reasonCodes.push("parent-chain-link-surface");
      if (!parentExists) reasonCodes.push("parent-missing");
      else if (!parentIsDirectory) reasonCodes.push("parent-not-directory");
      if (targetIsLink) reasonCodes.push("target-is-link");
      if (targetExists) reasonCodes.push("target-exists");
      if (caseInsensitiveCollision) reasonCodes.push("case-insensitive-collision");

      completed = true;
      return finalize(reasonCodes.length > 0 ? "blocked" : "completed");
    } catch {
      // Internal inspection error: fail closed, no raw error text recorded.
      reasonCodes.push("inspection-error");
      completed = false;
      return finalize("failed");
    }
  }

  /** First existing ancestor in a [parent ... root] chain, else the root. */
  private deepestExistingAncestor(chain: string[]): string {
    for (const ancestor of chain) {
      if (fs.existsSync(ancestor)) return ancestor;
    }
    return this.projectRoot;
  }

  private buildSnapshot(
    folders: InspectedFolder[],
    files: InspectedFile[],
    skipped: SkippedItem[],
    truncated: boolean
  ): ProjectSnapshot {
    const extensionCounts: Record<string, number> = {};
    let totalSizeBytes = 0;

    for (const file of files) {
      const key = file.extension || "(none)";
      extensionCounts[key] = (extensionCounts[key] ?? 0) + 1;
      totalSizeBytes += file.sizeBytes;
    }

    const risks: InspectionRisk[] = [];

    const secretSkips = skipped.filter((s) => s.reason === "secret-like-name");
    if (secretSkips.length > 0) {
      risks.push({
        riskId: `risk-${randomUUID()}`,
        severity: "info",
        description: `${secretSkips.length} file(s) with secret-like names were skipped and never opened. (Source files merely mentioning secret concepts in their name are listed in the tree but remain blocked for content reads.)`,
      });
    }

    const symlinkSkips = skipped.filter((s) => s.reason === "symlink");
    if (symlinkSkips.length > 0) {
      risks.push({
        riskId: `risk-${randomUUID()}`,
        severity: "caution",
        description: `${symlinkSkips.length} symlink(s) were skipped because symlinks are never followed (they could point outside the project root).`,
      });
    }

    const oversize = skipped.filter((s) => s.reason === "over-size-limit");
    if (oversize.length > 0) {
      risks.push({
        riskId: `risk-${randomUUID()}`,
        severity: "info",
        description: `${oversize.length} file(s) over ${this.maxFileSizeBytes} bytes were skipped.`,
      });
    }

    if (truncated) {
      risks.push({
        riskId: `risk-${randomUUID()}`,
        severity: "warning",
        description: `The walk stopped early at the ${this.maxEntries}-entry cap; this snapshot is incomplete.`,
      });
    }

    return {
      snapshotId: `snapshot-${randomUUID()}`,
      projectRoot: this.projectRoot,
      generatedAt: new Date().toISOString(),
      folders,
      files,
      skipped,
      risks,
      summary: {
        totalFolders: folders.length,
        totalFiles: files.length,
        totalSkipped: skipped.length,
        totalSizeBytes,
        extensionCounts,
      },
    };
  }

  private emptySnapshot(): ProjectSnapshot {
    return {
      snapshotId: `snapshot-${randomUUID()}`,
      projectRoot: this.projectRoot,
      generatedAt: new Date().toISOString(),
      folders: [],
      files: [],
      skipped: [],
      risks: [],
      summary: {
        totalFolders: 0,
        totalFiles: 0,
        totalSkipped: 0,
        totalSizeBytes: 0,
        extensionCounts: {},
      },
    };
  }
}
