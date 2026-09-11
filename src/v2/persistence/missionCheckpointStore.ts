import { EvidenceRecord } from "../types/evidence";
import {
  IntegratedCandidate,
  MissionStateRecord,
} from "../types/missionState";
import { LoopBudget } from "../types/namlaLoopTypes";

export const V2_MISSION_CHECKPOINT_SCHEMA =
  "namla-v2-mission-checkpoint-v1" as const;

export interface MissionCheckpoint {
  readonly schemaVersion: typeof V2_MISSION_CHECKPOINT_SCHEMA;
  readonly missionId: string;
  readonly state: MissionStateRecord;
  readonly loopBudget: LoopBudget;
  readonly evidenceRecords: readonly EvidenceRecord[];
  readonly integratedCandidates: readonly IntegratedCandidate[];
  readonly savedAt: number;
}

export type MissionCheckpointCreateResult =
  | "CREATED"
  | "ALREADY_EXISTS";

export type MissionCheckpointCasResult =
  | {
      readonly status: "UPDATED";
      readonly stateVersion: number;
    }
  | {
      readonly status: "NOT_FOUND";
    }
  | {
      readonly status: "VERSION_CONFLICT";
      readonly currentStateVersion: number;
    };

export interface MissionCheckpointStore {
  create(
    checkpoint: MissionCheckpoint,
  ): Promise<MissionCheckpointCreateResult>;

  load(
    missionId: string,
  ): Promise<MissionCheckpoint | null>;

  compareAndSet(
    missionId: string,
    expectedStateVersion: number,
    checkpoint: MissionCheckpoint,
  ): Promise<MissionCheckpointCasResult>;
}

export type MissionCheckpointValidationReason =
  | "ok"
  | "mission-id-empty"
  | "state-mission-id-mismatch"
  | "state-version-invalid"
  | "saved-at-invalid"
  | "loop-budget-invalid"
  | "work-package-mission-id-mismatch"
  | "evidence-mission-id-mismatch"
  | "candidate-mission-id-mismatch"
  | "duplicate-evidence-id"
  | "duplicate-candidate-id";

export interface MissionCheckpointValidationResult {
  readonly ok: boolean;
  readonly reasonCode: MissionCheckpointValidationReason;
}

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function validLoopBudget(budget: LoopBudget): boolean {
  if (
    !isNonNegativeSafeInteger(budget.maxTicks) ||
    !isNonNegativeSafeInteger(budget.remainingTicks) ||
    !isNonNegativeSafeInteger(budget.maxFixAttempts) ||
    !isNonNegativeSafeInteger(budget.remainingFixAttempts) ||
    !isNonNegativeSafeInteger(budget.maxProviderCalls) ||
    !isNonNegativeSafeInteger(budget.remainingProviderCalls)
  ) {
    return false;
  }

  if (budget.remainingTicks > budget.maxTicks) {
    return false;
  }

  if (budget.remainingFixAttempts > budget.maxFixAttempts) {
    return false;
  }

  if (budget.remainingProviderCalls > budget.maxProviderCalls) {
    return false;
  }

  return true;
}

export function validateMissionCheckpoint(
  checkpoint: MissionCheckpoint,
): MissionCheckpointValidationResult {
  if (checkpoint.missionId.trim().length === 0) {
    return { ok: false, reasonCode: "mission-id-empty" };
  }

  if (checkpoint.state.missionId !== checkpoint.missionId) {
    return { ok: false, reasonCode: "state-mission-id-mismatch" };
  }

  if (
    !Number.isSafeInteger(checkpoint.state.stateVersion) ||
    checkpoint.state.stateVersion < 1
  ) {
    return { ok: false, reasonCode: "state-version-invalid" };
  }

  if (
    !Number.isSafeInteger(checkpoint.savedAt) ||
    checkpoint.savedAt <= 0
  ) {
    return { ok: false, reasonCode: "saved-at-invalid" };
  }

  if (!validLoopBudget(checkpoint.loopBudget)) {
    return { ok: false, reasonCode: "loop-budget-invalid" };
  }

  for (const workPackage of checkpoint.state.activeWorkPackages) {
    if (workPackage.missionId !== checkpoint.missionId) {
      return {
        ok: false,
        reasonCode: "work-package-mission-id-mismatch",
      };
    }
  }

  const evidenceIds = new Set<string>();

  for (const evidence of checkpoint.evidenceRecords) {
    if (evidence.missionId !== checkpoint.missionId) {
      return {
        ok: false,
        reasonCode: "evidence-mission-id-mismatch",
      };
    }

    if (evidenceIds.has(evidence.evidenceId)) {
      return {
        ok: false,
        reasonCode: "duplicate-evidence-id",
      };
    }

    evidenceIds.add(evidence.evidenceId);
  }

  const candidateIds = new Set<string>();

  for (const candidate of checkpoint.integratedCandidates) {
    if (candidate.missionId !== checkpoint.missionId) {
      return {
        ok: false,
        reasonCode: "candidate-mission-id-mismatch",
      };
    }

    if (candidateIds.has(candidate.candidateId)) {
      return {
        ok: false,
        reasonCode: "duplicate-candidate-id",
      };
    }

    candidateIds.add(candidate.candidateId);
  }

  return { ok: true, reasonCode: "ok" };
}