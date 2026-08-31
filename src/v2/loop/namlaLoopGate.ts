/**
 * NAMLA LOOP Gate Implementation (§05, §06, §11).
 *
 * Every critical stage transition in V2 must pass through NAMLA LOOP.
 */

import { GateInput, GateVerdict, StageRecoveryPolicy } from "../types/namlaLoopTypes";
import { EvidenceRecord } from "../types/evidence";

export interface NamlaLoopGateOptions {
  readonly maxLivelockThreshold?: number;
}

export class NamlaLoopGate {
  private readonly livelockCounter: Map<string, number> = new Map();
  private readonly maxLivelockThreshold: number;

  constructor(options: NamlaLoopGateOptions = {}) {
    this.maxLivelockThreshold = options.maxLivelockThreshold ?? 3;
  }

  public evaluateGate(
    input: GateInput,
    evidencePool: readonly EvidenceRecord[],
    policy: StageRecoveryPolicy
  ): GateVerdict {
    const key = `${input.missionId}:${input.stageId}:${input.workPackageId ?? "global"}`;
    const currentLivelockCount = this.livelockCounter.get(key) ?? 0;

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
      this.livelockCounter.set(key, currentLivelockCount + 1);
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
      this.livelockCounter.set(key, currentLivelockCount + 1);
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

    this.livelockCounter.set(key, 0);

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
