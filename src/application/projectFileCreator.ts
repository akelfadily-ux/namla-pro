/**
 * Capability C2-B — ProjectFileCreator (guarded exclusive-create).
 *
 * This file is the SECOND and only other fs importer (ProjectInspector is
 * the first). It installs the first real exclusive-create primitive — but
 * C2-B never executes it. The real Node-backed driver is module-private,
 * never exported, and never referenced by any exported function, so no C2-B
 * code path can invoke it; a private invocation counter (exposed read-only)
 * proves it stayed at zero. All behavioral testing uses an INJECTED fake
 * driver.
 *
 * Allowed fs imports IN THIS FILE ONLY: openSync, writeSync, fsyncSync,
 * closeSync. No broader fs namespace, no readdir/lstat/stat here (metadata
 * inspection stays in ProjectInspector; the fresh final inspection is
 * injected as data). None of the forbidden mutation primitives (directory
 * creation, rename, copy, unlink, remove, chmod, truncate, append, whole-file
 * write, or write streams) appears anywhere. The Node driver uses "wx" only:
 * exclusive-create that never overwrites and never appends.
 *
 * Production isolation: ColonyEngine, ants, missions, adapters, and the
 * C2-A bootstrap do NOT import or invoke this module. There is no top-level
 * execution and no C2-C bootstrap here.
 */

import { openSync, writeSync, fsyncSync, closeSync } from "fs";

import type { CodeProposal } from "../generation/codeProposal";
import type { ReceiptStatus } from "../types/receiptTypes";
import { ReceiptLog } from "../core/receiptLog";
import type {
  CreateOperationDescriptor,
  HumanApprovalGrant,
} from "./createCapabilityTypes";
import type { CreateTargetInspection } from "./createTargetInspectionTypes";
import { ConsumedApprovalRegistry } from "./consumedApprovalRegistry";
import { evaluateWriteAttemptAdmission } from "./writeAttemptAdmission";
import { prepareExactUtf8Content, computeContentBytesFingerprint } from "./exactContentBytes";
import { bindCreateTarget, type InspectionBoundProjectRoot } from "./createTargetBinding";
import {
  DriverErrorCategory,
  ExclusiveCreateDriver,
  ExclusiveCreateDriverError,
  ExclusiveCreateHandle,
} from "./exclusiveCreateDriver";
import type {
  FileCreationFailureStage,
  FileCreationResult,
  ResidualArtifactState,
  WriteAttemptAdmissionCandidate,
} from "./fileCreationTypes";

/* ------------------------------------------------------------------ *
 * Installed-but-inactive real Node exclusive-create driver (private).
 * Never exported and never referenced by any exported symbol, so it is
 * unreachable in C2-B. Each method increments a private counter; the
 * counter getter below proves the driver stayed uninvoked.
 * ------------------------------------------------------------------ */

let realNodeDriverInvocations = 0;
const realHandleFds = new Map<string, number>();
let realHandleSequence = 0;

const nodeExclusiveCreateDriver: ExclusiveCreateDriver = {
  kind: "real-node",
  openExclusive(targetPath: string): ExclusiveCreateHandle {
    realNodeDriverInvocations += 1;
    // "wx" = O_CREAT | O_EXCL | O_WRONLY: exclusive-create, never overwrite.
    const fd = openSync(targetPath, "wx");
    realHandleSequence += 1;
    const handleId = `node-fd-${realHandleSequence}`;
    realHandleFds.set(handleId, fd);
    return { handleId };
  },
  write(handle: ExclusiveCreateHandle, buffer: Buffer, offset: number, length: number): number {
    realNodeDriverInvocations += 1;
    const fd = realHandleFds.get(handle.handleId);
    if (fd === undefined) throw new ExclusiveCreateDriverError("internal-driver-failed");
    return writeSync(fd, buffer, offset, length);
  },
  sync(handle: ExclusiveCreateHandle): void {
    realNodeDriverInvocations += 1;
    const fd = realHandleFds.get(handle.handleId);
    if (fd === undefined) throw new ExclusiveCreateDriverError("internal-driver-failed");
    fsyncSync(fd);
  },
  close(handle: ExclusiveCreateHandle): void {
    realNodeDriverInvocations += 1;
    const fd = realHandleFds.get(handle.handleId);
    if (fd === undefined) throw new ExclusiveCreateDriverError("internal-driver-failed");
    closeSync(fd);
    realHandleFds.delete(handle.handleId);
  },
};
// `nodeExclusiveCreateDriver` is intentionally declared-but-unreferenced:
// installed (the real primitive exists in source) yet inactive (no exported
// symbol names it, so no C2-B path can reach or invoke it). There is no
// top-level execution here.

