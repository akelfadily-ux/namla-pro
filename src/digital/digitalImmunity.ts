/**
 * digitalImmunity — digital disease and immune response (Build Law §23; the
 * digital analogue of pathogens + social immunity). Threats are DEFENSIVE
 * concerns only — prompt injection, poisoned knowledge, secret leakage,
 * malicious artifacts, vulnerable dependencies, false success, unreliable
 * provider output, unsafe command suggestions, stale assumptions. There is NO
 * offensive capability anywhere: the immune system only DETECTS, QUARANTINES,
 * reduces trust, and remediates.
 *
 * A threat enters as real `securityRisk` (collected from the environment, like a
 * pathogen exposure), can spread along a TRACED local path (a poisoned parcel
 * poisoning a co-located one), and is cleared only after LOCAL detection by a
 * securing worker, which quarantines the risk and the poisoned material.
 *
 * No fs, no child_process, no network, no wall clock, no module-level mutable state.
 */

import { clamp, roundTo } from "../colony/colonyTypes";
import { digitalDraw } from "./digitalTypes";
import type { DigitalResource, ThreatKind } from "./digitalTypes";
import type { DigitalResourceEconomy } from "./digitalResourceEconomy";
import type { DigitalMetabolismProfile } from "./digitalConfig";
import type { DigitalWorker } from "./digitalWorkers";

export interface ThreatEvent {
  readonly threatId: string;
  readonly kind: ThreatKind;
  readonly tick: number;
  readonly sourceParcelId: string | null;
  readonly riskAmount: number;
  readonly detected: boolean;
}

export interface TransmissionEdge {
  readonly fromParcelId: string;
  readonly toParcelId: string;
  readonly tick: number;
}

/** Introduce a controlled threat: real security risk enters from the environment. */
export function introduceThreat(economy: DigitalResourceEconomy, kind: ThreatKind, riskAmount: number, threatId: string, tick: number, sourceParcelId: string | null): ThreatEvent {
  economy.collect("securityRisk", riskAmount);
  return { threatId, kind, tick, sourceParcelId, riskAmount: roundTo(riskAmount, 6), detected: false };
}

export interface QuarantineOutcome {
  readonly quarantinedRisk: number;
  readonly quarantinedMaterial: number;
  readonly remediation: number; // remediation actions taken (>=1 when detected)
  readonly trustPenalty: number;
}

/**
 * A securing worker (senior, immune role) detects local risk and quarantines it
 * plus any poisoned material. Trust is reduced (evidence-driven), and a
 * remediation action is recorded. Nothing here attacks anything — it only
 * isolates and downgrades.
 */
export function quarantineThreat(
  economy: DigitalResourceEconomy,
  worker: DigitalWorker,
  riskAmount: number,
  poisonedResource: DigitalResource | null,
  poisonedAmount: number,
  profile: DigitalMetabolismProfile
): QuarantineOutcome {
  const quarantinedRisk = economy.quarantine("securityRisk", riskAmount * profile.quarantineFraction);
  const quarantinedMaterial = poisonedResource ? economy.quarantine(poisonedResource, poisonedAmount) : 0;
  void worker;
  return { quarantinedRisk, quarantinedMaterial, remediation: 1, trustPenalty: profile.trustPenaltyOnThreat };
}

/**
 * Attempt traced local transmission from a poisoned parcel to a co-located one.
 * The caller guarantees co-location (same team/artifact set) — the exposure
 * path. Returns the edge when the target becomes poisoned.
 */
export function tryTransmitThreat(fromParcelId: string, fromConfidence: number, toParcelId: string, seed: number, tick: number): TransmissionEdge | null {
  const draw = digitalDraw(seed, fromParcelId.length, toParcelId.length ^ tick, 0x27d4eb2f);
  const chance = clamp(0.2 + (1 - fromConfidence) * 0.3, 0, 0.6);
  return draw < chance ? { fromParcelId, toParcelId, tick } : null;
}

/** Detect a false-success claim by contradiction with test evidence. */
export function detectFalseSuccess(claimConfidence: number, evidenceStrength: number): boolean {
  return claimConfidence > 0.6 && evidenceStrength < 0.2;
}

/** Reduce a worker's trust after it produced or forwarded a threat (bounded). */
export function penalizeTrust(worker: DigitalWorker, penalty: number): DigitalWorker {
  return { ...worker, trust: roundTo(clamp(worker.trust - penalty, 0, 1), 4), reliability: roundTo(clamp(worker.reliability - penalty * 0.5, 0, 1), 4) };
}
