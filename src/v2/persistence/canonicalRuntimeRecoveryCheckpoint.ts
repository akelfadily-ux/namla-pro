import { isDeepStrictEqual } from "node:util";
import {
  CANONICAL_PIPELINE_SEQUENCE,
  type CanonicalLoopGateInstanceId,
} from "../architecture/canonicalPipelineRegistry";
import {
  readNamlaLoopGateState,
  type NamlaLoopGateState,
} from "../loop/namlaLoopGate";
import {
  restoreCanonicalFrozenPlanContract,
  type CanonicalFrozenPlanContractBinding,
  type CanonicalFrozenPlanContractIdentity,
} from "../protocol/canonicalFrozenPlanContract";
import {
  validateCanonicalRuntimeLoopBudget,
  validateCanonicalRuntimeLoopBudgetTransition,
} from "../runtime/canonicalRuntimeLoopBudget";
import type { CanonicalRuntimeCursor } from "../runtime/canonicalRuntimeStepper";
import type { PlanContract } from "../types/contracts";
import type { LoopBudget } from "../types/namlaLoopTypes";
import {
  V2_CANONICAL_RUNTIME_CHECKPOINT_SCHEMA,
  validateCanonicalRuntimeCheckpoint,
} from "./canonicalRuntimeCursorStore";

export const V2_CANONICAL_RUNTIME_RECOVERY_CHECKPOINT_SCHEMA =
  "namla-v2-canonical-runtime-checkpoint-v2" as const;

/**
 * Version 2 control/recovery-policy snapshot. Not an execution permit.
 *
 * The external pipeline's global gate states are explicit, complete and ordered.
 * PRO-internal work-package gate state belongs to its own execution records.
 * failureCount is lifetime accounting; individual livelockCounter values are
 * consecutive evidence-failure counters and may reset only at their own gate.
 *
 * This is NOT a complete factory recovery journal. Authoritative inputs,
 * results, evidence and pending operation identities still need durable binding
 * before an orchestrator can resume execution. Version 1 stores intentionally
 * remain unchanged and will reject this envelope until explicitly upgraded.
 */
export interface CanonicalRuntimeRecoveryCheckpoint {
  readonly schemaVersion: typeof V2_CANONICAL_RUNTIME_RECOVERY_CHECKPOINT_SCHEMA;
  readonly missionId: string;
  readonly checkpointVersion: number;
  readonly cursor: CanonicalRuntimeCursor;
  readonly savedAt: number;
  readonly loopBudget: LoopBudget;
  readonly gateStates: readonly NamlaLoopGateState[];
  readonly failureCount: number;
  readonly frozenContract: CanonicalFrozenPlanContractBinding | null;
}

export type CanonicalRuntimeRecoveryReason =
  | "recovery-shape-invalid"
  | "recovery-schema-invalid"
  | "recovery-cursor-checkpoint-invalid"
  | "recovery-budget-invalid"
  | "recovery-gate-states-invalid"
  | "recovery-gate-binding-invalid"
  | "recovery-future-gate-history"
  | "recovery-failure-count-invalid"
  | "recovery-contract-phase-invalid"
  | "recovery-contract-invalid"
  | "recovery-contract-mission-mismatch"
  | "recovery-validation-failed"
  | "recovery-mission-mismatch"
  | "recovery-version-not-next"
  | "recovery-saved-at-regression"
  | "recovery-cursor-transition-invalid"
  | "recovery-budget-transition-invalid"
  | "recovery-failure-count-regression"
  | "recovery-contract-mutated"
  | "recovery-contract-boundary-invalid"
  | "recovery-gate-threshold-mutated"
  | "recovery-gate-counter-transition-invalid";

export interface CanonicalRuntimeRecoveryFailure {
  readonly ok: false;
  readonly reasonCode: CanonicalRuntimeRecoveryReason;
  readonly detailReasonCode?: string;
}

export type CanonicalRuntimeRecoveryRestoreResult =
  | {
      readonly ok: true;
      readonly reasonCode: "ok";
      readonly checkpoint: CanonicalRuntimeRecoveryCheckpoint;
      readonly contract: PlanContract | null;
    }
  | CanonicalRuntimeRecoveryFailure;

export type CanonicalRuntimeRecoveryValidation =
  | { readonly ok: true; readonly reasonCode: "ok" }
  | CanonicalRuntimeRecoveryFailure;

