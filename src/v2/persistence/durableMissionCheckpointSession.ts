import {
  MissionCheckpoint,
  MissionCheckpointStore,
  MissionCheckpointValidationReason,
  validateMissionCheckpoint,
} from "./missionCheckpointStore";

type InvalidCheckpointReason =
  Exclude<MissionCheckpointValidationReason, "ok">;

export type DurableCheckpointSessionReasonCode =
  | "ok"
  | "session-failed-closed"
  | "session-not-active"
  | "session-already-active"
  | "mission-id-mismatch"
  | "initial-state-version-must-be-1"
  | "checkpoint-version-not-next"
  | "checkpoint-saved-at-regression"
  | "checkpoint-not-found"
  | "checkpoint-already-exists"
  | "checkpoint-version-conflict"
  | "checkpoint-disappeared"
  | "store-state-version-mismatch"
  | "storage-operation-failed"
  | `invalid-checkpoint:${InvalidCheckpointReason}`;

export type DurableCheckpointSessionSuccessStatus =
  | "CREATED"
  | "RESUMED"
  | "UPDATED";

export interface DurableCheckpointSessionSuccess {
  readonly ok: true;
  readonly status: DurableCheckpointSessionSuccessStatus;
  readonly reasonCode: "ok";
  readonly checkpoint: MissionCheckpoint;
}

export interface DurableCheckpointSessionFailure {
  readonly ok: false;
  readonly status: "REFUSED";
  readonly reasonCode: DurableCheckpointSessionReasonCode;
  readonly currentStateVersion?: number;
  readonly lockedByReasonCode?: DurableCheckpointSessionReasonCode;
}

export type DurableCheckpointSessionResult =
  | DurableCheckpointSessionSuccess
  | DurableCheckpointSessionFailure;

function cloneCheckpoint(
  checkpoint: MissionCheckpoint,
): MissionCheckpoint {
  return structuredClone(checkpoint);
}

/**
 * Storage-agnostic durable checkpoint session.
 *
 * Authority rules:
 *
 * 1. Initial durable creation starts at stateVersion=1.
 * 2. Resume loads exactly one persisted checkpoint and validates it.
 * 3. Every advance must be exactly currentVersion + 1.
 * 4. Persistence advances exclusively through compare-and-set.
 * 5. A CAS conflict, disappearing mission, malformed checkpoint, or
 *    storage failure permanently fail-closes this session instance.
 * 6. A failed/stale writer cannot silently reload and continue.
 *    Recovery requires constructing a new session and explicitly resuming.
 *
 * The class intentionally knows nothing about PostgreSQL. Any
 * MissionCheckpointStore implementation may be used.
 */
export class DurableMissionCheckpointSession {
  private currentCheckpoint: MissionCheckpoint | null = null;

  private failedClosedReason:
    | DurableCheckpointSessionReasonCode
    | null = null;

  public constructor(
    private readonly store: MissionCheckpointStore,
    public readonly missionId: string,
  ) {
    if (missionId.trim().length === 0) {
      throw new Error(
        "DURABLE_CHECKPOINT_SESSION_MISSION_ID_EMPTY",
      );
    }
  }

  public isActive(): boolean {
    return (
      this.currentCheckpoint !== null &&
      this.failedClosedReason === null
    );
  }

  public isFailedClosed(): boolean {
    return this.failedClosedReason !== null;
  }

  public getSnapshot(): MissionCheckpoint | null {
    if (!this.currentCheckpoint) {
      return null;
    }

    return cloneCheckpoint(this.currentCheckpoint);
  }

  /**
   * Creates the first durable checkpoint.
   *
   * This is deliberately not an upsert:
   * if the mission already exists the writer is stale/duplicated,
   * therefore the session fails closed.
   */
  public async createInitial(
    checkpoint: MissionCheckpoint,
  ): Promise<DurableCheckpointSessionResult> {
    const readinessFailure = this.ensureFreshSession();

    if (readinessFailure) {
      return readinessFailure;
    }

    const candidateFailure =
      this.validateCheckpointCandidate(checkpoint);

    if (candidateFailure) {
      return candidateFailure;
    }

    if (checkpoint.state.stateVersion !== 1) {
      return this.failClosed(
        "initial-state-version-must-be-1",
      );
    }

    try {
      const result = await this.store.create(
        cloneCheckpoint(checkpoint),
      );

      if (result !== "CREATED") {
        return this.failClosed(
          "checkpoint-already-exists",
        );
      }

      this.currentCheckpoint =
        cloneCheckpoint(checkpoint);

      return this.success(
        "CREATED",
        checkpoint,
      );
    }
    catch {
      return this.failClosed(
        "storage-operation-failed",
      );
    }
  }

