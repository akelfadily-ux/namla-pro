/**
 * silentWitness — the non-participating process-integrity laboratory for the twin
 * empire foundation. It OBSERVES safe receipts and detects cross-colony leakage;
 * it never assigns workers, never modifies files, never advises a colony, and
 * never reveals one colony's work to the other. It only reads receipt metadata
 * (colony id, kind, fingerprint) and integrity events — never raw artifacts,
 * prompts, credentials, or private AntMind state.
 *
 * A leakage attempt is a typed event describing one colony trying to read the
 * OTHER colony's bundle BEFORE both are frozen. The witness quarantines every
 * such pre-freeze attempt (blocks it) and records an integrity report. Post-freeze
 * cross-colony reads (for later cross-examination) are permitted and not blocked.
 *
 * No fs, no child_process, no network, no wall clock.
 */

import type { ColonyId } from "./twinColonyTypes";

export interface TwinReceipt {
  readonly seq: number;
  readonly colonyId: ColonyId | "namola-court" | "silent-witness";
  readonly kind: string;
  readonly fingerprint: string;
}

export interface LeakageAttempt {
  readonly fromColony: ColonyId;
  readonly toColony: ColonyId;
  readonly targetFingerprint: string;
  /** True when the target colony's bundle is not yet frozen — a genuine breach. */
  readonly beforeFreeze: boolean;
}

export interface LeakageVerdict {
  readonly blocked: boolean;
  readonly reasonCode: string;
}

export interface WitnessIntegrityReport {
  readonly receiptsObserved: number;
  readonly colonies: readonly ColonyId[];
  readonly leakageAttempts: number;
  readonly leakageQuarantined: number;
  readonly leakageAllowedPostFreeze: number;
  readonly providerMonoculture: boolean;
  readonly criteriaMutationsDetected: number;
  readonly fakeTestEvidenceDetected: number;
  readonly postFreezeEditsDetected: number;
  /** Cross-examination observation (Black Mirror milestone). */
  readonly crossExamAttacks: number;
  readonly crossExamRebuttals: number;
  readonly crossExamRoundLimitHonored: boolean;
  /** Differential-truth observation (decisive-test milestone). */
  readonly energyCalculations: number;
  readonly decisiveTestsAuthorized: number;
  readonly decisiveTestsRun: number;
  readonly evidenceComparisons: number;
  readonly evidenceDecisions: number;
  readonly residualUncertaintiesPreserved: number;
  readonly decisiveTestCountBounded: boolean;
  readonly prestigeInfluenceDetected: boolean;
  /** Sovereign court + zero-trust merge observation. */
  readonly courtOpened: boolean;
  readonly hardRejectionChecksObserved: number;
  readonly namolaDecisionsObserved: number;
  readonly componentsApprovedObserved: number;
  readonly mergeWorkspaceCreated: boolean;
  readonly provenanceRetainedObserved: boolean;
  readonly mergeVerificationRunsObserved: number;
  readonly mergeFailuresObserved: number;
  readonly repairAuthorizationsObserved: number;
  readonly repairsExecutedObserved: number;
  readonly verificationRerunsObserved: number;
  readonly unapprovedComponentBlocked: boolean;
  readonly inheritedPassingStatusDetected: boolean;
  readonly mergeTestCountBounded: boolean;
  readonly integrityIntact: boolean;
}

/**
 * The Silent Witness. It holds NO method that could assign work, modify a bundle,
 * or transfer content between colonies — by construction it can only observe and
 * report, plus quarantine an integrity breach (a fail-closed safety stop).
 */
