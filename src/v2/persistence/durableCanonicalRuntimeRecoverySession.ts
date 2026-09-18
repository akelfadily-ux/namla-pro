import type { CanonicalFrozenPlanContractIdentity } from "../protocol/canonicalFrozenPlanContract";
import {
  validateCanonicalRuntimeRecoveryTransition,
  type CanonicalRuntimeRecoveryCheckpoint,
} from "./canonicalRuntimeRecoveryCheckpoint";
import {
  isCanonicalRuntimeRecoveryMissionId,
  isInitialCanonicalRuntimeRecoveryCheckpoint,
  readCanonicalRuntimeRecoveryCandidate,
  snapshotCanonicalRuntimeRecoveryPin,
  type CanonicalRuntimeRecoveryCasResult,
  type CanonicalRuntimeRecoveryStore,
} from "./canonicalRuntimeRecoveryStore";

export type DurableCanonicalRuntimeRecoverySessionReason =
  | "session-failed-closed" | "session-busy" | "session-not-active" | "session-already-active"
  | "mission-id-mismatch" | "expected-contract-pin-invalid" | "invalid-checkpoint"
  | "invalid-initial-checkpoint" | "invalid-transition" | "checkpoint-not-found"
  | "checkpoint-already-exists" | "checkpoint-version-conflict" | "checkpoint-disappeared"
  | "store-receipt-invalid" | "storage-operation-failed";

export interface DurableCanonicalRuntimeRecoverySessionFailure {
  readonly ok: false;
  readonly status: "REFUSED";
  readonly reasonCode: DurableCanonicalRuntimeRecoverySessionReason;
  readonly detailReasonCode?: string;
  readonly currentCheckpointVersion?: number;
  readonly lockedByReasonCode?: DurableCanonicalRuntimeRecoverySessionReason;
}
export type DurableCanonicalRuntimeRecoverySessionResult =
  | { readonly ok: true; readonly status: "CREATED" | "RESUMED" | "UPDATED";
      readonly reasonCode: "ok"; readonly checkpoint: CanonicalRuntimeRecoveryCheckpoint }
  | DurableCanonicalRuntimeRecoverySessionFailure;

/** Capture a strict receipt without invoking getters supplied by an adapter. */
function readCasReceipt(value: unknown): CanonicalRuntimeRecoveryCasResult | null {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, "status");
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
    const status: unknown = descriptor.value;
    if (status === "NOT_FOUND") {
      return Reflect.ownKeys(value).length === 1 ? { status } : null;
    }
    if (status !== "UPDATED" && status !== "VERSION_CONFLICT") return null;
    const key = status === "UPDATED" ? "checkpointVersion" : "currentCheckpointVersion";
    const version = Object.getOwnPropertyDescriptor(value, key);
    if (Reflect.ownKeys(value).length !== 2 || !version || !("value" in version) ||
      !version.enumerable || typeof version.value !== "number" ||
      !Number.isSafeInteger(version.value) || version.value < 1) return null;
    return status === "UPDATED" ? { status, checkpointVersion: version.value } :
      { status, currentCheckpointVersion: version.value };
  } catch { return null; }
}

/**
 * Full v2 snapshot session. Durability depends on the injected store; an in-memory
 * store cannot survive process loss. Not an orchestrator or execution permit.
 *
 * Permanent failures require a NEW session and explicit resume with an external
 * contract pin. No automatic reload, pin inference, budget refill or v1 upgrade.
 * Calls on this instance are single-flight: a concurrent call is refused with
 * session-busy without invalidating the earlier in-flight operation. This guard
 * is process-local; competing sessions still require the store's atomic CAS.
 */
export class DurableCanonicalRuntimeRecoverySession {
  private currentCheckpoint: CanonicalRuntimeRecoveryCheckpoint | null = null;
  private currentContractPin: CanonicalFrozenPlanContractIdentity | null = null;
  private failedClosedReason: DurableCanonicalRuntimeRecoverySessionReason | null = null;
  private inFlight = false;

  public constructor(private readonly store: CanonicalRuntimeRecoveryStore, public readonly missionId: string) {
    if (!isCanonicalRuntimeRecoveryMissionId(missionId)) throw new Error("RECOVERY_SESSION_MISSION_ID_INVALID");
  }
  public isActive(): boolean { return this.currentCheckpoint !== null && this.failedClosedReason === null; }
  public isFailedClosed(): boolean { return this.failedClosedReason !== null; }
  public getSnapshot(): CanonicalRuntimeRecoveryCheckpoint | null {
    return this.currentCheckpoint === null ? null : structuredClone(this.currentCheckpoint);
  }

