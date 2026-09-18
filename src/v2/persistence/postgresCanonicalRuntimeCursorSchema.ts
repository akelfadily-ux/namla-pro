import {
  V2_CANONICAL_RUNTIME_CHECKPOINT_SCHEMA,
} from "./canonicalRuntimeCursorStore";

import {
  V2_CANONICAL_RUNTIME_CURSOR_SCHEMA,
} from "../runtime/canonicalRuntimeStepper";

export const V2_POSTGRES_CANONICAL_RUNTIME_CHECKPOINT_TABLE =
  "namla_v2_canonical_runtime_checkpoints" as const;

/**
 * Canonical runtime checkpoint persistence.
 *
 * The migration ledger owns table creation. CREATE TABLE deliberately does
 * not use IF NOT EXISTS: a pre-existing unrecorded or conflicting table must
 * fail closed rather than be silently accepted.
 */
export const V2_POSTGRES_CANONICAL_RUNTIME_CHECKPOINT_SCHEMA_SQL = `
CREATE TABLE namla_v2_canonical_runtime_checkpoints (
  mission_id TEXT PRIMARY KEY
    CHECK (length(btrim(mission_id)) > 0),

  schema_version TEXT NOT NULL
    CHECK (
      schema_version =
      '${V2_CANONICAL_RUNTIME_CHECKPOINT_SCHEMA}'
    ),

  checkpoint_version BIGINT NOT NULL
    CHECK (checkpoint_version >= 1),

  cursor_step_version BIGINT NOT NULL
    CHECK (cursor_step_version >= 1),

  checkpoint JSONB NOT NULL,

  saved_at BIGINT NOT NULL
    CHECK (saved_at > 0),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (
    checkpoint_version >=
    cursor_step_version
  ),

  CHECK (
    jsonb_typeof(checkpoint) =
    'object'
  ),

  CHECK (
    jsonb_typeof(
      checkpoint -> 'cursor'
    ) =
    'object'
  ),

  CHECK (
    checkpoint ->> 'schemaVersion' =
    schema_version
  ),

  CHECK (
    checkpoint ->> 'missionId' =
    mission_id
  ),

  CHECK (
    (checkpoint ->> 'checkpointVersion')::BIGINT =
    checkpoint_version
  ),

  CHECK (
    checkpoint #>> '{cursor,missionId}' =
    mission_id
  ),

  CHECK (
    checkpoint #>> '{cursor,schemaVersion}' =
    '${V2_CANONICAL_RUNTIME_CURSOR_SCHEMA}'
  ),

  CHECK (
    (checkpoint #>> '{cursor,stepVersion}')::BIGINT =
    cursor_step_version
  ),

  CHECK (
    (checkpoint ->> 'savedAt')::BIGINT =
    saved_at
  ),

  /*
   * CHECK accepts SQL NULL unless explicitly rejected.
   * Require every v1 field to exist with its expected JSON type.
   *
   * Existing constraints bind JSON values to physical columns.
   * Canonical node membership, phase and transition validation remain
   * application responsibilities; this is not execution authority.
   */
  CONSTRAINT canonical_runtime_checkpoint_json_required_types
  CHECK ((
    jsonb_typeof(checkpoint) = 'object'
    AND jsonb_typeof(checkpoint -> 'schemaVersion') = 'string'
    AND jsonb_typeof(checkpoint -> 'missionId') = 'string'
    AND jsonb_typeof(checkpoint -> 'checkpointVersion') = 'number'
    AND jsonb_typeof(checkpoint -> 'savedAt') = 'number'
    AND jsonb_typeof(checkpoint -> 'cursor') = 'object'
    AND jsonb_typeof(checkpoint #> '{cursor,schemaVersion}') = 'string'
    AND jsonb_typeof(checkpoint #> '{cursor,missionId}') = 'string'
    AND jsonb_typeof(checkpoint #> '{cursor,nodeIndex}') = 'number'
    AND jsonb_typeof(checkpoint #> '{cursor,nodeId}') = 'string'
    AND jsonb_typeof(checkpoint #> '{cursor,nodeKind}') = 'string'
    AND jsonb_typeof(checkpoint #> '{cursor,stepVersion}') = 'number'
    AND jsonb_typeof(checkpoint #> '{cursor,contractPhase}') = 'string'
  ) IS TRUE)
);
`.trim();