export class SilentWitness {
  private readonly receipts: TwinReceipt[] = [];
  private readonly attempts: LeakageAttempt[] = [];
  private quarantined = 0;
  private allowedPostFreeze = 0;
  private criteriaMutations = 0;
  private fakeTestEvidence = 0;
  private postFreezeEdits = 0;
  private readonly crossExamAttackers: ColonyId[] = [];
  private readonly crossExamRebutters: ColonyId[] = [];
  private diffEnergy = 0;
  private diffAuthorized = 0;
  private diffRun = 0;
  private diffCompared = 0;
  private diffDecided = 0;
  private diffResidual = 0;
  private prestigeDetected = false;
  private court = { opened: false, hardChecks: 0, decisions: 0, componentsApproved: 0, workspaceCreated: false, provenanceRetained: false, verifRuns: 0, failures: 0, repairAuths: 0, repairs: 0, reruns: 0, unapprovedBlocked: false, inheritedPassing: false };

  /** Observe one safe receipt (metadata only). */
  observe(receipt: TwinReceipt): void {
    this.receipts.push(receipt);
  }

  /** Observe one cross-examination round (attack or rebuttal) by a colony. */
  observeCrossExamRound(kind: "attack" | "rebuttal", colony: ColonyId): void {
    if (kind === "attack") this.crossExamAttackers.push(colony);
    else this.crossExamRebutters.push(colony);
    this.observe({ seq: this.receipts.length + 1, colonyId: colony, kind: `cross-exam-${kind}`, fingerprint: `${kind}:${colony}` });
  }

  /** Consider one cross-colony read attempt; pre-freeze attempts are quarantined. */
  consider(attempt: LeakageAttempt): LeakageVerdict {
    this.attempts.push(attempt);
    if (attempt.fromColony === attempt.toColony) return { blocked: false, reasonCode: "same-colony" };
    if (attempt.beforeFreeze) {
      this.quarantined += 1;
      this.observe({ seq: this.receipts.length + 1, colonyId: "silent-witness", kind: "leakage-quarantined", fingerprint: attempt.targetFingerprint });
      return { blocked: true, reasonCode: "cross-colony-leakage-before-freeze" };
    }
    this.allowedPostFreeze += 1;
    return { blocked: false, reasonCode: "post-freeze-read-permitted" };
  }

  /** Observe one differential-truth process step. `usedReputation` flags prestige influence. */
  observeDifferentialTruth(kind: "energy" | "authorization" | "test-start" | "test-complete" | "comparison" | "decision" | "residual", contradictionId: string, usedReputation = false): void {
    if (kind === "energy") this.diffEnergy += 1;
    else if (kind === "authorization") this.diffAuthorized += 1;
    else if (kind === "test-start") this.diffRun += 1;
    else if (kind === "comparison") this.diffCompared += 1;
    else if (kind === "decision") this.diffDecided += 1;
    else if (kind === "residual") this.diffResidual += 1;
    if (usedReputation) this.prestigeDetected = true;
    this.observe({ seq: this.receipts.length + 1, colonyId: "silent-witness", kind: `differential-${kind}`, fingerprint: contradictionId });
  }

  /** Observe one sovereign-court / zero-trust-merge step (safe metadata only). */
  observeCourtMerge(kind: "court-opened" | "hard-rejection-checks" | "decision-created" | "components-approved" | "merge-workspace-created" | "provenance-retained" | "merge-verification-started" | "merge-failure" | "repair-authorization" | "repair-execution" | "verification-rerun" | "final-merge-result", count = 1, flag = false): void {
    const c = this.court;
    if (kind === "court-opened") c.opened = true;
    else if (kind === "hard-rejection-checks") c.hardChecks += count;
    else if (kind === "decision-created") c.decisions += 1;
    else if (kind === "components-approved") c.componentsApproved += count;
    else if (kind === "merge-workspace-created") c.workspaceCreated = true;
    else if (kind === "provenance-retained") c.provenanceRetained = flag;
    else if (kind === "merge-verification-started") c.verifRuns += 1;
    else if (kind === "merge-failure") c.failures += 1;
    else if (kind === "repair-authorization") c.repairAuths += 1;
    else if (kind === "repair-execution") c.repairs += 1;
    else if (kind === "verification-rerun") c.reruns += 1;
    if (kind === "final-merge-result" && flag) c.inheritedPassing = true;
    if (kind === "components-approved" && flag) c.unapprovedBlocked = true;
    this.observe({ seq: this.receipts.length + 1, colonyId: "silent-witness", kind: `court-${kind}`, fingerprint: `${kind}:${count}` });
  }

