import { isDeepStrictEqual } from "node:util";

import {
  type CanonicalRuntimeCheckpoint,
  type CanonicalRuntimeCheckpointValidationReason,
  type CanonicalRuntimeCursorStore,
  validateCanonicalRuntimeCheckpoint,
} from "./canonicalRuntimeCursorStore";

export type DurableCanonicalRuntimeCursorSessionReasonCode =
  | "ok"
  | "session-failed-closed"
  | "session-not-active"
  | "session-already-active"
  | "mission-id-mismatch"
  | "initial-checkpoint-version-must-be-1"
  | "initial-cursor-invalid"
  | "checkpoint-version-not-next"
  | "checkpoint-saved-at-regression"
  | "cursor-transition-not-allowed"
  | "checkpoint-not-found"
  | "checkpoint-already-exists"
  | "checkpoint-version-conflict"
  | "checkpoint-disappeared"
  | "store-checkpoint-version-mismatch"
  | "storage-operation-failed"
  | `invalid-checkpoint:${CanonicalRuntimeCheckpointValidationReason}`;

export type DurableCanonicalRuntimeCursorSessionSuccessStatus =
  | "CREATED"
  | "RESUMED"
  | "UPDATED";

export interface DurableCanonicalRuntimeCursorSessionSuccess {
  readonly ok: true;
  readonly status:
    DurableCanonicalRuntimeCursorSessionSuccessStatus;
  readonly reasonCode: "ok";
  readonly checkpoint:
    CanonicalRuntimeCheckpoint;
}

export interface DurableCanonicalRuntimeCursorSessionFailure {
  readonly ok: false;
  readonly status: "REFUSED";
  readonly reasonCode:
    DurableCanonicalRuntimeCursorSessionReasonCode;
  readonly currentCheckpointVersion?: number;
  readonly lockedByReasonCode?:
    DurableCanonicalRuntimeCursorSessionReasonCode;
}

export type DurableCanonicalRuntimeCursorSessionResult =
  | DurableCanonicalRuntimeCursorSessionSuccess
  | DurableCanonicalRuntimeCursorSessionFailure;

function cloneCheckpoint(
  checkpoint: CanonicalRuntimeCheckpoint,
): CanonicalRuntimeCheckpoint {
  return structuredClone(checkpoint);
}

function isInitialCursor(
  checkpoint: CanonicalRuntimeCheckpoint,
): boolean {
  const cursor =
    checkpoint.cursor;

  return (
    cursor.nodeIndex === 0 &&
    cursor.nodeId === "EER" &&
    cursor.nodeKind === "FACTORY" &&
    cursor.stepVersion === 1 &&
    cursor.contractPhase === "PRE_FREEZE"
  );
}

function cursorTransitionAllowed(
  current: CanonicalRuntimeCheckpoint,
  next: CanonicalRuntimeCheckpoint,
): boolean {
  if (
    isDeepStrictEqual(
      current.cursor,
      next.cursor,
    )
  ) {
    return true;
  }

  return (
    next.cursor.nodeIndex ===
      current.cursor.nodeIndex + 1 &&
    next.cursor.stepVersion ===
      current.cursor.stepVersion + 1
  );
}

/**
 * Durable CAS session for the canonical runtime checkpoint.
 *
 * Authority rules:
 *
 * 1. Initial creation is checkpointVersion=1 at canonical EER.
 * 2. Resume is explicit and validates persisted data.
 * 3. Every persistence update is exactly checkpointVersion + 1.
 * 4. Cursor persistence may remain on the same node or advance one node.
 * 5. Writes use compare-and-set exclusively.
 * 6. Conflicts, corruption, disappearance and storage failures fail closed.
 * 7. A failed/stale session cannot reload and continue. Recovery requires
 *    constructing a new session and explicitly calling resume().
 *
 * This class does NOT authorize factory execution, gate passage, retries,
 * execution leases, or FROZEN_PLAN_CONTRACT establishment.
 */
