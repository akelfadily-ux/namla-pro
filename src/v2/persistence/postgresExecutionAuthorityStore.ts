import { randomUUID } from "node:crypto";

import {
  OperationClaimResult,
  OperationExecutionRecord,
  OperationFinalizeResult,
  TaskExecutionAuthority,
  completeOperationClaim,
  decideOperationClaim,
  failOperationClaim,
} from "../kernel/executionAuthority";

import {
  PostgresCheckpointClient,
  PostgresCheckpointDatabase,
} from "./postgresMissionCheckpointStore";

const MAX_FIELD_LENGTH = 512;
const MAX_LEASE_DURATION_MS = 5 * 60_000;
const MAX_ERROR_TEXT_LENGTH = 16_384;

interface TaskLeaseRow {
  readonly mission_id: unknown;
  readonly task_id: unknown;
  readonly worker_id: unknown;
  readonly authority_scope: unknown;
  readonly lease_token: unknown;
  readonly lease_epoch: unknown;
  readonly lease_expires_at: unknown;
  readonly now_ms?: unknown;
}

interface OperationClaimRow {
  readonly mission_id: unknown;
  readonly operation_key: unknown;
  readonly task_id: unknown;
  readonly authority_scope: unknown;
  readonly operation_type: unknown;
  readonly input_fingerprint: unknown;
  readonly status: unknown;
  readonly claim_owner_worker_id: unknown;
  readonly claim_task_lease_token: unknown;
  readonly claim_task_lease_epoch: unknown;
  readonly claim_token: unknown;
  readonly claim_epoch: unknown;
  readonly claim_expires_at: unknown;
  readonly result: unknown;
  readonly error_text: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
  readonly finished_at: unknown;
}

export type TaskLeaseAcquireReasonCode =
  | "ok"
  | "invalid-field"
  | "invalid-duration"
  | "binding-mismatch"
  | "held-by-other";

export type TaskLeaseAcquireResult =
  | {
      readonly ok: true;
      readonly status: "ACQUIRED";
      readonly reasonCode: "ok";
      readonly authority: TaskExecutionAuthority;
    }
  | {
      readonly ok: false;
      readonly status: "REFUSED";
      readonly reasonCode:
        Exclude<TaskLeaseAcquireReasonCode, "ok">;
    };

export type TaskLeaseRenewReasonCode =
  | "ok"
  | "invalid-duration"
  | "authority-lost";

export type TaskLeaseRenewResult =
  | {
      readonly ok: true;
      readonly status: "RENEWED";
      readonly reasonCode: "ok";
      readonly authority: TaskExecutionAuthority;
    }
  | {
      readonly ok: false;
      readonly status: "REFUSED";
      readonly reasonCode:
        Exclude<TaskLeaseRenewReasonCode, "ok">;
    };

export type PostgresOperationClaimReasonCode =
  | OperationClaimResult["reasonCode"]
  | "task-authority-not-found"
  | "task-authority-mismatch"
  | "task-authority-expired";

export type PostgresOperationClaimResult =
  | {
      readonly ok: true;
      readonly status:
        | "CLAIMED"
        | "ALREADY_CLAIMED_BY_CALLER"
        | "REPLAY_COMPLETED";
      readonly reasonCode: "ok";
      readonly inputFingerprint?: string;
      readonly record?: OperationExecutionRecord;
      readonly completedValue?: unknown;
    }
  | {
      readonly ok: false;
      readonly status: "REFUSED";
      readonly reasonCode: PostgresOperationClaimReasonCode;
      readonly inputFingerprint?: string;
      readonly record?: OperationExecutionRecord;
    };

export type PostgresOperationFinalizeReasonCode =
  | OperationFinalizeResult["reasonCode"]
  | "task-authority-not-found"
  | "task-authority-mismatch"
  | "task-authority-expired"
  | "operation-not-found";

export type PostgresOperationFinalizeResult =
  | {
      readonly ok: true;
      readonly status: "COMPLETED" | "FAILED";
      readonly reasonCode: "ok";
      readonly record: OperationExecutionRecord;
    }
  | {
      readonly ok: false;
      readonly status: "REFUSED";
      readonly reasonCode:
        PostgresOperationFinalizeReasonCode;
    };

