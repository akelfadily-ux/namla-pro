/**
 * NAMLA LOOP Gate Implementation (§05, §06, §11).
 *
 * Every critical stage transition in V2 must pass through NAMLA LOOP.
 */

import { GateInput, GateVerdict, StageRecoveryPolicy } from "../types/namlaLoopTypes";
import { EvidenceRecord } from "../types/evidence";
import { validateCanonicalRuntimeLoopBudget } from "../runtime/canonicalRuntimeLoopBudget";

export interface NamlaLoopGateOptions {
  readonly maxLivelockThreshold?: number;
}

export const V2_NAMLA_LOOP_GATE_STATE_SCHEMA =
  "namla-v2-loop-gate-state-v1" as const;

/** Explicit state for one mission/stage/work-package gate evaluation. */
export interface NamlaLoopGateState {
  readonly schemaVersion: typeof V2_NAMLA_LOOP_GATE_STATE_SCHEMA;
  readonly missionId: string;
  readonly stageId: string;
  readonly workPackageId: string | null;
  readonly maxLivelockThreshold: number;
  /** Consecutive stale/missing-evidence failures, NOT lifetime failureCount. */
  readonly livelockCounter: number;
}

export type NamlaLoopGateStateResult =
  | {
      readonly ok: true;
      readonly reasonCode: "ok";
      readonly verdict: GateVerdict;
      readonly nextState: NamlaLoopGateState;
    }
  | {
      readonly ok: false;
      readonly reasonCode:
        | "gate-state-invalid"
        | "gate-state-binding-mismatch"
        | "gate-state-threshold-mismatch"
        | "gate-budget-invalid"
        | "gate-evaluation-failed";
    };

/** Capture own data properties; missing state never becomes a zero counter. */
export function readNamlaLoopGateState(value: unknown): NamlaLoopGateState | null {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const fields = ["schemaVersion", "missionId", "stageId", "workPackageId",
      "maxLivelockThreshold", "livelockCounter"] as const;
    if (Reflect.ownKeys(value).length !== fields.length) return null;
    const captured: Record<string, unknown> = {};
    for (const field of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(value, field);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return null;
      }
      captured[field] = descriptor.value;
    }
    const { schemaVersion, missionId, stageId, workPackageId,
      maxLivelockThreshold, livelockCounter } = captured;
    if (
      schemaVersion !== V2_NAMLA_LOOP_GATE_STATE_SCHEMA ||
      typeof missionId !== "string" || missionId.trim().length === 0 ||
      typeof stageId !== "string" || stageId.trim().length === 0 ||
      !(workPackageId === null ||
        (typeof workPackageId === "string" && workPackageId.trim().length > 0)) ||
      typeof maxLivelockThreshold !== "number" ||
      !Number.isSafeInteger(maxLivelockThreshold) || maxLivelockThreshold < 0 ||
      typeof livelockCounter !== "number" ||
      !Number.isSafeInteger(livelockCounter) || livelockCounter < 0
    ) return null;
    return Object.freeze({ schemaVersion, missionId, stageId, workPackageId,
      maxLivelockThreshold, livelockCounter });
  } catch {
    return null;
  }
}

export class NamlaLoopGate {
  private readonly livelockCounter: Map<string, number> = new Map();
  private readonly maxLivelockThreshold: number;

  constructor(options: NamlaLoopGateOptions = {}) {
    this.maxLivelockThreshold = options.maxLivelockThreshold ?? 3;
  }

  /** Backward-compatible in-memory entry point. */
  public evaluateGate(
    input: GateInput,
    evidencePool: readonly EvidenceRecord[],
    policy: StageRecoveryPolicy
  ): GateVerdict {
    const key = `${input.missionId}:${input.stageId}:${input.workPackageId ?? "global"}`;
    const counter = { count: this.livelockCounter.get(key) ?? 0 };
    const verdict = this.evaluateWithCounter(input, evidencePool, policy, counter);
    this.livelockCounter.set(key, counter.count);
    return verdict;
  }

  /**
   * Explicit-state entry point for the future durable orchestrator.
   * Does not read or modify the instance Map. Returns a proposal, not a commit.
   * Caller must atomically persist nextState with budget/cursor/attempt state.
   * ok=true means evaluation succeeded; advancement still requires PASS/NEXT.
   * This refactor does not implement retries or change gate evidence rules.
   */
  public evaluateGateWithState(
    input: GateInput,
    evidencePool: readonly EvidenceRecord[],
    policy: StageRecoveryPolicy,
    state: unknown,
  ): NamlaLoopGateStateResult {
    const snapshot = readNamlaLoopGateState(state);
    if (!snapshot) return { ok: false, reasonCode: "gate-state-invalid" };
    try {
      if (
        snapshot.missionId !== input.missionId ||
        snapshot.stageId !== input.stageId ||
        snapshot.workPackageId !== (input.workPackageId ?? null)
      ) return { ok: false, reasonCode: "gate-state-binding-mismatch" };
      if (snapshot.maxLivelockThreshold !== this.maxLivelockThreshold) {
        return { ok: false, reasonCode: "gate-state-threshold-mismatch" };
      }
      if (!validateCanonicalRuntimeLoopBudget(input.budget).ok) {
        return { ok: false, reasonCode: "gate-budget-invalid" };
      }
      const counter = { count: snapshot.livelockCounter };
      const verdict = this.evaluateWithCounter(input, evidencePool, policy, counter);
      Object.freeze(verdict.reasonCodes);
      Object.freeze(verdict.staleEvidenceRefs);
      Object.freeze(verdict.missingEvidence);
      Object.freeze(verdict.failedCriteria);
      return Object.freeze({
        ok: true as const,
        reasonCode: "ok" as const,
        verdict: Object.freeze(verdict),
        nextState: Object.freeze({ ...snapshot, livelockCounter: counter.count }),
      });
    } catch {
      return { ok: false, reasonCode: "gate-evaluation-failed" };
    }
  }

