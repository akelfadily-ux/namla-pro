/**
 * C9C1 canonical PLAN_TEST implementation.
 *
 * PLAN_TEST is pre-freeze. It validates DraftPlan data, rejects dependency and
 * target-shape defects, delegates canonical contract construction to
 * ProtocolEngine, then captures the exact immutable PlanContract bytes.
 *
 * It does not cross FROZEN_PLAN_CONTRACT and does not mint runtime authority.
 */
import { isDeepStrictEqual } from "node:util";
import { ProtocolEngine, type ProtocolResult } from "../protocol/protocolEngine";
import {
  captureCanonicalFrozenPlanContract,
  type CanonicalFrozenPlanContractBinding,
  type CanonicalFrozenPlanContractIdentity,
} from "../protocol/canonicalFrozenPlanContract";
import type { DraftPlan, PlanContract, RiskClass } from "../types/contracts";
import type { WorkPackage } from "../types/missionState";
import type { PreFreezeStageContext } from "../types/stageContext";

export interface PlanContractFreezer {
  freezePlanContract(draftPlan: DraftPlan, context: PreFreezeStageContext): ProtocolResult;
}

export type CanonicalPlanTestReasonCode =
  | "OK"
  | "CONTEXT_INVALID"
  | "DRAFT_SHAPE_INVALID"
  | "DRAFT_CONTEXT_MISMATCH"
  | "DUPLICATE_TASK_ID"
  | "DUPLICATE_CRITERION_ID"
  | "NO_REQUIRED_ACCEPTANCE_CRITERION"
  | "DEPENDENCY_INVALID"
  | "DEPENDENCY_TARGET_MISSING"
  | "DEPENDENCY_CYCLE"
  | "TARGET_PATH_SHAPE_INVALID"
  | "BUDGET_INVALID"
  | "PROTOCOL_REFUSED"
  | "PROTOCOL_OUTPUT_INVALID"
  | "CANONICAL_CONTRACT_CAPTURE_REFUSED";

export type CanonicalPlanTestResult =
  | {
      readonly success: true;
      readonly readyForFreeze: true;
      readonly reasonCode: "OK";
      readonly frozenContract: PlanContract;
      readonly workPackages: readonly WorkPackage[];
      readonly contractBinding: CanonicalFrozenPlanContractBinding;
      readonly contractIdentity: CanonicalFrozenPlanContractIdentity;
    }
  | {
      readonly success: false;
      readonly readyForFreeze: false;
      readonly reasonCode: Exclude<CanonicalPlanTestReasonCode, "OK">;
      readonly detailReasonCode?: string;
    };

const RISKS = new Set<RiskClass>(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

function nonempty(value: unknown, max = 16_384): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
}