type LockedTaskAuthorityFailureReason =
  | "task-authority-not-found"
  | "task-authority-mismatch"
  | "task-authority-expired";

type LockedTaskAuthorityResult =
  | {
      readonly ok: true;
      readonly authority:
        TaskExecutionAuthority;
      readonly now: number;
    }
  | {
      readonly ok: false;
      readonly reasonCode:
        LockedTaskAuthorityFailureReason;
    };

export interface ValidateDurableOperationClaimInput {
  readonly operationKey: string;
  readonly authority: TaskExecutionAuthority;
  readonly claimToken: string;
  readonly claimEpoch: number;
}

export type PostgresOperationClaimValidationResult =
  | {
      readonly ok: true;
      readonly status: "VALID";
      readonly reasonCode: "ok";
      readonly record: OperationExecutionRecord;
      readonly now: number;
    }
  | {
      readonly ok: false;
      readonly status: "REFUSED";
      readonly reasonCode: PostgresOperationFinalizeReasonCode;
    };

export interface AcquireTaskLeaseInput {
  readonly missionId: string;
  readonly taskId: string;
  readonly workerId: string;
  readonly authorityScope: string;
  readonly leaseDurationMs?: number;
}

export interface ClaimDurableOperationInput {
  readonly operationKey: string;
  readonly operationType: string;
  readonly value: unknown;
  readonly authority: TaskExecutionAuthority;
  readonly claimDurationMs?: number;
}

export interface CompleteDurableOperationInput {
  readonly operationKey: string;
  readonly authority: TaskExecutionAuthority;
  readonly claimToken: string;
  readonly claimEpoch: number;
  readonly value: unknown;
}

export interface FailDurableOperationInput {
  readonly operationKey: string;
  readonly authority: TaskExecutionAuthority;
  readonly claimToken: string;
  readonly claimEpoch: number;
  readonly errorText: string;
}

function validField(value: string): boolean {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= MAX_FIELD_LENGTH &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function validDuration(value: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= MAX_LEASE_DURATION_MS
  );
}

function parsePositiveInteger(
  value: unknown,
  field: string,
): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" &&
          /^[0-9]+$/.test(value)
        ? Number(value)
        : Number.NaN;

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1
  ) {
    throw new Error(
      `POSTGRES_EXECUTION_AUTHORITY_INVALID_INTEGER:${field}`,
    );
  }

  return parsed;
}

function parseTimestampMs(
  value: unknown,
  field: string,
): number {
  if (value instanceof Date) {
    const time = value.getTime();

    if (
      Number.isSafeInteger(time) &&
      time > 0
    ) {
      return time;
    }
  }

  if (typeof value === "number") {
    if (
      Number.isSafeInteger(value) &&
      value > 0
    ) {
      return value;
    }
  }

  if (
    typeof value === "string" &&
    /^[0-9]+$/.test(value)
  ) {
    const numeric = Number(value);

    if (
      Number.isSafeInteger(numeric) &&
      numeric > 0
    ) {
      return numeric;
    }
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);

    if (
      Number.isSafeInteger(parsed) &&
      parsed > 0
    ) {
      return parsed;
    }
  }

  throw new Error(
    `POSTGRES_EXECUTION_AUTHORITY_INVALID_TIMESTAMP:${field}`,
  );
}

function assertString(
  value: unknown,
  field: string,
): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new Error(
      `POSTGRES_EXECUTION_AUTHORITY_INVALID_STRING:${field}`,
    );
  }

  return value;
}

function decodeTaskAuthority(
  row: TaskLeaseRow,
): {
  readonly authority: TaskExecutionAuthority;
  readonly now: number;
} {
  const authority: TaskExecutionAuthority = {
    missionId:
      assertString(row.mission_id, "mission_id"),
    taskId:
      assertString(row.task_id, "task_id"),
    workerId:
      assertString(row.worker_id, "worker_id"),
    authorityScope:
      assertString(
        row.authority_scope,
        "authority_scope",
      ),
    leaseToken:
      assertString(row.lease_token, "lease_token"),
    leaseEpoch:
      parsePositiveInteger(
        row.lease_epoch,
        "lease_epoch",
      ),
    expiresAt:
      parseTimestampMs(
        row.lease_expires_at,
        "lease_expires_at",
      ),
  };

  const now =
    row.now_ms === undefined
      ? Date.now()
      : parseTimestampMs(
          row.now_ms,
          "now_ms",
        );

  return {
    authority,
    now,
  };
}

