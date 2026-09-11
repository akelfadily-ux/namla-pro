import {
  MissionCheckpoint,
  MissionCheckpointCasResult,
  MissionCheckpointCreateResult,
  MissionCheckpointStore,
  V2_MISSION_CHECKPOINT_SCHEMA,
  validateMissionCheckpoint,
} from "./missionCheckpointStore";

export interface PostgresCheckpointQueryResult<T> {
  readonly rows: readonly T[];
  readonly rowCount?: number | null;
}

export interface PostgresCheckpointClient {
  query<T = unknown>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<PostgresCheckpointQueryResult<T>>;
}

export interface PostgresCheckpointDatabase
  extends PostgresCheckpointClient
{
  transaction<T>(
    work: (
      client: PostgresCheckpointClient,
    ) => Promise<T>,
  ): Promise<T>;
}

interface StoredCheckpointRow {
  readonly mission_id: unknown;
  readonly schema_version: unknown;
  readonly state_version: unknown;
  readonly checkpoint: unknown;
  readonly saved_at: unknown;
}

interface StateVersionRow {
  readonly state_version: unknown;
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function parsePositiveSafeInteger(
  value: unknown,
  field: string,
): number {
  let parsed: number;

  if (typeof value === "number") {
    parsed = value;
  } else if (
    typeof value === "string" &&
    /^[0-9]+$/.test(value)
  ) {
    parsed = Number(value);
  } else {
    throw new Error(
      `POSTGRES_INVALID_INTEGER:${field}`,
    );
  }

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1
  ) {
    throw new Error(
      `POSTGRES_INVALID_INTEGER:${field}`,
    );
  }

  return parsed;
}

function assertValidCheckpoint(
  checkpoint: MissionCheckpoint,
): void {
  const validation =
    validateMissionCheckpoint(checkpoint);

  if (!validation.ok) {
    throw new Error(
      `INVALID_MISSION_CHECKPOINT:${validation.reasonCode}`,
    );
  }
}

function encodeCheckpoint(
  checkpoint: MissionCheckpoint,
): string {
  assertValidCheckpoint(checkpoint);

  try {
    const encoded = JSON.stringify(checkpoint);

    if (typeof encoded !== "string") {
      throw new Error(
        "MISSION_CHECKPOINT_NOT_JSON_SERIALIZABLE",
      );
    }

    return encoded;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message ===
        "MISSION_CHECKPOINT_NOT_JSON_SERIALIZABLE"
    ) {
      throw error;
    }

    throw new Error(
      "MISSION_CHECKPOINT_NOT_JSON_SERIALIZABLE",
    );
  }
}

function decodeCheckpointValue(
  value: unknown,
): MissionCheckpoint {
  let decoded: unknown = value;

  if (typeof decoded === "string") {
    try {
      decoded = JSON.parse(decoded);
    } catch {
      throw new Error(
        "POSTGRES_CORRUPT_CHECKPOINT_JSON",
      );
    }
  }

  if (!isRecord(decoded)) {
    throw new Error(
      "POSTGRES_CORRUPT_CHECKPOINT_SHAPE",
    );
  }

  if (
    decoded.schemaVersion !==
    V2_MISSION_CHECKPOINT_SCHEMA
  ) {
    throw new Error(
      "POSTGRES_CORRUPT_CHECKPOINT_SCHEMA",
    );
  }

  if (
    typeof decoded.missionId !== "string" ||
    !isRecord(decoded.state) ||
    !isRecord(decoded.loopBudget) ||
    !Array.isArray(decoded.evidenceRecords) ||
    !Array.isArray(decoded.integratedCandidates) ||
    typeof decoded.savedAt !== "number"
  ) {
    throw new Error(
      "POSTGRES_CORRUPT_CHECKPOINT_SHAPE",
    );
  }

  const state = decoded.state;

  if (
    !Array.isArray(state.activeWorkPackages) ||
    !Array.isArray(state.executions)
  ) {
    throw new Error(
      "POSTGRES_CORRUPT_CHECKPOINT_SHAPE",
    );
  }

  if (
    !state.activeWorkPackages.every(isRecord) ||
    !decoded.evidenceRecords.every(isRecord) ||
    !decoded.integratedCandidates.every(isRecord)
  ) {
    throw new Error(
      "POSTGRES_CORRUPT_CHECKPOINT_SHAPE",
    );
  }

  const checkpoint =
    decoded as unknown as MissionCheckpoint;

  const validation =
    validateMissionCheckpoint(checkpoint);

  if (!validation.ok) {
    throw new Error(
      `POSTGRES_CORRUPT_CHECKPOINT:${validation.reasonCode}`,
    );
  }

  return checkpoint;
}

function decodeStoredRow(
  row: StoredCheckpointRow,
  requestedMissionId: string,
): MissionCheckpoint {
  if (
    typeof row.mission_id !== "string" ||
    typeof row.schema_version !== "string"
  ) {
    throw new Error(
      "POSTGRES_CORRUPT_CHECKPOINT_ROW",
    );
  }

  if (row.mission_id !== requestedMissionId) {
    throw new Error(
      "POSTGRES_ROW_MISSION_ID_MISMATCH",
    );
  }

  if (
    row.schema_version !==
    V2_MISSION_CHECKPOINT_SCHEMA
  ) {
    throw new Error(
      "POSTGRES_ROW_SCHEMA_MISMATCH",
    );
  }

  const rowStateVersion =
    parsePositiveSafeInteger(
      row.state_version,
      "state_version",
    );

  const rowSavedAt =
    parsePositiveSafeInteger(
      row.saved_at,
      "saved_at",
    );

  const checkpoint =
    decodeCheckpointValue(row.checkpoint);

  if (
    checkpoint.missionId !==
    requestedMissionId
  ) {
    throw new Error(
      "POSTGRES_CHECKPOINT_MISSION_ID_MISMATCH",
    );
  }

  if (
    checkpoint.state.stateVersion !==
    rowStateVersion
  ) {
    throw new Error(
      "POSTGRES_ROW_STATE_VERSION_MISMATCH",
    );
  }

  if (
    checkpoint.savedAt !==
    rowSavedAt
  ) {
    throw new Error(
      "POSTGRES_ROW_SAVED_AT_MISMATCH",
    );
  }

  return structuredClone(checkpoint);
}

