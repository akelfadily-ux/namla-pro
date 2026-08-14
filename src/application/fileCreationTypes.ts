/**
 * Capability C2-A — immutable file-creation lifecycle types.
 *
 * These types model the FUTURE write lifecycle honestly, so that when C2-B
 * installs a real primitive it can report partial writes, residual
 * artifacts, and post-write receipt failures truthfully — without ever
 * mutating the CodeProposal (which keeps `applied: false` immutably).
 *
 * In C2-A every produced FileCreationResult is literal-typed to a NON-ATTEMPT:
 * attempted:false, exclusiveOpenOccurred:false, bytesWritten:0,
 * persistenceConfirmed:false, closeConfirmed:false, residualArtifactPossible:
 * false, receiptWriteFailed:false, grantConsumed:false, writePerformed:false,
 * completed:false, simulated:true, executed:false, requiresC2BPrimitive:true.
 * A performed write is unrepresentable in C2-A output.
 *
 * Pure data only: no fs, no behavior.
 */

/** Where a future write attempt failed, if it did. */
export type FileCreationFailureStage =
  | "none"
  | "pre-admission"
  | "authority"
  | "filesystem-boundary"
  | "c2b-primitive-not-installed"
  // §33: the physical target could not be derived from, and proven against,
  // the approved and inspected logical target. Occurs strictly BEFORE grant
  // consumption and before any exclusive open.
  | "target-binding"
  // C2-B lifecycle stages (produced only via an injected driver in C2-B):
  | "open"
  | "write"
  | "persistence"
  | "close"
  | "receipt";

/** What may remain on disk after a future failed attempt. */
export type ResidualArtifactState = "none" | "possible-zero-byte" | "possible-partial";

/** Whether a canonical receipt was delivered for the outcome. */
export type ReceiptDeliveryState = "not-attempted" | "delivered" | "failed";

/** Result of recognizing (or not) a write-authority permit — never a disk authorization. */
export interface WriteAuthorityDecision {
  /** Permit recognized architecturally. NOT authority to write to disk. */
  authorityRecognized: boolean;
  reasonCode: string;
  scope?: "create-one-generated-markdown";
}

/** The outcome of C2-A admission-candidate evaluation. */
export interface WriteAttemptAdmissionCandidate {
  status: "candidate-ready-for-c2b-review" | "refused" | "blocked";
  reasonCode: string;
  underlyingReasonCode?: string;
  proposalId: string;
  grantId: string;

  authorityRecognized: boolean;
  approvalValid: boolean;
  c2PolicyPassed: boolean;
  exactBytesOk: boolean;
  inspectionClean: boolean;

  contentBytesFingerprint?: string;
  byteLength: number;

  // Literal safety: a candidate is never a write authorization, never
  // executed, and never consumes a grant; a fresh final C1 inspection is
  // always still required before any future open.
  simulated: true;
  executed: false;
  writeAuthorized: false;
  grantConsumed: false;
  requiresFinalC1Revalidation: true;
}

/**
 * The immutable outcome record of a create attempt. The CodeProposal is
 * never mutated to produce this.
 *
 * The lifecycle fields are real `boolean`/`number` so a C2-B attempt can be
 * reported TRUTHFULLY (partial write, unsynced/unclosed residual, receipt
 * failure after a disk result). The C2-A non-mutating shell
 * (`prepareCreationAttempt`) still returns all-false/zero values here.
 *
 * `executed` is true only when a real fs-backed driver executed. In C2-B
 * only fake drivers are used, so every produced result reports executed as
 * false and simulated as true — and no executed-true literal is written in
 * source (the creator sets it from the driver kind, an expression).
 */
export interface FileCreationResult {
  proposalId: string;
  grantId: string;
  /** Present for an admitted attempt; absent/synthetic otherwise. */
  attemptId?: string;

  attempted: boolean;
  exclusiveOpenOccurred: boolean;
  bytesWritten: number;
  persistenceConfirmed: boolean;
  closeConfirmed: boolean;
  residualArtifactPossible: boolean;
  receiptWriteFailed: boolean;
  grantConsumed: boolean;
  writePerformed: boolean;
  completed: boolean;
  simulated: boolean;
  executed: boolean;
  /** True while no exclusive-create primitive is engaged (C2-A shell path). */
  requiresC2BPrimitive: boolean;

  /** Exact approved byte count for this operation, when known. */
  byteCount?: number;
  /** Exact content-byte fingerprint bound to the write, when known. */
  contentBytesFingerprint?: string;

  failureStage: FileCreationFailureStage;
  residualArtifactState: ResidualArtifactState;
  receiptDeliveryState: ReceiptDeliveryState;
  reasonCode: string;
}
