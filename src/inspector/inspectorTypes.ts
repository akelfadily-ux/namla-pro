/**
 * Phase 1 inspector types. A ProjectSnapshot is the read-only picture of the
 * project tree that the inspector produces. It records what was seen, what
 * was deliberately skipped and why, and any risks noticed along the way.
 */

export interface InspectedFile {
  relativePath: string;
  name: string;
  extension: string; // "" when the file has no extension
  sizeBytes: number;
  modifiedAt: string;
}

export interface InspectedFolder {
  relativePath: string;
  name: string;
  fileCount: number;
  subfolderCount: number;
}

export type SkipReason =
  | "ignored-folder"
  | "secret-like-name"
  | "over-size-limit"
  | "symlink"
  | "outside-project-root"
  | "unreadable";

export interface SkippedItem {
  relativePath: string;
  kind: "file" | "folder" | "symlink" | "other";
  reason: SkipReason;
}

export type InspectionRiskSeverity = "info" | "caution" | "warning";

export interface InspectionRisk {
  riskId: string;
  severity: InspectionRiskSeverity;
  description: string;
  relatedPath?: string;
}

export interface SnapshotSummary {
  totalFolders: number;
  totalFiles: number;
  totalSkipped: number;
  totalSizeBytes: number;
  extensionCounts: Record<string, number>;
}

export interface ProjectSnapshot {
  snapshotId: string;
  projectRoot: string;
  generatedAt: string;
  folders: InspectedFolder[];
  files: InspectedFile[];
  skipped: SkippedItem[];
  risks: InspectionRisk[];
  summary: SnapshotSummary;
}

export interface InspectorOptions {
  /** Files larger than this are skipped from the snapshot entirely. */
  maxFileSizeBytes?: number;
  /** Hard cap on total entries walked, as a runaway guard. */
  maxEntries?: number;
  /** readSmallTextFile refuses files larger than this. */
  maxReadFileBytes?: number;
}

/**
 * Loose structural check so senses can accept a snapshot through their
 * untyped context bag without importing the inspector implementation.
 */
export function isProjectSnapshotLike(value: unknown): value is ProjectSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.projectRoot === "string" &&
    Array.isArray(candidate.folders) &&
    Array.isArray(candidate.files) &&
    typeof candidate.summary === "object" &&
    candidate.summary !== null
  );
}
