/**
 * diseaseAndSanitation — bounded pathogen dynamics, social immunity, and
 * sanitation (Build Law §22, §10/§11). A pathogen has exposure -> load ->
 * incubation -> infectiousness -> health effect -> mortality risk. Transmission
 * requires a real EXPOSURE PATH: co-location with an infectious nestmate or a
 * contaminated chamber — never global knowledge. Social responses (self-
 * grooming, allogrooming, reduced contact, corpse handling, waste transport)
 * are local and cost energy. Sanitation reduces contamination only after LOCAL
 * detection.
 *
 * No fs, no child_process, no network, no wall clock, no module-level mutable state.
 */

import { clamp, roundTo } from "../colony/colonyTypes";
import { bioDraw } from "./biologicalTypes";
import type { AntBody } from "./colonyPhysiology";
import type { ColonyResourceEconomy } from "./resourceEconomy";

export const INFECTIOUS_THRESHOLD = 0.4;
export const TRANSMISSION_BASE = 0.15;

/** Raise a body's pathogen load from a real exposure (caller confirms the path). */
export function exposeToPathogen(body: AntBody, exposureStrength: number): AntBody {
  if (exposureStrength <= 0) return body;
  return { ...body, pathogenLoad: clamp(body.pathogenLoad + exposureStrength * 0.2, 0, 1) };
}

/** Incubate: load grows while immune activation and grooming push it down; health falls when high. */
export function advanceInfection(body: AntBody): AntBody {
  if (!body.alive) return body;
  const growth = body.pathogenLoad > 0 && body.pathogenLoad < 0.9 ? body.pathogenLoad * 0.05 : 0;
  const immuneClear = body.immuneActivation * 0.08;
  const pathogenLoad = clamp(body.pathogenLoad + growth - immuneClear, 0, 1);
  const immuneActivation = clamp(body.immuneActivation + (pathogenLoad > 0.2 ? 0.05 : -0.02), 0, 1);
  const health = clamp(body.health - (pathogenLoad > INFECTIOUS_THRESHOLD ? pathogenLoad * 0.01 : 0), 0, 1);
  return { ...body, pathogenLoad: roundTo(pathogenLoad, 6), immuneActivation: roundTo(immuneActivation, 6), health: roundTo(health, 6) };
}

export function isInfectious(body: AntBody): boolean {
  return body.alive && body.pathogenLoad >= INFECTIOUS_THRESHOLD;
}

/** Self-grooming: an ant reduces its OWN load at an energy cost (economy-tracked). */
export function selfGroom(body: AntBody, economy: ColonyResourceEconomy): { body: AntBody; groomed: boolean } {
  if (body.pathogenLoad <= 0.02) return { body, groomed: false };
  economy.spendEnergy(0.001);
  return { body: { ...body, pathogenLoad: roundTo(clamp(body.pathogenLoad - 0.05, 0, 1), 6) }, groomed: true };
}

/** Allogrooming: a healthy groomer lowers a co-located patient's load, costing the groomer energy. */
export function allogroom(groomer: AntBody, patient: AntBody, economy: ColonyResourceEconomy): { groomer: AntBody; patient: AntBody; groomed: boolean } {
  if (patient.pathogenLoad <= 0.05 || groomer.pathogenLoad > 0.3 || groomer.energy < 0.1) {
    return { groomer, patient, groomed: false };
  }
  economy.spendEnergy(0.0015);
  // Small back-transmission risk to the groomer — social immunity is not free.
  const patientLoad = clamp(patient.pathogenLoad - 0.08, 0, 1);
  const groomerLoad = clamp(groomer.pathogenLoad + patient.pathogenLoad * 0.02, 0, 1);
  return {
    groomer: { ...groomer, pathogenLoad: roundTo(groomerLoad, 6) },
    patient: { ...patient, pathogenLoad: roundTo(patientLoad, 6) },
    groomed: true,
  };
}

export interface TransmissionEvent {
  readonly fromAntId: string;
  readonly toAntId: string;
  readonly tick: number;
  readonly chamberId: string;
}

/**
 * Attempt transmission from an infectious ant to a co-located susceptible one.
 * The caller guarantees co-location (the exposure path); this only decides the
 * stochastic outcome and applies the load. Returns the event when it happens.
 */
export function tryTransmit(infectious: AntBody, susceptible: AntBody, seed: number, tick: number): { susceptible: AntBody; event: TransmissionEvent | null } {
  if (!isInfectious(infectious) || !susceptible.alive) return { susceptible, event: null };
  const draw = bioDraw(seed, infectious.antIndex, susceptible.antIndex ^ tick, 0x165667b1);
  const chance = TRANSMISSION_BASE * infectious.pathogenLoad * (1 - susceptible.immuneActivation * 0.5);
  if (draw >= chance) return { susceptible, event: null };
  return {
    susceptible: { ...susceptible, pathogenLoad: roundTo(clamp(susceptible.pathogenLoad + 0.15, 0, 1), 6) },
    event: { fromAntId: infectious.antId, toAntId: susceptible.antId, tick, chamberId: susceptible.chamberId },
  };
}

export interface SanitationOutcome {
  readonly corpsesDetected: number;
  readonly corpsesTransported: number;
}

/**
 * A live worker co-located with a corpse detects it and, if able, transports it
 * to the waste chamber (necrophoresis). Detection is strictly local; a corpse
 * never vanishes silently — it is moved, and its chamber's contamination rises
 * until sanitation clears it. Returns which corpse ids were transported.
 */
export function detectAndTransportCorpses(corpseChamber: string, liveWorkersHere: number, corpseIds: readonly string[]): { transported: readonly string[]; detected: number } {
  if (liveWorkersHere === 0 || corpseIds.length === 0) return { transported: [], detected: 0 };
  // One worker can carry one corpse per tick; detection precedes transport.
  const transported = corpseIds.slice(0, Math.min(liveWorkersHere, corpseIds.length));
  return { transported, detected: corpseIds.length };
}
