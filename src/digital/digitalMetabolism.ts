/**
 * digitalMetabolism — the transformations that turn raw information into plans,
 * code, tests, reviews, and artifacts (Build Law §23; the digital analogue of
 * biological metabolism + brood feeding). Every transformation CONSUMES real
 * budgets (working context, compute, tokens) and, where risky, a tool permit and
 * an eligible matured worker; every transformation PRODUCES a real output
 * (knowledge, component, evidence) or a real failure (error waste + debt). There
 * is no success counter without an event chain: each op goes through the
 * conserving `DigitalResourceEconomy` and returns a parcel whose provenance links
 * back to its source.
 *
 * No fs, no child_process, no network, no wall clock, no module-level mutable state.
 */

import { clamp, roundTo } from "../colony/colonyTypes";
import { digitalDraw } from "./digitalTypes";
import type { AccessPolicy, DigitalResource } from "./digitalTypes";
import type { DigitalResourceEconomy } from "./digitalResourceEconomy";
import type { DigitalMetabolismProfile } from "./digitalConfig";
import { canExecute, spendWorkerEnergy } from "./digitalWorkers";
import type { DigitalWorker } from "./digitalWorkers";

export type ParcelKind = "raw" | "knowledge" | "plan" | "component" | "artifact" | "lesson";

export interface DigitalParcel {
  readonly parcelId: string;
  readonly kind: ParcelKind;
  readonly quality: number; // 0..1
  readonly freshness: number; // 0..1 (1 = brand new)
  readonly confidence: number; // 0..1
  readonly provenanceSourceId: string | null; // lineage to the raw source
  readonly verified: boolean;
  readonly poisoned: boolean; // carries a disease vector until cleared
  readonly accessPolicy: AccessPolicy;
  readonly ownerWorkerId: string;
  readonly createdTick: number;
}

type Cost = { resource: DigitalResource; amount: number };

/** True iff the economy currently holds every input in full (no partial work). */
export function canAfford(economy: DigitalResourceEconomy, costs: readonly Cost[]): boolean {
  return costs.every((c) => economy.balanceOf(c.resource) >= c.amount - 1e-9);
}

function energyCost(base: number, worker: DigitalWorker, profile: DigitalMetabolismProfile): number {
  return base * profile.energyRateByKind[worker.kind];
}

export interface ScoutOutcome {
  readonly ok: boolean;
  readonly worker: DigitalWorker;
  readonly collected: number;
  readonly parcel: DigitalParcel | null;
}

/** Scout the environment for raw information (collection, not creation). */
export function scout(economy: DigitalResourceEconomy, worker: DigitalWorker, profile: DigitalMetabolismProfile, parcelOrdinal: number, seed: number, tick: number): ScoutOutcome {
  const budget: Cost[] = [
    { resource: "computeCapacity", amount: profile.scoutComputeCost },
    { resource: "tokenBudget", amount: profile.scoutTokenCost },
  ];
  if (!canExecute(worker, "scouting") || !canAfford(economy, budget)) return { ok: false, worker, collected: 0, parcel: null };
  for (const b of budget) economy.consume(b.resource, b.amount);
  const q = clamp(0.4 + worker.reliability * 0.4 + digitalDraw(seed, worker.index, tick, 0x1b873593) * 0.2, 0, 1);
  const collected = economy.collect("rawInformation", profile.rawCollectPerScout * (0.6 + q * 0.4));
  const spent = spendWorkerEnergy({ ...worker, currentTask: "scouting" }, energyCost(profile.scoutEnergyCost, worker, profile), 0.02);
  const parcel: DigitalParcel = {
    parcelId: `raw-${parcelOrdinal}`,
    kind: "raw",
    quality: roundTo(q, 4),
    freshness: 1,
    confidence: roundTo(0.3 + q * 0.3, 4),
    provenanceSourceId: null,
    verified: false,
    poisoned: false,
    accessPolicy: "team-local",
    ownerWorkerId: worker.workerId,
    createdTick: tick,
  };
  return { ok: true, worker: spent, collected, parcel };
}

