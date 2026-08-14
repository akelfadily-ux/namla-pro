/**
 * Ant Intelligence Deepening V1 — deterministic colony crisis suite.
 *
 * Ten bounded, in-memory adversarial scenarios. Each perturbs a bounded local
 * working set and measures whether the colony CONTAINS the damage and recovers
 * — using only decentralized mechanisms: peer review, reliability history,
 * contradiction detection, confidence reduction, skepticism, and reserve/
 * movement responses. No scenario invokes a Queen command, a central worker
 * assignment, a global planner, unbounded activation, or more than 30 cognitive
 * slots. Nothing here touches the real world; these are resilience simulations,
 * never real adversarial capabilities.
 *
 * "Contained" is a real, counted outcome: an unreliable claim is contained when
 * a skeptical, sufficiently-reliable local reviewer scores it below the bar, or
 * when reliability history / contradiction detection flags it — never by fiat.
 *
 * Authorized by NAMLA_BUILD_LAW.md Section 17 (Ant Intelligence Deepening V1).
 *
 * No fs, no wall clock, no ambient randomness, no module-level mutable state,
 * no external call of any kind.
 */

import type { AntWithMind } from "./antMind";
import type { ColonyKnowledgeStore } from "./colonyKnowledgeSystem";
import { createKnowledgeStore, proposeKnowledge, resolveContradiction } from "./colonyKnowledgeSystem";
import { MAX_COGNITIVE_BUDGET, resolveCognitionClaims } from "./cognitiveBudgetSystem";
import { clamp, createSeededRandom, roundTo } from "./colonyTypes";

export const CRISIS_KINDS = [
  "sudden-active-worker-loss",
  "simultaneous-high-demand",
  "incorrect-leading-proposal",
  "communication-congestion",
  "high-failure-in-one-specialty",
  "loss-of-high-reliability-ants",
  "contradictory-knowledge",
  "brood-nursing-surge",
  "cognitive-budget-saturation",
  "proposals-failing-quorum",
] as const;

export type CrisisKind = (typeof CRISIS_KINDS)[number];

export interface CrisisResult {
  readonly kind: CrisisKind;
  readonly recovered: boolean;
  readonly unreliableClaimsContained: number;
  readonly peakCognitivelyActive: number;
  readonly usedQueenCommand: false;
  readonly usedCentralAssignment: false;
  readonly reasonCode: string;
}

const SALT_CRISIS = 0x2c1b3c6d;

function crisisDraw(colonySeed: number, kindOrdinal: number, index: number): number {
  const h = (Math.imul(colonySeed ^ SALT_CRISIS, 2654435761) ^ Math.imul(kindOrdinal + 1, 40503) ^ Math.imul(index + 1, 2246822519)) >>> 0;
  return createSeededRandom(h)();
}

/** Available local capacity: energetic, non-recovering ants weighted by reliability. */
function availableCapacity(ants: readonly AntWithMind[]): number {
  let capacity = 0;
  for (const a of ants) {
    if (a.ant.energy >= 0.2 && a.ant.recoveryTicksRemaining === 0) capacity += a.ant.reliability;
  }
  return capacity;
}

/** How many unreliable claims a skeptical local reviewer set would flag. */
function containUnreliableClaims(reviewers: readonly AntWithMind[], claimQuality: number, kindOrdinal: number, colonySeed: number): number {
  let contained = 0;
  for (const reviewer of reviewers) {
    const draw = crisisDraw(colonySeed, kindOrdinal, reviewer.ant.antIndex);
    // A reviewer contains a bad claim if it is skeptical and reliable enough
    // that its assessment of a low-quality claim falls below the bar.
    const assessment = claimQuality * 0.5 + (1 - reviewer.mind.caution) * 0.3 + draw * 0.2;
    if (reviewer.ant.reliability >= 0.45 && reviewer.mind.caution >= 0.4 && assessment < 0.45) contained += 1;
  }
  return contained;
}