export class DurableCanonicalRuntimeCursorSession {
  private currentCheckpoint:
    CanonicalRuntimeCheckpoint | null =
      null;

  private failedClosedReason:
    | DurableCanonicalRuntimeCursorSessionReasonCode
    | null = null;

  public constructor(
    private readonly store:
      CanonicalRuntimeCursorStore,
    public readonly missionId:
      string,
  ) {
    if (
      missionId.trim().length === 0
    ) {
      throw new Error(
        "DURABLE_CANONICAL_RUNTIME_CURSOR_SESSION_MISSION_ID_EMPTY",
      );
    }
  }

  public isActive(): boolean {
    return (
      this.currentCheckpoint !==
        null &&
      this.failedClosedReason ===
        null
    );
  }

  public isFailedClosed(): boolean {
    return (
      this.failedClosedReason !==
      null
    );
  }

  public getSnapshot():
    CanonicalRuntimeCheckpoint | null {
    if (!this.currentCheckpoint) {
      return null;
    }

    return cloneCheckpoint(
      this.currentCheckpoint,
    );
  }

  public async createInitial(
    checkpoint:
      CanonicalRuntimeCheckpoint,
  ): Promise<DurableCanonicalRuntimeCursorSessionResult> {
    const readinessFailure =
      this.ensureFreshSession();

    if (readinessFailure) {
      return readinessFailure;
    }

    const candidateFailure =
      this.validateCheckpointCandidate(
        checkpoint,
      );

    if (candidateFailure) {
      return candidateFailure;
    }

    if (
      checkpoint.checkpointVersion !==
      1
    ) {
      return this.failClosed(
        "initial-checkpoint-version-must-be-1",
      );
    }

    if (
      !isInitialCursor(
        checkpoint,
      )
    ) {
      return this.failClosed(
        "initial-cursor-invalid",
      );
    }

    const detached =
      cloneCheckpoint(
        checkpoint,
      );

    try {
      const result =
        await this.store.create(
          detached,
        );

      if (
        result !==
        "CREATED"
      ) {
        return this.failClosed(
          "checkpoint-already-exists",
        );
      }

      this.currentCheckpoint =
        cloneCheckpoint(
          detached,
        );

      return this.success(
        "CREATED",
        detached,
      );
    }
    catch {
      return this.failClosed(
        "storage-operation-failed",
      );
    }
  }

  /**
   * Explicit process restart / recovery boundary.
   *
   * Missing or malformed persisted state is never converted into a new
   * mission automatically.
   */
  public async resume():
    Promise<DurableCanonicalRuntimeCursorSessionResult> {
    const readinessFailure =
      this.ensureFreshSession();

    if (readinessFailure) {
      return readinessFailure;
    }

    let loaded:
      CanonicalRuntimeCheckpoint | null;

    try {
      loaded =
        await this.store.load(
          this.missionId,
        );
    }
    catch {
      return this.failClosed(
        "storage-operation-failed",
      );
    }

    if (!loaded) {
      return this.failClosed(
        "checkpoint-not-found",
      );
    }

    const candidateFailure =
      this.validateCheckpointCandidate(
        loaded,
      );

    if (candidateFailure) {
      return candidateFailure;
    }

    this.currentCheckpoint =
      cloneCheckpoint(
        loaded,
      );

    return this.success(
      "RESUMED",
      loaded,
    );
  }