export interface VerifyOutcome {
  readonly ok: boolean; // the op ran (had budget + eligibility)
  readonly worker: DigitalWorker;
  readonly succeeded: boolean; // verification passed
  readonly knowledge: DigitalParcel | null;
  readonly evidenceProduced: number;
  readonly wasteProduced: number;
  readonly falseSuccess: boolean; // a poisoned raw parcel that slipped verification
}

/** Verify raw information into durable verified knowledge (needs a tool permit). */
export function verify(economy: DigitalResourceEconomy, worker: DigitalWorker, raw: DigitalParcel, profile: DigitalMetabolismProfile, parcelOrdinal: number, seed: number, tick: number): VerifyOutcome {
  const inputs: Cost[] = [
    { resource: "rawInformation", amount: profile.verifyRawInput },
    { resource: "workingContext", amount: profile.verifyContextCost },
    { resource: "computeCapacity", amount: profile.verifyComputeCost },
    { resource: "tokenBudget", amount: profile.verifyTokenCost },
  ];
  if (!canExecute(worker, "verifying") || !worker.toolPermitHeld || !canAfford(economy, inputs)) {
    return { ok: false, worker, succeeded: false, knowledge: null, evidenceProduced: 0, wasteProduced: 0, falseSuccess: false };
  }
  const draw = digitalDraw(seed, worker.index, tick ^ 5, 0x27220a95);
  const failThreshold = profile.verifyFailureRate * (1.3 - worker.reliability);
  const succeeded = draw >= failThreshold;
  // A poisoned raw parcel that passes a weak verification is a false success.
  const falseSuccess = succeeded && raw.poisoned && worker.reliability < 0.75;
  const outputs: Cost[] = succeeded
    ? [
        { resource: "verifiedKnowledge", amount: profile.verifyKnowledgeYield },
        { resource: "testEvidence", amount: profile.verifyEvidenceYield },
      ]
    : [{ resource: "errorWaste", amount: profile.verifyKnowledgeYield * 0.5 }];
  economy.transform("verify", tick, worker.workerId, inputs, outputs, true);
  const spent = spendWorkerEnergy({ ...worker, currentTask: "verifying", evidenceCount: worker.evidenceCount + (succeeded ? 1 : 0) }, energyCost(profile.verifyEnergyCost, worker, profile), 0.03);
  const knowledge: DigitalParcel | null = succeeded
    ? {
        parcelId: `know-${parcelOrdinal}`,
        kind: "knowledge",
        quality: roundTo(clamp(raw.quality * 0.7 + worker.reliability * 0.3, 0, 1), 4),
        freshness: 1,
        confidence: roundTo(clamp(0.5 + worker.reliability * 0.4, 0, 1), 4),
        provenanceSourceId: raw.parcelId,
        verified: true,
        poisoned: falseSuccess, // slipped through: still carries the vector
        accessPolicy: "public-colony",
        ownerWorkerId: worker.workerId,
        createdTick: tick,
      }
    : null;
  return {
    ok: true,
    worker: spent,
    succeeded,
    knowledge,
    evidenceProduced: succeeded ? profile.verifyEvidenceYield : 0,
    wasteProduced: succeeded ? 0 : profile.verifyKnowledgeYield * 0.5,
    falseSuccess,
  };
}

export interface BuildOutcome {
  readonly ok: boolean;
  readonly worker: DigitalWorker;
  readonly succeeded: boolean;
  readonly artifact: DigitalParcel | null;
  readonly debtAccrued: number;
  readonly wasteProduced: number;
}