const ROOT_FIELDS = [
  "schemaVersion", "missionId", "checkpointVersion", "cursor", "savedAt",
  "loopBudget", "gateStates", "failureCount", "frozenContract",
] as const;
const CURSOR_FIELDS = [
  "schemaVersion", "missionId", "nodeIndex", "nodeId", "nodeKind",
  "stepVersion", "contractPhase",
] as const;
const BUDGET_FIELDS = [
  "maxTicks", "remainingTicks", "maxFixAttempts", "remainingFixAttempts",
  "maxProviderCalls", "remainingProviderCalls",
] as const;
const GATES: readonly { readonly id: CanonicalLoopGateInstanceId; readonly index: number }[] =
  Object.freeze(CANONICAL_PIPELINE_SEQUENCE.flatMap((node, index) =>
    node.kind === "GATE" ? [Object.freeze({ id: node.id, index })] : []));

function refused(
  reasonCode: CanonicalRuntimeRecoveryReason, detailReasonCode?: string,
): CanonicalRuntimeRecoveryFailure {
  return Object.freeze({ ok: false as const, reasonCode,
    ...(detailReasonCode === undefined ? {} : { detailReasonCode }) });
}

/** Snapshot exact own data properties without invoking getters or toJSON. */
function readFields(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  if (Reflect.ownKeys(value).length !== keys.length) return null;
  const captured: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
    captured[key] = descriptor.value;
  }
  return captured;
}

function readGateArray(value: unknown): readonly NamlaLoopGateState[] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
  // Reject holes, accessors, symbols and extra properties before reading entries.
  const length = Object.getOwnPropertyDescriptor(value, "length");
  if (!length || !("value" in length) || length.value !== GATES.length) return null;
  if (Reflect.ownKeys(value).length !== GATES.length + 1) return null;
  const states: NamlaLoopGateState[] = [];
  for (let index = 0; index < GATES.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
    const state = readNamlaLoopGateState(descriptor.value);
    if (!state) return null;
    states.push(state);
  }
  return Object.freeze(states);
}

/**
 * No defaults and no v1-to-v2 upgrade. expectedContract is mandatory: null for
 * PRE_FREEZE, otherwise an independently obtained authoritative identity pin.
 * Do not derive that pin from the untrusted frozenContract being checked.
 * Successful restore establishes structural/integrity consistency, not history
 * authenticity, PLAN_TEST approval, current execution authority or freshness.
 */
export function restoreCanonicalRuntimeRecoveryCheckpoint(
  value: unknown,
  expectedContract: CanonicalFrozenPlanContractIdentity | null,
): CanonicalRuntimeRecoveryRestoreResult {
  try {
    const data = readFields(value, ROOT_FIELDS);
    if (!data) return refused("recovery-shape-invalid");
    if (data.schemaVersion !== V2_CANONICAL_RUNTIME_RECOVERY_CHECKPOINT_SCHEMA) {
      return refused("recovery-schema-invalid");
    }
    const cursor = readFields(data.cursor, CURSOR_FIELDS);
    if (!cursor) return refused("recovery-cursor-checkpoint-invalid");
    // Reuse the strict cursor/envelope checks; no independently maintained copy.
    const cursorValidation = validateCanonicalRuntimeCheckpoint({
      schemaVersion: V2_CANONICAL_RUNTIME_CHECKPOINT_SCHEMA,
      missionId: data.missionId, checkpointVersion: data.checkpointVersion,
      cursor, savedAt: data.savedAt,
    });
    if (!cursorValidation.ok) {
      return refused("recovery-cursor-checkpoint-invalid", cursorValidation.reasonCode);
    }
    const budget = readFields(data.loopBudget, BUDGET_FIELDS);
    if (!budget || !validateCanonicalRuntimeLoopBudget(budget).ok) {
      return refused("recovery-budget-invalid");
    }
    const gateStates = readGateArray(data.gateStates);
    if (!gateStates) return refused("recovery-gate-states-invalid");
    let consecutiveFailures = 0;
    for (let index = 0; index < GATES.length; index += 1) {
      const state = gateStates[index];
      if (state.missionId !== data.missionId || state.stageId !== GATES[index].id ||
        state.workPackageId !== null) return refused("recovery-gate-binding-invalid");
      if (GATES[index].index > (cursor.nodeIndex as number) && state.livelockCounter !== 0) {
        return refused("recovery-future-gate-history");
      }
      consecutiveFailures += state.livelockCounter;
    }
    if (typeof data.failureCount !== "number" || !Number.isSafeInteger(data.failureCount) ||
      data.failureCount < 0 || !Number.isSafeInteger(consecutiveFailures) ||
      data.failureCount < consecutiveFailures) return refused("recovery-failure-count-invalid");

    let binding: CanonicalFrozenPlanContractBinding | null = null;
    let contract: PlanContract | null = null;
    if (cursor.contractPhase === "PRE_FREEZE") {
      if (data.frozenContract !== null || expectedContract !== null) {
        return refused("recovery-contract-phase-invalid");
      }
    } else {
      if (data.frozenContract === null || expectedContract === null) {
        return refused("recovery-contract-phase-invalid");
      }
      const restored = restoreCanonicalFrozenPlanContract(data.frozenContract, expectedContract);
      if (!restored.ok) return refused("recovery-contract-invalid", restored.reasonCode);
      if (restored.binding.missionId !== data.missionId) {
        return refused("recovery-contract-mission-mismatch");
      }
      binding = restored.binding;
      contract = restored.contract;
    }
    const checkpoint: CanonicalRuntimeRecoveryCheckpoint = Object.freeze({
      schemaVersion: V2_CANONICAL_RUNTIME_RECOVERY_CHECKPOINT_SCHEMA,
      missionId: data.missionId as string,
      checkpointVersion: data.checkpointVersion as number,
      cursor: Object.freeze(cursor) as unknown as CanonicalRuntimeCursor,
      savedAt: data.savedAt as number,
      loopBudget: Object.freeze(budget) as unknown as LoopBudget,
      gateStates, failureCount: data.failureCount, frozenContract: binding,
    });
    return Object.freeze({ ok: true as const, reasonCode: "ok" as const, checkpoint, contract });
  } catch {
    return refused("recovery-validation-failed");
  }
}

