import { isDeepStrictEqual } from "node:util";

import {
  V2_CANONICAL_RUNTIME_CHECKPOINT_SCHEMA,
  type CanonicalRuntimeCheckpoint,
  type CanonicalRuntimeCheckpointCasResult,
  type CanonicalRuntimeCheckpointCreateResult,
  type CanonicalRuntimeCursorStore,
  validateCanonicalRuntimeCheckpoint,
} from "./canonicalRuntimeCursorStore";

import {
  type PostgresCheckpointDatabase,
} from "./postgresMissionCheckpointStore";

interface StoredCanonicalRuntimeCheckpointRow {
  readonly mission_id: unknown;
  readonly schema_version: unknown;
  readonly checkpoint_version: unknown;
  readonly cursor_step_version: unknown;
  readonly checkpoint: unknown;
  readonly saved_at: unknown;
}

interface WrittenCanonicalRuntimeVersionRow {
  readonly checkpoint_version: unknown;
  readonly cursor_step_version: unknown;
}

function parsePositiveSafeInteger(
  value: unknown,
  field: string,
): number {
  let parsed: number;

  if (typeof value === "number") {
    parsed = value;
  }
  else if (
    typeof value === "string" &&
    /^[0-9]+$/.test(value)
  ) {
    parsed = Number(value);
  }
  else {
    throw new Error(
      `POSTGRES_CANONICAL_RUNTIME_INVALID_INTEGER:${field}`,
    );
  }

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1
  ) {
    throw new Error(
      `POSTGRES_CANONICAL_RUNTIME_INVALID_INTEGER:${field}`,
    );
  }

  return parsed;
}