/** Read-only proof that the real Node driver was never invoked (C2-B: 0). */
export function getRealNodeDriverInvocationCount(): number {
  return realNodeDriverInvocations;
}

/* ------------------------------------------------------------------ *
 * C2-A non-mutating shell (retained). Without an injected driver, no
 * primitive is engaged and no attempt occurs.
 * ------------------------------------------------------------------ */

export function prepareCreationAttempt(
  candidate: WriteAttemptAdmissionCandidate
): FileCreationResult {
  return {
    proposalId: candidate.proposalId,
    grantId: candidate.grantId,
    attempted: false,
    exclusiveOpenOccurred: false,
    bytesWritten: 0,
    persistenceConfirmed: false,
    closeConfirmed: false,
    residualArtifactPossible: false,
    receiptWriteFailed: false,
    grantConsumed: false,
    writePerformed: false,
    completed: false,
    simulated: true,
    executed: false,
    requiresC2BPrimitive: true,
    failureStage: "c2b-primitive-not-installed",
    residualArtifactState: "none",
    receiptDeliveryState: "not-attempted",
    reasonCode: "c2b-write-primitive-not-installed",
  };
}

/* ------------------------------------------------------------------ *
 * C2-B guarded creator (driver injected). In C2-B the driver is always a
 * fake, so nothing touches the real filesystem.
 * ------------------------------------------------------------------ */

export interface CreateProjectFileInput {
  permit: unknown;
  proposal: CodeProposal;
  descriptor: CreateOperationDescriptor;
  grant: HumanApprovalGrant;
  /** Fresh final C1 inspection, computed immediately before this call. */
  targetInspection: CreateTargetInspection;
  reviewVerdict?: string;
  reviewReceiptId?: string;
  currentSequence?: number;
  operationCount?: number;
  /** Process-local consumed-grant registry. */
  registry: ConsumedApprovalRegistry;
  receiptLog: ReceiptLog;
  /** Injected exclusive-create driver. In C2-B always a fake (kind:"fake"). */
  driver: ExclusiveCreateDriver;
  /**
   * The inspection-bound project root, minted only by `ProjectInspector` (§33).
   *
   * There is deliberately NO physical target field here. The path handed to
   * `openExclusive` used to be `driverTargetPath: string` — a free-form input
   * bound to nothing that had been approved, reviewed, or inspected, so an
   * approval for path A could open path B while every receipt recorded A. The
   * target is now DERIVED inside this boundary by `bindCreateTarget`, from this
   * root plus the approved `descriptor.normalizedRelativePath`, and proven
   * against the inspection's fingerprint. A caller supplies domain inputs only.
   */
  projectRoot: InspectionBoundProjectRoot;
  /** Deterministic attempt id (no wall-clock). */
  attemptId: string;
  /** Test seam: when true, simulate a receipt-delivery failure. */
  simulateReceiptFailure?: boolean;
}

function categoryOf(error: unknown): DriverErrorCategory {
  if (error instanceof ExclusiveCreateDriverError) return error.category;
  return "internal-driver-failed";
}