function decodeOperationRow(
  row: OperationClaimRow,
): OperationExecutionRecord {
  const status =
    row.status === "RUNNING" ||
    row.status === "COMPLETED" ||
    row.status === "FAILED"
      ? row.status
      : null;

  if (!status) {
    throw new Error(
      "POSTGRES_EXECUTION_AUTHORITY_INVALID_OPERATION_STATUS",
    );
  }

  const fingerprint =
    assertString(
      row.input_fingerprint,
      "input_fingerprint",
    );

  if (!/^[0-9a-f]{64}$/.test(fingerprint)) {
    throw new Error(
      "POSTGRES_EXECUTION_AUTHORITY_INVALID_FINGERPRINT",
    );
  }

  const createdAt =
    parseTimestampMs(
      row.created_at,
      "created_at",
    );

  const updatedAt =
    parseTimestampMs(
      row.updated_at,
      "updated_at",
    );

  const finishedAt =
    row.finished_at === null ||
    row.finished_at === undefined
      ? undefined
      : parseTimestampMs(
          row.finished_at,
          "finished_at",
        );

  if (
    status === "RUNNING" &&
    finishedAt !== undefined
  ) {
    throw new Error(
      "POSTGRES_EXECUTION_AUTHORITY_RUNNING_HAS_FINISHED_AT",
    );
  }

  if (
    status !== "RUNNING" &&
    finishedAt === undefined
  ) {
    throw new Error(
      "POSTGRES_EXECUTION_AUTHORITY_TERMINAL_MISSING_FINISHED_AT",
    );
  }

  return {
    operationKey:
      assertString(
        row.operation_key,
        "operation_key",
      ),
    missionId:
      assertString(row.mission_id, "mission_id"),
    taskId:
      assertString(row.task_id, "task_id"),
    authorityScope:
      assertString(
        row.authority_scope,
        "authority_scope",
      ),
    operationType:
      assertString(
        row.operation_type,
        "operation_type",
      ),
    inputFingerprint: fingerprint,
    status,
    claimOwnerWorkerId:
      assertString(
        row.claim_owner_worker_id,
        "claim_owner_worker_id",
      ),
    claimTaskLeaseToken:
      assertString(
        row.claim_task_lease_token,
        "claim_task_lease_token",
      ),
    claimTaskLeaseEpoch:
      parsePositiveInteger(
        row.claim_task_lease_epoch,
        "claim_task_lease_epoch",
      ),
    claimToken:
      assertString(
        row.claim_token,
        "claim_token",
      ),
    claimEpoch:
      parsePositiveInteger(
        row.claim_epoch,
        "claim_epoch",
      ),
    claimExpiresAt:
      parseTimestampMs(
        row.claim_expires_at,
        "claim_expires_at",
      ),
    createdAt,
    updatedAt,
    ...(finishedAt !== undefined
      ? { finishedAt }
      : {}),
  };
}

function sameAuthorityIdentity(
  expected: TaskExecutionAuthority,
  actual: TaskExecutionAuthority,
): boolean {
  return (
    expected.missionId === actual.missionId &&
    expected.taskId === actual.taskId &&
    expected.workerId === actual.workerId &&
    expected.authorityScope ===
      actual.authorityScope &&
    expected.leaseToken === actual.leaseToken &&
    expected.leaseEpoch === actual.leaseEpoch
  );
}

function serializeJson(
  value: unknown,
): string {
  try {
    const encoded = JSON.stringify(value);

    if (typeof encoded !== "string") {
      throw new Error(
        "POSTGRES_EXECUTION_AUTHORITY_VALUE_NOT_JSON_SERIALIZABLE",
      );
    }

    return encoded;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message ===
        "POSTGRES_EXECUTION_AUTHORITY_VALUE_NOT_JSON_SERIALIZABLE"
    ) {
      throw error;
    }

    throw new Error(
      "POSTGRES_EXECUTION_AUTHORITY_VALUE_NOT_JSON_SERIALIZABLE",
    );
  }
}