  /** Record a detected process-integrity anomaly (from safe receipt comparison). */
  recordAnomaly(kind: "criteria-mutation" | "fake-test-evidence" | "post-freeze-edit"): void {
    if (kind === "criteria-mutation") this.criteriaMutations += 1;
    else if (kind === "fake-test-evidence") this.fakeTestEvidence += 1;
    else this.postFreezeEdits += 1;
  }

  report(): WitnessIntegrityReport {
    const colonies = [...new Set(this.receipts.map((r) => r.colonyId).filter((c): c is ColonyId => c === "claude-forge" || c === "codex-crucible"))];
    const providerReceipts = this.receipts.filter((r) => r.kind === "provider-receipt");
    // Monoculture = all provider receipts from a single colony/family (both colonies must participate).
    const providerColonies = new Set(providerReceipts.map((r) => r.colonyId));
    const providerMonoculture = providerReceipts.length > 0 && providerColonies.size < 2;
    // Round limit honored: no colony attacked or rebutted more than once.
    const attackDistinct = new Set(this.crossExamAttackers).size === this.crossExamAttackers.length;
    const rebutDistinct = new Set(this.crossExamRebutters).size === this.crossExamRebutters.length;
    return {
      receiptsObserved: this.receipts.length,
      colonies,
      leakageAttempts: this.attempts.length,
      leakageQuarantined: this.quarantined,
      leakageAllowedPostFreeze: this.allowedPostFreeze,
      providerMonoculture,
      criteriaMutationsDetected: this.criteriaMutations,
      fakeTestEvidenceDetected: this.fakeTestEvidence,
      postFreezeEditsDetected: this.postFreezeEdits,
      crossExamAttacks: this.crossExamAttackers.length,
      crossExamRebuttals: this.crossExamRebutters.length,
      crossExamRoundLimitHonored: attackDistinct && rebutDistinct && this.crossExamAttackers.length <= 2 && this.crossExamRebutters.length <= 2,
      energyCalculations: this.diffEnergy,
      decisiveTestsAuthorized: this.diffAuthorized,
      decisiveTestsRun: this.diffRun,
      evidenceComparisons: this.diffCompared,
      evidenceDecisions: this.diffDecided,
      residualUncertaintiesPreserved: this.diffResidual,
      decisiveTestCountBounded: this.diffRun <= 2,
      prestigeInfluenceDetected: this.prestigeDetected,
      courtOpened: this.court.opened,
      hardRejectionChecksObserved: this.court.hardChecks,
      namolaDecisionsObserved: this.court.decisions,
      componentsApprovedObserved: this.court.componentsApproved,
      mergeWorkspaceCreated: this.court.workspaceCreated,
      provenanceRetainedObserved: this.court.provenanceRetained,
      mergeVerificationRunsObserved: this.court.verifRuns,
      mergeFailuresObserved: this.court.failures,
      repairAuthorizationsObserved: this.court.repairAuths,
      repairsExecutedObserved: this.court.repairs,
      verificationRerunsObserved: this.court.reruns,
      unapprovedComponentBlocked: this.court.unapprovedBlocked,
      inheritedPassingStatusDetected: this.court.inheritedPassing,
      mergeTestCountBounded: this.court.verifRuns <= 4 && this.court.repairs <= 1,
      // Fake test evidence is an integrity breach: a witness that has DETECTED
      // fabricated test evidence must never report integrity as intact (this term
      // gates the sovereign court's `witness-integrity-true` check and the
      // customer delivery gate).
      integrityIntact: this.criteriaMutations === 0 && this.fakeTestEvidence === 0 && this.postFreezeEdits === 0 && this.attempts.every((a) => !a.beforeFreeze || this.quarantined > 0),
    };
  }
}
