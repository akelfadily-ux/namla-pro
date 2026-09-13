import { randomUUID } from "node:crypto";

import { fingerprintOperationIdentity } from "./operationIdentity";

const MAX_AUTHORITY_FIELD_LENGTH = 512;
const MAX_CLAIM_DURATION_MS = 5 * 60_000;

export interface TaskExecutionAuthority {
  readonly missionId: string;
  readonly taskId: string;
  readonly workerId: string;
  readonly authorityScope: string;
  readonly leaseToken: string;
  readonly leaseEpoch: number;
  readonly expiresAt: number;
}

export type OperationExecutionStatus =
  | "RUNNING"
  | "COMPLETED"
  | "FAILED";

export interface OperationExecutionRecord {
  readonly operationKey: string;
  readonly missionId: string;
  readonly taskId: string;
  readonly authorityScope: string;
  readonly operationType: string;
  readonly inputFingerprint: string;
  readonly status: OperationExecutionStatus;
  readonly claimOwnerWorkerId: string;
  readonly claimTaskLeaseToken: string;
  readonly claimTaskLeaseEpoch: number;
  readonly claimToken: string;
  readonly claimEpoch: number;
  readonly claimExpiresAt: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly finishedAt?: number;
}

export type TaskAuthorityValidationReason =
  | "ok"
  | "now-invalid"
  | "mission-id-empty"
  | "task-id-empty"
  | "worker-id-empty"
  | "authority-scope-empty"
  | "lease-token-empty"
  | "authority-field-too-long"
  | "lease-epoch-invalid"
  | "lease-expiry-invalid"
  | "lease-expired";

export interface TaskAuthorityValidationResult {
  readonly ok: boolean;
  readonly reasonCode: TaskAuthorityValidationReason;
}

export type OperationClaimReasonCode =
  | "ok"
  | `task-authority:${Exclude<TaskAuthorityValidationReason, "ok">}`
  | "operation-key-empty"
  | "operation-type-empty"
  | "operation-field-too-long"
  | "claim-duration-invalid"
  | "existing-operation-binding-mismatch"
  | "input-fingerprint-mismatch"
  | "running-other-claim"
  | "terminal-failed";

export type OperationClaimStatus =
  | "CLAIMED"
  | "ALREADY_CLAIMED_BY_CALLER"
  | "REPLAY_COMPLETED"
  | "REFUSED";

export interface OperationClaimResult {
  readonly ok: boolean;
  readonly status: OperationClaimStatus;
  readonly reasonCode: OperationClaimReasonCode;
  readonly inputFingerprint?: string;
  readonly record?: OperationExecutionRecord;
}

export type OperationFinalizeReasonCode =
  | "ok"
  | `task-authority:${Exclude<TaskAuthorityValidationReason, "ok">}`
  | "operation-not-running"
  | "operation-binding-mismatch"
  | "claim-expired"
  | "claim-owner-mismatch"
  | "task-lease-token-mismatch"
  | "task-lease-epoch-mismatch"
  | "claim-token-mismatch"
  | "claim-epoch-mismatch";

export interface OperationFinalizeSuccess {
  readonly ok: true;
  readonly status: "COMPLETED" | "FAILED";
  readonly reasonCode: "ok";
  readonly record: OperationExecutionRecord;
}

export interface OperationFinalizeFailure {
  readonly ok: false;
  readonly status: "REFUSED";
  readonly reasonCode: OperationFinalizeReasonCode;
}

export type OperationFinalizeResult =
  | OperationFinalizeSuccess
  | OperationFinalizeFailure;

export interface OperationClaimInput {
  readonly operationKey: string;
  readonly operationType: string;
  readonly value: unknown;
  readonly authority: TaskExecutionAuthority;
  readonly existing: OperationExecutionRecord | null;
  readonly now: number;
  readonly claimDurationMs?: number;
  readonly tokenFactory?: () => string;
}

function validTimestamp(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function fieldReason(
  value: string,
  emptyReason:
    | "mission-id-empty"
    | "task-id-empty"
    | "worker-id-empty"
    | "authority-scope-empty"
    | "lease-token-empty",
): TaskAuthorityValidationReason | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return emptyReason;
  }

  if (
    value.length > MAX_AUTHORITY_FIELD_LENGTH ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return "authority-field-too-long";
  }

  return null;
}

