import {
  V2_MISSION_CHECKPOINT_SCHEMA,
} from "./missionCheckpointStore";

export const V2_POSTGRES_MISSION_CHECKPOINT_TABLE =
  "namla_v2_mission_checkpoints" as const;

export const V2_POSTGRES_MISSION_CHECKPOINT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS namla_v2_mission_checkpoints (
  mission_id TEXT PRIMARY KEY
    CHECK (length(btrim(mission_id)) > 0),

  schema_version TEXT NOT NULL
    CHECK (
      schema_version = '${V2_MISSION_CHECKPOINT_SCHEMA}'
    ),

  state_version BIGINT NOT NULL
    CHECK (state_version >= 1),

  checkpoint JSONB NOT NULL,

  saved_at BIGINT NOT NULL
    CHECK (saved_at > 0),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (jsonb_typeof(checkpoint) = 'object'),

  CHECK (
    checkpoint ->> 'schemaVersion' =
    schema_version
  ),

  CHECK (
    checkpoint ->> 'missionId' =
    mission_id
  ),

  CHECK (
    (checkpoint #>> '{state,stateVersion}')::BIGINT =
    state_version
  ),

  CHECK (
    (checkpoint ->> 'savedAt')::BIGINT =
    saved_at
  )
);
`.trim();