  /**
   * Explicit crash/restart recovery boundary.
   *
   * A malformed or missing persisted checkpoint is never converted
   * into a fresh mission automatically.
   */
  public async resume():
    Promise<DurableCheckpointSessionResult> {
    const readinessFailure = this.ensureFreshSession();

    if (readinessFailure) {
      return readinessFailure;
    }

    let loaded: MissionCheckpoint | null;

    try {
      loaded = await this.store.load(this.missionId);
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
      this.validateCheckpointCandidate(loaded);

    if (candidateFailure) {
      return candidateFailure;
    }

    this.currentCheckpoint =
      cloneCheckpoint(loaded);

    return this.success(
      "RESUMED",
      loaded,
    );
  }

  /**
   * Persists the next checkpoint with optimistic concurrency.
   *
   * Only an exact +1 stateVersion transition is legal.
   */
  public async advance(
    nextCheckpoint: MissionCheckpoint,
  ): Promise<DurableCheckpointSessionResult> {
    const activeFailure = this.ensureActiveSession();

    if (activeFailure) {
      return activeFailure;
    }

    const current = this.currentCheckpoint!;

    const candidateFailure =
      this.validateCheckpointCandidate(
        nextCheckpoint,
      );

    if (candidateFailure) {
      return candidateFailure;
    }

    if (
      nextCheckpoint.state.stateVersion !==
      current.state.stateVersion + 1
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

    try {
      const result =
        await this.store.compareAndSet(
          this.missionId,
          current.state.stateVersion,
          cloneCheckpoint(nextCheckpoint),
        );

      if (result.status === "VERSION_CONFLICT") {
        return this.failClosed(
          "checkpoint-version-conflict",
          result.currentStateVersion,
        );
      }

      if (result.status === "NOT_FOUND") {
        return this.failClosed(
          "checkpoint-disappeared",
        );
      }

      if (
        result.stateVersion !==
        nextCheckpoint.state.stateVersion
      ) {
        return this.failClosed(
          "store-state-version-mismatch",
          result.stateVersion,
        );
      }

      this.currentCheckpoint =
        cloneCheckpoint(nextCheckpoint);

      return this.success(
        "UPDATED",
        nextCheckpoint,
      );
    }
    catch {
      return this.failClosed(
        "storage-operation-failed",
      );
    }
  }

  private validateCheckpointCandidate(
    checkpoint: MissionCheckpoint,
  ): DurableCheckpointSessionFailure | null {
    if (
      checkpoint.missionId !==
      this.missionId
    ) {
      return this.failClosed(
        "mission-id-mismatch",
      );
    }

    const validation =
      validateMissionCheckpoint(checkpoint);

    if (!validation.ok) {
      return this.failClosed(
        `invalid-checkpoint:${validation.reasonCode}` as
          DurableCheckpointSessionReasonCode,
      );
    }

    return null;
  }

  private ensureFreshSession():
    DurableCheckpointSessionFailure | null {
    if (this.failedClosedReason) {
      return {
        ok: false,
        status: "REFUSED",
        reasonCode: "session-failed-closed",
        lockedByReasonCode:
          this.failedClosedReason,
      };
    }

    if (this.currentCheckpoint) {
      return this.failClosed(
        "session-already-active",
      );
    }

    return null;
  }

  private ensureActiveSession():
    DurableCheckpointSessionFailure | null {
    if (this.failedClosedReason) {
      return {
        ok: false,
        status: "REFUSED",
        reasonCode: "session-failed-closed",
        lockedByReasonCode:
          this.failedClosedReason,
      };
    }

    if (!this.currentCheckpoint) {
      return this.failClosed(
        "session-not-active",
      );
    }

    return null;
  }

  private success(
    status: DurableCheckpointSessionSuccessStatus,
    checkpoint: MissionCheckpoint,
  ): DurableCheckpointSessionSuccess {
    return {
      ok: true,
      status,
      reasonCode: "ok",
      checkpoint:
        cloneCheckpoint(checkpoint),
    };
  }

  private failClosed(
    reasonCode:
      DurableCheckpointSessionReasonCode,
    currentStateVersion?: number,
  ): DurableCheckpointSessionFailure {
    if (!this.failedClosedReason) {
      this.failedClosedReason = reasonCode;
    }

    return {
      ok: false,
      status: "REFUSED",
      reasonCode,
      ...(currentStateVersion !== undefined
        ? { currentStateVersion }
        : {}),
      lockedByReasonCode:
        this.failedClosedReason,
    };
  }
}