  public async createInitial(checkpoint: CanonicalRuntimeRecoveryCheckpoint): Promise<DurableCanonicalRuntimeRecoverySessionResult> {
    return this.run(async () => {
      if (this.currentCheckpoint !== null) return this.fail("session-already-active");
      const candidate = readCanonicalRuntimeRecoveryCandidate(checkpoint, null);
      if (!candidate.ok) return this.fail("invalid-checkpoint", candidate.reasonCode);
      if (candidate.checkpoint.missionId !== this.missionId) return this.fail("mission-id-mismatch");
      if (!isInitialCanonicalRuntimeRecoveryCheckpoint(candidate.checkpoint)) {
        return this.fail("invalid-initial-checkpoint");
      }
      const receipt: unknown = await this.store.create(candidate.checkpoint);
      if (receipt === "ALREADY_EXISTS") return this.fail("checkpoint-already-exists");
      if (receipt !== "CREATED") return this.fail("store-receipt-invalid");
      this.currentCheckpoint = candidate.checkpoint;
      this.currentContractPin = null;
      return this.success("CREATED");
    });
  }

  public async resume(
    expectedContract: CanonicalFrozenPlanContractIdentity | null,
  ): Promise<DurableCanonicalRuntimeRecoverySessionResult> {
    return this.run(async () => {
      if (this.currentCheckpoint !== null) return this.fail("session-already-active");
      const external = snapshotCanonicalRuntimeRecoveryPin(expectedContract);
      if (!external.ok) return this.fail("expected-contract-pin-invalid");
      const loaded: unknown = await this.store.load(this.missionId, external.pin);
      if (loaded === null) return this.fail("checkpoint-not-found");
      const candidate = readCanonicalRuntimeRecoveryCandidate(loaded, external.pin);
      if (!candidate.ok) return this.fail("invalid-checkpoint", candidate.reasonCode);
      if (candidate.checkpoint.missionId !== this.missionId) return this.fail("mission-id-mismatch");
      this.currentCheckpoint = candidate.checkpoint;
      this.currentContractPin = candidate.pin;
      return this.success("RESUMED");
    });
  }

  public async advance(
    nextCheckpoint: CanonicalRuntimeRecoveryCheckpoint,
    nextExpectedContract: CanonicalFrozenPlanContractIdentity | null,
  ): Promise<DurableCanonicalRuntimeRecoverySessionResult> {
    return this.run(async () => {
      const current = this.currentCheckpoint;
      if (current === null) return this.fail("session-not-active");
      const candidate = readCanonicalRuntimeRecoveryCandidate(nextCheckpoint, nextExpectedContract);
      if (!candidate.ok) return this.fail("invalid-checkpoint", candidate.reasonCode);
      if (candidate.checkpoint.missionId !== this.missionId) return this.fail("mission-id-mismatch");
      const transition = validateCanonicalRuntimeRecoveryTransition(
        current, candidate.checkpoint, this.currentContractPin, candidate.pin,
      );
      if (!transition.ok) return this.fail("invalid-transition", transition.reasonCode);
      const raw: unknown = await this.store.compareAndSet(this.missionId, current.checkpointVersion,
        candidate.checkpoint, this.currentContractPin, candidate.pin);
      const receipt = readCasReceipt(raw);
      if (!receipt) return this.fail("store-receipt-invalid");
      if (receipt.status === "NOT_FOUND") return this.fail("checkpoint-disappeared");
      if (receipt.status === "VERSION_CONFLICT") {
        if (receipt.currentCheckpointVersion === current.checkpointVersion) {
          return this.fail("store-receipt-invalid");
        }
        return this.fail("checkpoint-version-conflict", undefined, receipt.currentCheckpointVersion);
      }
      if (receipt.checkpointVersion !== candidate.checkpoint.checkpointVersion) {
        return this.fail("store-receipt-invalid");
      }
      this.currentCheckpoint = candidate.checkpoint;
      this.currentContractPin = candidate.pin;
      return this.success("UPDATED");
    });
  }

  private async run(
    work: () => Promise<DurableCanonicalRuntimeRecoverySessionResult>,
  ): Promise<DurableCanonicalRuntimeRecoverySessionResult> {
    if (this.failedClosedReason !== null) return {
      ok: false, status: "REFUSED", reasonCode: "session-failed-closed",
      lockedByReasonCode: this.failedClosedReason,
    };
    if (this.inFlight) return { ok: false, status: "REFUSED", reasonCode: "session-busy" };
    this.inFlight = true;
    try { return await work(); }
    catch { return this.fail("storage-operation-failed"); }
    finally { this.inFlight = false; }
  }
  private success(status: "CREATED" | "RESUMED" | "UPDATED"): DurableCanonicalRuntimeRecoverySessionResult {
    return { ok: true, status, reasonCode: "ok", checkpoint: structuredClone(this.currentCheckpoint!) };
  }
  private fail(
    reasonCode: DurableCanonicalRuntimeRecoverySessionReason,
    detailReasonCode?: string, currentCheckpointVersion?: number,
  ): DurableCanonicalRuntimeRecoverySessionFailure {
    if (this.failedClosedReason === null) this.failedClosedReason = reasonCode;
    return { ok: false, status: "REFUSED", reasonCode, lockedByReasonCode: this.failedClosedReason,
      ...(detailReasonCode === undefined ? {} : { detailReasonCode }),
      ...(currentCheckpointVersion === undefined ? {} : { currentCheckpointVersion }) };
  }
}
