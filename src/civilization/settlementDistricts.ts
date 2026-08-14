/**
 * settlementDistricts — the twenty districts and the voluntary digital labor
 * market (Build Law §27). Each district holds real local state, publishes real
 * work demand, consumes resources, and produces artifacts/failures/messages.
 * Work is NEVER assigned centrally: districts emit demand, ants locally observe
 * it, ants voluntarily submit claims, and a bounded resolver accepts only among
 * volunteers, forming temporary teams that dissolve on completion or failure.
 *
 * No fs, no child_process, no network, no wall clock, no ambient randomness.
 */

import { clamp, roundTo } from "../colony/colonyTypes";
import { DISTRICTS, civDraw } from "./settlementTypes";
import type { DistrictId, McpToolId, ProviderName, WorkKind } from "./settlementTypes";
import type { DigitalWorker } from "../digital/digitalWorkers";
import { stageRank } from "../digital/digitalWorkers";

export interface District {
  readonly id: DistrictId;
  readonly workKind: WorkKind;
  demandLevel: number; // 0..1 current pressure
  openDemands: number;
  artifactsProduced: number;
  failuresProduced: number;
  messagesIn: number;
  messagesOut: number;
  resourcesConsumed: number;
}

const DISTRICT_WORK_KIND: Record<DistrictId, WorkKind> = {
  "queen-continuity": "research",
  academy: "training",
  research: "research",
  "architecture-council": "architecture",
  "software-engineering": "backend",
  "frontend-guild": "frontend",
  "backend-guild": "backend",
  "database-guild": "database",
  "ai-agent-engineering": "ai-agent",
  "testing-quality": "testing",
  "debugging-repair": "debugging",
  "defensive-security": "security",
  "devops-infrastructure": "devops",
  "knowledge-memory": "knowledge",
  "tool-mcp": "mcp-tooling",
  "provider-compute": "provider-orchestration",
  "operations-command": "review",
  "waste-recycling": "repair",
  "reserve-worker": "research",
  "brood-development": "training",
};

export function createDistricts(): Record<DistrictId, District> {
  const out = {} as Record<DistrictId, District>;
  for (const id of DISTRICTS) {
    out[id] = { id, workKind: DISTRICT_WORK_KIND[id], demandLevel: 0.3, openDemands: 0, artifactsProduced: 0, failuresProduced: 0, messagesIn: 0, messagesOut: 0, resourcesConsumed: 0 };
  }
  return out;
}

/** A district publishes bounded demand this cycle from the objective + backlog. */
export function publishDistrictDemand(district: District, objectivePressure: number, seed: number, tick: number): number {
  const pressure = clamp(district.demandLevel * 0.6 + objectivePressure * 0.4 + civDraw(seed, district.id.length, tick, 0x1b873593) * 0.1, 0, 1);
  const demands = Math.max(0, Math.round(pressure * 3));
  district.demandLevel = pressure;
  district.openDemands += demands;
  district.messagesOut += demands; // demand publication is a bounded local message
  return demands;
}

export interface WorkClaim {
  readonly antId: string;
  readonly index: number;
  readonly districtId: DistrictId;
  readonly workKind: WorkKind;
  readonly skill: number;
  readonly reliability: number;
  readonly energy: number;
  readonly contextCapacity: number;
  readonly costEstimate: number;
  readonly toolRequirements: readonly McpToolId[];
  readonly providerPreference: ProviderName;
  readonly learningBenefit: number;
  readonly risk: number;
  readonly confidence: number;
}

/** A stable per-ant specialization affinity toward a work kind (self-selection). */
export function specializationAffinity(worker: DigitalWorker, workKind: WorkKind, seed: number): number {
  return civDraw(seed, worker.index, workKind.length, 0x2c1b3c6d) * 0.7 + worker.competence * 0.3;
}

/**
 * Ants voluntarily submit claims for a district's open demand — only ants whose
 * self-observed affinity, energy, and maturation warrant it. Never an
 * assignment: the ant chooses to claim.
 */
export function collectVoluntaryClaims(workers: readonly DigitalWorker[], district: District, seed: number, tick: number): WorkClaim[] {
  if (district.openDemands <= 0) return [];
  const claims: WorkClaim[] = [];
  for (const w of workers) {
    if (!w.active || w.maturation === "untrained" || w.cognitiveEnergy < 0.25) continue;
    const affinity = specializationAffinity(w, district.workKind, seed);
    if (affinity < 0.45) continue;
    if (civDraw(seed, w.index, tick ^ district.id.length, 0x27220a95) < 0.5) continue; // the ant chooses whether to volunteer
    const toolReq: McpToolId[] = district.workKind === "backend" || district.workKind === "frontend" || district.workKind === "database" ? ["workspace-file-create", "typecheck"] : district.workKind === "testing" ? ["tests"] : district.workKind === "review" ? ["project-analysis"] : ["knowledge-retrieval"];
    claims.push({
      antId: w.workerId,
      index: w.index,
      districtId: district.id,
      workKind: district.workKind,
      skill: affinity,
      reliability: w.reliability,
      energy: w.cognitiveEnergy,
      contextCapacity: w.bandwidth,
      costEstimate: roundTo(0.3 + (1 - w.competence) * 0.4, 4),
      toolRequirements: toolReq,
      providerPreference: w.index % 3 === 0 ? "codex" : w.index % 3 === 1 ? "claude" : "local-model",
      learningBenefit: roundTo(1 - w.competence, 4),
      risk: roundTo(district.demandLevel * 0.4, 4),
      confidence: roundTo(w.reliability * 0.6 + affinity * 0.4, 4),
    });
  }
  return claims;
}

export interface WorkTeam {
  readonly teamId: string;
  readonly districtId: DistrictId;
  readonly workKind: WorkKind;
  readonly memberAntIds: readonly string[];
  readonly formedTick: number;
  dissolved: boolean;
}

/**
 * A bounded resolver accepts ONLY among volunteers, ranking by a fair blend of
 * skill, reliability, confidence, low cost, and learning benefit — never by
 * identity, and never more than the open demand or a small team cap.
 */
export function resolveClaimsIntoTeam(district: District, claims: readonly WorkClaim[], teamSeq: number, tick: number): { readonly team: WorkTeam | null; readonly acceptedAntIds: readonly string[] } {
  if (claims.length === 0 || district.openDemands <= 0) return { team: null, acceptedAntIds: [] };
  const ranked = [...claims].sort((a, b) => claimScore(b) - claimScore(a));
  const teamSize = Math.min(ranked.length, Math.max(1, Math.min(4, district.openDemands)));
  const accepted = ranked.slice(0, teamSize);
  const team: WorkTeam = { teamId: `team-${district.id}-${teamSeq}`, districtId: district.id, workKind: district.workKind, memberAntIds: accepted.map((c) => c.antId), formedTick: tick, dissolved: false };
  district.openDemands = Math.max(0, district.openDemands - teamSize);
  return { team, acceptedAntIds: accepted.map((c) => c.antId) };
}

function claimScore(c: WorkClaim): number {
  return c.skill * 0.3 + c.reliability * 0.25 + c.confidence * 0.2 + (1 - c.costEstimate) * 0.15 + c.learningBenefit * 0.1;
}

/** Bounded local message between two districts (routing demand / evidence). */
export function sendDistrictMessage(from: District, to: District): void {
  from.messagesOut += 1;
  to.messagesIn += 1;
}

export function districtIsAdvanced(worker: DigitalWorker): boolean {
  return stageRank(worker.maturation) >= stageRank("qualified");
}
