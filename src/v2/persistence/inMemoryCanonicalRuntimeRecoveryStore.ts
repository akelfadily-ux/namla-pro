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
  type CanonicalRuntimeRecoveryCreateResult,
  type CanonicalRuntimeRecoveryStore,
} from "./canonicalRuntimeRecoveryStore";

function assertMissionId(value: unknown): asserts value is string {
  if (!isCanonicalRuntimeRecoveryMissionId(value)) throw new Error("RECOVERY_MISSION_ID_INVALID");
}
function checked(value: unknown, pin: CanonicalFrozenPlanContractIdentity | null) {
  const result = readCanonicalRuntimeRecoveryCandidate(value, pin);
  if (!result.ok) throw new Error(`INVALID_RECOVERY_CHECKPOINT:${result.reasonCode}`);
  return result;
}

/**
 * Single-process reference store. Volatile: NOT disk persistence or crash proof.
 * There is deliberately no await between reading the current entry and writing
 * its successor. One map replacement commits cursor, budget, gates and contract.
 */
export class InMemoryCanonicalRuntimeRecoveryStore implements CanonicalRuntimeRecoveryStore {
  private readonly checkpoints = new Map<string, CanonicalRuntimeRecoveryCheckpoint>();

  public async create(checkpoint: CanonicalRuntimeRecoveryCheckpoint): Promise<CanonicalRuntimeRecoveryCreateResult> {
    const candidate = checked(checkpoint, null).checkpoint;
    if (!isInitialCanonicalRuntimeRecoveryCheckpoint(candidate)) {
      throw new Error("RECOVERY_INITIAL_CHECKPOINT_REQUIRED");
    }
    if (this.checkpoints.has(candidate.missionId)) return "ALREADY_EXISTS";
    this.checkpoints.set(candidate.missionId, candidate);
    return "CREATED";
  }

  public async load(
    missionId: string, expectedContract: CanonicalFrozenPlanContractIdentity | null,
  ): Promise<CanonicalRuntimeRecoveryCheckpoint | null> {
    assertMissionId(missionId);
    const external = snapshotCanonicalRuntimeRecoveryPin(expectedContract);
    if (!external.ok) throw new Error("RECOVERY_EXPECTED_CONTRACT_PIN_INVALID");
    const current = this.checkpoints.get(missionId);
    if (!current) return null;
    return structuredClone(checked(current, external.pin).checkpoint);
  }

  public async compareAndSet(
    missionId: string, expectedCheckpointVersion: number,
    checkpoint: CanonicalRuntimeRecoveryCheckpoint,
    currentExpectedContract: CanonicalFrozenPlanContractIdentity | null,
    nextExpectedContract: CanonicalFrozenPlanContractIdentity | null,
  ): Promise<CanonicalRuntimeRecoveryCasResult> {
    assertMissionId(missionId);
    if (!Number.isSafeInteger(expectedCheckpointVersion) || expectedCheckpointVersion < 1) {
      throw new Error("RECOVERY_EXPECTED_CHECKPOINT_VERSION_INVALID");
    }
    const beforePin = snapshotCanonicalRuntimeRecoveryPin(currentExpectedContract);
    if (!beforePin.ok) throw new Error("RECOVERY_EXPECTED_CONTRACT_PIN_INVALID");
    const next = checked(checkpoint, nextExpectedContract);
    if (next.checkpoint.missionId !== missionId) throw new Error("RECOVERY_MISSION_ID_MISMATCH");
    if (next.checkpoint.checkpointVersion !== expectedCheckpointVersion + 1) {
      throw new Error("RECOVERY_CHECKPOINT_VERSION_NOT_NEXT");
    }
    const current = this.checkpoints.get(missionId);
    if (!current) return Object.freeze({ status: "NOT_FOUND" as const });
    // Entries were validated before insertion. A stale caller cannot authorize
    // anything; report the conflict without reinterpreting its old contract pin.
    if (current.checkpointVersion !== expectedCheckpointVersion) {
      return Object.freeze({ status: "VERSION_CONFLICT" as const,
        currentCheckpointVersion: current.checkpointVersion });
    }
    const transition = validateCanonicalRuntimeRecoveryTransition(
      current, next.checkpoint, beforePin.pin, next.pin,
    );
    if (!transition.ok) throw new Error(`INVALID_RECOVERY_TRANSITION:${transition.reasonCode}`);
    this.checkpoints.set(missionId, next.checkpoint);
    return Object.freeze({ status: "UPDATED" as const,
      checkpointVersion: next.checkpoint.checkpointVersion });
  }
}
