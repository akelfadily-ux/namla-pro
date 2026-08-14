/**
 * digitalConfig — the ONE documented profile of tunable digital-metabolism
 * parameters (Build Law §23). Every cost, yield, threshold, and cap that shapes
 * the digital economy lives here with a comment, so behaviour is tuned in one
 * reviewed place rather than through magic numbers scattered across modules.
 *
 * These are the digital analogues of the biological knobs (basal metabolic rate,
 * travel cost, collection amount, forager proportion, feeding threshold, etc.).
 */

import type { WorkerKind } from "./digitalTypes";

export interface DigitalMetabolismProfile {
  // --- scouting (collect raw information) ---
  readonly rawCollectPerScout: number; // raw information gathered per scouting act
  readonly scoutContextCost: number; // working context consumed to scout
  readonly scoutComputeCost: number;
  readonly scoutTokenCost: number;
  readonly scoutEnergyCost: number;

  // --- verification (raw information -> verified knowledge) ---
  readonly verifyRawInput: number; // raw information consumed per verify
  readonly verifyContextCost: number;
  readonly verifyComputeCost: number;
  readonly verifyTokenCost: number;
  readonly verifyKnowledgeYield: number; // verified knowledge produced on success
  readonly verifyEvidenceYield: number; // test evidence produced on success
  readonly verifyFailureRate: number; // fraction that fails -> error waste
  readonly verifyEnergyCost: number;

  // --- planning (knowledge + context -> plan) ---
  readonly planKnowledgeInput: number;
  readonly planContextCost: number;
  readonly planComputeCost: number;
  readonly planEnergyCost: number;

  // --- building (plan -> reusable components / artifacts) ---
  readonly buildKnowledgeInput: number;
  readonly buildContextCost: number;
  readonly buildComputeCost: number;
  readonly buildTokenCost: number;
  readonly buildComponentYield: number; // reusable components produced on success
  readonly buildFailureRate: number; // fraction failing -> error waste + debt
  readonly buildDebtOnFailure: number; // technical debt accrued per failed build
  readonly buildEnergyCost: number;

  // --- review + test (immune evidence) ---
  readonly reviewContextCost: number;
  readonly reviewComputeCost: number;
  readonly reviewEvidenceYield: number;
  readonly reviewRejectRate: number; // fraction of artifacts a review rejects
  readonly testComputeCost: number;
  readonly testTokenCost: number;
  readonly testEvidenceYield: number;
  readonly testFailureRate: number;

  // --- repair (recycle waste -> lessons) ---
  readonly repairWasteInput: number; // error waste consumed per repair
  readonly repairComputeCost: number;
  readonly repairLessonYield: number; // reusable knowledge recovered
  readonly repairDebtServiced: number; // technical debt paid down per repair

  // --- trophallaxis (bounded local context/knowledge transfer) ---
  readonly trophallaxisContextTransfer: number; // context handed over per exchange
  readonly trophallaxisBandwidthCost: number; // bandwidth spent per exchange
  readonly maxTrophallaxisPerWorker: number;

  // --- immunity (threat handling) ---
  readonly threatIntroRisk: number; // security risk added per introduced threat
  readonly quarantineFraction: number; // fraction of risk quarantined on detection
  readonly trustPenaltyOnThreat: number;

  // --- maturation ---
  readonly evidenceToPromote: number; // verified evidence needed to promote a stage

  // --- freshness / degradation ---
  readonly contextExpiryPerCycle: number; // working context that goes stale each cycle
  readonly knowledgeStalingPerCycle: number; // verified knowledge -> stale knowledge

  // --- worker energy cost multiplier per worker kind (metabolic rate analogue) ---
  readonly energyRateByKind: Record<WorkerKind, number>;
}

/**
 * The default profile. Tuned so a bounded high-tech project sustains real flow
 * over many cycles without exhausting budgets prematurely: information is
 * collected, verified, planned, built, reviewed, tested, failures recycled — and
 * the conservation identity still closes exactly.
 */
export const DEFAULT_DIGITAL_PROFILE: DigitalMetabolismProfile = {
  rawCollectPerScout: 1.2,
  scoutContextCost: 0.15,
  scoutComputeCost: 0.1,
  scoutTokenCost: 0.2,
  scoutEnergyCost: 0.08,

  verifyRawInput: 1,
  verifyContextCost: 0.2,
  verifyComputeCost: 0.15,
  verifyTokenCost: 0.3,
  verifyKnowledgeYield: 0.8,
  verifyEvidenceYield: 0.3,
  verifyFailureRate: 0.18,
  verifyEnergyCost: 0.1,

  planKnowledgeInput: 0.6,
  planContextCost: 0.25,
  planComputeCost: 0.2,
  planEnergyCost: 0.1,

  buildKnowledgeInput: 0.7,
  buildContextCost: 0.3,
  buildComputeCost: 0.35,
  buildTokenCost: 0.5,
  buildComponentYield: 0.9,
  buildFailureRate: 0.22,
  buildDebtOnFailure: 0.4,
  buildEnergyCost: 0.14,

  reviewContextCost: 0.15,
  reviewComputeCost: 0.15,
  reviewEvidenceYield: 0.4,
  reviewRejectRate: 0.2,
  testComputeCost: 0.2,
  testTokenCost: 0.25,
  testEvidenceYield: 0.5,
  testFailureRate: 0.25,

  repairWasteInput: 0.8,
  repairComputeCost: 0.2,
  repairLessonYield: 0.5,
  repairDebtServiced: 0.3,

  trophallaxisContextTransfer: 0.2,
  trophallaxisBandwidthCost: 0.05,
  maxTrophallaxisPerWorker: 2,

  threatIntroRisk: 1,
  quarantineFraction: 0.85,
  trustPenaltyOnThreat: 0.1,

  evidenceToPromote: 4,

  contextExpiryPerCycle: 0.4,
  knowledgeStalingPerCycle: 0.15,

  energyRateByKind: { "deterministic-active": 1, "deep-cognitive": 1.15, "real-provider": 1.3 },
};