/** Build a plan/knowledge into a reusable component (high-risk: qualified+ + permit). */
export function build(economy: DigitalResourceEconomy, worker: DigitalWorker, knowledge: DigitalParcel, profile: DigitalMetabolismProfile, parcelOrdinal: number, seed: number, tick: number): BuildOutcome {
  const inputs: Cost[] = [
    { resource: "verifiedKnowledge", amount: profile.buildKnowledgeInput },
    { resource: "workingContext", amount: profile.buildContextCost },
    { resource: "computeCapacity", amount: profile.buildComputeCost },
    { resource: "tokenBudget", amount: profile.buildTokenCost },
  ];
  if (!canExecute(worker, "building") || !worker.toolPermitHeld || !canAfford(economy, inputs)) {
    return { ok: false, worker, succeeded: false, artifact: null, debtAccrued: 0, wasteProduced: 0 };
  }
  const draw = digitalDraw(seed, worker.index, tick ^ 9, 0x165667b1);
  const failThreshold = profile.buildFailureRate * (1.3 - worker.competence);
  const succeeded = draw >= failThreshold && !knowledge.poisoned;
  const outputs: Cost[] = succeeded
    ? [{ resource: "reusableComponents", amount: profile.buildComponentYield }]
    : [
        { resource: "errorWaste", amount: profile.buildComponentYield * 0.6 },
        { resource: "technicalDebt", amount: profile.buildDebtOnFailure },
      ];
  economy.transform("build", tick, worker.workerId, inputs, outputs, true);
  const spent = spendWorkerEnergy({ ...worker, currentTask: "building" }, energyCost(profile.buildEnergyCost, worker, profile), 0.05);
  const artifact: DigitalParcel | null = succeeded
    ? {
        parcelId: `artifact-${parcelOrdinal}`,
        kind: "component",
        quality: roundTo(clamp(knowledge.quality * 0.6 + worker.competence * 0.4, 0, 1), 4),
        freshness: 1,
        confidence: roundTo(clamp(knowledge.confidence * 0.7 + worker.reliability * 0.3, 0, 1), 4),
        provenanceSourceId: knowledge.parcelId,
        verified: false, // review/test will attest it
        poisoned: false,
        accessPolicy: "team-local",
        ownerWorkerId: worker.workerId,
        createdTick: tick,
      }
    : null;
  return { ok: true, worker: spent, succeeded, artifact, debtAccrued: succeeded ? 0 : profile.buildDebtOnFailure, wasteProduced: succeeded ? 0 : profile.buildComponentYield * 0.6 };
}

export interface ReviewOutcome {
  readonly ok: boolean;
  readonly worker: DigitalWorker;
  readonly passed: boolean;
  readonly evidenceProduced: number;
  readonly wasteProduced: number;
}

/** Independent review of an artifact — immune inspection producing test evidence. */
export function review(economy: DigitalResourceEconomy, worker: DigitalWorker, artifact: DigitalParcel, profile: DigitalMetabolismProfile, seed: number, tick: number): ReviewOutcome {
  const inputs: Cost[] = [
    { resource: "workingContext", amount: profile.reviewContextCost },
    { resource: "computeCapacity", amount: profile.reviewComputeCost },
  ];
  // A reviewer must be a DIFFERENT worker than the builder (checked by the runner).
  if (!canExecute(worker, "reviewing") || !canAfford(economy, inputs)) return { ok: false, worker, passed: false, evidenceProduced: 0, wasteProduced: 0 };
  const draw = digitalDraw(seed, worker.index, tick ^ 13, 0x9e3779b9);
  // Poisoned or low-quality artifacts are more likely to be rejected (caught).
  const rejectChance = profile.reviewRejectRate + (artifact.poisoned ? 0.5 : 0) + (1 - artifact.quality) * 0.2;
  const passed = draw >= rejectChance;
  const outputs: Cost[] = passed ? [{ resource: "testEvidence", amount: profile.reviewEvidenceYield }, { resource: "trustCapital", amount: 0.1 }] : [{ resource: "errorWaste", amount: profile.reviewEvidenceYield * 0.5 }];
  economy.transform("review", tick, worker.workerId, inputs, outputs, true);
  const spent = spendWorkerEnergy({ ...worker, currentTask: "reviewing", evidenceCount: worker.evidenceCount + (passed ? 1 : 0) }, energyCost(0.06, worker, profile), 0.03);
  return { ok: true, worker: spent, passed, evidenceProduced: passed ? profile.reviewEvidenceYield : 0, wasteProduced: passed ? 0 : profile.reviewEvidenceYield * 0.5 };
}