function completedValueFrom(
  row: OperationClaimRow | undefined,
): unknown {
  if (!row) {
    return undefined;
  }

  if (typeof row.result === "string") {
    try {
      return JSON.parse(row.result);
    } catch {
      throw new Error(
        "POSTGRES_EXECUTION_AUTHORITY_CORRUPT_RESULT_JSON",
      );
    }
  }

  return row.result;
}

export class PostgresExecutionAuthorityStore {
  public constructor(
    private readonly database:
      PostgresCheckpointDatabase,
    private readonly tokenFactory:
      () => string = randomUUID,
  ) {}

  public async acquireTaskLease(
    input: AcquireTaskLeaseInput,
  ): Promise<TaskLeaseAcquireResult> {
    if (
      !validField(input.missionId) ||
      !validField(input.taskId) ||
      !validField(input.workerId) ||
      !validField(input.authorityScope)
    ) {
      return {
        ok: false,
        status: "REFUSED",
        reasonCode: "invalid-field",
      };
    }

    const duration =
      input.leaseDurationMs ?? 60_000;

    if (!validDuration(duration)) {
      return {
        ok: false,
        status: "REFUSED",
        reasonCode: "invalid-duration",
      };
    }

    const leaseToken =
      this.tokenFactory();

    if (!validField(leaseToken)) {
      throw new Error(
        "POSTGRES_EXECUTION_AUTHORITY_INVALID_GENERATED_TOKEN",
      );
    }

    const acquired =
      await this.database.query<TaskLeaseRow>(
        `
INSERT INTO namla_v2_task_execution_leases (
  mission_id,
  task_id,
  worker_id,
  authority_scope,
  lease_token,
  lease_epoch,
  lease_expires_at
)
VALUES (
  $1,
  $2,
  $3,
  $4,
  $5,
  1,
  NOW() + ($6::bigint * INTERVAL '1 millisecond')
)
ON CONFLICT (mission_id, task_id)
DO UPDATE SET
  worker_id = EXCLUDED.worker_id,
  lease_token = EXCLUDED.lease_token,
  lease_epoch =
    namla_v2_task_execution_leases.lease_epoch + 1,
  lease_expires_at = EXCLUDED.lease_expires_at,
  updated_at = NOW()
WHERE
  namla_v2_task_execution_leases.lease_expires_at <= NOW()
  AND namla_v2_task_execution_leases.authority_scope =
    EXCLUDED.authority_scope
RETURNING
  mission_id,
  task_id,
  worker_id,
  authority_scope,
  lease_token,
  lease_epoch,
  lease_expires_at,
  (EXTRACT(EPOCH FROM transaction_timestamp()) * 1000)::bigint
    AS now_ms
        `.trim(),
        [
          input.missionId,
          input.taskId,
          input.workerId,
          input.authorityScope,
          leaseToken,
          duration,
        ],
      );

    if (acquired.rows.length === 1) {
      const decoded =
        decodeTaskAuthority(
          acquired.rows[0],
        );

      if (decoded.authority.expiresAt <= decoded.now) {
        throw new Error(
          "POSTGRES_EXECUTION_AUTHORITY_ACQUIRED_EXPIRED_LEASE",
        );
      }

      return {
        ok: true,
        status: "ACQUIRED",
        reasonCode: "ok",
        authority:
          decoded.authority,
      };
    }

    if (acquired.rows.length !== 0) {
      throw new Error(
        "POSTGRES_EXECUTION_AUTHORITY_ACQUIRE_CARDINALITY_VIOLATION",
      );
    }

    const existing =
      await this.database.query<TaskLeaseRow>(
        `
SELECT
  mission_id,
  task_id,
  worker_id,
  authority_scope,
  lease_token,
  lease_epoch,
  lease_expires_at,
  (EXTRACT(EPOCH FROM transaction_timestamp()) * 1000)::bigint
    AS now_ms
FROM namla_v2_task_execution_leases
WHERE mission_id = $1
  AND task_id = $2
        `.trim(),
        [
          input.missionId,
          input.taskId,
        ],
      );

    if (existing.rows.length !== 1) {
      throw new Error(
        "POSTGRES_EXECUTION_AUTHORITY_ACQUIRE_DIAGNOSTIC_CARDINALITY",
      );
    }

    const decoded =
      decodeTaskAuthority(
        existing.rows[0],
      );

    if (
      decoded.authority.authorityScope !==
      input.authorityScope
    ) {
      return {
        ok: false,
        status: "REFUSED",
        reasonCode: "binding-mismatch",
      };
    }

    return {
      ok: false,
      status: "REFUSED",
      reasonCode: "held-by-other",
    };
  }