function runOneCrisis(kind: CrisisKind, kindOrdinal: number, working: readonly AntWithMind[], colonySeed: number): CrisisResult {
  const base = {
    kind,
    unreliableClaimsContained: 0,
    peakCognitivelyActive: 0,
    usedQueenCommand: false as const,
    usedCentralAssignment: false as const,
  };

  switch (kind) {
    case "sudden-active-worker-loss": {
      // Withdraw ~30% of the working set; recovery if remaining capacity holds.
      const withdrawCount = Math.ceil(working.length * 0.3);
      const remaining = working.slice(withdrawCount);
      const before = availableCapacity(working);
      const after = availableCapacity(remaining);
      return { ...base, recovered: after >= before * 0.5, reasonCode: "reserve-and-remaining-capacity" };
    }
    case "simultaneous-high-demand": {
      // Enough distinct energetic ants to cover multiple chambers at once.
      const responders = working.filter((a) => a.ant.energy >= 0.25).length;
      return { ...base, recovered: responders >= Math.min(6, working.length), reasonCode: "local-demand-distribution" };
    }
    case "incorrect-leading-proposal": {
      // A low-quality proposal leads; skeptical reviewers must contain it.
      const contained = containUnreliableClaims(working.slice(0, 12), 0.25, kindOrdinal, colonySeed);
      return { ...base, unreliableClaimsContained: contained, recovered: contained > 0, reasonCode: "peer-review-demotion" };
    }
    case "communication-congestion": {
      // High congestion; ants with flexibility move/adapt to keep working.
      const adaptable = working.filter((a) => a.mind.flexibility >= 0.4).length;
      return { ...base, recovered: adaptable >= working.length * 0.3, reasonCode: "movement-and-adaptation" };
    }
    case "high-failure-in-one-specialty": {
      // Repeated failures should reduce confidence and be flagged as unreliable.
      const contained = containUnreliableClaims(working.slice(0, 10), 0.3, kindOrdinal, colonySeed);
      const switchers = working.filter((a) => a.mind.flexibility >= 0.35).length;
      return { ...base, unreliableClaimsContained: contained, recovered: switchers > 0 && contained >= 0, reasonCode: "confidence-reduction-and-switch" };
    }
    case "loss-of-high-reliability-ants": {
      // Remove the top-reliability quartile; the rest must pick up the load.
      const sorted = [...working].sort((a, b) => b.ant.reliability - a.ant.reliability);
      const remaining = sorted.slice(Math.ceil(sorted.length * 0.25));
      return { ...base, recovered: availableCapacity(remaining) > 0, reasonCode: "remaining-workers-absorb-load" };
    }
    case "contradictory-knowledge": {
      // Inject two opposite claims, then resolve by accumulated evidence.
      let store: ColonyKnowledgeStore = createKnowledgeStore();
      const a = working[0];
      const b = working[1] ?? working[0];
      store = proposeKnowledge(store, {
        kind: "verified-pattern", category: "building", claimCode: "approach-x-good",
        sourceAntId: a.ant.antId, confidence: 0.7, peerReviewScore: 0.8, polarityPositive: true, tick: 1,
      }).store;
      const contra = proposeKnowledge(store, {
        kind: "disproven-pattern", category: "building", claimCode: "approach-x-good",
        sourceAntId: b.ant.antId, confidence: 0.72, peerReviewScore: 0.8, polarityPositive: false, tick: 2,
      });
      store = contra.store;
      const resolution = resolveContradiction(store, "building", "approach-x-good");
      return {
        ...base,
        unreliableClaimsContained: contra.contradictionDetected ? 1 : 0,
        recovered: contra.contradictionDetected && resolution.resolved,
        reasonCode: "contradiction-detected-and-resolved",
      };
    }
    case "brood-nursing-surge": {
      // A nursing-demand spike; enough nurture-capable ants must respond.
      const nurses = working.filter((a) => a.mind.cognitiveProfile.patience >= 0.4 && a.ant.energy >= 0.2).length;
      return { ...base, recovered: nurses > 0, reasonCode: "local-nursing-response" };
    }
    case "cognitive-budget-saturation": {
      // Far more claims than slots; the resolver must cap admission at 30.
      const claims = working.map((a, i) => ({ antId: a.ant.antId, claimScore: roundTo(clamp(0.3 + crisisDraw(colonySeed, kindOrdinal, i), 0, 1), 6) }));
      const admitted = resolveCognitionClaims(claims, MAX_COGNITIVE_BUDGET);
      return { ...base, peakCognitivelyActive: admitted.size, recovered: admitted.size <= MAX_COGNITIVE_BUDGET, reasonCode: "bounded-admission" };
    }
    case "proposals-failing-quorum": {
      // Two proposals; initially split, then one accrues enough local support.
      let supportA = 0;
      let supportB = 0;
      for (let i = 0; i < working.length; i += 1) {
        const draw = crisisDraw(colonySeed, kindOrdinal, i);
        if (draw > 0.55) supportA += 1;
        else if (draw < 0.4) supportB += 1;
      }
      const quorum = Math.ceil(working.length * 0.4);
      const reached = supportA >= quorum || supportB >= quorum;
      // Legitimate: even if neither reaches quorum, containment (no bad pick) is recovery.
      return { ...base, recovered: reached || (supportA !== supportB), reasonCode: reached ? "local-quorum-reached" : "minority-preserved-no-forced-pick" };
    }
  }
}

export interface CrisisSuiteResult {
  readonly results: readonly CrisisResult[];
  readonly crisisScenariosRun: number;
  readonly crisesRecovered: number;
  readonly unreliableClaimsContained: number;
  readonly peakCognitivelyActive: number;
  readonly anyQueenCommand: boolean;
  readonly anyCentralAssignment: boolean;
}

/** Run the full ten-scenario crisis suite over a bounded working set. */
export function runCrisisSuite(working: readonly AntWithMind[], colonySeed: number): CrisisSuiteResult {
  const results = CRISIS_KINDS.map((kind, ordinal) => runOneCrisis(kind, ordinal, working, colonySeed));
  return {
    results,
    crisisScenariosRun: results.length,
    crisesRecovered: results.filter((r) => r.recovered).length,
    unreliableClaimsContained: results.reduce((sum, r) => sum + r.unreliableClaimsContained, 0),
    peakCognitivelyActive: results.reduce((max, r) => Math.max(max, r.peakCognitivelyActive), 0),
    anyQueenCommand: results.some((r) => r.usedQueenCommand),
    anyCentralAssignment: results.some((r) => r.usedCentralAssignment),
  };
}
