/**
 * digitalWorkers — the persistent worker identities and their bounded state
 * (Build Law §23; the digital analogue of `colonyPhysiology`). A colony may hold
 * 300 / 1,000 / 10,000 persistent identities, but only a BOUNDED number ever
 * execute in a cycle. "Working hands" are executing AntAgents; "deep cognitive"
 * workers are capped globally at 30; "real-provider" workers are capped at 5 and
 * make ZERO calls in deterministic runs.
 *
 * A worker cannot act without cognitive energy, cannot do high-risk work before
 * it has matured through evidence, and once retired makes no decision. Every
 * energy change and every maturation step is explicit and event-sourced.
 *
 * No fs, no child_process, no network, no wall clock, no module-level mutable state.
 */

import { clamp, roundTo } from "../colony/colonyTypes";
import { digitalDraw } from "./digitalTypes";
import type { DigitalTask, MaturationStage, WorkerKind } from "./digitalTypes";

export interface DigitalWorker {
  readonly workerId: string;
  readonly index: number;
  readonly kind: WorkerKind;
  readonly teamId: string;
  readonly maturation: MaturationStage;
  readonly reliability: number; // 0..1 evidence-backed reliability
  readonly trust: number; // 0..1 trust capital held by this worker
  readonly competence: number; // 0..1 skill breadth (durable skillAssets)
  readonly cognitiveEnergy: number; // 0..1 depletes with work, recovers with rest
  readonly bandwidth: number; // 0..1 communication/context bandwidth headroom
  readonly toolPermitHeld: boolean;
  readonly currentTask: DigitalTask;
  readonly evidenceCount: number; // accumulated verified evidence toward promotion
  readonly active: boolean; // false once retired/disabled
  readonly retiredReason: string | null;
  readonly forageTendency: number; // stable preference toward outward scouting work
}

export const GLOBAL_COGNITIVE_CAP = 30 as const;
export const REAL_PROVIDER_CAP = 5 as const;

const STAGE_ORDER: readonly MaturationStage[] = ["untrained", "training", "supervised", "qualified", "senior", "retired"];

export interface CreateWorkerInput {
  readonly workerId: string;
  readonly index: number;
  readonly kind: WorkerKind;
  readonly teamId: string;
  readonly seed: number;
  readonly maturation?: MaturationStage;
}

export function createDigitalWorker(input: CreateWorkerInput): DigitalWorker {
  const v = digitalDraw(input.seed, input.index, 0, 0x51ed270b);
  const stage: MaturationStage = input.maturation ?? (v < 0.35 ? "untrained" : v < 0.6 ? "supervised" : v < 0.85 ? "qualified" : "senior");
  return {
    workerId: input.workerId,
    index: input.index,
    kind: input.kind,
    teamId: input.teamId,
    maturation: stage,
    reliability: roundTo(0.4 + v * 0.4, 4),
    trust: roundTo(0.3 + v * 0.4, 4),
    competence: roundTo(0.3 + digitalDraw(input.seed, input.index, 1, 0x9e3779b9) * 0.5, 4),
    cognitiveEnergy: roundTo(0.7 + v * 0.2, 4),
    bandwidth: roundTo(0.6 + digitalDraw(input.seed, input.index, 2, 0x2545f491) * 0.3, 4),
    toolPermitHeld: false,
    currentTask: "resting",
    evidenceCount: 0,
    active: true,
    retiredReason: null,
    forageTendency: roundTo(digitalDraw(input.seed, input.index, 7, 0x2c1b3c6d), 4),
  };
}

/** Maturation gate: which tasks a worker is permitted to perform unmentored. */
export function taskPermittedForStage(task: DigitalTask, stage: MaturationStage): boolean {
  switch (task) {
    case "resting":
    case "scouting":
      return true; // any active worker may scout / rest
    case "verifying":
    case "testing":
    case "reviewing":
      return stage !== "untrained" && stage !== "retired"; // needs at least training
    case "planning":
    case "repairing":
      return stage === "supervised" || stage === "qualified" || stage === "senior";
    case "building":
      return stage === "qualified" || stage === "senior"; // high-risk: evidence required
    case "securing":
      return stage === "senior"; // immune work: most-trusted only
    case "mentoring":
      return stage === "senior";
    default:
      return false;
  }
}

/** A worker can execute iff active, energised, and stage-permitted. */
export function canExecute(worker: DigitalWorker, task: DigitalTask): boolean {
  if (!worker.active || worker.maturation === "retired") return false;
  if (worker.cognitiveEnergy < 0.12) return false; // must rest
  return taskPermittedForStage(task, worker.maturation);
}

/** Spend cognitive energy + bandwidth on work (bounded, never negative). */
export function spendWorkerEnergy(worker: DigitalWorker, energyCost: number, bandwidthCost: number): DigitalWorker {
  return {
    ...worker,
    cognitiveEnergy: roundTo(clamp(worker.cognitiveEnergy - energyCost, 0, 1), 6),
    bandwidth: roundTo(clamp(worker.bandwidth - bandwidthCost, 0, 1), 6),
  };
}

/** Rest: recover cognitive energy and bandwidth (no external resource needed). */
export function restWorker(worker: DigitalWorker): DigitalWorker {
  return {
    ...worker,
    currentTask: "resting",
    cognitiveEnergy: roundTo(clamp(worker.cognitiveEnergy + 0.15, 0, 1), 6),
    bandwidth: roundTo(clamp(worker.bandwidth + 0.2, 0, 1), 6),
  };
}

/** Promote one maturation step. Caller guarantees the evidence gate is met. */
export function promoteWorker(worker: DigitalWorker): DigitalWorker {
  const idx = STAGE_ORDER.indexOf(worker.maturation);
  if (idx < 0 || idx >= STAGE_ORDER.indexOf("senior")) return worker; // senior is the cap; retire is separate
  const next = STAGE_ORDER[idx + 1];
  return { ...worker, maturation: next, reliability: roundTo(clamp(worker.reliability + 0.08, 0, 1), 4), competence: roundTo(clamp(worker.competence + 0.06, 0, 1), 4) };
}

/** Retire a worker: its identity is preserved (active=false, reason recorded). */
export function retireWorker(worker: DigitalWorker, reason: string): DigitalWorker {
  return { ...worker, active: false, maturation: "retired", currentTask: "resting", toolPermitHeld: false, retiredReason: reason };
}

export function stageRank(stage: MaturationStage): number {
  return STAGE_ORDER.indexOf(stage);
}
