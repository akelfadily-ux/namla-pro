/**
 * Capability C0 — data contracts for Human-Approved Local File Creation.
 *
 * C0 is DATA ONLY. Nothing in this module (or the C0 module set) writes,
 * deletes, or touches the filesystem: no fs import exists anywhere in
 * src/application. These types describe an approved create operation and
 * the human-approval grant that would authorize it in a FUTURE phase — the
 * contracts are built and verified now so that C1 (dry-run) and C2 (one
 * real exclusive-create, behind a law amendment) inherit a proven shape.
 *
 * Four corrections from the design review are baked in here:
 * 1. Rollback is modeled as data with executed:false; there is NO delete
 *    authority in C0, and a real deletion would need its own approval +
 *    law amendment.
 * 2. Integrity binds the WHOLE operation (see proposalIntegrity.ts), not
 *    content alone.
 * 3. `declaredApproverKind: "human"` is a DECLARATION, not cryptographic
 *    proof of a human. C0 verifies consistency and scope, never identity.
 * 4. The grant carries no mutable `spent` flag; replay state is supplied
 *    separately (ConsumedApprovalState) and is process-local until
 *    persistence exists.
 */

export type CreateCapabilityScope = "create-one-project-file";

export type ChangeKindCreate = "create";

/**
 * A human-approval grant as data. Deliberately carries no credential,
 * token, auth header, external identity claim, executable-authority field,
 * or mutable spent boolean.
 */
export interface HumanApprovalGrant {
  grantId: string;
  proposalId: string;
  /** Full-operation SHA-256 hex (see proposalIntegrity.ts). */
  proposalIntegrityFingerprint: string;
  scope: CreateCapabilityScope;
  singleUse: true;
  /** A declaration of origin, NOT proof of human identity. */
  declaredApproverKind: "human";
  /** Deterministic issuance label (no wall-clock identity meaning). */
  issuedSequenceLabel: string;
  /**
   * Optional deterministic freshness bound: the grant is stale if the
   * verifier's supplied current sequence exceeds this. Sequence-based, not
   * wall-clock.
   */
  expiresAfterSequence?: number;
}

/** Immutable replay state, supplied to the verifier (never mutated in place). */
export interface ConsumedApprovalState {
  readonly consumedGrantIds: readonly string[];
}

export interface ApprovalDecision {
  approved: boolean;
  /** Fixed, protected-text-audited reason code. */
  reasonCode: string;
  grantId: string;
  proposalId: string;
  /** Safe metadata only — no raw content or path. */
  details?: Record<string, string | number | boolean>;
}

/**
 * The approved create operation described as data. simulated/executed/
 * requiresHumanApproval are literal types: an executed create operation is
 * unrepresentable in C0.
 */
export interface CreateOperationDescriptor {
  proposalId: string;
  changeKind: ChangeKindCreate;
  normalizedRelativePath: string;
  contentByteLength: number;
  proposalIntegrityFingerprint: string;
  proposalReceiptId: string;
  reviewVerdict?: string;
  reviewReceiptId?: string;
  simulated: true;
  executed: false;
  requiresHumanApproval: true;
}

/**
 * Rollback modeled as an INSTRUCTION, not a capability. There is no delete
 * method and no filesystem authority anywhere near this type. A real
 * deletion would target the created artifact and requires its own explicit
 * human approval and a separate law amendment.
 */
export interface RollbackInstruction {
  /** The would-be-created path is the rollback target (data reference only). */
  targetPathReference: string;
  reason: string;
  executed: false;
  requiresSeparateHumanApproval: true;
}