export interface TestOutcome {
  readonly ok: boolean;
  readonly worker: DigitalWorker;
  readonly passed: boolean;
  readonly evidenceProduced: number;
  readonly wasteProduced: number;
}

/** Test an artifact — produces test evidence on pass, test-failure waste on fail. */
export function runTest(economy: DigitalResourceEconomy, worker: DigitalWorker, artifact: DigitalParcel, profile: DigitalMetabolismProfile, seed: number, tick: number): TestOutcome {
  const inputs: Cost[] = [
    { resource: "computeCapacity", amount: profile.testComputeCost },
    { resource: "tokenBudget", amount: profile.testTokenCost },
    { resource: "workingContext", amount: 0.1 },
  ];
  if (!canExecute(worker, "testing") || !canAfford(economy, inputs)) return { ok: false, worker, passed: false, evidenceProduced: 0, wasteProduced: 0 };
  const draw = digitalDraw(seed, worker.index, tick ^ 17, 0x85ebca6b);
  const failChance = profile.testFailureRate + (artifact.poisoned ? 0.4 : 0) + (1 - artifact.confidence) * 0.2;
  const passed = draw >= failChance;
  const outputs: Cost[] = passed ? [{ resource: "testEvidence", amount: profile.testEvidenceYield }] : [{ resource: "errorWaste", amount: profile.testEvidenceYield * 0.6 }];
  economy.transform("test", tick, worker.workerId, inputs, outputs, true);
  const spent = spendWorkerEnergy({ ...worker, currentTask: "testing", evidenceCount: worker.evidenceCount + (passed ? 1 : 0) }, energyCost(0.07, worker, profile), 0.02);
  return { ok: true, worker: spent, passed, evidenceProduced: passed ? profile.testEvidenceYield : 0, wasteProduced: passed ? 0 : profile.testEvidenceYield * 0.6 };
}

export interface RepairOutcome {
  readonly ok: boolean;
  readonly worker: DigitalWorker;
  readonly wasteRecycled: number;
  readonly lessonProduced: number;
  readonly debtServiced: number;
}

/**
 * Repair: recycle accumulated error waste into a reusable lesson (verified
 * knowledge) and pay down technical debt. Requires a prior review event (the
 * caller guarantees `hasReviewEvidence`) — no reusable lesson without review.
 */
export function repair(economy: DigitalResourceEconomy, worker: DigitalWorker, hasReviewEvidence: boolean, profile: DigitalMetabolismProfile, seed: number, tick: number): RepairOutcome {
  const inputs: Cost[] = [
    { resource: "errorWaste", amount: profile.repairWasteInput },
    { resource: "computeCapacity", amount: profile.repairComputeCost },
  ];
  if (!canExecute(worker, "repairing") || !hasReviewEvidence || !canAfford(economy, inputs)) {
    return { ok: false, worker, wasteRecycled: 0, lessonProduced: 0, debtServiced: 0 };
  }
  // Consume waste + compute; produce a reusable lesson; separately service debt.
  economy.transform("repair", tick, worker.workerId, inputs, [{ resource: "verifiedKnowledge", amount: profile.repairLessonYield }], true);
  const debtServiced = economy.consume("technicalDebt", profile.repairDebtServiced);
  const spent = spendWorkerEnergy({ ...worker, currentTask: "repairing" }, energyCost(0.06, worker, profile), 0.03);
  return { ok: true, worker: spent, wasteRecycled: profile.repairWasteInput, lessonProduced: profile.repairLessonYield, debtServiced };
}