/** Planning-time shape check only; TrustedKernel remains path/effect authority. */
function targetShape(value: unknown): value is string {
  if (!nonempty(value, 4096) || value.includes("\\") || value.startsWith("/") ||
      /^[A-Za-z]:/u.test(value) || value.includes("://")) return false;
  const segments = value.split("/");
  return segments.length > 0 &&
    segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function budget(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function refused(
  reasonCode: Exclude<CanonicalPlanTestReasonCode, "OK">,
  detailReasonCode?: string,
): CanonicalPlanTestResult {
  return Object.freeze({
    success: false as const,
    readyForFreeze: false as const,
    reasonCode,
    ...(detailReasonCode === undefined ? {} : { detailReasonCode }),
  });
}

function validateDraft(draft: DraftPlan, context: PreFreezeStageContext): CanonicalPlanTestResult | null {
  if (context.contractPhase !== "PRE_FREEZE" || !nonempty(context.missionId, 512)) {
    return refused("CONTEXT_INVALID");
  }
  if (!draft || typeof draft !== "object" || !nonempty(draft.draftId, 512) ||
      !nonempty(draft.objective, 262_144) || !Array.isArray(draft.tasks) ||
      draft.tasks.length === 0 || !Array.isArray(draft.acceptanceCriteria) ||
      draft.acceptanceCriteria.length === 0 || !RISKS.has(draft.riskClassification) ||
      !draft.estimatedBudgets || typeof draft.estimatedBudgets !== "object") {
    return refused("DRAFT_SHAPE_INVALID");
  }
  if (context.currentDraftPlan !== undefined &&
      !isDeepStrictEqual(context.currentDraftPlan, draft)) {
    return refused("DRAFT_CONTEXT_MISMATCH");
  }
  if (!budget(draft.estimatedBudgets.maxVirtualTicks) ||
      !budget(draft.estimatedBudgets.maxProviderCalls) ||
      !budget(draft.estimatedBudgets.maxFixAttempts)) {
    return refused("BUDGET_INVALID");
  }

  const taskIds = new Set<string>();
  for (const task of draft.tasks) {
    if (!task || typeof task !== "object" || !nonempty(task.id, 512)) {
      return refused("DRAFT_SHAPE_INVALID");
    }
    if (taskIds.has(task.id)) return refused("DUPLICATE_TASK_ID", task.id);
    taskIds.add(task.id);
    if (!Array.isArray(task.targetFiles) || !task.targetFiles.every(targetShape)) {
      return refused("TARGET_PATH_SHAPE_INVALID", task.id);
    }
    if (!Array.isArray(task.dependencies) ||
        !task.dependencies.every((d: unknown) => nonempty(d, 512)) ||
        new Set(task.dependencies).size !== task.dependencies.length) {
      return refused("DEPENDENCY_INVALID", task.id);
    }
    if (!Array.isArray(task.capabilityRequirements) ||
        !task.capabilityRequirements.every((c: unknown) => nonempty(c, 512))) {
      return refused("DRAFT_SHAPE_INVALID", task.id);
    }
  }

  for (const task of draft.tasks) {
    for (const dep of task.dependencies) {
      if (dep === task.id) return refused("DEPENDENCY_CYCLE", task.id);
      if (!taskIds.has(dep)) return refused("DEPENDENCY_TARGET_MISSING", `${task.id}:${dep}`);
    }
  }

  const byId = new Map(draft.tasks.map((task) => [task.id, task] as const));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cyclic = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const task = byId.get(id);
    if (!task) return true;
    for (const dep of task.dependencies) if (cyclic(dep)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  for (const id of taskIds) if (cyclic(id)) return refused("DEPENDENCY_CYCLE", id);

  const criterionIds = new Set<string>();
  let required = 0;
  for (const criterion of draft.acceptanceCriteria) {
    if (!criterion || typeof criterion !== "object" ||
        !nonempty(criterion.id, 512) || !nonempty(criterion.description, 65_536)) {
      return refused("DRAFT_SHAPE_INVALID");
    }
    if (criterionIds.has(criterion.id)) return refused("DUPLICATE_CRITERION_ID", criterion.id);
    criterionIds.add(criterion.id);
    if (criterion.required) required += 1;
  }
  if (required === 0) return refused("NO_REQUIRED_ACCEPTANCE_CRITERION");
  return null;
}

export class PlanTestFactory {
  public constructor(private readonly freezer: PlanContractFreezer = new ProtocolEngine()) {}

  public validateAndFreezePlan(
    draftPlan: DraftPlan,
    context: PreFreezeStageContext,
  ): CanonicalPlanTestResult {
    const validation = validateDraft(draftPlan, context);
    if (validation) return validation;

    let protocol: ProtocolResult;
    try {
      protocol = this.freezer.freezePlanContract(draftPlan, context);
    } catch {
      return refused("PROTOCOL_REFUSED", "protocol-threw");
    }

    if (!protocol.success) return refused("PROTOCOL_REFUSED", protocol.reasonCode);
    if (!protocol.frozenContract || !Array.isArray(protocol.workPackages) ||
        protocol.workPackages.length !== draftPlan.tasks.length) {
      return refused("PROTOCOL_OUTPUT_INVALID");
    }

    const expectedTasks = new Map(
      draftPlan.tasks.map((task) => [task.id, task] as const),
    );
    const observedTaskIds = new Set<string>();

    for (const wp of protocol.workPackages) {
      const expectedTask = expectedTasks.get(wp.taskSpec.id);
      if (!expectedTask || observedTaskIds.has(wp.taskSpec.id) ||
          wp.id !== `wp-${context.missionId}-${wp.taskSpec.id}` ||
          wp.missionId !== context.missionId ||
          wp.contractVersion !== protocol.frozenContract.version ||
          wp.readOnly !== false ||
          wp.maxAttempts !== draftPlan.estimatedBudgets.maxFixAttempts ||
          wp.inputArtifacts.length !== 0 ||
          !isDeepStrictEqual(wp.taskSpec, expectedTask) ||
          !isDeepStrictEqual(wp.acceptanceCriteria, draftPlan.acceptanceCriteria)) {
        return refused("PROTOCOL_OUTPUT_INVALID");
      }
      observedTaskIds.add(wp.taskSpec.id);
    }

    if (observedTaskIds.size !== expectedTasks.size) {
      return refused("PROTOCOL_OUTPUT_INVALID");
    }

    const captured = captureCanonicalFrozenPlanContract(context.missionId, protocol.frozenContract);
    if (!captured.ok) {
      return refused("CANONICAL_CONTRACT_CAPTURE_REFUSED", captured.reasonCode);
    }

    const packages = deepFreeze(structuredClone(protocol.workPackages));
    const identity: CanonicalFrozenPlanContractIdentity = Object.freeze({
      missionId: captured.binding.missionId,
      contractId: captured.binding.contractId,
      contractVersion: captured.binding.contractVersion,
      contractHash: captured.binding.contractHash,
    });

    return Object.freeze({
      success: true as const,
      readyForFreeze: true as const,
      reasonCode: "OK" as const,
      frozenContract: captured.contract,
      workPackages: packages,
      contractBinding: captured.binding,
      contractIdentity: identity,
    });
  }
}