export function createProjectFile(input: CreateProjectFileInput): FileCreationResult {
  const { proposal, descriptor, grant, registry, receiptLog, driver } = input;

  const finish = (opts: {
    attempted: boolean;
    grantConsumed: boolean;
    exclusiveOpenOccurred: boolean;
    bytesWritten: number;
    persistenceConfirmed: boolean;
    closeConfirmed: boolean;
    writePerformed: boolean;
    completed: boolean;
    residualArtifactPossible: boolean;
    residualArtifactState: ResidualArtifactState;
    failureStage: FileCreationFailureStage;
    reasonCode: string;
    status: ReceiptStatus;
    contentBytesFingerprint?: string;
  }): FileCreationResult => {
    let receiptDeliveryState: FileCreationResult["receiptDeliveryState"];
    try {
      // Test seam: an injected receipt-delivery failure must NOT erase the
      // disk-state truth already computed below.
      if (input.simulateReceiptFailure) throw new Error("injected receipt delivery failure");
      receiptLog.create({
        summary: `C2-B create attempt outcome: ${opts.status}.`,
        status: opts.status,
        links: {},
        details: {
          attemptId: input.attemptId,
          proposalId: proposal.proposalId,
          grantId: grant.grantId,
          normalizedRelativePathFingerprint: input.targetInspection.normalizedRelativePathFingerprint,
          contentBytesFingerprint: opts.contentBytesFingerprint,
          byteCount: descriptor.contentByteLength,
          bytesWritten: opts.bytesWritten,
          reasonCode: opts.reasonCode,
          lifecycleStage: opts.failureStage,
          exclusiveOpenOccurred: opts.exclusiveOpenOccurred,
          persistenceConfirmed: opts.persistenceConfirmed,
          closeConfirmed: opts.closeConfirmed,
          residualArtifactPossible: opts.residualArtifactPossible,
        },
      });
      receiptDeliveryState = "delivered";
    } catch {
      receiptDeliveryState = "failed";
    }

    return {
      proposalId: proposal.proposalId,
      grantId: grant.grantId,
      attemptId: input.attemptId,
      attempted: opts.attempted,
      exclusiveOpenOccurred: opts.exclusiveOpenOccurred,
      bytesWritten: opts.bytesWritten,
      persistenceConfirmed: opts.persistenceConfirmed,
      closeConfirmed: opts.closeConfirmed,
      residualArtifactPossible: opts.residualArtifactPossible,
      receiptWriteFailed: receiptDeliveryState === "failed",
      grantConsumed: opts.grantConsumed,
      writePerformed: opts.writePerformed,
      completed: opts.completed,
      simulated: driver.kind !== "real-node",
      executed: driver.kind === "real-node",
      requiresC2BPrimitive: false,
      byteCount: descriptor.contentByteLength,
      contentBytesFingerprint: opts.contentBytesFingerprint,
      failureStage: opts.failureStage,
      residualArtifactState: opts.residualArtifactState,
      receiptDeliveryState,
      reasonCode: opts.reasonCode,
    };
  };

  const noAttempt = (
    failureStage: FileCreationFailureStage,
    reasonCode: string,
    status: ReceiptStatus,
    contentBytesFingerprint?: string
  ): FileCreationResult =>
    finish({
      attempted: false,
      grantConsumed: false,
      exclusiveOpenOccurred: false,
      bytesWritten: 0,
      persistenceConfirmed: false,
      closeConfirmed: false,
      writePerformed: false,
      completed: false,
      residualArtifactPossible: false,
      residualArtifactState: "none",
      failureStage,
      reasonCode,
      status,
      contentBytesFingerprint,
    });

  // Gates A-G: permit identity, C0 approval, strict C2 policy, exact bytes,
  // and the injected fresh final inspection. No consumption occurs here.
  const candidate = evaluateWriteAttemptAdmission({
    permit: input.permit,
    proposal,
    descriptor,
    grant,
    consumed: registry.asConsumedApprovalState(),
    targetInspection: input.targetInspection,
    reviewVerdict: input.reviewVerdict,
    reviewReceiptId: input.reviewReceiptId,
    currentSequence: input.currentSequence,
    operationCount: input.operationCount,
  });

  if (candidate.status === "refused") {
    return noAttempt(
      "pre-admission",
      candidate.underlyingReasonCode ?? candidate.reasonCode,
      "refused",
      candidate.contentBytesFingerprint
    );
  }
  if (candidate.status === "blocked") {
    return noAttempt("filesystem-boundary", candidate.reasonCode, "blocked", candidate.contentBytesFingerprint);
  }

  // Step D/E: prepare the exact Buffer once and re-bind the exact-content-byte
  // fingerprint immediately before consuming/opening. Fail closed WITHOUT
  // consuming if anything drifted (defensive — never fires for a ready
  // candidate whose content is unchanged).
  const content = typeof proposal.proposedContent === "string" ? proposal.proposedContent : "";
  const prepared = prepareExactUtf8Content(content);
  if (!prepared.ok) {
    return noAttempt("pre-admission", "exact-byte-refused", "refused");
  }
  const buffer = Buffer.from(content, "utf8");
  const rebound = computeContentBytesFingerprint(buffer);
  const bytesPreserved =
    prepared.contentBytesFingerprint === candidate.contentBytesFingerprint &&
    rebound === candidate.contentBytesFingerprint &&
    buffer.length === descriptor.contentByteLength;
  if (!bytesPreserved) {
    return noAttempt("pre-admission", "exact-byte-fingerprint-mismatch", "refused", candidate.contentBytesFingerprint);
  }

  // Step G2 (§33): derive and PROVE the one physical target before anything
  // irreversible happens. This runs BEFORE `registry.consume` and BEFORE
  // `openExclusive`, so a binding failure leaves the grant unconsumed, no
  // exclusive open, and zero bytes written — `noAttempt` guarantees exactly
  // that shape. The target is not an input; it is derived here.
  const binding = bindCreateTarget({
    projectRoot: input.projectRoot,
    descriptor,
    proposalTargetRelativePath: proposal.targetRelativePath,
    targetInspection: input.targetInspection,
  });
  if (!binding.ok) {
    return noAttempt("target-binding", binding.reasonCode, "refused", candidate.contentBytesFingerprint);
  }

  // Step H: consume the grant immediately before open. From here it stays
  // consumed whether the attempt succeeds or fails; no automatic retry.
  registry.consume(grant.grantId);

  // Step I: drive the exclusive-create through the INJECTED driver.
  let exclusiveOpenOccurred = false;
  let bytesWritten = 0;
  let persistenceConfirmed = false;
  let closeConfirmed = false;
  let writePerformed = false;
  let failureStage: FileCreationFailureStage = "none";
  let reasonCode = "created";
  let handle: ExclusiveCreateHandle | undefined;

  try {
    try {
      // The DERIVED, fingerprint-bound target — never a caller-supplied string.
      handle = driver.openExclusive(binding.target);
      exclusiveOpenOccurred = true;
    } catch (error) {
      failureStage = "open";
      reasonCode = categoryOf(error) === "target-exists" ? "open-target-exists" : "open-failed";
    }

    if (handle !== undefined) {
      const maxIterations = buffer.length + 1; // each iteration must progress ≥1
      let iterations = 0;
      while (bytesWritten < buffer.length && failureStage === "none") {
        iterations += 1;
        if (iterations > maxIterations) {
          failureStage = "write";
          reasonCode = "internal-creator-failed";
          break;
        }
        const remaining = buffer.length - bytesWritten;
        let n: number;
        try {
          n = driver.write(handle, buffer, bytesWritten, remaining);
        } catch (error) {
          failureStage = "write";
          reasonCode = categoryOf(error) === "zero-progress-write" ? "zero-progress-write" : "write-failed";
          break;
        }
        if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > remaining) {
          failureStage = "write";
          reasonCode = "invalid-write-count";
          break;
        }
        if (n === 0) {
          failureStage = "write";
          reasonCode = "zero-progress-write";
          break;
        }
        bytesWritten += n;
        writePerformed = true;
      }

      if (failureStage === "none" && bytesWritten === buffer.length) {
        try {
          driver.sync(handle);
          persistenceConfirmed = true;
        } catch {
          failureStage = "persistence";
          reasonCode = "sync-failed";
        }
      }
    }
  } finally {
    if (handle !== undefined) {
      try {
        driver.close(handle);
        closeConfirmed = true;
      } catch {
        closeConfirmed = false;
        if (failureStage === "none") {
          failureStage = "close";
          reasonCode = "close-failed";
        }
      }
    }
  }

  const completed =
    exclusiveOpenOccurred &&
    bytesWritten === buffer.length &&
    persistenceConfirmed &&
    closeConfirmed &&
    failureStage === "none";

  // Exclusive-create is existence-atomic, NOT content-atomic: any admitted
  // failure after open may leave a zero-byte or partial residual artifact.
  const residualArtifactPossible = exclusiveOpenOccurred && !completed;
  const residualArtifactState: ResidualArtifactState = !residualArtifactPossible
    ? "none"
    : bytesWritten === 0
      ? "possible-zero-byte"
      : "possible-partial";

  const status: ReceiptStatus = completed
    ? "completed"
    : reasonCode === "open-target-exists"
      ? "blocked" // admitted boundary discovered at exclusive open
      : "failed";

  return finish({
    attempted: true,
    grantConsumed: true,
    exclusiveOpenOccurred,
    bytesWritten,
    persistenceConfirmed,
    closeConfirmed,
    writePerformed,
    completed,
    residualArtifactPossible,
    residualArtifactState,
    failureStage,
    reasonCode: completed ? "created" : reasonCode,
    status,
    contentBytesFingerprint: candidate.contentBytesFingerprint,
  });
}