  public async renewTaskLease(
    authority: TaskExecutionAuthority,
    leaseDurationMs = 60_000,
  ): Promise<TaskLeaseRenewResult> {
    if (!validDuration(leaseDurationMs)) {
      return {
        ok: false,
        status: "REFUSED",
        reasonCode: "invalid-duration",
      };
    }

    const renewed =
      await this.database.query<TaskLeaseRow>(
        `
UPDATE namla_v2_task_execution_leases
SET
  lease_expires_at =
    NOW() + ($7::bigint * INTERVAL '1 millisecond'),
  updated_at = NOW()
WHERE mission_id = $1
  AND task_id = $2
  AND worker_id = $3
  AND authority_scope = $4
  AND lease_token = $5
  AND lease_epoch = $6
  AND lease_expires_at > NOW()
RETURNING
  mission_id,
  task_id,
  worker_id,
  authority_scope,
  lease_token,
  lease_epoch,
  lease_expires_at,
  (EXTRACT(EPOCH FROM transaction_timestamp()) * 1000)::bigint
    AS now_ms
        `.trim(),
        [
          authority.missionId,
          authority.taskId,
          authority.workerId,
          authority.authorityScope,
          authority.leaseToken,
          authority.leaseEpoch,
          leaseDurationMs,
        ],
      );

    if (renewed.rows.length === 0) {
      return {
        ok: false,
        status: "REFUSED",
        reasonCode: "authority-lost",
      };
    }

    if (renewed.rows.length !== 1) {
      throw new Error(
        "POSTGRES_EXECUTION_AUTHORITY_RENEW_CARDINALITY_VIOLATION",
      );
    }

    const decoded =
      decodeTaskAuthority(
        renewed.rows[0],
      );

    return {
      ok: true,
      status: "RENEWED",
      reasonCode: "ok",
      authority:
        decoded.authority,
    };
  }

