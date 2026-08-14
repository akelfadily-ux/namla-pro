/**
 * digitalBrood — brood and maturation (Build Law §23; the digital analogue of
 * egg -> larva -> pupa -> callow -> adult). New workers and new skills begin
 * UNTRAINED: limited reliability, restricted tool access, supervised, unable to
 * perform high-risk work. They mature only through training missions,
 * mentorship, review, exams, and project evidence — never instantly. Promotion
 * is EVIDENCE-GATED: a worker cannot advance a stage without the required
 * accumulated verified evidence AND an active senior mentor.
 *
 * No fs, no child_process, no network, no wall clock, no module-level mutable state.
 */

import { clamp, roundTo } from "../colony/colonyTypes";
import { digitalDraw } from "./digitalTypes";
import type { DigitalResourceEconomy } from "./digitalResourceEconomy";
import type { DigitalMetabolismProfile } from "./digitalConfig";
import { canExecute, promoteWorker, spendWorkerEnergy, stageRank } from "./digitalWorkers";
import type { DigitalWorker } from "./digitalWorkers";

export interface TrainingOutcome {
  readonly brood: DigitalWorker;
  readonly mentor: DigitalWorker;
  readonly trained: boolean;
  readonly skillGained: number;
}

/**
 * A senior mentor trains one brood worker: consumes a little compute + context
 * (the cost of a training mission), grows the brood's competence and evidence a
 * little. Requires an active senior mentor with energy — mentorship is not free.
 */
export function trainBroodWorker(economy: DigitalResourceEconomy, brood: DigitalWorker, mentor: DigitalWorker, profile: DigitalMetabolismProfile, seed: number, tick: number): TrainingOutcome {
  if (!mentor.active || mentor.maturation !== "senior" || !canExecute(mentor, "mentoring") || brood.maturation === "retired") {
    return { brood, mentor, trained: false, skillGained: 0 };
  }
  const cost = [
    { r: "computeCapacity" as const, a: 0.1 },
    { r: "workingContext" as const, a: 0.1 },
  ];
  if (cost.some((c) => economy.balanceOf(c.r) < c.a)) return { brood, mentor, trained: false, skillGained: 0 };
  for (const c of cost) economy.consume(c.r, c.a);
  const gain = 0.03 + digitalDraw(seed, brood.index, tick, 0x2545f491) * 0.03;
  const trainedBrood: DigitalWorker = {
    ...brood,
    competence: roundTo(clamp(brood.competence + gain, 0, 1), 4),
    reliability: roundTo(clamp(brood.reliability + gain * 0.5, 0, 1), 4),
    evidenceCount: brood.evidenceCount + 1,
    currentTask: "resting",
  };
  const spentMentor = spendWorkerEnergy({ ...mentor, currentTask: "mentoring" }, 0.05, 0.02);
  return { brood: trainedBrood, mentor: spentMentor, trained: true, skillGained: gain };
}

export interface PromotionOutcome {
  readonly worker: DigitalWorker;
  readonly promoted: boolean;
}

/**
 * Evidence-gated promotion: advance one stage only when the worker has enough
 * accumulated verified evidence, is not already senior/retired, and a mentor is
 * available (`mentorAvailable`). No promotion without evidence.
 */
export function attemptPromotion(worker: DigitalWorker, mentorAvailable: boolean, profile: DigitalMetabolismProfile): PromotionOutcome {
  if (worker.maturation === "retired" || stageRank(worker.maturation) >= stageRank("senior")) return { worker, promoted: false };
  if (!mentorAvailable) return { worker, promoted: false };
  if (worker.evidenceCount < profile.evidenceToPromote) return { worker, promoted: false };
  const promoted = promoteWorker(worker);
  if (promoted.maturation === worker.maturation) return { worker, promoted: false };
  return { worker: { ...promoted, evidenceCount: promoted.evidenceCount - profile.evidenceToPromote }, promoted: true };
}
