import { isDeepStrictEqual } from "node:util";

import {
  DurableCheckpointSessionReasonCode,
  DurableMissionCheckpointSession,
} from "./durableMissionCheckpointSession";

import {
  MissionCheckpoint,
  MissionCheckpointStore,
  V2_MISSION_CHECKPOINT_SCHEMA,
} from "./missionCheckpointStore";

import {
  IntegratedCandidate,
  MissionStage,
  MissionState,
  WorkPackage,
  WorkPackageExecution,
} from "../types/missionState";

import {
  PlanContract,
} from "../types/contracts";

import {
  EvidenceRecord,
} from "../types/evidence";

import {
  LoopBudget,
} from "../types/namlaLoopTypes";

const STAGE_SEQUENCE:
  readonly MissionStage[] = [
    "EER",
    "PLAN",
    "PROTOCOL",
    "PRO",
    "COLONY_AB",
    "SON",
    "LEGGO",
    "PROMAX",
    "NAMLA_LAB",
    "DELIVERY",
  ];

const CANONICAL_STATE_BY_STAGE:
  Readonly<Record<MissionStage, MissionState>> = {
    EER: "INTERPRETING",
    PLAN: "PLANNING",
    PROTOCOL: "CONTRACT_FREEZE",
    PRO: "DISPATCHING",
    COLONY_AB: "EXECUTING_AB",
    SON: "COMPARING",
    LEGGO: "INTEGRATING",
    PROMAX: "VERIFYING",
    NAMLA_LAB: "PACKAGING",
    DELIVERY: "COMPLETED",
  };

export type DurableBoundaryCoordinatorReasonCode =
  | "ok"
  | "coordinator-failed-closed"
  | "coordinator-not-started"
  | "invalid-stage-state-pair"
  | "checkpoint-stage-mismatch"
  | "stage-transition-not-allowed"
  | "terminal-boundary"
  | "contract-freeze-required"
  | "contract-freeze-stage-invalid"
  | "frozen-contract-mutated"
  | "loop-budget-max-mutated"
  | "loop-budget-replenishment"
  | "counter-invalid"
  | "counter-regression"
  | "evidence-history-regression"
  | "candidate-history-regression"
  | "execution-history-regression"
  | "execution-identity-mutated"
  | "execution-invalid"
  | "duplicate-execution-id"
  | `session:${DurableCheckpointSessionReasonCode}`;

export interface DurableBoundaryCoordinatorSuccess {
  readonly ok: true;
  readonly status:
    | "STARTED"
    | "RESUMED"
    | "CHECKPOINTED";
  readonly reasonCode: "ok";
  readonly checkpoint: MissionCheckpoint;
}

export interface DurableBoundaryCoordinatorFailure {
  readonly ok: false;
  readonly status: "REFUSED";
  readonly reasonCode:
    DurableBoundaryCoordinatorReasonCode;
  readonly lockedByReasonCode?:
    DurableBoundaryCoordinatorReasonCode;
}

export type DurableBoundaryCoordinatorResult =
  | DurableBoundaryCoordinatorSuccess
  | DurableBoundaryCoordinatorFailure;

export interface DurableBoundaryStartInput {
  readonly loopBudget: LoopBudget;
  readonly savedAt?: number;
}

export interface DurableBoundaryAdvanceInput {
  readonly nextStage: MissionStage;

  readonly frozenContract?: PlanContract;

  readonly activeWorkPackages?:
    readonly WorkPackage[];

  readonly executions?:
    readonly WorkPackageExecution[];

  readonly loopBudget?: LoopBudget;

  readonly evidenceRecords?:
    readonly EvidenceRecord[];

  readonly integratedCandidates?:
    readonly IntegratedCandidate[];

  readonly failureCount?: number;

  readonly livelockCounter?: number;