  public async claimOperation(
    input: ClaimDurableOperationInput,
  ): Promise<PostgresOperationClaimResult> {
    return this.database.transaction(
      async (client) => {
        const verified =
          await this.lockTaskAuthority(
            client,
            input.authority,
          );

        if (!verified.ok) {
          return {
            ok: false,
            status: "REFUSED",
            reasonCode:
              verified.reasonCode,
          };
        }

        const existing =
          await client.query<OperationClaimRow>(
            `
SELECT
  mission_id,
  operation_key,
  task_id,
  authority_scope,
  operation_type,
  input_fingerprint,
  status,
  claim_owner_worker_id,
  claim_task_lease_token,
  claim_task_lease_epoch,
  claim_token,
  claim_epoch,
  claim_expires_at,
  result,
  error_text,
  created_at,
  updated_at,
  finished_at
FROM namla_v2_operation_claims
WHERE mission_id = $1
  AND operation_key = $2
FOR UPDATE
            `.trim(),
            [
              input.authority.missionId,
              input.operationKey,
            ],
          );

        if (existing.rows.length > 1) {
          throw new Error(
            "POSTGRES_EXECUTION_AUTHORITY_OPERATION_CARDINALITY_VIOLATION",
          );
        }

        const existingRecord =
          existing.rows.length === 0
            ? null
            : decodeOperationRow(
                existing.rows[0],
              );

        const decision =
          decideOperationClaim({
            operationKey:
              input.operationKey,
            operationType:
              input.operationType,
            value:
              input.value,
            authority:
              verified.authority,
            existing:
              existingRecord,
            now:
              verified.now,
            claimDurationMs:
              input.claimDurationMs,
            tokenFactory:
              this.tokenFactory,
          });

        if (!decision.ok) {
          return {
            ok: false,
            status: "REFUSED",
            reasonCode:
              decision.reasonCode,
            inputFingerprint:
              decision.inputFingerprint,
            record:
              decision.record,
          };
        }

        if (
          decision.status ===
          "ALREADY_CLAIMED_BY_CALLER"
        ) {
          return {
            ok: true,
            status:
              "ALREADY_CLAIMED_BY_CALLER",
            reasonCode: "ok",
            inputFingerprint:
              decision.inputFingerprint,
            record:
              decision.record,
          };
        }

        if (
          decision.status ===
          "REPLAY_COMPLETED"
        ) {
          return {
            ok: true,
            status:
              "REPLAY_COMPLETED",
            reasonCode: "ok",
            inputFingerprint:
              decision.inputFingerprint,
            record:
              decision.record,
            completedValue:
              completedValueFrom(
                existing.rows[0],
              ),
          };
        }

        if (
          decision.status !== "CLAIMED" ||
          !decision.record
        ) {
          throw new Error(
            "POSTGRES_EXECUTION_AUTHORITY_UNEXPECTED_CLAIM_DECISION",
          );
        }

        if (existingRecord === null) {
          const inserted =
            await client.query<{
              readonly operation_key: string;
            }>(
              `
INSERT INTO namla_v2_operation_claims (
  mission_id,
  operation_key,
  task_id,
  authority_scope,
  operation_type,
  input_fingerprint,
  status,
  claim_owner_worker_id,
  claim_task_lease_token,
  claim_task_lease_epoch,
  claim_token,
  claim_epoch,
  claim_expires_at,
  created_at,
  updated_at,
  finished_at
)
VALUES (
  $1, $2, $3, $4, $5, $6, 'RUNNING',
  $7, $8, $9, $10, $11,
  to_timestamp($12::double precision / 1000.0),
  to_timestamp($13::double precision / 1000.0),
  to_timestamp($14::double precision / 1000.0),
  NULL
)
RETURNING operation_key
              `.trim(),
              [
                decision.record.missionId,
                decision.record.operationKey,
                decision.record.taskId,
                decision.record.authorityScope,
                decision.record.operationType,
                decision.record.inputFingerprint,
                decision.record.claimOwnerWorkerId,
                decision.record.claimTaskLeaseToken,
                decision.record.claimTaskLeaseEpoch,
                decision.record.claimToken,
                decision.record.claimEpoch,
                decision.record.claimExpiresAt,
                decision.record.createdAt,
                decision.record.updatedAt,
              ],
            );

          if (inserted.rows.length !== 1) {
            throw new Error(
              "POSTGRES_EXECUTION_AUTHORITY_INSERT_CLAIM_FAILED",
            );
          }
        } else {
          const updated =
            await client.query<{
              readonly operation_key: string;
            }>(
              `
UPDATE namla_v2_operation_claims
SET
  claim_owner_worker_id = $3,
  claim_task_lease_token = $4,
  claim_task_lease_epoch = $5,
  claim_token = $6,
  claim_epoch = $7,
  claim_expires_at =
    to_timestamp($8::double precision / 1000.0),
  updated_at =
    to_timestamp($9::double precision / 1000.0)
WHERE mission_id = $1
  AND operation_key = $2
  AND status = 'RUNNING'
  AND claim_token = $10
  AND claim_epoch = $11
RETURNING operation_key
              `.trim(),
              [
                decision.record.missionId,
                decision.record.operationKey,
                decision.record.claimOwnerWorkerId,
                decision.record.claimTaskLeaseToken,
                decision.record.claimTaskLeaseEpoch,
                decision.record.claimToken,
                decision.record.claimEpoch,
                decision.record.claimExpiresAt,
                decision.record.updatedAt,
                existingRecord.claimToken,
                existingRecord.claimEpoch,
              ],
            );

          if (updated.rows.length !== 1) {
            throw new Error(
              "POSTGRES_EXECUTION_AUTHORITY_TAKEOVER_FENCE_FAILED",
            );
          }
        }

        return {
          ok: true,
          status: "CLAIMED",
          reasonCode: "ok",
          inputFingerprint:
            decision.inputFingerprint,
          record:
            decision.record,
        };
      },
    );
  }

