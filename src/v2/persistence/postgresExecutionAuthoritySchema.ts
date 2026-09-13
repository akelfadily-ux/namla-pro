export const V2_POSTGRES_TASK_EXECUTION_LEASE_TABLE =
  "namla_v2_task_execution_leases" as const;

export const V2_POSTGRES_OPERATION_CLAIM_TABLE =
  "namla_v2_operation_claims" as const;

export const V2_POSTGRES_EXECUTION_AUTHORITY_SCHEMA_SQL = `
CREATE TABLE namla_v2_task_execution_leases (
  mission_id TEXT NOT NULL
    CHECK (length(btrim(mission_id)) > 0),

  task_id TEXT NOT NULL
    CHECK (length(btrim(task_id)) > 0),

  worker_id TEXT NOT NULL
    CHECK (length(btrim(worker_id)) > 0),

  authority_scope TEXT NOT NULL
    CHECK (length(btrim(authority_scope)) > 0),

  lease_token TEXT NOT NULL
    CHECK (length(btrim(lease_token)) > 0),

  lease_epoch BIGINT NOT NULL
    CHECK (lease_epoch >= 1),

  lease_expires_at TIMESTAMPTZ NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (mission_id, task_id)
);

CREATE INDEX namla_v2_task_execution_leases_expiry_idx
  ON namla_v2_task_execution_leases (
    mission_id,
    lease_expires_at
  );

CREATE TABLE namla_v2_operation_claims (
  mission_id TEXT NOT NULL
    CHECK (length(btrim(mission_id)) > 0),

  operation_key TEXT NOT NULL
    CHECK (length(btrim(operation_key)) > 0),

  task_id TEXT NOT NULL
    CHECK (length(btrim(task_id)) > 0),

  authority_scope TEXT NOT NULL
    CHECK (length(btrim(authority_scope)) > 0),

  operation_type TEXT NOT NULL
    CHECK (length(btrim(operation_type)) > 0),

  input_fingerprint TEXT NOT NULL
    CHECK (
      input_fingerprint ~ '^[0-9a-f]{64}$'
    ),

  status TEXT NOT NULL
    CHECK (
      status IN ('RUNNING', 'COMPLETED', 'FAILED')
    ),

  claim_owner_worker_id TEXT NOT NULL
    CHECK (length(btrim(claim_owner_worker_id)) > 0),

  claim_task_lease_token TEXT NOT NULL
    CHECK (length(btrim(claim_task_lease_token)) > 0),

  claim_task_lease_epoch BIGINT NOT NULL
    CHECK (claim_task_lease_epoch >= 1),

  claim_token TEXT NOT NULL
    CHECK (length(btrim(claim_token)) > 0),

  claim_epoch BIGINT NOT NULL
    CHECK (claim_epoch >= 1),

  claim_expires_at TIMESTAMPTZ NOT NULL,

  result JSONB,
  error_text TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,

  PRIMARY KEY (mission_id, operation_key),

  FOREIGN KEY (mission_id, task_id)
    REFERENCES namla_v2_task_execution_leases (
      mission_id,
      task_id
    )
    ON DELETE RESTRICT,

  CHECK (
    (status = 'RUNNING' AND finished_at IS NULL)
    OR
    (status IN ('COMPLETED', 'FAILED') AND finished_at IS NOT NULL)
  ),

  CHECK (
    finished_at IS NULL OR finished_at >= created_at
  )
);

CREATE INDEX namla_v2_operation_claims_running_expiry_idx
  ON namla_v2_operation_claims (
    mission_id,
    status,
    claim_expires_at
  );
`.trim();