export function validateTaskExecutionAuthority(
  authority: TaskExecutionAuthority,
  now: number,
): TaskAuthorityValidationResult {
  if (!validTimestamp(now)) {
    return { ok: false, reasonCode: "now-invalid" };
  }

  const fields = [
    fieldReason(authority.missionId, "mission-id-empty"),
    fieldReason(authority.taskId, "task-id-empty"),
    fieldReason(authority.workerId, "worker-id-empty"),
    fieldReason(authority.authorityScope, "authority-scope-empty"),
    fieldReason(authority.leaseToken, "lease-token-empty"),
  ];

  const fieldFailure = fields.find(
    (reason): reason is TaskAuthorityValidationReason =>
      reason !== null,
  );

  if (fieldFailure) {
    return { ok: false, reasonCode: fieldFailure };
  }

  if (
    !Number.isSafeInteger(authority.leaseEpoch) ||
    authority.leaseEpoch < 1
  ) {
    return { ok: false, reasonCode: "lease-epoch-invalid" };
  }

  if (!validTimestamp(authority.expiresAt)) {
    return { ok: false, reasonCode: "lease-expiry-invalid" };
  }

  if (authority.expiresAt <= now) {
    return { ok: false, reasonCode: "lease-expired" };
  }

  return { ok: true, reasonCode: "ok" };
}

