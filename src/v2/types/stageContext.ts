/**
 * V2 StageContext Contracts (§09).
 */

import { PlanContract, DraftPlan } from "./contracts";
import { ExecutionMode } from "../colony/colonyExecutor";

export interface RuntimeBudgets {
  readonly virtualTicks: number;
  readonly providerCalls: number;
  readonly maxFixAttempts: number;
}

export interface StageContextBase {
  readonly missionId: string;
  readonly authoritativeInputs: readonly string[];
  readonly currentDraftPlan?: DraftPlan;
  readonly policyVersions: readonly string[];
  readonly budgets: RuntimeBudgets;
  readonly evidenceRefs: readonly string[];
  readonly missionStateRef: string;
  readonly executionMode?: ExecutionMode;
}

export type PreFreezeStageContext = StageContextBase & {
  readonly contractPhase: "PRE_FREEZE";
  readonly frozenPlanContract?: never;
};

export type ContractBoundStageContext = StageContextBase & {
  readonly contractPhase: "CONTRACT_BOUND";
  readonly frozenPlanContract: PlanContract;
};

export type StageContext = PreFreezeStageContext | ContractBoundStageContext;
