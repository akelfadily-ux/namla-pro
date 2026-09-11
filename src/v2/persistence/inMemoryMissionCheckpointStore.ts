import {
  MissionCheckpoint,
  MissionCheckpointCasResult,
  MissionCheckpointCreateResult,
  MissionCheckpointStore,
  validateMissionCheckpoint,
} from "./missionCheckpointStore";

function cloneCheckpoint(
  checkpoint: MissionCheckpoint,
): MissionCheckpoint {
  return structuredClone(checkpoint);
}

function assertValidCheckpoint(
  checkpoint: MissionCheckpoint,
): void {
  const validation = validateMissionCheckpoint(checkpoint);

  if (!validation.ok) {
    throw new Error(
      `INVALID_MISSION_CHECKPOINT:${validation.reasonCode}`,
    );
  }
}

export class InMemoryMissionCheckpointStore
  implements MissionCheckpointStore
{
  private readonly checkpoints =
    new Map<string, MissionCheckpoint>();

  public async create(
    checkpoint: MissionCheckpoint,
  ): Promise<MissionCheckpointCreateResult> {
    assertValidCheckpoint(checkpoint);

    if (this.checkpoints.has(checkpoint.missionId)) {
      return "ALREADY_EXISTS";
    }

    this.checkpoints.set(
      checkpoint.missionId,
      cloneCheckpoint(checkpoint),
    );

    return "CREATED";
  }

  public async load(
    missionId: string,
  ): Promise<MissionCheckpoint | null> {
    const checkpoint = this.checkpoints.get(missionId);

    if (!checkpoint) {
      return null;
    }

    return cloneCheckpoint(checkpoint);
  }

  public async compareAndSet(
    missionId: string,
    expectedStateVersion: number,
    checkpoint: MissionCheckpoint,
  ): Promise<MissionCheckpointCasResult> {
    if (
      !Number.isSafeInteger(expectedStateVersion) ||
      expectedStateVersion < 1
    ) {
      throw new Error("INVALID_EXPECTED_STATE_VERSION");
    }

    if (checkpoint.missionId !== missionId) {
      throw new Error("MISSION_ID_MISMATCH");
    }

    assertValidCheckpoint(checkpoint);

    const current = this.checkpoints.get(missionId);

    if (!current) {
      return {
        status: "NOT_FOUND",
      };
    }

    if (
      current.state.stateVersion !==
      expectedStateVersion
    ) {
      return {
        status: "VERSION_CONFLICT",
        currentStateVersion:
          current.state.stateVersion,
      };
    }

    if (
      checkpoint.state.stateVersion !==
      expectedStateVersion + 1
    ) {
      throw new Error(
        "NON_MONOTONIC_STATE_VERSION",
      );
    }

    this.checkpoints.set(
      missionId,
      cloneCheckpoint(checkpoint),
    );

    return {
      status: "UPDATED",
      stateVersion:
        checkpoint.state.stateVersion,
    };
  }
}