function assertMissionId(
  missionId: string,
): void {
  if (
    missionId.trim().length === 0
  ) {
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
    checkpoint.checkpointVersion !==
    1
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

function cloneCheckpoint(
  checkpoint: CanonicalRuntimeCheckpoint,
): CanonicalRuntimeCheckpoint {
  return structuredClone(
    checkpoint,
  );
}

function encodeCheckpoint(
  checkpoint: CanonicalRuntimeCheckpoint,
): string {
  assertValidCheckpoint(
    checkpoint,
  );

  try {
    const encoded =
      JSON.stringify(
        checkpoint,
      );

    if (
      typeof encoded !==
      "string"
    ) {
      throw new Error(
        "CANONICAL_RUNTIME_CHECKPOINT_NOT_JSON_SERIALIZABLE",
      );
    }

    return encoded;
  }
  catch (error) {
    if (
      error instanceof Error &&
      error.message ===
        "CANONICAL_RUNTIME_CHECKPOINT_NOT_JSON_SERIALIZABLE"
    ) {
      throw error;
    }

    throw new Error(
      "CANONICAL_RUNTIME_CHECKPOINT_NOT_JSON_SERIALIZABLE",
    );
  }
}

function decodeCheckpointValue(
  value: unknown,
): CanonicalRuntimeCheckpoint {
  let decoded:
    unknown = value;

  if (
    typeof decoded ===
    "string"
  ) {
    try {
      decoded =
        JSON.parse(
          decoded,
        );
    }
    catch {
      throw new Error(
        "POSTGRES_CANONICAL_RUNTIME_CORRUPT_CHECKPOINT_JSON",
      );
    }
  }

  const validation =
    validateCanonicalRuntimeCheckpoint(
      decoded,
    );

  if (!validation.ok) {
    throw new Error(
      `POSTGRES_CANONICAL_RUNTIME_CORRUPT_CHECKPOINT:${validation.reasonCode}`,
    );
  }

  return cloneCheckpoint(
    decoded as CanonicalRuntimeCheckpoint,
  );
}

function decodeStoredRow(
  row:
    StoredCanonicalRuntimeCheckpointRow,
  requestedMissionId:
    string,
): CanonicalRuntimeCheckpoint {
  if (
    typeof row.mission_id !==
      "string" ||
    typeof row.schema_version !==
      "string"
  ) {
    throw new Error(
      "POSTGRES_CANONICAL_RUNTIME_CORRUPT_ROW",
    );
  }

  if (
    row.mission_id !==
    requestedMissionId
  ) {
    throw new Error(
      "POSTGRES_CANONICAL_RUNTIME_ROW_MISSION_ID_MISMATCH",
    );
  }

  if (
    row.schema_version !==
    V2_CANONICAL_RUNTIME_CHECKPOINT_SCHEMA
  ) {
    throw new Error(
      "POSTGRES_CANONICAL_RUNTIME_ROW_SCHEMA_MISMATCH",
    );
  }

  const rowCheckpointVersion =
    parsePositiveSafeInteger(
      row.checkpoint_version,
      "checkpoint_version",
    );

  const rowCursorStepVersion =
    parsePositiveSafeInteger(
      row.cursor_step_version,
      "cursor_step_version",
    );

  const rowSavedAt =
    parsePositiveSafeInteger(
      row.saved_at,
      "saved_at",
    );

  const checkpoint =
    decodeCheckpointValue(
      row.checkpoint,
    );

  if (
    checkpoint.missionId !==
    requestedMissionId
  ) {
    throw new Error(
      "POSTGRES_CANONICAL_RUNTIME_CHECKPOINT_MISSION_ID_MISMATCH",
    );
  }

  if (
    checkpoint.checkpointVersion !==
    rowCheckpointVersion
  ) {
    throw new Error(
      "POSTGRES_CANONICAL_RUNTIME_ROW_CHECKPOINT_VERSION_MISMATCH",
    );
  }

  if (
    checkpoint.cursor.stepVersion !==
    rowCursorStepVersion
  ) {
    throw new Error(
      "POSTGRES_CANONICAL_RUNTIME_ROW_CURSOR_STEP_VERSION_MISMATCH",
    );
  }

  if (
    checkpoint.savedAt !==
    rowSavedAt
  ) {
    throw new Error(
      "POSTGRES_CANONICAL_RUNTIME_ROW_SAVED_AT_MISMATCH",
    );
  }

  return cloneCheckpoint(
    checkpoint,
  );
}

/**
 * PostgreSQL-backed canonical runtime checkpoint store.
 *
 * The row is locked before CAS comparison. The current persisted checkpoint is
 * decoded and validated under the same transaction so cursor continuity and
 * savedAt monotonicity are checked against authoritative durable state.
 *
 * This store does not authorize execution or gate passage.
 */
export class PostgresCanonicalRuntimeCursorStore
  implements CanonicalRuntimeCursorStore
{
  public constructor(
    private readonly database:
      PostgresCheckpointDatabase,
  ) {}

  public async create(
    checkpoint:
      CanonicalRuntimeCheckpoint,
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

    const encoded =
      encodeCheckpoint(
        detached,
      );

    const result =
      await this.database.query<{
        readonly mission_id:
          string;
      }>(
        `
INSERT INTO namla_v2_canonical_runtime_checkpoints (
  mission_id,
  schema_version,
  checkpoint_version,
  cursor_step_version,
  checkpoint,
  saved_at
)
VALUES ($1, $2, $3, $4, $5::jsonb, $6)
ON CONFLICT (mission_id) DO NOTHING
RETURNING mission_id
        `.trim(),
        [
          detached.missionId,
          detached.schemaVersion,
          detached.checkpointVersion,
          detached.cursor.stepVersion,
          encoded,
          detached.savedAt,
        ],
      );

    if (
      result.rows.length ===
      1
    ) {
      return "CREATED";
    }

    if (
      result.rows.length ===
      0
    ) {
      return "ALREADY_EXISTS";
    }

    throw new Error(
      "POSTGRES_CANONICAL_RUNTIME_CREATE_CARDINALITY_VIOLATION",
    );
  }

  public async load(
    missionId:
      string,
  ): Promise<CanonicalRuntimeCheckpoint | null> {
    assertMissionId(
      missionId,
    );

    const result =
      await this.database.query<
        StoredCanonicalRuntimeCheckpointRow
      >(
        `
SELECT
  mission_id,
  schema_version,
  checkpoint_version,
  cursor_step_version,
  checkpoint,
  saved_at
FROM namla_v2_canonical_runtime_checkpoints
WHERE mission_id = $1
        `.trim(),
        [
          missionId,
        ],
      );

    if (
      result.rows.length ===
      0
    ) {
      return null;
    }

    if (
      result.rows.length !==
      1
    ) {
      throw new Error(
        "POSTGRES_CANONICAL_RUNTIME_LOAD_CARDINALITY_VIOLATION",
      );
    }

    return decodeStoredRow(
      result.rows[0],
      missionId,
    );
  }

  public async compareAndSet(
    missionId:
      string,
    expectedCheckpointVersion:
      number,
    checkpoint:
      CanonicalRuntimeCheckpoint,
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

    if (
      checkpoint.checkpointVersion !==
      expectedCheckpointVersion + 1
    ) {
      throw new Error(
        "NON_MONOTONIC_CANONICAL_RUNTIME_CHECKPOINT_VERSION",
      );
    }

    const detached =
      cloneCheckpoint(
        checkpoint,
      );

    const encoded =
      encodeCheckpoint(
        detached,
      );

    return this.database.transaction(
      async (client) => {
        const locked =
          await client.query<
            StoredCanonicalRuntimeCheckpointRow
          >(
            `
SELECT
  mission_id,
  schema_version,
  checkpoint_version,
  cursor_step_version,
  checkpoint,
  saved_at
FROM namla_v2_canonical_runtime_checkpoints
WHERE mission_id = $1
FOR UPDATE
            `.trim(),
            [
              missionId,
            ],
          );

        if (
          locked.rows.length ===
          0
        ) {
          return {
            status:
              "NOT_FOUND" as const,
          };
        }

        if (
          locked.rows.length !==
          1
        ) {
          throw new Error(
            "POSTGRES_CANONICAL_RUNTIME_LOCK_CARDINALITY_VIOLATION",
          );
        }

        const current =
          decodeStoredRow(
            locked.rows[0],
            missionId,
          );

        if (
          current.checkpointVersion !==
          expectedCheckpointVersion
        ) {
          return {
            status:
              "VERSION_CONFLICT" as const,
            currentCheckpointVersion:
              current.checkpointVersion,
          };
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

        const updated =
          await client.query<
            WrittenCanonicalRuntimeVersionRow
          >(
            `
UPDATE namla_v2_canonical_runtime_checkpoints
SET
  schema_version = $3,
  checkpoint_version = $4,
  cursor_step_version = $5,
  checkpoint = $6::jsonb,
  saved_at = $7,
  updated_at = NOW()
WHERE
  mission_id = $1
  AND checkpoint_version = $2
RETURNING
  checkpoint_version,
  cursor_step_version
            `.trim(),
            [
              missionId,
              expectedCheckpointVersion,
              detached.schemaVersion,
              detached.checkpointVersion,
              detached.cursor.stepVersion,
              encoded,
              detached.savedAt,
            ],
          );

        if (
          updated.rows.length !==
          1
        ) {
          throw new Error(
            "POSTGRES_CANONICAL_RUNTIME_CAS_WRITE_LOST",
          );
        }

        const writtenCheckpointVersion =
          parsePositiveSafeInteger(
            updated.rows[0]
              .checkpoint_version,
            "checkpoint_version",
          );

        const writtenCursorStepVersion =
          parsePositiveSafeInteger(
            updated.rows[0]
              .cursor_step_version,
            "cursor_step_version",
          );

        if (
          writtenCheckpointVersion !==
          detached.checkpointVersion
        ) {
          throw new Error(
            "POSTGRES_CANONICAL_RUNTIME_CAS_CHECKPOINT_VERSION_MISMATCH",
          );
        }

        if (
          writtenCursorStepVersion !==
          detached.cursor.stepVersion
        ) {
          throw new Error(
            "POSTGRES_CANONICAL_RUNTIME_CAS_CURSOR_STEP_VERSION_MISMATCH",
          );
        }

        return {
          status:
            "UPDATED" as const,
          checkpointVersion:
            writtenCheckpointVersion,
        };
      },
    );
  }
}