  /**
   * Read-only current-fence check for an already claimed operation.
   *
   * The task lease and operation row are locked in one transaction and the
   * existing pure finalize predicate is reused to validate current ownership,
   * lease identity, claim token/epoch and claim expiry. No row is updated.
   */
  public async validateOperationClaim(
    input: ValidateDurableOperationClaimInput,
  ): Promise<PostgresOperationClaimValidationResult> {
    return this.database.transaction(
      async (client) => {
        const verified =
          await this.lockTaskAuthority(
            client,
            input.authority,
          );

        if (!verified.ok) {
          return {
            ok: false,
            status: "REFUSED",
            reasonCode:
              verified.reasonCode,
          };
        }

        const locked =
          await client.query<OperationClaimRow>(
            `
SELECT
  mission_id,
  operation_key,
  task_id,
  authority_scope,
  operation_type,
  input_fingerprint,
  status,
  claim_owner_worker_id,
  claim_task_lease_token,
  claim_task_lease_epoch,
  claim_token,
  claim_epoch,
  claim_expires_at,
  result,
  error_text,
  created_at,
  updated_at,
  finished_at
FROM namla_v2_operation_claims
WHERE mission_id = $1
  AND operation_key = $2
FOR UPDATE
            `.trim(),
            [
              input.authority.missionId,
              input.operationKey,
            ],
          );

        if (locked.rows.length === 0) {
          return {
            ok: false,
            status: "REFUSED",
            reasonCode:
              "operation-not-found",
          };
        }

        if (locked.rows.length !== 1) {
          throw new Error(
            "POSTGRES_EXECUTION_AUTHORITY_VALIDATE_CLAIM_CARDINALITY_VIOLATION",
          );
        }

        const record =
          decodeOperationRow(
            locked.rows[0],
          );

        const decision =
          completeOperationClaim(
            record,
            verified.authority,
            input.claimToken,
            input.claimEpoch,
            verified.now,
          );

        if (!decision.ok) {
          return {
            ok: false,
            status: "REFUSED",
            reasonCode:
              decision.reasonCode,
          };
        }

        return {
          ok: true,
          status: "VALID",
          reasonCode: "ok",
          record,
          now:
            verified.now,
        };
      },
    );
  }

  public async completeOperation(
    input: CompleteDurableOperationInput,
  ): Promise<PostgresOperationFinalizeResult> {
    const encoded =
      serializeJson(input.value);

    return this.finalizeOperation(
      input.operationKey,
      input.authority,
      input.claimToken,
      input.claimEpoch,
      "COMPLETED",
      encoded,
      null,
    );
  }

  public async failOperation(
    input: FailDurableOperationInput,
  ): Promise<PostgresOperationFinalizeResult> {
    if (
      typeof input.errorText !== "string" ||
      input.errorText.trim().length === 0 ||
      input.errorText.length >
        MAX_ERROR_TEXT_LENGTH
    ) {
      throw new Error(
        "POSTGRES_EXECUTION_AUTHORITY_INVALID_ERROR_TEXT",
      );
    }

    return this.finalizeOperation(
      input.operationKey,
      input.authority,
      input.claimToken,
      input.claimEpoch,
      "FAILED",
      null,
      input.errorText,
    );
  }