  private evaluateWithCounter(
    input: GateInput,
    evidencePool: readonly EvidenceRecord[],
    policy: StageRecoveryPolicy,
    state: { count: number },
  ): GateVerdict {
    const currentLivelockCount = state.count;

    // 1. Budget check
    if (input.budget.remainingTicks <= 0 || input.budget.remainingFixAttempts < 0) {
      return {
        status: "HUMAN_REQUIRED",
        nextAction: "HUMAN_REQUIRED",
        reasonCodes: ["BUDGET_EXHAUSTED"],
        staleEvidenceRefs: [],
        missingEvidence: [],
        failedCriteria: ["BUDGET_CEILING"],
      };
    }

    // 2. Anti-livelock check
    if (currentLivelockCount >= this.maxLivelockThreshold) {
      return {
        status: "FAIL",
        nextAction: "FAIL_CLOSED",
        reasonCodes: ["ANTI_LIVELOCK_TRIGGERED", "MAX_RETRY_EXCEEDED"],
        staleEvidenceRefs: [],
        missingEvidence: [],
        failedCriteria: ["ANTI_LIVELOCK_POLICY"],
      };
    }

    // 3. Contract phase invariant
    if (input.phase === "CONTRACT_BOUND" && !input.contractVersion) {
      return {
        status: "FAIL",
        nextAction: "FAIL_CLOSED",
        reasonCodes: ["MISSING_CONTRACT_VERSION_IN_CONTRACT_BOUND_PHASE"],
        staleEvidenceRefs: [],
        missingEvidence: [],
        failedCriteria: ["CONTRACT_PHASE_INVARIANT"],
      };
    }

    // 4. Stale evidence check (check first so invalidated/superseded evidence is flagged as STALE)
    const staleEvidenceRefs: string[] = [];
    for (const requiredRef of input.evidenceRefs) {
      const record = evidencePool.find((e) => e.evidenceId === requiredRef);
      if (record && (record.status === "INVALIDATED" || record.status === "SUPERSEDED")) {
        staleEvidenceRefs.push(requiredRef);
      }
    }

    if (staleEvidenceRefs.length > 0) {
      state.count = currentLivelockCount + 1;
      const action = this.determineRecoveryAction("REWORK_AB", policy);
      return {
        status: "FAIL",
        nextAction: action,
        reasonCodes: ["STALE_EVIDENCE_DETECTED"],
        staleEvidenceRefs,
        missingEvidence: [],
        failedCriteria: ["EVIDENCE_FRESHNESS"],
      };
    }

    // 5. Missing evidence check (evidence not present in pool at all)
    const missingEvidence: string[] = [];
    for (const requiredRef of input.evidenceRefs) {
      const record = evidencePool.find((e) => e.evidenceId === requiredRef);
      if (!record) {
        missingEvidence.push(requiredRef);
      }
    }

    if (missingEvidence.length > 0) {
      state.count = currentLivelockCount + 1;
      const action = this.determineRecoveryAction("FIX", policy);
      return {
        status: "FAIL",
        nextAction: action,
        reasonCodes: ["MISSING_REQUIRED_EVIDENCE"],
        staleEvidenceRefs: [],
        missingEvidence,
        failedCriteria: ["EVIDENCE_COMPLETENESS"],
      };
    }

    state.count = 0;

    return {
      status: "PASS",
      nextAction: "NEXT",
      reasonCodes: ["ALL_GATE_CRITERIA_SATISFIED"],
      staleEvidenceRefs: [],
      missingEvidence: [],
      failedCriteria: [],
    };
  }

  public invalidateStaleEvidence(
    evidencePool: EvidenceRecord[],
    invalidatedIds: readonly string[]
  ): EvidenceRecord[] {
    return evidencePool.map((record) => {
      if (invalidatedIds.includes(record.evidenceId)) {
        return { ...record, status: "INVALIDATED" as const };
      }
      return record;
    });
  }

  private determineRecoveryAction(
    proposed: "FIX" | "REWORK_AB" | "REPLAN" | "FAIL_CLOSED" | "HUMAN_REQUIRED",
    policy: StageRecoveryPolicy
  ): "FIX" | "REWORK_AB" | "REPLAN" | "FAIL_CLOSED" | "HUMAN_REQUIRED" {
    if (policy.allowedActions.includes(proposed)) {
      return proposed;
    }
    return "FAIL_CLOSED";
  }
}