function validOperationField(value: string): boolean {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= MAX_AUTHORITY_FIELD_LENGTH &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function sameBinding(
  record: OperationExecutionRecord,
  authority: TaskExecutionAuthority,
  operationKey: string,
  operationType: string,
): boolean {
  return (
    record.operationKey === operationKey &&
    record.missionId === authority.missionId &&
    record.taskId === authority.taskId &&
    record.authorityScope === authority.authorityScope &&
    record.operationType === operationType
  );
}

function makeClaim(
  input: OperationClaimInput,
  inputFingerprint: string,
  claimEpoch: number,
  createdAt: number,
): OperationExecutionRecord {
  const duration = input.claimDurationMs ?? 60_000;
  const tokenFactory = input.tokenFactory ?? randomUUID;
  const claimToken = tokenFactory();

  if (!validOperationField(claimToken)) {
    throw new Error("EXECUTION_AUTHORITY_INVALID_CLAIM_TOKEN");
  }

  const claimExpiresAt = Math.min(
    input.now + duration,
    input.authority.expiresAt,
  );

  if (claimExpiresAt <= input.now) {
    throw new Error("EXECUTION_AUTHORITY_EMPTY_CLAIM_WINDOW");
  }

  return Object.freeze({
    operationKey: input.operationKey,
    missionId: input.authority.missionId,
    taskId: input.authority.taskId,
    authorityScope: input.authority.authorityScope,
    operationType: input.operationType,
    inputFingerprint,
    status: "RUNNING" as const,
    claimOwnerWorkerId: input.authority.workerId,
    claimTaskLeaseToken: input.authority.leaseToken,
    claimTaskLeaseEpoch: input.authority.leaseEpoch,
    claimToken,
    claimEpoch,
    claimExpiresAt,
    createdAt,
    updatedAt: input.now,
  });
}

export function decideOperationClaim(
  input: OperationClaimInput,
): OperationClaimResult {
  const authorityValidation = validateTaskExecutionAuthority(
    input.authority,
    input.now,
  );

  if (!authorityValidation.ok) {
    return {
      ok: false,
      status: "REFUSED",
      reasonCode:
        `task-authority:${authorityValidation.reasonCode}` as
          OperationClaimReasonCode,
    };
  }

  if (!validOperationField(input.operationKey)) {
    return {
      ok: false,
      status: "REFUSED",
      reasonCode:
        input.operationKey.trim().length === 0
          ? "operation-key-empty"
          : "operation-field-too-long",
    };
  }

  if (!validOperationField(input.operationType)) {
    return {
      ok: false,
      status: "REFUSED",
      reasonCode:
        input.operationType.trim().length === 0
          ? "operation-type-empty"
          : "operation-field-too-long",
    };
  }

  const duration = input.claimDurationMs ?? 60_000;

  if (
    !Number.isSafeInteger(duration) ||
    duration < 1 ||
    duration > MAX_CLAIM_DURATION_MS
  ) {
    return {
      ok: false,
      status: "REFUSED",
      reasonCode: "claim-duration-invalid",
    };
  }

  const inputFingerprint = fingerprintOperationIdentity({
    missionId: input.authority.missionId,
    authorityScope: input.authority.authorityScope,
    operationType: input.operationType,
    value: input.value,
  });

  const existing = input.existing;

  if (!existing) {
    return {
      ok: true,
      status: "CLAIMED",
      reasonCode: "ok",
      inputFingerprint,
      record: makeClaim(
        input,
        inputFingerprint,
        1,
        input.now,
      ),
    };
  }

  if (
    !sameBinding(
      existing,
      input.authority,
      input.operationKey,
      input.operationType,
    )
  ) {
    return {
      ok: false,
      status: "REFUSED",
      reasonCode: "existing-operation-binding-mismatch",
      inputFingerprint,
      record: existing,
    };
  }

  if (existing.inputFingerprint !== inputFingerprint) {
    return {
      ok: false,
      status: "REFUSED",
      reasonCode: "input-fingerprint-mismatch",
      inputFingerprint,
      record: existing,
    };
  }

  if (existing.status === "COMPLETED") {
    return {
      ok: true,
      status: "REPLAY_COMPLETED",
      reasonCode: "ok",
      inputFingerprint,
      record: existing,
    };
  }

  if (existing.status === "FAILED") {
    return {
      ok: false,
      status: "REFUSED",
      reasonCode: "terminal-failed",
      inputFingerprint,
      record: existing,
    };
  }

  if (existing.claimExpiresAt > input.now) {
    const sameCaller =
      existing.claimOwnerWorkerId === input.authority.workerId &&
      existing.claimTaskLeaseToken === input.authority.leaseToken &&
      existing.claimTaskLeaseEpoch === input.authority.leaseEpoch;

    if (sameCaller) {
      return {
        ok: true,
        status: "ALREADY_CLAIMED_BY_CALLER",
        reasonCode: "ok",
        inputFingerprint,
        record: existing,
      };
    }

    return {
      ok: false,
      status: "REFUSED",
      reasonCode: "running-other-claim",
      inputFingerprint,
      record: existing,
    };
  }

  return {
    ok: true,
    status: "CLAIMED",
    reasonCode: "ok",
    inputFingerprint,
    record: makeClaim(
      input,
      inputFingerprint,
      existing.claimEpoch + 1,
      existing.createdAt,
    ),
  };
}

function finalize(
  record: OperationExecutionRecord,
  authority: TaskExecutionAuthority,
  claimToken: string,
  claimEpoch: number,
  now: number,
  status: "COMPLETED" | "FAILED",
): OperationFinalizeResult {
  const authorityValidation =
    validateTaskExecutionAuthority(authority, now);

  if (!authorityValidation.ok) {
    return {
      ok: false,
      status: "REFUSED",
      reasonCode:
        `task-authority:${authorityValidation.reasonCode}` as
          OperationFinalizeReasonCode,
    };
  }

  if (record.status !== "RUNNING") {
    return {
      ok: false,
      status: "REFUSED",
      reasonCode: "operation-not-running",
    };
  }

  if (
    record.missionId !== authority.missionId ||
    record.taskId !== authority.taskId ||
    record.authorityScope !== authority.authorityScope
  ) {
    return {
      ok: false,
      status: "REFUSED",
      reasonCode: "operation-binding-mismatch",
    };
  }

  if (record.claimExpiresAt <= now) {
    return {
      ok: false,
      status: "REFUSED",
      reasonCode: "claim-expired",
    };
  }

  if (record.claimOwnerWorkerId !== authority.workerId) {
    return {
      ok: false,
      status: "REFUSED",
      reasonCode: "claim-owner-mismatch",
    };
  }

  if (
    record.claimTaskLeaseToken !== authority.leaseToken
  ) {
    return {
      ok: false,
      status: "REFUSED",
      reasonCode: "task-lease-token-mismatch",
    };
  }

  if (
    record.claimTaskLeaseEpoch !== authority.leaseEpoch
  ) {
    return {
      ok: false,
      status: "REFUSED",
      reasonCode: "task-lease-epoch-mismatch",
    };
  }

  if (record.claimToken !== claimToken) {
    return {
      ok: false,
      status: "REFUSED",
      reasonCode: "claim-token-mismatch",
    };
  }

  if (record.claimEpoch !== claimEpoch) {
    return {
      ok: false,
      status: "REFUSED",
      reasonCode: "claim-epoch-mismatch",
    };
  }

  return {
    ok: true,
    status,
    reasonCode: "ok",
    record: Object.freeze({
      ...record,
      status,
      updatedAt: now,
      finishedAt: now,
    }),
  };
}

export function completeOperationClaim(
  record: OperationExecutionRecord,
  authority: TaskExecutionAuthority,
  claimToken: string,
  claimEpoch: number,
  now: number,
): OperationFinalizeResult {
  return finalize(
    record,
    authority,
    claimToken,
    claimEpoch,
    now,
    "COMPLETED",
  );
}

export function failOperationClaim(
  record: OperationExecutionRecord,
  authority: TaskExecutionAuthority,
  claimToken: string,
  claimEpoch: number,
  now: number,
): OperationFinalizeResult {
  return finalize(
    record,
    authority,
    claimToken,
    claimEpoch,
    now,
    "FAILED",
  );
}