  private async lockTaskAuthority(
    client: PostgresCheckpointClient,
    expected: TaskExecutionAuthority,
  ): Promise<LockedTaskAuthorityResult> {
    const locked =
      await client.query<TaskLeaseRow>(
        `
SELECT
  mission_id,
  task_id,
  worker_id,
  authority_scope,
  lease_token,
  lease_epoch,
  lease_expires_at,
  (EXTRACT(EPOCH FROM transaction_timestamp()) * 1000)::bigint
    AS now_ms
FROM namla_v2_task_execution_leases
WHERE mission_id = $1
  AND task_id = $2
FOR UPDATE
        `.trim(),
        [
          expected.missionId,
          expected.taskId,
        ],
      );

    if (locked.rows.length === 0) {
      return {
        ok: false,
        reasonCode:
          "task-authority-not-found",
      };
    }

    if (locked.rows.length !== 1) {
      throw new Error(
        "POSTGRES_EXECUTION_AUTHORITY_TASK_LEASE_CARDINALITY_VIOLATION",
      );
    }

    const decoded =
      decodeTaskAuthority(
        locked.rows[0],
      );

    if (
      !sameAuthorityIdentity(
        expected,
        decoded.authority,
      )
    ) {
      return {
        ok: false,
        reasonCode:
          "task-authority-mismatch",
      };
    }

    if (
      decoded.authority.expiresAt <=
      decoded.now
    ) {
      return {
        ok: false,
        reasonCode:
          "task-authority-expired",
      };
    }

    return {
      ok: true,
      authority:
        decoded.authority,
      now:
        decoded.now,
    };
  }

  private async finalizeOperation(
    operationKey: string,
    authority: TaskExecutionAuthority,
    claimToken: string,
    claimEpoch: number,
    status: "COMPLETED" | "FAILED",
    encodedResult: string | null,
    errorText: string | null,
  ): Promise<PostgresOperationFinalizeResult> {
    return this.database.transaction(
      async (client) => {
        const verified =
          await this.lockTaskAuthority(
            client,
            authority,
          );

        if (!verified.ok) {
          return {
            ok: false,
            status: "REFUSED",
            reasonCode:
              verified.reasonCode,
          };
        }

        const locked =
          await client.query<OperationClaimRow>(
            `
SELECT
  mission_id,
  operation_key,
  task_id,
  authority_scope,
  operation_type,
  input_fingerprint,
  status,
  claim_owner_worker_id,
  claim_task_lease_token,
  claim_task_lease_epoch,
  claim_token,
  claim_epoch,
  claim_expires_at,
  result,
  error_text,
  created_at,
  updated_at,
  finished_at
FROM namla_v2_operation_claims
WHERE mission_id = $1
  AND operation_key = $2
FOR UPDATE
            `.trim(),
            [
              authority.missionId,
              operationKey,
            ],
          );

        if (locked.rows.length === 0) {
          return {
            ok: false,
            status: "REFUSED",
            reasonCode:
              "operation-not-found",
          };
        }

        if (locked.rows.length !== 1) {
          throw new Error(
            "POSTGRES_EXECUTION_AUTHORITY_FINALIZE_CARDINALITY_VIOLATION",
          );
        }

        const record =
          decodeOperationRow(
            locked.rows[0],
          );

        const decision =
          status === "COMPLETED"
            ? completeOperationClaim(
                record,
                verified.authority,
                claimToken,
                claimEpoch,
                verified.now,
              )
            : failOperationClaim(
                record,
                verified.authority,
                claimToken,
                claimEpoch,
                verified.now,
              );

        if (!decision.ok) {
          return decision;
        }

        const updated =
          await client.query<{
            readonly operation_key: string;
          }>(
            `
UPDATE namla_v2_operation_claims
SET
  status = $3,
  result =
    CASE
      WHEN $3 = 'COMPLETED'
        THEN $4::jsonb
      ELSE NULL
    END,
  error_text =
    CASE
      WHEN $3 = 'FAILED'
        THEN $5
      ELSE NULL
    END,
  updated_at =
    to_timestamp($6::double precision / 1000.0),
  finished_at =
    to_timestamp($6::double precision / 1000.0)
WHERE mission_id = $1
  AND operation_key = $2
  AND status = 'RUNNING'
  AND claim_owner_worker_id = $7
  AND claim_task_lease_token = $8
  AND claim_task_lease_epoch = $9
  AND claim_token = $10
  AND claim_epoch = $11
RETURNING operation_key
            `.trim(),
            [
              authority.missionId,
              operationKey,
              status,
              encodedResult,
              errorText,
              verified.now,
              authority.workerId,
              authority.leaseToken,
              authority.leaseEpoch,
              claimToken,
              claimEpoch,
            ],
          );

        if (updated.rows.length !== 1) {
          throw new Error(
            "POSTGRES_EXECUTION_AUTHORITY_FINALIZE_FENCE_FAILED",
          );
        }

        return decision;
      },
    );
  }
}