  readonly savedAt?: number;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function stageIndex(
  stage: MissionStage,
): number {
  return STAGE_SEQUENCE.indexOf(stage);
}

function expectedState(
  stage: MissionStage,
): MissionState {
  return CANONICAL_STATE_BY_STAGE[stage];
}

function isNonNegativeSafeInteger(
  value: number,
): boolean {
  return (
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function isAppendOnlyHistory<T>(
  current: readonly T[],
  next: readonly T[],
): boolean {
  if (next.length < current.length) {
    return false;
  }

  for (
    let index = 0;
    index < current.length;
    index += 1
  ) {
    if (
      !isDeepStrictEqual(
        current[index],
        next[index],
      )
    ) {
      return false;
    }
  }

  return true;
}

function validateExecutionContinuity(
  current:
    readonly WorkPackageExecution[],
  next:
    readonly WorkPackageExecution[],
):
  | DurableBoundaryCoordinatorReasonCode
  | null {
  const nextById =
    new Map<string, WorkPackageExecution>();

  for (const execution of next) {
    if (
      !Number.isSafeInteger(
        execution.stateVersion,
      ) ||
      execution.stateVersion < 1 ||
      !Number.isSafeInteger(
        execution.attempts,
      ) ||
      execution.attempts < 1
    ) {
      return "execution-invalid";
    }

    if (
      nextById.has(
        execution.executionId,
      )
    ) {
      return "duplicate-execution-id";
    }

    nextById.set(
      execution.executionId,
      execution,
    );
  }

  for (
    const previousExecution
    of current
  ) {
    const nextExecution =
      nextById.get(
        previousExecution.executionId,
      );

    if (!nextExecution) {
      return "execution-history-regression";
    }

    if (
      nextExecution.workPackageId !==
        previousExecution.workPackageId ||
      nextExecution.colonyId !==
        previousExecution.colonyId ||
      nextExecution.workspacePath !==
        previousExecution.workspacePath
    ) {
      return "execution-identity-mutated";
    }

    if (
      nextExecution.stateVersion <
        previousExecution.stateVersion ||
      nextExecution.attempts <
        previousExecution.attempts
    ) {
      return "execution-history-regression";
    }

    if (
      !isAppendOnlyHistory(
        previousExecution.outputArtifacts,
        nextExecution.outputArtifacts,
      ) ||
      !isAppendOnlyHistory(
        previousExecution.evidenceRefs,
        nextExecution.evidenceRefs,
      )
    ) {
      return "execution-history-regression";
    }
  }

  return null;
}

/**
 * Durable stage-boundary coordinator.
 *
 * Responsibilities:
 *
 * - canonical MissionStage <-> MissionState pairing
 * - exact forward stage ordering
 * - same-stage durable checkpoints
 * - stateVersion ownership through 10E1
 * - CAS persistence through DurableMissionCheckpointSession
 * - non-replenishable loop budgets
 * - immutable frozen contract after PROTOCOL
 * - append-only evidence and integrated candidate history
 * - execution identity/history continuity
 *
 * This class intentionally does not know PostgreSQL
 * and does not execute NAMLA stages itself.
 */
export class DurableMissionBoundaryCoordinator {
  private readonly session:
    DurableMissionCheckpointSession;

  private failedClosedReason:
    | DurableBoundaryCoordinatorReasonCode
    | null = null;

  public constructor(
    store: MissionCheckpointStore,
    public readonly missionId: string,
    private readonly clock:
      () => number = Date.now,
  ) {
    this.session =
      new DurableMissionCheckpointSession(
        store,
        missionId,
      );
  }

  public getSnapshot():
    MissionCheckpoint | null {
    return this.session.getSnapshot();
  }

  public isFailedClosed(): boolean {
    return (
      this.failedClosedReason !== null ||
      this.session.isFailedClosed()
    );
  }

  public async start(
    input: DurableBoundaryStartInput,
  ): Promise<DurableBoundaryCoordinatorResult> {
    const locked =
      this.ensureCoordinatorOpen();

    if (locked) {
      return locked;
    }

    if (this.session.getSnapshot()) {
      return this.failClosed(
        "coordinator-failed-closed",
      );
    }

    const checkpoint:
      MissionCheckpoint = {
        schemaVersion:
          V2_MISSION_CHECKPOINT_SCHEMA,

        missionId:
          this.missionId,

        state: {
          missionId:
            this.missionId,

          currentState:
            "INTERPRETING",

          stateVersion:
            1,

          currentStage:
            "EER",

          checkpointStage:
            "EER",

          activeWorkPackages:
            [],

          executions:
            [],

          failureCount:
            0,

          livelockCounter:
            0,
        },

        loopBudget:
          clone(input.loopBudget),

        evidenceRecords:
          [],

        integratedCandidates:
          [],

        savedAt:
          input.savedAt ??
          this.clock(),
      };

    const sessionResult =
      await this.session.createInitial(
        checkpoint,
      );

    if (!sessionResult.ok) {
      return this.failClosed(
        `session:${sessionResult.reasonCode}`,
      );
    }

    return {
      ok: true,
      status: "STARTED",
      reasonCode: "ok",
      checkpoint:
        clone(sessionResult.checkpoint),
    };
  }

  public async resume():
    Promise<DurableBoundaryCoordinatorResult> {
    const locked =
      this.ensureCoordinatorOpen();

    if (locked) {
      return locked;
    }

    const sessionResult =
      await this.session.resume();

    if (!sessionResult.ok) {
      return this.failClosed(
        `session:${sessionResult.reasonCode}`,
      );
    }

    const semanticFailure =
      this.validateCheckpointSemantics(
        sessionResult.checkpoint,
      );

    if (semanticFailure) {
      return this.failClosed(
        semanticFailure,
      );
    }

    return {
      ok: true,
      status: "RESUMED",
      reasonCode: "ok",
      checkpoint:
        clone(sessionResult.checkpoint),
    };
  }

  public async advance(
    input: DurableBoundaryAdvanceInput,
  ): Promise<DurableBoundaryCoordinatorResult> {
    const locked =
      this.ensureCoordinatorOpen();

    if (locked) {
      return locked;
    }

    const current =
      this.session.getSnapshot();

    if (!current) {
      return this.failClosed(
        "coordinator-not-started",
      );
    }

    const currentSemanticFailure =
      this.validateCheckpointSemantics(
        current,
      );

    if (currentSemanticFailure) {
      return this.failClosed(
        currentSemanticFailure,
      );
    }

    if (
      current.state.currentStage ===
      "DELIVERY"
    ) {
      return this.failClosed(
        "terminal-boundary",
      );
    }

    const currentStageIndex =
      stageIndex(
        current.state.currentStage,
      );

    const nextStageIndex =
      stageIndex(
        input.nextStage,
      );

    const sameStage =
      nextStageIndex ===
      currentStageIndex;

    const exactNextStage =
      nextStageIndex ===
      currentStageIndex + 1;

    if (
      !sameStage &&
      !exactNextStage
    ) {
      return this.failClosed(
        "stage-transition-not-allowed",
      );
    }

    const currentContract =
      current.state.frozenContract;

    const requestedContract =
      input.frozenContract;

    if (
      currentContract &&
      requestedContract &&
      !isDeepStrictEqual(
        currentContract,
        requestedContract,
      )
    ) {
      return this.failClosed(
        "frozen-contract-mutated",
      );
    }

    if (
      !currentContract &&
      requestedContract &&
      input.nextStage !==
        "PROTOCOL"
    ) {
      return this.failClosed(
        "contract-freeze-stage-invalid",
      );
    }

    const effectiveContract =
      requestedContract ??
      currentContract;

    if (
      input.nextStage ===
        "PROTOCOL" &&
      !effectiveContract
    ) {
      return this.failClosed(
        "contract-freeze-required",
      );
    }

    if (
      nextStageIndex >=
        stageIndex("PROTOCOL") &&
      !effectiveContract
    ) {
      return this.failClosed(
        "contract-freeze-required",
      );
    }

    const nextBudget =
      input.loopBudget
        ? clone(input.loopBudget)
        : clone(current.loopBudget);

    const budgetFailure =
      this.validateBudgetTransition(
        current.loopBudget,
        nextBudget,
      );

    if (budgetFailure) {
      return this.failClosed(
        budgetFailure,
      );
    }

    const nextFailureCount =
      input.failureCount ??
      current.state.failureCount;

    const nextLivelockCounter =
      input.livelockCounter ??
      current.state.livelockCounter;

    if (
      !isNonNegativeSafeInteger(
        nextFailureCount,
      ) ||
      !isNonNegativeSafeInteger(
        nextLivelockCounter,
      )
    ) {
      return this.failClosed(
        "counter-invalid",
      );
    }

    if (
      nextFailureCount <
        current.state.failureCount ||
      nextLivelockCounter <
        current.state.livelockCounter
    ) {
      return this.failClosed(
        "counter-regression",
      );
    }

    const nextEvidence =
      input.evidenceRecords
        ? clone(input.evidenceRecords)
        : clone(
            current.evidenceRecords,
          );

    if (
      !isAppendOnlyHistory(
        current.evidenceRecords,
        nextEvidence,
      )
    ) {
      return this.failClosed(
        "evidence-history-regression",
      );
    }

    const nextCandidates =
      input.integratedCandidates
        ? clone(
            input.integratedCandidates,
          )
        : clone(
            current.integratedCandidates,
          );

    if (
      !isAppendOnlyHistory(
        current.integratedCandidates,
        nextCandidates,
      )
    ) {
      return this.failClosed(
        "candidate-history-regression",
      );
    }

    const nextExecutions =
      input.executions
        ? clone(input.executions)
        : clone(
            current.state.executions,
          );

    const executionFailure =
      validateExecutionContinuity(
        current.state.executions,
        nextExecutions,
      );

    if (executionFailure) {
      return this.failClosed(
        executionFailure,
      );
    }

    const nextCheckpoint:
      MissionCheckpoint = {
        schemaVersion:
          V2_MISSION_CHECKPOINT_SCHEMA,

        missionId:
          this.missionId,

        state: {
          missionId:
            this.missionId,

          currentState:
            expectedState(
              input.nextStage,
            ),

          stateVersion:
            current.state.stateVersion +
            1,

          currentStage:
            input.nextStage,

          checkpointStage:
            input.nextStage,

          ...(effectiveContract
            ? {
                frozenContract:
                  clone(
                    effectiveContract,
                  ),
              }
            : {}),

          activeWorkPackages:
            input.activeWorkPackages
              ? clone(
                  input.activeWorkPackages,
                )
              : clone(
                  current.state
                    .activeWorkPackages,
                ),

          executions:
            nextExecutions,

          failureCount:
            nextFailureCount,

          livelockCounter:
            nextLivelockCounter,
        },

        loopBudget:
          nextBudget,

        evidenceRecords:
          nextEvidence,

        integratedCandidates:
          nextCandidates,

        savedAt:
          input.savedAt ??
          this.clock(),
      };

    const nextSemanticFailure =
      this.validateCheckpointSemantics(
        nextCheckpoint,
      );

    if (nextSemanticFailure) {
      return this.failClosed(
        nextSemanticFailure,
      );
    }

    const sessionResult =
      await this.session.advance(
        nextCheckpoint,
      );

    if (!sessionResult.ok) {
      return this.failClosed(
        `session:${sessionResult.reasonCode}`,
      );
    }

    return {
      ok: true,
      status: "CHECKPOINTED",
      reasonCode: "ok",
      checkpoint:
        clone(
          sessionResult.checkpoint,
        ),
    };
  }

  private validateCheckpointSemantics(
    checkpoint: MissionCheckpoint,
  ):
    | DurableBoundaryCoordinatorReasonCode
    | null {
    const stage =
      checkpoint.state.currentStage;

    if (
      checkpoint.state.currentState !==
      expectedState(stage)
    ) {
      return "invalid-stage-state-pair";
    }

    if (
      checkpoint.state.checkpointStage !==
        undefined &&
      checkpoint.state.checkpointStage !==
        stage
    ) {
      return "checkpoint-stage-mismatch";
    }

    const index =
      stageIndex(stage);

    const hasFrozenContract =
      checkpoint.state.frozenContract !==
      undefined;

    if (
      index <
        stageIndex("PROTOCOL") &&
      hasFrozenContract
    ) {
      return "contract-freeze-stage-invalid";
    }

    if (
      index >=
        stageIndex("PROTOCOL") &&
      !hasFrozenContract
    ) {
      return "contract-freeze-required";
    }

    return null;
  }

  private validateBudgetTransition(
    current: LoopBudget,
    next: LoopBudget,
  ):
    | DurableBoundaryCoordinatorReasonCode
    | null {
    if (
      current.maxTicks !==
        next.maxTicks ||
      current.maxFixAttempts !==
        next.maxFixAttempts ||
      current.maxProviderCalls !==
        next.maxProviderCalls
    ) {
      return "loop-budget-max-mutated";
    }

    if (
      next.remainingTicks >
        current.remainingTicks ||
      next.remainingFixAttempts >
        current.remainingFixAttempts ||
      next.remainingProviderCalls >
        current.remainingProviderCalls
    ) {
      return "loop-budget-replenishment";
    }

    return null;
  }

  private ensureCoordinatorOpen():
    DurableBoundaryCoordinatorFailure | null {
    if (this.failedClosedReason) {
      return {
        ok: false,
        status: "REFUSED",
        reasonCode:
          "coordinator-failed-closed",
        lockedByReasonCode:
          this.failedClosedReason,
      };
    }

    return null;
  }

  private failClosed(
    reasonCode:
      DurableBoundaryCoordinatorReasonCode,
  ): DurableBoundaryCoordinatorFailure {
    if (!this.failedClosedReason) {
      this.failedClosedReason =
        reasonCode;
    }

    return {
      ok: false,
      status: "REFUSED",
      reasonCode,
      lockedByReasonCode:
        this.failedClosedReason,
    };
  }
}