import type { CanonicalFrozenPlanContractIdentity } from "../protocol/canonicalFrozenPlanContract";
import {
  restoreCanonicalRuntimeRecoveryCheckpoint,
  type CanonicalRuntimeRecoveryCheckpoint,
  type CanonicalRuntimeRecoveryFailure,
} from "./canonicalRuntimeRecoveryCheckpoint";

export type CanonicalRuntimeRecoveryCreateResult = "CREATED" | "ALREADY_EXISTS";
export type CanonicalRuntimeRecoveryCasResult =
  | { readonly status: "UPDATED"; readonly checkpointVersion: number }
  | { readonly status: "NOT_FOUND" }
  | { readonly status: "VERSION_CONFLICT"; readonly currentCheckpointVersion: number };

/**
 * Version 2 persistence only; no implicit conversion from version 1.
 *
 * Store implementations must capture/validate inputs before asynchronous work,
 * validate the full recovery transition against the authoritative current row,
 * and write the entire snapshot under one CAS revision. No field-by-field writes.
 * load returns null only for absence. Corruption and infrastructure errors throw.
 *
 * Contract pins are explicit inputs from a trusted authority source, NOT values
 * inferred from an unchecked checkpoint. Pins must survive process restart in
 * that authority source. This interface does not create or persist approvals.
 * Consistency validation is not proof of execution, gate passage or ownership.
 */
export interface CanonicalRuntimeRecoveryStore {
  create(checkpoint: CanonicalRuntimeRecoveryCheckpoint): Promise<CanonicalRuntimeRecoveryCreateResult>;
  load(
    missionId: string,
    expectedContract: CanonicalFrozenPlanContractIdentity | null,
  ): Promise<CanonicalRuntimeRecoveryCheckpoint | null>;
  compareAndSet(
    missionId: string,
    expectedCheckpointVersion: number,
    checkpoint: CanonicalRuntimeRecoveryCheckpoint,
    currentExpectedContract: CanonicalFrozenPlanContractIdentity | null,
    nextExpectedContract: CanonicalFrozenPlanContractIdentity | null,
  ): Promise<CanonicalRuntimeRecoveryCasResult>;
}

export function isCanonicalRuntimeRecoveryMissionId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export type CanonicalRuntimeRecoveryPinSnapshot =
  | { readonly ok: true; readonly pin: CanonicalFrozenPlanContractIdentity | null }
  | { readonly ok: false; readonly reasonCode: "expected-contract-pin-invalid" };

/**
 * Defensive copy across an asynchronous boundary; never invokes accessors.
 * This checks only the external pin's data surface. The existing frozen-contract
 * and recovery validators remain authoritative for identity/content validation.
 */
export function snapshotCanonicalRuntimeRecoveryPin(value: unknown): CanonicalRuntimeRecoveryPinSnapshot {
  const invalid = () => Object.freeze({ ok: false as const,
    reasonCode: "expected-contract-pin-invalid" as const });
  if (value === null) return Object.freeze({ ok: true as const, pin: null });
  try {
    if (typeof value !== "object" || Array.isArray(value)) return invalid();
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return invalid();
    const keys = ["missionId", "contractId", "contractVersion", "contractHash"] as const;
    if (Reflect.ownKeys(value).length !== keys.length) return invalid();
    const captured = {} as Record<typeof keys[number], string>;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable ||
        typeof descriptor.value !== "string" || descriptor.value.trim().length === 0) return invalid();
      captured[key] = descriptor.value;
    }
    return Object.freeze({ ok: true as const, pin: Object.freeze(captured) });
  } catch { return invalid(); }
}

export type CanonicalRuntimeRecoveryCandidateResult =
  | { readonly ok: true; readonly checkpoint: CanonicalRuntimeRecoveryCheckpoint;
      readonly pin: CanonicalFrozenPlanContractIdentity | null }
  | CanonicalRuntimeRecoveryFailure
  | { readonly ok: false; readonly reasonCode: "expected-contract-pin-invalid" };

/** Shared strict reader for stores and sessions; returns detached frozen data. */
export function readCanonicalRuntimeRecoveryCandidate(
  value: unknown,
  expectedContract: CanonicalFrozenPlanContractIdentity | null,
): CanonicalRuntimeRecoveryCandidateResult {
  const captured = snapshotCanonicalRuntimeRecoveryPin(expectedContract);
  if (!captured.ok) return captured;
  const restored = restoreCanonicalRuntimeRecoveryCheckpoint(value, captured.pin);
  if (!restored.ok) return restored;
  return Object.freeze({ ok: true as const, checkpoint: restored.checkpoint, pin: captured.pin });
}

/** Called only on a validated snapshot; zero history is explicit, never filled. */
export function isInitialCanonicalRuntimeRecoveryCheckpoint(
  checkpoint: CanonicalRuntimeRecoveryCheckpoint,
): boolean {
  return checkpoint.checkpointVersion === 1 &&
    checkpoint.cursor.nodeIndex === 0 && checkpoint.cursor.nodeId === "EER" &&
    checkpoint.cursor.stepVersion === 1 && checkpoint.cursor.contractPhase === "PRE_FREEZE" &&
    checkpoint.frozenContract === null && checkpoint.failureCount === 0 &&
    checkpoint.gateStates.every((state) => state.livelockCounter === 0);
}
