import {
  validateCanonicalRuntimeCursor,
  type CanonicalRuntimeCursor,
  type CanonicalRuntimeCursorValidationReason,
} from "../runtime/canonicalRuntimeStepper";

export const V2_CANONICAL_RUNTIME_CHECKPOINT_SCHEMA =
  "namla-v2-canonical-runtime-checkpoint-v1" as const;

/**
 * Control-flow checkpoint only; not a factory result or execution permit.
 *
 * A complete runtime recovery record must also preserve budgets, retry state,
 * inputs, outputs and authoritative evidence. This envelope does not supply them.
 */
export interface CanonicalRuntimeCheckpoint {
  readonly schemaVersion: typeof V2_CANONICAL_RUNTIME_CHECKPOINT_SCHEMA;
  readonly missionId: string;

  /** CAS revision; distinct from the cursor's canonical node transition count. */
  readonly checkpointVersion: number;

  readonly cursor: CanonicalRuntimeCursor;
  readonly savedAt: number;
}

export type CanonicalRuntimeCheckpointCreateResult =
  | "CREATED"
  | "ALREADY_EXISTS";

export type CanonicalRuntimeCheckpointCasResult =
  | {
      readonly status: "UPDATED";
      readonly checkpointVersion: number;
    }
  | {
      readonly status: "NOT_FOUND";
    }
  | {
      readonly status: "VERSION_CONFLICT";
      readonly currentCheckpointVersion: number;
    };

/**
 * Store contract, not an implementation.
 *
 * Implementations must validate and detach inputs before asynchronous work,
 * and return detached snapshots. Storage/corruption errors must not be mapped
 * to NOT_FOUND, ALREADY_EXISTS or a successful write.
 *
 * The durable orchestrator remains responsible for execution authority,
 * authentic completions, gate verdicts and the frozen PlanContract.
 */
export interface CanonicalRuntimeCursorStore {
  /** Insert only: checkpointVersion=1 and the initial EER cursor; never upsert. */
  create(
    checkpoint: CanonicalRuntimeCheckpoint,
  ): Promise<CanonicalRuntimeCheckpointCreateResult>;

  /** Return null only when the requested mission does not exist. */
  load(
    missionId: string,
  ): Promise<CanonicalRuntimeCheckpoint | null>;

  /**
   * Atomically compare checkpointVersion and write exactly expectedVersion+1.
   * Mission identity cannot change and savedAt cannot regress.
   *
   * The cursor may stay at the current node or advance exactly one node;
   * a same-node checkpoint does not itself authorize a retry or execution.
   */
  compareAndSet(
    missionId: string,
    expectedCheckpointVersion: number,
    checkpoint: CanonicalRuntimeCheckpoint,
  ): Promise<CanonicalRuntimeCheckpointCasResult>;
}

export type CanonicalRuntimeCheckpointValidationReason =
  | "checkpoint-shape-invalid"
  | "checkpoint-validation-failed"
  | "checkpoint-schema-invalid"
  | "checkpoint-mission-id-invalid"
  | "checkpoint-version-invalid"
  | "checkpoint-cursor-invalid"
  | "checkpoint-cursor-mission-id-mismatch"
  | "checkpoint-version-before-cursor"
  | "checkpoint-saved-at-invalid";

export type CanonicalRuntimeCheckpointValidation =
  | {
      readonly ok: true;
      readonly reasonCode: "ok";
    }
  | {
      readonly ok: false;
      readonly reasonCode: CanonicalRuntimeCheckpointValidationReason;
      readonly cursorReasonCode?: CanonicalRuntimeCursorValidationReason;
    };

const CHECKPOINT_FIELDS = Object.freeze([
  "schemaVersion",
  "missionId",
  "checkpointVersion",
  "cursor",
  "savedAt",
]);

const CURSOR_FIELDS = Object.freeze([
  "schemaVersion",
  "missionId",
  "nodeIndex",
  "nodeId",
  "nodeKind",
  "stepVersion",
  "contractPhase",
]);

/** Accept only the exact own, enumerable data fields of this JSON schema. */
function hasExactDataFields(
  value: unknown,
  fields: readonly string[],
): value is Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }

  const prototype: unknown = Object.getPrototypeOf(value);
  if (
    prototype !== Object.prototype &&
    prototype !== null
  ) {
    return false;
  }

  if (Reflect.ownKeys(value).length !== fields.length) {
    return false;
  }

  return fields.every((field) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);

    return (
      descriptor !== undefined &&
      "value" in descriptor &&
      descriptor.enumerable === true
    );
  });
}

function isPositiveSafeInteger(
  value: unknown,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
  );
}

function invalid(
  reasonCode: CanonicalRuntimeCheckpointValidationReason,
): CanonicalRuntimeCheckpointValidation {
  return Object.freeze({
    ok: false as const,
    reasonCode,
  });
}

/**
 * Structural validation of checkpoint data, not proof of execution history,
 * freshness, ownership, gate acceptance or contract authenticity.
 */
export function validateCanonicalRuntimeCheckpoint(
  checkpoint: unknown,
): CanonicalRuntimeCheckpointValidation {
  try {
    if (!hasExactDataFields(checkpoint, CHECKPOINT_FIELDS)) {
      return invalid("checkpoint-shape-invalid");
    }

    if (
      checkpoint.schemaVersion !==
      V2_CANONICAL_RUNTIME_CHECKPOINT_SCHEMA
    ) {
      return invalid("checkpoint-schema-invalid");
    }

    if (
      typeof checkpoint.missionId !== "string" ||
      checkpoint.missionId.trim().length === 0
    ) {
      return invalid("checkpoint-mission-id-invalid");
    }

    if (!isPositiveSafeInteger(checkpoint.checkpointVersion)) {
      return invalid("checkpoint-version-invalid");
    }

    if (!hasExactDataFields(checkpoint.cursor, CURSOR_FIELDS)) {
      return invalid("checkpoint-cursor-invalid");
    }

    const cursor = checkpoint.cursor;
    const validation = validateCanonicalRuntimeCursor(cursor);

    if (!validation.ok || validation.reasonCode !== "ok") {
      return Object.freeze({
        ok: false as const,
        reasonCode: "checkpoint-cursor-invalid" as const,
        cursorReasonCode: validation.reasonCode,
      });
    }

    if (cursor.missionId !== checkpoint.missionId) {
      return invalid("checkpoint-cursor-mission-id-mismatch");
    }

    if (!isPositiveSafeInteger(cursor.stepVersion)) {
      return invalid("checkpoint-cursor-invalid");
    }

    if (checkpoint.checkpointVersion < cursor.stepVersion) {
      return invalid("checkpoint-version-before-cursor");
    }

    if (!isPositiveSafeInteger(checkpoint.savedAt)) {
      return invalid("checkpoint-saved-at-invalid");
    }

    return Object.freeze({
      ok: true as const,
      reasonCode: "ok" as const,
    });
  } catch {
    return invalid("checkpoint-validation-failed");
  }
}
