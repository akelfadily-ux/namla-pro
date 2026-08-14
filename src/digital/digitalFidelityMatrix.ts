/**
 * digitalFidelityMatrix — the HONEST fidelity matrix for Digital Superorganism
 * Metabolism V1 (Build Law §23). For each system it states the biological
 * mechanism it descends from, the digital mapping, the implementation status,
 * and the runtime evidence. A system is only "fully-mechanistic" when it changes
 * real runtime state, another system reads that state, its effect appears in
 * event-sourced evidence, and its causal invariant passes. Anything shallower is
 * marked "partially-mechanistic"; anything deferred is "postponed". This module
 * deliberately does NOT overclaim.
 *
 * No fs, no child_process, no network, no wall clock, no module-level mutable state.
 */

import type { DigitalFidelityStatus } from "./digitalTypes";

export interface DigitalFidelityRow {
  readonly system: string;
  readonly biologicalMechanism: string;
  readonly digitalMapping: string;
  readonly status: DigitalFidelityStatus;
  readonly runtimeEvidence: string;
}

export const DIGITAL_FIDELITY_MATRIX: readonly DigitalFidelityRow[] = [
  {
    system: "Resource conservation ledger",
    biologicalMechanism: "colony resource economy (food/water conservation)",
    digitalMapping: "15 conserved digital resources; quantity = initial + collected + created - consumed - expired - quarantined",
    status: "fully-mechanistic",
    runtimeEvidence: "DigitalResourceEconomy.validate(); report.unexplainedResourceCreation === 0",
  },
  {
    system: "Metabolism (information -> knowledge -> artifacts)",
    biologicalMechanism: "digestion of forage into usable energy + brood mass",
    digitalMapping: "scout/verify/plan/build/review/test transforms consuming context, compute, tokens, tools",
    status: "fully-mechanistic",
    runtimeEvidence: "transformation ledger receipts; causal checks knowledge-has-source, artifact-has-inputs",
  },
  {
    system: "Trophallaxis (bounded local transfer)",
    biologicalMechanism: "mouth-to-mouth food sharing between co-located ants",
    digitalMapping: "team-local bounded knowledge/context reference transfer with bandwidth cost",
    status: "fully-mechanistic",
    runtimeEvidence: "digitalTrophallaxisEvents > 0 with matched bandwidthConsumed; per-team, not all-to-all",
  },
  {
    system: "Oxygen / tool access",
    biologicalMechanism: "oxygen availability gating aerobic work",
    digitalMapping: "bounded, revocable tool permits reserved from a capacity pool (available+held==initial)",
    status: "fully-mechanistic",
    runtimeEvidence: "toolAccessGrants/releases; report.toolAccessClosed; held==0 at end",
  },
  {
    system: "Energy / budgets",
    biologicalMechanism: "metabolic energy budget bounding activity",
    digitalMapping: "token/compute/context budgets consumed only, never created; exhaustion forces rest",
    status: "fully-mechanistic",
    runtimeEvidence: "consumed accumulators; workers rest when canAfford fails",
  },
  {
    system: "CO2 / waste recycling",
    biologicalMechanism: "metabolic waste + corpse processing",
    digitalMapping: "failures create errorWaste + technicalDebt; repair recycles waste into lessons",
    status: "fully-mechanistic",
    runtimeEvidence: "errorWasteCreated, wasteRecycled, remediationActions; causal check repaired-has-failure",
  },
  {
    system: "Disease + immunity",
    biologicalMechanism: "pathogen exposure, transmission, social immunity, quarantine",
    digitalMapping: "threats introduced as securityRisk; traced parcel transmission; quarantine + trust penalty",
    status: "partially-mechanistic",
    runtimeEvidence: "threatsIntroduced, transmissionEdges, securityThreatsDetected, quarantined; transmission model is a bounded proxy, not full parcel-graph epidemiology",
  },
  {
    system: "Brood + maturation",
    biologicalMechanism: "egg->larva->pupa->adult development gated by care",
    digitalMapping: "untrained->...->senior via mentored training, evidence-gated promotion",
    status: "fully-mechanistic",
    runtimeEvidence: "broodTrained, promotions; attemptPromotion enforces evidence; promotionWithoutEvidence === 0",
  },
  {
    system: "Bounded working hands",
    biologicalMechanism: "only a fraction of the colony forages at once",
    digitalMapping: "300/1k/10k persistent identities; deep-cognitive <=30; real-provider <=5, 0 calls",
    status: "fully-mechanistic",
    runtimeEvidence: "peakCognitiveWorkers <= 30; providerCalls === 0; scale run stays bounded",
  },
  {
    system: "Decentralized allocation",
    biologicalMechanism: "no ant commands another; task from local stimulus + threshold",
    digitalMapping: "voluntary claims via stable affinity x demand; Queen/Tamara publish only",
    status: "fully-mechanistic",
    runtimeEvidence: "voluntaryTaskClaims > 0; central/queen/tamara/globalPlanner assignments === 0",
  },
  {
    system: "Per-resource provenance metadata",
    biologicalMechanism: "each nutrient parcel has a source and freshness",
    digitalMapping: "parcels carry quality/freshness/confidence/provenance/accessPolicy",
    status: "partially-mechanistic",
    runtimeEvidence: "DigitalParcel metadata is tracked for flowing knowledge/artifacts; budgets are tracked in aggregate, not per-unit",
  },
  {
    system: "Monetary budget",
    biologicalMechanism: "energy reserves",
    digitalMapping: "monetaryBudget resource",
    status: "partially-mechanistic",
    runtimeEvidence: "conserved and consumable, but the deterministic scenario spends it lightly; real cost accounting is postponed",
  },
  {
    system: "Real cognitive providers (Claude/Codex)",
    biologicalMechanism: "specialist workers",
    digitalMapping: "real-provider workers, human-gated, budgeted, permit-scoped",
    status: "postponed",
    runtimeEvidence: "capped at 5, never invoked here (providerCalls === 0); live activation is a separate human-authorized pilot",
  },
];

export interface DigitalFidelitySummary {
  readonly total: number;
  readonly fullyMechanistic: number;
  readonly partiallyMechanistic: number;
  readonly placeholder: number;
  readonly postponed: number;
  readonly rows: readonly DigitalFidelityRow[];
}

export function summarizeDigitalFidelity(): DigitalFidelitySummary {
  const rows = DIGITAL_FIDELITY_MATRIX;
  const count = (s: DigitalFidelityStatus) => rows.filter((r) => r.status === s).length;
  return {
    total: rows.length,
    fullyMechanistic: count("fully-mechanistic"),
    partiallyMechanistic: count("partially-mechanistic"),
    placeholder: count("placeholder"),
    postponed: count("postponed"),
    rows,
  };
}
