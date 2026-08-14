/**
 * Capability C1 — read-only create-target inspection contracts (data only).
 *
 * These types describe the OUTCOME of a real read-only filesystem metadata
 * inspection of a proposed create target. The inspection itself lives in
 * ProjectInspector (the only fs importer in the codebase); this module and
 * the C1 dry-run evaluator import NO fs and perform NO mutation.
 *
 * Nothing here is authority for a write. A CreateTargetInspection is
 * observational: it records what the filesystem looked like at inspection
 * time. The filesystem may change afterward, so C2 must re-run every check
 * immediately before any exclusive-create. `authoritativeForWrite: false`
 * is a literal type — an inspection can never be typed as write authority.
 *
 * Redaction: no raw absolute path, no raw relative path, no protected path,
 * no file content, and no directory listing appears on these records. Paths
 * are represented only as a short non-reversible fingerprint plus a length;
 * findings are booleans, counts, and fixed reason codes.
 */

/** Fixed, protected-text-audited reason vocabulary for a target inspection. */
export type CreateTargetInspectionReasonCode =
  | "target-inspection-clean"
  | "target-escapes-root"
  | "real-parent-escapes-root"
  | "parent-missing"
  | "parent-not-directory"
  | "parent-chain-link-surface"
  | "target-is-link"
  | "target-exists"
  | "case-insensitive-collision"
  | "inspection-error";

/**
 * The result of one read-only metadata inspection of a create target.
 * Produced only by ProjectInspector.inspectCreateTarget.
 */
export interface CreateTargetInspection {
  /** Non-reversible short fingerprint of the normalized relative path. */
  normalizedRelativePathFingerprint: string;
  /** Length only — never the raw path text. */
  normalizedRelativePathLength: number;

  /** An entry already occupies the exact target name (case-sensitive). */
  targetExists: boolean;
  /**
   * A sibling matches the target name case-insensitively but NOT
   * case-sensitively (the distinctive case-variant collision). Computed
   * from a directory listing, so it is detected on case-sensitive and
   * case-insensitive filesystems alike.
   */
  caseInsensitiveCollision: boolean;

  parentExists: boolean;
  parentIsDirectory: boolean;

  /** The lexical target and its parent chain resolve inside the project root. */
  parentChainInsideProject: boolean;
  /** Some existing parent-chain component is a symlink/junction/reparse surface. */
  parentChainContainsLink: boolean;
  /** The exact target, when it exists, is itself a link. */
  targetIsLink: boolean;
  /** The real (symlink-resolved) parent still resolves inside the project root. */
  realParentInsideProject: boolean;

  /** The structural (C0) gate result that admitted this inspection. */
  structuralPolicyPassed: boolean;

  /** True when the metadata inspection ran to completion with no internal error. */
  filesystemInspectionCompleted: boolean;
  /** Count of metadata entries examined (chain components + siblings scanned). */
  inspectedEntryCount: number;

  /** DATA ONLY: an inspection is never authority for a write. */
  simulated: true;
  executed: false;
  authoritativeForWrite: false;

  /** The canonical receipt written for this inspection activity. */
  inspectionReceiptId: string;

  /** Fixed reason codes describing the findings (no raw text). */
  reasonCodes: CreateTargetInspectionReasonCode[];
}

/**
 * A rollback described as DATA and never executable. C1 exposes this only as
 * a preview of what a rollback WOULD target if a future creation succeeded;
 * there is no delete/unlink/rm authority anywhere near it, and the target is
 * carried as a fingerprint reference, not a raw path.
 */
export interface RollbackInstructionPreview {
  /** Fingerprint reference to the would-be-created path — not a raw path. */
  targetPathReference: string;
  reason: string;
  executed: false;
  requiresSeparateHumanApproval: true;
  /** A rollback is only conceivable after a real creation that C1 cannot do. */
  availableOnlyAfterSuccessfulFutureCreation: true;
}
