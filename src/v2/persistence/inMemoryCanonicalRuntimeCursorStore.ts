import { isDeepStrictEqual } from "node:util";

import {
  type CanonicalRuntimeCheckpoint,
  type CanonicalRuntimeCheckpointCasResult,
  type CanonicalRuntimeCheckpointCreateResult,
  type CanonicalRuntimeCursorStore,
  validateCanonicalRuntimeCheckpoint,
} from "./canonicalRuntimeCursorStore";

function cloneCheckpoint(
  checkpoint: CanonicalRuntimeCheckpoint,
): CanonicalRuntimeCheckpoint {
  return structuredClone(checkpoint);
}

function assertMissionId(
  missionId: string,
): void {
  if (missionId.trim().length === 0) {
    throw new Error(
      "CANONICAL_RUNTIME_MISSION_ID_EMPTY",
    );
  }
}

function assertValidCheckpoint(
  checkpoint: CanonicalRuntimeCheckpoint,
): void {
  const validation =
    validateCanonicalRuntimeCheckpoint(
      checkpoint,
    );

  if (!validation.ok) {
    throw new Error(
      `INVALID_CANONICAL_RUNTIME_CHECKPOINT:${validation.reasonCode}`,
    );
  }
}

function assertInitialCheckpoint(
  checkpoint: CanonicalRuntimeCheckpoint,
): void {
  if (
    checkpoint.checkpointVersion !== 1
  ) {
    throw new Error(
      "CANONICAL_RUNTIME_INITIAL_CHECKPOINT_VERSION_MUST_BE_1",
    );
  }

  const cursor =
    checkpoint.cursor;

  if (
    cursor.nodeIndex !== 0 ||
    cursor.nodeId !== "EER" ||
    cursor.nodeKind !== "FACTORY" ||
    cursor.stepVersion !== 1 ||
    cursor.contractPhase !== "PRE_FREEZE"
  ) {
    throw new Error(
      "CANONICAL_RUNTIME_INITIAL_CURSOR_INVALID",
    );
  }
}

function assertCursorContinuity(
  current: CanonicalRuntimeCheckpoint,
  next: CanonicalRuntimeCheckpoint,
): void {
  if (
    isDeepStrictEqual(
      current.cursor,
      next.cursor,
    )
  ) {
    return;
  }

  if (
    next.cursor.nodeIndex !==
      current.cursor.nodeIndex + 1 ||
    next.cursor.stepVersion !==
      current.cursor.stepVersion + 1
  ) {
    throw new Error(
      "CANONICAL_RUNTIME_CURSOR_TRANSITION_NOT_ADJACENT",
    );
  }
}

/**
 * In-memory reference store for the 10E6 canonical runtime checkpoint.
 *
 * This store owns persistence mechanics only. It does not authenticate
 * factory completions, NAMLA LOOP verdicts, execution leases or the
 * FROZEN_PLAN_CONTRACT boundary. Those remain orchestrator/authority duties.
 */
export class InMemoryCanonicalRuntimeCursorStore
  implements CanonicalRuntimeCursorStore
{
  private readonly checkpoints =
    new Map<
      string,
      CanonicalRuntimeCheckpoint
    >();

  public async create(
    checkpoint: CanonicalRuntimeCheckpoint,
  ): Promise<CanonicalRuntimeCheckpointCreateResult> {
    assertValidCheckpoint(
      checkpoint,
    );

    assertInitialCheckpoint(
      checkpoint,
    );

    const detached =
      cloneCheckpoint(
        checkpoint,
      );

    if (
      this.checkpoints.has(
        detached.missionId,
      )
    ) {
      return "ALREADY_EXISTS";
    }

    this.checkpoints.set(
      detached.missionId,
      detached,
    );

    return "CREATED";
  }

  public async load(
    missionId: string,
  ): Promise<CanonicalRuntimeCheckpoint | null> {
    assertMissionId(
      missionId,
    );

    const checkpoint =
      this.checkpoints.get(
        missionId,
      );

    if (!checkpoint) {
      return null;
    }

    return cloneCheckpoint(
      checkpoint,
    );
  }

  public async compareAndSet(
    missionId: string,
    expectedCheckpointVersion: number,
    checkpoint: CanonicalRuntimeCheckpoint,
  ): Promise<CanonicalRuntimeCheckpointCasResult> {
    assertMissionId(
      missionId,
    );

    if (
      !Number.isSafeInteger(
        expectedCheckpointVersion,
      ) ||
      expectedCheckpointVersion < 1
    ) {
      throw new Error(
        "INVALID_EXPECTED_CANONICAL_RUNTIME_CHECKPOINT_VERSION",
      );
    }

    if (
      checkpoint.missionId !==
      missionId
    ) {
      throw new Error(
        "CANONICAL_RUNTIME_CHECKPOINT_MISSION_ID_MISMATCH",
      );
    }

    assertValidCheckpoint(
      checkpoint,
    );

    const detached =
      cloneCheckpoint(
        checkpoint,
      );

    const current =
      this.checkpoints.get(
        missionId,
      );

    if (!current) {
      return {
        status: "NOT_FOUND",
      };
    }

    if (
      current.checkpointVersion !==
      expectedCheckpointVersion
    ) {
      return {
        status: "VERSION_CONFLICT",
        currentCheckpointVersion:
          current.checkpointVersion,
      };
    }

    if (
      detached.checkpointVersion !==
      expectedCheckpointVersion + 1
    ) {
      throw new Error(
        "NON_MONOTONIC_CANONICAL_RUNTIME_CHECKPOINT_VERSION",
      );
    }

    if (
      detached.savedAt <
      current.savedAt
    ) {
      throw new Error(
        "CANONICAL_RUNTIME_CHECKPOINT_SAVED_AT_REGRESSION",
      );
    }

    assertCursorContinuity(
      current,
      detached,
    );

    this.checkpoints.set(
      missionId,
      detached,
    );

    return {
      status: "UPDATED",
      checkpointVersion:
        detached.checkpointVersion,
    };
  }
}