  public async advance(
    nextCheckpoint:
      CanonicalRuntimeCheckpoint,
  ): Promise<DurableCanonicalRuntimeCursorSessionResult> {
    const activeFailure =
      this.ensureActiveSession();

    if (activeFailure) {
      return activeFailure;
    }

    const current =
      this.currentCheckpoint!;

    const candidateFailure =
      this.validateCheckpointCandidate(
        nextCheckpoint,
      );

    if (candidateFailure) {
      return candidateFailure;
    }

    if (
      nextCheckpoint.checkpointVersion !==
      current.checkpointVersion + 1
    ) {
      return this.failClosed(
        "checkpoint-version-not-next",
      );
    }

    if (
      nextCheckpoint.savedAt <
      current.savedAt
    ) {
      return this.failClosed(
        "checkpoint-saved-at-regression",
      );
    }

    if (
      !cursorTransitionAllowed(
        current,
        nextCheckpoint,
      )
    ) {
      return this.failClosed(
        "cursor-transition-not-allowed",
      );
    }

    const detached =
      cloneCheckpoint(
        nextCheckpoint,
      );

    try {
      const result =
        await this.store.compareAndSet(
          this.missionId,
          current.checkpointVersion,
          detached,
        );

      if (
        result.status ===
        "VERSION_CONFLICT"
      ) {
        return this.failClosed(
          "checkpoint-version-conflict",
          result.currentCheckpointVersion,
        );
      }

      if (
        result.status ===
        "NOT_FOUND"
      ) {
        return this.failClosed(
          "checkpoint-disappeared",
        );
      }

      if (
        result.checkpointVersion !==
        detached.checkpointVersion
      ) {
        return this.failClosed(
          "store-checkpoint-version-mismatch",
          result.checkpointVersion,
        );
      }

      this.currentCheckpoint =
        cloneCheckpoint(
          detached,
        );

      return this.success(
        "UPDATED",
        detached,
      );
    }
    catch {
      return this.failClosed(
        "storage-operation-failed",
      );
    }
  }

  private validateCheckpointCandidate(
    checkpoint:
      CanonicalRuntimeCheckpoint,
  ):
    | DurableCanonicalRuntimeCursorSessionFailure
    | null {
    if (
      checkpoint.missionId !==
      this.missionId
    ) {
      return this.failClosed(
        "mission-id-mismatch",
      );
    }

    const validation =
      validateCanonicalRuntimeCheckpoint(
        checkpoint,
      );

    if (!validation.ok) {
      return this.failClosed(
        `invalid-checkpoint:${validation.reasonCode}`,
      );
    }

    return null;
  }

  private ensureFreshSession():
    DurableCanonicalRuntimeCursorSessionFailure | null {
    if (
      this.failedClosedReason
    ) {
      return {
        ok: false,
        status: "REFUSED",
        reasonCode:
          "session-failed-closed",
        lockedByReasonCode:
          this.failedClosedReason,
      };
    }

    if (
      this.currentCheckpoint
    ) {
      return this.failClosed(
        "session-already-active",
      );
    }

    return null;
  }

  private ensureActiveSession():
    DurableCanonicalRuntimeCursorSessionFailure | null {
    if (
      this.failedClosedReason
    ) {
      return {
        ok: false,
        status: "REFUSED",
        reasonCode:
          "session-failed-closed",
        lockedByReasonCode:
          this.failedClosedReason,
      };
    }

    if (
      !this.currentCheckpoint
    ) {
      return this.failClosed(
        "session-not-active",
      );
    }

    return null;
  }

  private success(
    status:
      DurableCanonicalRuntimeCursorSessionSuccessStatus,
    checkpoint:
      CanonicalRuntimeCheckpoint,
  ): DurableCanonicalRuntimeCursorSessionSuccess {
    return {
      ok: true,
      status,
      reasonCode:
        "ok",
      checkpoint:
        cloneCheckpoint(
          checkpoint,
        ),
    };
  }

  private failClosed(
    reasonCode:
      DurableCanonicalRuntimeCursorSessionReasonCode,
    currentCheckpointVersion?:
      number,
  ): DurableCanonicalRuntimeCursorSessionFailure {
    if (
      !this.failedClosedReason
    ) {
      this.failedClosedReason =
        reasonCode;
    }

    return {
      ok: false,
      status:
        "REFUSED",
      reasonCode,
      ...(currentCheckpointVersion !==
      undefined
        ? {
            currentCheckpointVersion,
          }
        : {}),
      lockedByReasonCode:
        this.failedClosedReason,
    };
  }
}