function assertMissionId(
  missionId: string,
): void {
  if (missionId.trim().length === 0) {
    throw new Error("MISSION_ID_EMPTY");
  }
}

export class PostgresMissionCheckpointStore
  implements MissionCheckpointStore
{
  public constructor(
    private readonly database:
      PostgresCheckpointDatabase,
  ) {}

  public async create(
    checkpoint: MissionCheckpoint,
  ): Promise<MissionCheckpointCreateResult> {
    const encoded =
      encodeCheckpoint(checkpoint);

    const result =
      await this.database.query<{
        readonly mission_id: string;
      }>(
        `
INSERT INTO namla_v2_mission_checkpoints (
  mission_id,
  schema_version,
  state_version,
  checkpoint,
  saved_at
)
VALUES ($1, $2, $3, $4::jsonb, $5)
ON CONFLICT (mission_id) DO NOTHING
RETURNING mission_id
        `.trim(),
        [
          checkpoint.missionId,
          checkpoint.schemaVersion,
          checkpoint.state.stateVersion,
          encoded,
          checkpoint.savedAt,
        ],
      );

    if (result.rows.length === 1) {
      return "CREATED";
    }

    if (result.rows.length === 0) {
      return "ALREADY_EXISTS";
    }

    throw new Error(
      "POSTGRES_CREATE_CARDINALITY_VIOLATION",
    );
  }

  public async load(
    missionId: string,
  ): Promise<MissionCheckpoint | null> {
    assertMissionId(missionId);

    const result =
      await this.database.query<StoredCheckpointRow>(
        `
SELECT
  mission_id,
  schema_version,
  state_version,
  checkpoint,
  saved_at
FROM namla_v2_mission_checkpoints
WHERE mission_id = $1
        `.trim(),
        [missionId],
      );

    if (result.rows.length === 0) {
      return null;
    }

    if (result.rows.length !== 1) {
      throw new Error(
        "POSTGRES_LOAD_CARDINALITY_VIOLATION",
      );
    }

    return decodeStoredRow(
      result.rows[0],
      missionId,
    );
  }

  public async compareAndSet(
    missionId: string,
    expectedStateVersion: number,
    checkpoint: MissionCheckpoint,
  ): Promise<MissionCheckpointCasResult> {
    assertMissionId(missionId);

    if (
      !Number.isSafeInteger(expectedStateVersion) ||
      expectedStateVersion < 1
    ) {
      throw new Error(
        "INVALID_EXPECTED_STATE_VERSION",
      );
    }

    if (checkpoint.missionId !== missionId) {
      throw new Error(
        "MISSION_ID_MISMATCH",
      );
    }

    assertValidCheckpoint(checkpoint);

    if (
      checkpoint.state.stateVersion !==
      expectedStateVersion + 1
    ) {
      throw new Error(
        "NON_MONOTONIC_STATE_VERSION",
      );
    }

    const encoded =
      encodeCheckpoint(checkpoint);

    return this.database.transaction(
      async (client) => {
        const locked =
          await client.query<StateVersionRow>(
            `
SELECT state_version
FROM namla_v2_mission_checkpoints
WHERE mission_id = $1
FOR UPDATE
            `.trim(),
            [missionId],
          );

        if (locked.rows.length === 0) {
          return {
            status: "NOT_FOUND",
          };
        }

        if (locked.rows.length !== 1) {
          throw new Error(
            "POSTGRES_LOCK_CARDINALITY_VIOLATION",
          );
        }

        const currentStateVersion =
          parsePositiveSafeInteger(
            locked.rows[0].state_version,
            "state_version",
          );

        if (
          currentStateVersion !==
          expectedStateVersion
        ) {
          return {
            status: "VERSION_CONFLICT",
            currentStateVersion,
          };
        }

        const updated =
          await client.query<StateVersionRow>(
            `
UPDATE namla_v2_mission_checkpoints
SET
  schema_version = $3,
  state_version = $4,
  checkpoint = $5::jsonb,
  saved_at = $6,
  updated_at = NOW()
WHERE
  mission_id = $1
  AND state_version = $2
RETURNING state_version
            `.trim(),
            [
              missionId,
              expectedStateVersion,
              checkpoint.schemaVersion,
              checkpoint.state.stateVersion,
              encoded,
              checkpoint.savedAt,
            ],
          );

        if (updated.rows.length !== 1) {
          throw new Error(
            "POSTGRES_CAS_WRITE_LOST",
          );
        }

        const writtenVersion =
          parsePositiveSafeInteger(
            updated.rows[0].state_version,
            "state_version",
          );

        if (
          writtenVersion !==
          checkpoint.state.stateVersion
        ) {
          throw new Error(
            "POSTGRES_CAS_VERSION_MISMATCH",
          );
        }

        return {
          status: "UPDATED",
          stateVersion: writtenVersion,
        };
      },
    );
  }
}