/**
 * Candidate transition consistency only. Does not execute a factory/gate or
 * perform CAS. The caller must also verify genuine completions, gate verdicts,
 * operation receipts and ownership before atomically persisting the candidate.
 * Both contract pins must come from trusted state, not the candidates themselves.
 */
export function validateCanonicalRuntimeRecoveryTransition(
  current: unknown,
  next: unknown,
  currentContractPin: CanonicalFrozenPlanContractIdentity | null,
  nextContractPin: CanonicalFrozenPlanContractIdentity | null,
): CanonicalRuntimeRecoveryValidation {
  const beforeResult = restoreCanonicalRuntimeRecoveryCheckpoint(current, currentContractPin);
  if (!beforeResult.ok) return beforeResult;
  const afterResult = restoreCanonicalRuntimeRecoveryCheckpoint(next, nextContractPin);
  if (!afterResult.ok) return afterResult;
  const before = beforeResult.checkpoint;
  const after = afterResult.checkpoint;
  if (before.missionId !== after.missionId) return refused("recovery-mission-mismatch");
  if (after.checkpointVersion !== before.checkpointVersion + 1) {
    return refused("recovery-version-not-next");
  }
  if (after.savedAt < before.savedAt) return refused("recovery-saved-at-regression");
  const sameCursor = isDeepStrictEqual(before.cursor, after.cursor);
  const adjacent = after.cursor.nodeIndex === before.cursor.nodeIndex + 1 &&
    after.cursor.stepVersion === before.cursor.stepVersion + 1;
  if (!sameCursor && !adjacent) return refused("recovery-cursor-transition-invalid");
  const budgetTransition = validateCanonicalRuntimeLoopBudgetTransition(before.loopBudget, after.loopBudget);
  if (!budgetTransition.ok) return refused("recovery-budget-transition-invalid", budgetTransition.reasonCode);
  if (after.failureCount < before.failureCount) return refused("recovery-failure-count-regression");
  if (before.frozenContract !== null && !isDeepStrictEqual(before.frozenContract, after.frozenContract)) {
    return refused("recovery-contract-mutated");
  }
  if (before.frozenContract === null && after.frozenContract !== null &&
    !(before.cursor.nodeId === "LOOP_AFTER_PLAN_TEST" && after.cursor.nodeId === "PRO" && adjacent)) {
    return refused("recovery-contract-boundary-invalid");
  }
  for (let index = 0; index < GATES.length; index += 1) {
    const oldState = before.gateStates[index];
    const newState = after.gateStates[index];
    if (newState.maxLivelockThreshold !== oldState.maxLivelockThreshold) {
      return refused("recovery-gate-threshold-mutated");
    }
    const active = before.cursor.nodeKind === "GATE" && before.cursor.nodeId === GATES[index].id;
    if (active && adjacent) {
      // Successful gate passage resets its consecutive-failure counter.
      if (newState.livelockCounter !== 0) return refused("recovery-gate-counter-transition-invalid");
    } else if (newState.livelockCounter !== oldState.livelockCounter) {
      // A newly recorded evidence failure stays at the same gate, increments
      // exactly once, and must also be reflected in lifetime failure accounting.
      if (!active || !sameCursor ||
        oldState.livelockCounter >= oldState.maxLivelockThreshold ||
        newState.livelockCounter !== oldState.livelockCounter + 1 ||
        after.failureCount <= before.failureCount) {
        return refused("recovery-gate-counter-transition-invalid");
      }
    }
  }
  return Object.freeze({ ok: true as const, reasonCode: "ok" as const });
}
